import { constants, type Stats } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const secret = z.string().min(1).max(512).regex(/^[!-~]+$/);
const providersSchema = z.object({
  kis: z.object({ appKey: secret, appSecret: secret }).strict().optional(),
  opendart: z.object({ apiKey: secret.length(40) }).strict().optional(),
}).strict();
const schema = z.object({ schemaVersion: z.literal(1), providers: providersSchema }).strict();
export type CredentialProviders = z.infer<typeof providersSchema>;
export type LocalCredentialDocument = z.infer<typeof schema>;
export class SafeCredentialError extends Error {
  constructor(readonly code: "credential_missing" | "credential_file_invalid" | "credential_file_unsafe" | "credential_io_failed" | "credential_confirmation_required" | "credential_environment_invalid" | "secure_file_storage_unsupported" | "setup_cancelled" | "setup_requires_interactive_terminal") {
    super(code); this.name = "SafeCredentialError";
  }
}
const MAX_BYTES = 16_384;
const errno = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
export const defaultCredentialFilePath = (homeDir = homedir()): string => join(homeDir, ".goose", "keystore", "credentials.json");
function safe(info: Stats): boolean {
  return info.isFile() && info.nlink === 1 && (info.mode & 0o077) === 0 && info.uid === process.getuid?.() && info.size <= MAX_BYTES;
}
async function directory(projectRoot: string, homeDir: string, create: boolean): Promise<string | undefined> {
  if (process.platform === "win32") throw new SafeCredentialError("secure_file_storage_unsupported");
  const home = await realpath(homeDir), project = await realpath(projectRoot);
  const target = join(home, ".goose", "keystore"), within = relative(project, target);
  if (!within || (!within.startsWith("..") && !isAbsolute(within))) throw new SafeCredentialError("credential_file_unsafe");
  for (const path of [join(home, ".goose"), target]) {
    if (create) await mkdir(path, { mode: 0o700 }).catch((e: unknown) => { if (errno(e) !== "EEXIST") throw e; });
    let info: Stats;
    try { info = await lstat(path); }
    catch (e) { if (!create && errno(e) === "ENOENT") return undefined; throw e; }
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new SafeCredentialError("credential_file_unsafe");
  }
  return target;
}
/** Shared setup/runtime contract. No OAuth, network, output or token persistence. */
export async function loadLocalCredentials(projectRoot = process.cwd(), homeDir = homedir()): Promise<LocalCredentialDocument | undefined> {
  let handle;
  try {
    const parent = await directory(projectRoot, homeDir, false);
    if (!parent) return undefined;
    handle = await open(join(parent, "credentials.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!safe(await handle.stat())) throw new SafeCredentialError("credential_file_unsafe");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    try {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAX_BYTES) throw new SafeCredentialError("credential_file_invalid");
      const parsed = schema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead))));
      if (!parsed.success) throw new SafeCredentialError("credential_file_invalid");
      return parsed.data;
    } finally { bytes.fill(0); }
  } catch (e) {
    if (errno(e) === "ENOENT") return undefined;
    if (e instanceof SafeCredentialError) throw e;
    throw new SafeCredentialError(["ELOOP", "ENOTDIR"].includes(errno(e) ?? "") ? "credential_file_unsafe" : "credential_file_invalid");
  } finally { await handle?.close(); }
}
/** Test-only fault-injection point for the atomic-write steps. Production call sites never pass it; a missing member is the node:fs/promises function. */
export interface SaveFsAdapter { open: typeof open; rename: typeof rename; link: typeof link; unlink: typeof unlink }
export async function saveLocalCredentials(patch: CredentialProviders, projectRoot: string, options: { confirmed: boolean; homeDir?: string; fsAdapter?: Partial<SaveFsAdapter> }): Promise<void> {
  if (!options.confirmed) throw new SafeCredentialError("credential_confirmation_required");
  const parsed = providersSchema.safeParse(patch);
  if (!parsed.success || !Object.keys(parsed.data).length) throw new SafeCredentialError("credential_file_invalid");
  const fsx: SaveFsAdapter = { open, rename, link, unlink, ...options.fsAdapter };
  const home = options.homeDir ?? homedir();
  const previous = await loadLocalCredentials(projectRoot, home);
  let handle, temporary: string | undefined;
  try {
    const parent = await directory(projectRoot, home, true);
    if (!parent) throw new SafeCredentialError("credential_io_failed");
    temporary = join(parent, `.credentials-${randomUUID()}.tmp`);
    handle = await fsx.open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ schemaVersion: 1, providers: { ...previous?.providers, ...parsed.data } }) + "\n");
    await handle.sync(); await handle.close(); handle = undefined;
    // Revalidate an existing destination before replacing it. Never follow links.
    await loadLocalCredentials(projectRoot, home);
    if (!previous) await fsx.link(temporary, join(parent, "credentials.json"));
    else await fsx.rename(temporary, join(parent, "credentials.json"));
  } catch (e) {
    if (e instanceof SafeCredentialError) throw e;
    throw new SafeCredentialError("credential_io_failed");
  } finally {
    await handle?.close();
    if (temporary) await fsx.unlink(temporary).catch((e: unknown) => { if (errno(e) !== "ENOENT") throw e; });
  }
}
/** Complete environment provider values override the file; partial values fail closed. */
export async function resolveProviderCredentials<P extends keyof CredentialProviders>(provider: P, options: { projectRoot?: string; homeDir?: string; env?: NodeJS.ProcessEnv } = {}): Promise<NonNullable<CredentialProviders[P]>> {
  const env = options.env ?? process.env;
  const selected = provider === "kis" ? [env.KIS_APP_KEY, env.KIS_APP_SECRET] : [env.OPENDART_API_KEY];
  if (selected.some(v => v !== undefined)) {
    const patch = provider === "kis" ? { kis: { appKey: selected[0], appSecret: selected[1] } } : { opendart: { apiKey: selected[0] } };
    const checked = providersSchema.safeParse(patch);
    if (!checked.success) throw new SafeCredentialError("credential_environment_invalid");
    return checked.data[provider] as NonNullable<CredentialProviders[P]>;
  }
  const document = await loadLocalCredentials(options.projectRoot, options.homeDir);
  const result = document?.providers[provider];
  if (!result) throw new SafeCredentialError("credential_missing");
  return result as NonNullable<CredentialProviders[P]>;
}
