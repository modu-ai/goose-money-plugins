import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Closed choices only: never accept account data, secrets or counseling text.
export const investorContextAnswersSchema = z.object({
  objectives: z.array(z.enum(["long_term_growth", "income", "capital_preservation", "learning"])).min(1).max(4),
  timeHorizon: z.enum(["under_1y", "1_3y", "3_5y", "5y_plus", "unspecified"]),
  experience: z.enum(["new", "some", "experienced", "unspecified"]),
  riskTolerance: z.enum(["low", "medium", "high", "unspecified"]),
  riskCapacity: z.enum(["low", "medium", "high", "unspecified"]),
  liquidityNeed: z.enum(["low", "medium", "high", "unspecified"]),
  assetScope: z.array(z.enum(["domestic_equity", "domestic_etf", "domestic_futures", "overseas_equity", "overseas_etf", "overseas_futures"])).min(1).max(6),
}).strict();
const documentSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().positive(),
  confirmed: z.literal(true), confirmedAt: z.string().datetime({ offset: true }),
  answers: investorContextAnswersSchema,
}).strict();
export type InvestorContextAnswers = z.infer<typeof investorContextAnswersSchema>;
export type InvestorContextDocument = z.infer<typeof documentSchema>;
export type InvestorContextDimension = keyof InvestorContextAnswers;
export class UserContextError extends Error {
  constructor(readonly code: "context_invalid" | "context_unsafe_path" | "context_confirmation_required" | "context_io_failed") {
    super(code); this.name = "UserContextError";
  }
}
const MAX_BYTES = 8192;
const errno = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
export const investorContextFilePath = (homeDir = homedir()): string => join(homeDir, ".goose", "context", "profile.json");
function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
// POSIX-only until Windows ACL handling has its own validation. Reject broad
// permissions rather than chmod-ing existing user directories behind their back.
async function contextDirectory(homeDir: string, projectRoot: string, create: boolean): Promise<string | undefined> {
  if (process.platform === "win32") throw new UserContextError("context_unsafe_path");
  const home = await realpath(homeDir);
  const project = await realpath(projectRoot);
  const target = join(home, ".goose", "context");
  if (isInside(project, target)) throw new UserContextError("context_unsafe_path");
  for (const path of [join(home, ".goose"), target]) {
    if (create) await mkdir(path, { mode: 0o700 }).catch((e: unknown) => { if (errno(e) !== "EEXIST") throw e; });
    let info;
    try { info = await lstat(path); }
    catch (e) { if (!create && errno(e) === "ENOENT") return undefined; throw e; }
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
      throw new UserContextError("context_unsafe_path");
    }
  }
  return target;
}
function safeFile(info: Stats): boolean {
  return info.isFile() && !info.isSymbolicLink() && info.nlink === 1 &&
    (info.mode & 0o077) === 0 && info.uid === process.getuid?.() && info.size <= MAX_BYTES;
}
export async function readInvestorContext(projectRoot = process.cwd(), homeDir = homedir()): Promise<InvestorContextDocument | undefined> {
  let handle;
  try {
    const directory = await contextDirectory(homeDir, projectRoot, false);
    if (!directory) return undefined;
    // NONBLOCK prevents a substituted FIFO from hanging before descriptor checks.
    handle = await open(join(directory, "profile.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!safeFile(await handle.stat())) throw new UserContextError("context_unsafe_path");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new UserContextError("context_invalid");
    const parsed = documentSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead))));
    if (!parsed.success) throw new UserContextError("context_invalid");
    return parsed.data;
  } catch (e) {
    if (errno(e) === "ENOENT") return undefined;
    if (e instanceof UserContextError) throw e;
    if (["ELOOP", "ENOTDIR"].includes(errno(e) ?? "")) throw new UserContextError("context_unsafe_path");
    throw new UserContextError("context_invalid");
  } finally { await handle?.close(); }
}
// Records only that onboarding was presented, never an inferred personality.
// A declined/canceled first interview is not repeatedly offered in new projects.
export async function setupWasPresented(projectRoot: string, homeDir: string): Promise<boolean> {
  const directory = await contextDirectory(homeDir, projectRoot, false);
  if (!directory) return false;
  let handle;
  try {
    handle = await open(join(directory, "onboarding.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!safeFile(await handle.stat())) throw new UserContextError("context_unsafe_path");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new UserContextError("context_invalid");
    const record = z.object({ schemaVersion: z.literal(1), presented: z.literal(true) }).strict().safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytesRead))));
    if (!record.success) throw new UserContextError("context_invalid");
    return true;
  } catch (e) {
    if (errno(e) === "ENOENT") return false;
    if (e instanceof UserContextError) throw e;
    throw new UserContextError("context_invalid");
  } finally { await handle?.close(); }
}
export async function markSetupPresented(projectRoot: string, homeDir: string): Promise<void> {
  if (await setupWasPresented(projectRoot, homeDir)) return;
  const directory = await contextDirectory(homeDir, projectRoot, true);
  if (!directory) throw new UserContextError("context_io_failed");
  const file = await open(join(directory, "onboarding.json"), "wx", 0o600);
  try { await file.writeFile('{"schemaVersion":1,"presented":true}\n'); await file.sync(); }
  finally { await file.close(); }
}
export async function saveInvestorContext(answers: InvestorContextAnswers, projectRoot: string, options: { confirmed: boolean; homeDir?: string; replace?: boolean }): Promise<InvestorContextDocument> {
  if (!options.confirmed) throw new UserContextError("context_confirmation_required");
  const parsed = investorContextAnswersSchema.safeParse(answers);
  if (!parsed.success) throw new UserContextError("context_invalid");
  const home = options.homeDir ?? homedir();
  const previous = await readInvestorContext(projectRoot, home);
  if (previous && !options.replace) throw new UserContextError("context_confirmation_required");
  const directory = await contextDirectory(home, projectRoot, true);
  if (!directory) throw new UserContextError("context_io_failed");
  const path = join(directory, "profile.json");
  const document = documentSchema.parse({ schemaVersion: 1, revision: (previous?.revision ?? 0) + 1, confirmed: true, confirmedAt: new Date().toISOString(), answers: parsed.data });
  const temp = join(directory, `.profile-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(JSON.stringify(document) + "\n"); await handle.sync();
    await handle.close(); handle = undefined;
    if (!options.replace) {
      // Hard-link creation is atomic and cannot replace a concurrently saved profile.
      const { link } = await import("node:fs/promises"); await link(temp, path);
    } else {
      const current = await readInvestorContext(projectRoot, home);
      if (current?.revision !== previous?.revision) throw new UserContextError("context_io_failed");
      await rename(temp, path);
    }
    return document;
  } catch (e) {
    if (e instanceof UserContextError) throw e;
    throw new UserContextError("context_io_failed");
  } finally {
    await handle?.close();
    await unlink(temp).catch((e: unknown) => { if (errno(e) !== "ENOENT") throw e; });
  }
}
export async function deleteInvestorContext(projectRoot: string, options: { confirmed: boolean; homeDir?: string }): Promise<boolean> {
  if (!options.confirmed) throw new UserContextError("context_confirmation_required");
  const home = options.homeDir ?? homedir();
  if (!await readInvestorContext(projectRoot, home)) return false;
  await unlink(investorContextFilePath(await realpath(home)));
  return true;
}
export const onboardingFilePath = (homeDir = homedir()): string => join(homeDir, ".goose", "context", "onboarding.json");
/** Deletion command for the presented marker only (#43); the profile file is never touched here. */
export async function deleteOnboardingMarker(projectRoot: string, options: { confirmed: boolean; homeDir?: string }): Promise<boolean> {
  if (!options.confirmed) throw new UserContextError("context_confirmation_required");
  const home = options.homeDir ?? homedir();
  if (!await setupWasPresented(projectRoot, home)) return false;
  await unlink(onboardingFilePath(await realpath(home)));
  return true;
}
// No profile is sent to MCP or a model automatically. Caller explicitly selects
// relevant dimensions after user-authorized setup; this is self-reported context.
export function selectInvestorContext(profile: InvestorContextDocument | undefined, dimensions: readonly InvestorContextDimension[]) {
  if (!profile) return undefined;
  const validated = documentSchema.parse(profile);
  const fields: Partial<InvestorContextAnswers> = {};
  for (const key of new Set(dimensions)) {
    if (!Object.hasOwn(validated.answers, key)) throw new UserContextError("context_invalid");
    Object.assign(fields, { [key]: validated.answers[key] });
  }
  return { profileRevision: validated.revision, confirmedAt: validated.confirmedAt, source: "user_confirmed_local" as const, fields };
}
