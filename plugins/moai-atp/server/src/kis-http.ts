import { KIS_QUOTE_CATALOG } from "./normalize-kr-quote.js";
import { validateProviderQuoteJson } from "./domain.js";
import { SafeCredentialError } from "./local-credentials.js";

export type KisEnvironment = "production" | "paper";

export interface InMemoryKisCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
}

export interface KisCredentialProvider {
  getForMarketRead(): Promise<InMemoryKisCredentials>;
}

export interface KisQuoteTransport {
  getMarketSnapshot(symbol: string, board: "J" | "NX" | "UN", signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export class SafeKisError extends Error {
  constructor(readonly code: "request_contract_conflict" | "invalid_input" | "credential_missing" | "credential_rejected" | "credential_environment_invalid" | "auth_expired" | "rate_limited" | "upstream_timeout" | "request_cancelled" | "upstream_unavailable" | "upstream_rejected" | "schema_drift" | "response_too_large" | "pagination_not_supported" | "pagination_limit_reached" | "empty_response" | "duplicate_provider_business_date") {
    super(code);
    this.name = "SafeKisError";
  }
}

export const KIS_BASE_URL: Readonly<Record<KisEnvironment, string>> = Object.freeze({
  production: "https://openapi.koreainvestment.com:9443",
  paper: "https://openapivts.koreainvestment.com:29443",
});

/**
 * Maps a failed `getForMarketRead()` to the error a tool call reports (SPEC-ATP-AUTH-002 M2). The token path's own
 * SafeKisError codes (rate_limited, upstream_*, credential_rejected, schema_drift, ...) and the two credential-set
 * codes survive; any other credential-resolution failure (corrupt or unsafe key file, ...) stays credential_missing.
 */
export function kisCredentialError(error: unknown): SafeKisError {
  if (error instanceof SafeKisError) return error;
  if (error instanceof SafeCredentialError && (error.code === "credential_missing" || error.code === "credential_environment_invalid")) return new SafeKisError(error.code);
  return new SafeKisError("credential_missing");
}

const MIN_INTERVAL_MS = 1_000;
export class RequestPacer {
  private nextSlotAt = 0;
  constructor(private readonly minIntervalMs = MIN_INTERVAL_MS) {}

  async reserve(): Promise<void> {
    const now = Date.now();
    const slotAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slotAt + this.minIntervalMs;
    const waitMs = slotAt - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export const PROCESS_PACER = new RequestPacer();

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const lengthText = response.headers.get("content-length");
  if (lengthText && /^\d+$/.test(lengthText) && Number(lengthText) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeKisError("response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SafeKisError("response_too_large");
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } catch (error) {
    if (error instanceof SafeKisError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") throw new SafeKisError("upstream_timeout");
    if (error instanceof Error && error.name === "AbortError") throw new SafeKisError("request_cancelled");
    throw new SafeKisError("schema_drift");
  }
}

export interface KisQuoteCapture { rawResponseText: string; responseStatus: number; sourceUrl: string; }

export class AllowListedKisQuoteTransport implements KisQuoteTransport {
  constructor(
    private readonly environment: KisEnvironment,
    private readonly credentials: KisCredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxResponseBytes = 300_000,
    private readonly pacer: RequestPacer = PROCESS_PACER,
  ) {}

  async getMarketSnapshot(symbol: string, board: "J" | "NX" | "UN", outerSignal?: AbortSignal): Promise<Record<string, unknown>> {
    const capture = await this.getMarketSnapshotCapture(symbol, board, outerSignal);
    return validateProviderQuoteJson(capture.rawResponseText, this.maxResponseBytes).output!;
  }

  /** No credentials, headers or URL query strings are included in this capture. */
  async getMarketSnapshotCapture(symbol: string, board: "J" | "NX" | "UN", outerSignal?: AbortSignal): Promise<KisQuoteCapture> {
    if (!/^\d{6}$/.test(symbol) || !["J", "NX", "UN"].includes(board)) throw new SafeKisError("invalid_input");
    const credential = await this.credentials.getForMarketRead().catch((error: unknown) => { throw kisCredentialError(error); });
    if (!credential.appKey || !credential.appSecret || !credential.accessToken) throw new SafeKisError("credential_missing");
    await this.pacer.reserve();
    const base = KIS_BASE_URL[this.environment];
    const url = new URL(KIS_QUOTE_CATALOG.path, base);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", board);
    url.searchParams.set("FID_INPUT_ISCD", symbol);
    const signal = outerSignal ? AbortSignal.any([outerSignal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          appkey: credential.appKey,
          appsecret: credential.appSecret,
          tr_id: KIS_QUOTE_CATALOG.trId,
          custtype: "P",
          "content-type": "application/json; charset=utf-8",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new SafeKisError("upstream_unavailable");
      throw new SafeKisError("upstream_unavailable");
    }
    if (response.status === 401 || response.status === 403) throw new SafeKisError("auth_expired");
    if (response.status === 429) throw new SafeKisError("rate_limited");
    if (!response.ok) throw new SafeKisError("upstream_unavailable");
    const text = await readBoundedResponseText(response, this.maxResponseBytes);
    const envelope = validateProviderQuoteJson(text, this.maxResponseBytes);
    if (String(envelope.rt_cd ?? "0") !== "0") throw new SafeKisError("upstream_unavailable");
    if (!envelope.output || typeof envelope.output.stck_prpr !== "string") throw new SafeKisError("schema_drift");
    return { rawResponseText: text, responseStatus: response.status, sourceUrl: base + KIS_QUOTE_CATALOG.path };
  }
}
