import {NarrativeDraftSchema,applyNarrativeDraft} from "./report-narrative.js";
import { randomUUID } from "node:crypto";
import { McpServer, ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { safeResult, MCP_RESPONSE_MAX_BYTES } from "./mcp-result.js";
import { ACTIVE_REPORT_ROUTE_IDS, ActiveReportInputSchema, ReportInputSchema, renderReportInputHtml } from "./report-pipeline.js";

const REPORT_HTML_MAX_BYTES = 6 * 1024 * 1024;
const REPORT_RESOURCE_TTL_MS = 5 * 60 * 1000;
const REPORT_RESOURCE_MAX_ENTRIES = 3;
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_RESOURCE_URI_PATTERN = /^moai-atp:\/\/reports\/[0-9a-f-]{36}$/i;

export const RenderReportHtmlInputSchema = z.object({
  report_input: ActiveReportInputSchema,
  narrative_draft: NarrativeDraftSchema.optional(),
  template: z.enum(["existing", "artboard-v2"]).optional(),
}).strict();

export const RenderReportHtmlOutputSchema = z.object({
  contract: z.literal("moai.stock.report-html.v1"),
  report_id: z.enum(ACTIVE_REPORT_ROUTE_IDS),
  mode: z.enum(["synthetic", "supplied", "actual", "mixed"]),
  filename: z.string().regex(/^[A-Z0-9-]+\.html$/),
  resource_uri: z.string().regex(REPORT_RESOURCE_URI_PATTERN),
  mime_type: z.literal("text/html"),
  size_bytes: z.number().int().positive().max(REPORT_HTML_MAX_BYTES),
  expires_at: z.string().datetime({ offset: true }),
  delivery: z.literal("mcp_resource_link"),
  host_rendering: z.literal("not_observed"),
  narrative_status:z.literal("host_draft_applied_unverified").optional(),
}).strict();

type CachedReport = {
  html: string;
  expires_at_ms: number;
  size_bytes: number;
};

export function registerReportHtmlTool(server: McpServer, clock: () => string, trustedReport:(doc:unknown)=>boolean=()=>false): void {
  const reports = new Map<string, CachedReport>();

  function currentTimeMs(): number {
    const value = Date.parse(clock());
    if (!Number.isFinite(value)) throw new Error("error_code=invalid_input");
    return value;
  }

  function purgeExpired(now: number): void {
    for (const [id, report] of reports) {
      if (report.expires_at_ms <= now) reports.delete(id);
    }
  }

  const reportTemplate = new ResourceTemplate("moai-atp://reports/{reportId}", { list: undefined });
  server.registerResource(
    "rendered-html-report",
    reportTemplate,
    {
      title: "Generated MoAI ATP HTML report",
      description: "Short-lived, in-memory HTML output created by render_report_html.",
      mimeType: "text/html",
    },
    async (uri, variables) => {
      const id = variables.reportId;
      if (typeof id !== "string" || !REPORT_ID_PATTERN.test(id) || uri.href !== "moai-atp://reports/" + id) {
        throw new ResourceNotFoundError(uri.href);
      }
      const now = currentTimeMs();
      purgeExpired(now);
      const report = reports.get(id);
      if (!report || report.expires_at_ms <= now) throw new ResourceNotFoundError(uri.href);
      return {
        contents: [{ uri: uri.href, mimeType: "text/html", text: report.html }],
      };
    },
  );

  server.registerTool(
    "render_report_html",
    {
      title: "보고서 HTML 생성",
      description: "build_report_input의 검증된 ReportInput을 단일 HTML 문서로 렌더하고 짧은 수명의 MCP resource_link를 반환합니다. 파일에 저장하지 않습니다. 자원은 메모리에 최대 5분 보관되며 실제 호스트 화면 표시·다운로드는 클라이언트 지원에 달려 있습니다. HTML 입력의 합성/실제/권리 상태와 미확인 값 표시를 보존합니다. narrative_draft는 호스트 산문·Goose 오피니언을 추가하며 숫자는 바인딩된 원본 지표로만 채웁니다. 원본 ReportInput 권리 검증은 그대로 유지합니다.",
      inputSchema: RenderReportHtmlInputSchema,
      outputSchema: RenderReportHtmlOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ report_input, narrative_draft, template }) => {
      const base = await safeResult(async () => {
        const doc = ReportInputSchema.parse(report_input);
        if(doc.sources.some(source=>source.kind!=='synthetic'&&source.kind!=='user_supplied'&&source.rights==='local_view')&&!trustedReport(doc))throw new Error('invalid_provenance');
        const narrativeDoc=narrative_draft?applyNarrativeDraft(doc,narrative_draft):doc;
        const html = renderReportInputHtml(narrativeDoc, template);
        const sizeBytes = Buffer.byteLength(html, "utf8");
        if (sizeBytes < 1 || sizeBytes > REPORT_HTML_MAX_BYTES) throw new Error("error_code=response_too_large");
        const now = currentTimeMs();
        const expiresAtMs = now + REPORT_RESOURCE_TTL_MS;
        const id = randomUUID();
        const uri = "moai-atp://reports/" + id;
        const date = doc.cutoff.slice(0, 10);
        const filename = doc.report_id + "-" + date + ".html";

        purgeExpired(now);
        while (reports.size >= REPORT_RESOURCE_MAX_ENTRIES) {
          const oldest = reports.keys().next().value;
          if (typeof oldest !== "string") break;
          reports.delete(oldest);
        }
        reports.set(id, { html, expires_at_ms: expiresAtMs, size_bytes: sizeBytes });

        return RenderReportHtmlOutputSchema.parse({
          contract: "moai.stock.report-html.v1",
          report_id: doc.report_id,
          mode: doc.mode,
          filename,
          resource_uri: uri,
          mime_type: "text/html",
          size_bytes: sizeBytes,
          expires_at: new Date(expiresAtMs).toISOString(),
          delivery: "mcp_resource_link",
          host_rendering: "not_observed",
          ...(narrative_draft?{narrative_status:"host_draft_applied_unverified" as const}:{}),
        });
      });
      const metadata = RenderReportHtmlOutputSchema.parse(base.structuredContent);
      const result = {
        ...base,
        content: [
          ...base.content,
          {
            type: "resource_link" as const,
            uri: metadata.resource_uri,
            name: metadata.filename,
            title: "MoAI ATP " + metadata.report_id + " HTML report",
            description: "UTF-8 HTML resource, " + metadata.size_bytes + " bytes. Read through resources/read before expiry. Host rendering or download is not confirmed by the server.",
            mimeType: metadata.mime_type,
            size: metadata.size_bytes,
          },
        ],
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MCP_RESPONSE_MAX_BYTES) {
        throw new Error("error_code=response_too_large");
      }
      return result;
    },
  );
}
