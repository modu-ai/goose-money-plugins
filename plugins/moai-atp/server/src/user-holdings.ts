import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, link, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EntitlementResult } from "./entitlement.js";
import { AccountBalanceResultSchema, type AccountBalanceTransport } from "./account-balance.js";

const decimal = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).max(32);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
// Closed fields: no account identity, keys, token, notes or arbitrary labels.
// Missing cash, quantities and costs stay absent; no defaults or coercion.
export const ManualHoldingsSchema = z.object({
  as_of: date, currency: z.string().regex(/^[A-Z]{3}$/),
  cash: decimal.optional(), liabilities: decimal.optional(),
  positions: z.array(z.object({
    symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,11}$/),
    quantity: decimal.optional(), market_value: decimal.optional(), cost_basis: decimal.optional(),
  }).strict()).max(100),
}).strict();
const SnapshotSchema = z.union([ManualHoldingsSchema, AccountBalanceResultSchema]);
export type HoldingsSnapshot = z.infer<typeof SnapshotSchema>;
export class HoldingsError extends Error {
  constructor(readonly code: "holdings_invalid" | "holdings_unsafe_path" | "holdings_io_failed" | "holdings_confirmation_required" | "holdings_entitlement_required") {
    super(code); this.name = "HoldingsError";
  }
}
const MAX_BYTES = 300_000;
const errno = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
export const holdingsFilePath = (homeDir = homedir()) => join(homeDir, ".goose", "context", "holdings-snapshot.json");
export function parseManualHoldings(value: unknown): z.infer<typeof ManualHoldingsSchema> {
  try { return ManualHoldingsSchema.parse(value); } catch { throw new HoldingsError("holdings_invalid"); }
}
function parseSnapshot(value: unknown): HoldingsSnapshot {
  try { return SnapshotSchema.parse(value); } catch { throw new HoldingsError("holdings_invalid"); }
}
function safeFile(info: Stats): boolean {
  return info.isFile() && info.nlink === 1 && (process.platform === "win32" || ((info.mode & 0o077) === 0 && info.uid === process.getuid?.()));
}
async function readJson(path: string): Promise<unknown> {
  if (process.platform === "win32") throw new HoldingsError("holdings_unsafe_path");
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!safeFile(info)) throw new HoldingsError("holdings_unsafe_path");
    if (info.size > MAX_BYTES) throw new HoldingsError("holdings_invalid");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new HoldingsError("holdings_invalid");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead)));
  } catch (e) {
    if (e instanceof HoldingsError) throw e;
    if (["ELOOP", "ENOTDIR"].includes(errno(e) ?? "")) throw new HoldingsError("holdings_unsafe_path");
    throw new HoldingsError("holdings_invalid");
  } finally { await handle?.close(); }
}
export async function readHoldingsFile(path: string) { return parseManualHoldings(await readJson(path)); }
async function directory(projectRoot: string, homeDir: string, create: boolean): Promise<string | undefined> {
  if (process.platform === "win32") throw new HoldingsError("holdings_unsafe_path");
  const home = await realpath(homeDir), project = await realpath(projectRoot);
  const target = join(home, ".goose", "context");
  const rel = relative(project, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new HoldingsError("holdings_unsafe_path");
  for (const path of [join(home, ".goose"), target]) {
    if (create) await mkdir(path, { mode: 0o700 }).catch((e: unknown) => { if (errno(e) !== "EEXIST") throw e; });
    let info;
    try { info = await lstat(path); } catch (e) { if (!create && errno(e) === "ENOENT") return undefined; throw e; }
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new HoldingsError("holdings_unsafe_path");
  }
  return target;
}
// Only fixed error codes escape local storage; never include supplied paths or contents.
async function local<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (e) { if (e instanceof HoldingsError) throw e; throw new HoldingsError("holdings_io_failed"); }
}
export async function readHoldings(projectRoot: string, homeDir = homedir()): Promise<HoldingsSnapshot | undefined> {
  return local(async () => {
    const dir = await directory(projectRoot, homeDir, false);
    if (!dir) return undefined;
    const path = join(dir, "holdings-snapshot.json");
    try { await lstat(path); } catch (e) { if (errno(e) === "ENOENT") return undefined; throw e; }
    return parseSnapshot(await readJson(path));
  });
}
type SaveOptions = { confirmed: boolean; homeDir?: string; replace?: boolean };
async function save(snapshot: unknown, projectRoot: string, options: SaveOptions): Promise<void> {
  if (!options.confirmed) throw new HoldingsError("holdings_confirmation_required");
  const value = parseSnapshot(snapshot), home = options.homeDir ?? homedir();
  return local(async () => {
    const previous = await readHoldings(projectRoot, home);
    if (previous && !options.replace) throw new HoldingsError("holdings_confirmation_required");
    const dir = await directory(projectRoot, home, true);
    if (!dir) throw new HoldingsError("holdings_io_failed");
    const path = join(dir, "holdings-snapshot.json"), temp = join(dir, `.holdings-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync();
      await handle.close(); handle = undefined;
      if (options.replace) await rename(temp, path); else await link(temp, path);
    } finally { await handle?.close(); await unlink(temp).catch((e: unknown) => { if (errno(e) !== "ENOENT") throw e; }); }
  });
}
export async function deleteHoldings(projectRoot: string, options: { confirmed: boolean; homeDir?: string }): Promise<boolean> {
  if (!options.confirmed) throw new HoldingsError("holdings_confirmation_required");
  // Delete even a corrupt snapshot without parsing its private contents.
  return local(async () => {
    const dir = await directory(projectRoot, options.homeDir ?? homedir(), false);
    if (!dir) return false;
    const path = join(dir, "holdings-snapshot.json");
    let info;
    try { info = await lstat(path); } catch (e) { if (errno(e) === "ENOENT") return false; throw e; }
    if (!safeFile(info) || info.isSymbolicLink()) throw new HoldingsError("holdings_unsafe_path");
    await unlink(path); return true;
  });
}
/** #7 boundary: the host supplies its verified-identity F14 evaluator, never a tool argument.
 * No default grant. Deletion is deliberately available without an active paid entitlement.
 * No MCP registration or automatic model/report projection of personal holdings.
 */
export function createHoldingsService(authorize: () => EntitlementResult) {
  function requirePaid() {
    try { const r = authorize(); if (r.decision === "allow" && r.tier === "paid") return; } catch { /* fixed denial */ }
    throw new HoldingsError("holdings_entitlement_required");
  }
  return {
    async manual(value: unknown) { requirePaid(); return parseManualHoldings(value); },
    async fromFile(path: string) { requirePaid(); return readHoldingsFile(path); },
    async fromKis(transport: AccountBalanceTransport) { requirePaid(); return parseSnapshot(await transport.read()); },
    async read(projectRoot: string, homeDir?: string) { requirePaid(); return readHoldings(projectRoot, homeDir); },
    async save(value: unknown, projectRoot: string, options: SaveOptions) { requirePaid(); return save(value, projectRoot, options); },
  };
}
