import { createInterface } from "node:readline/promises";
import { readTerminalChoice } from "./terminal-choice.js";
import { homedir } from "node:os";
import { defaultCredentialFilePath, loadLocalCredentials, saveLocalCredentials, SafeCredentialError, type CredentialProviders } from "./local-credentials.js";

type Output = { write(value: string): unknown };
/** No echo, no shell/argv/environment entry. Only an interactive local terminal. */
export function readHiddenLine(input: NodeJS.ReadStream, output: Output, prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") return Promise.reject(new SafeCredentialError("setup_requires_interactive_terminal"));
  return new Promise((resolve, reject) => {
    let value = "", finished = false;
    const wasRaw = input.isRaw;
    const finish = (cancel = false) => {
      if (finished) return; finished = true;
      input.removeListener("data", onData); input.removeListener("end", onCancel); input.removeListener("error", onCancel);
      try { input.setRawMode(wasRaw); } catch { cancel = true; }
      input.pause(); output.write("\n");
      const answer = value; value = "";
      if (cancel) reject(new SafeCredentialError("setup_cancelled")); else resolve(answer);
    };
    const onCancel = () => finish(true);
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ch === "\x03" || ch === "\x04") { finish(true); return; }
        if (ch === "\r" || ch === "\n") { finish(); return; }
        if (ch === "\x7f" || ch === "\b") { value = value.slice(0, -1); continue; }
        if (!/^[!-~]$/.test(ch) || value.length >= 512) { finish(true); return; }
        value += ch;
      }
    };
    output.write(prompt);
    try {
      input.setRawMode(true);
      input.on("data", onData); input.on("end", onCancel); input.on("error", onCancel); input.resume();
    } catch { finish(true); }
  });
}
export async function runCredentialSetupFlow(projectRoot: string, ask: (question: string) => Promise<string>, hidden: (question: string) => Promise<string>, output: Output, homeDir = homedir(), selectExisting?: (label: string) => Promise<"reuse" | "replace" | "cancel">): Promise<number> {
  output.write(`모두의 주식 · MoAI ATP — 선택적 키 설정\n저장 위치: ${defaultCredentialFilePath(homeDir)}\n평문·사용자 전용 권한이며 OS 키체인이나 암호화 저장소가 아닙니다. API 호출·토큰 발급은 수행하지 않습니다. 기존 키는 사용자 확인 후 그대로 재사용할 수 있습니다. Ctrl+C/D로 중단할 수 있습니다.\n`);
  if (await ask("키 설정을 시작하려면 YES: ") !== "YES") { output.write("credentials_saved=false\n"); return 0; }
  const existing = await loadLocalCredentials(projectRoot, homeDir);
  const patch: CredentialProviders = {};
  // A default is accepted only when the user submits Enter; never auto-submit.
  const replaceExisting = async (label: string, present: boolean): Promise<boolean> => {
    if (!present) return true;
    if (selectExisting) {
      const decision = await selectExisting(label);
      if (decision === "cancel") throw new SafeCredentialError("setup_cancelled");
      return decision === "replace";
    }
    for (;;) {
      const selection = (await ask(`${label} 키가 있습니다. 1) 기존 키 사용 [기본] / 2) 새로 입력 / CANCEL: `)).trim();
      if (selection === "" || selection === "1") return false;
      if (selection === "2") return true;
      if (selection === "CANCEL") throw new SafeCredentialError("setup_cancelled");
      output.write("1 또는 2를 선택하거나 CANCEL로 중단하세요.\n");
    }
  };
  if (await replaceExisting("KIS", Boolean(existing?.providers.kis))) {
    const appKey = await hidden("KIS App Key (숨김·빈 입력은 보류): ");
    const appSecret = await hidden("KIS App Secret (숨김·빈 입력은 보류): ");
    if (Boolean(appKey) !== Boolean(appSecret)) throw new SafeCredentialError("credential_file_invalid");
    if (appKey && appSecret) patch.kis = { appKey, appSecret };
  }
  if (await replaceExisting("OpenDART", Boolean(existing?.providers.opendart))) {
    const apiKey = await hidden("OpenDART API 키 (숨김·빈 입력은 보류): ");
    if (apiKey) patch.opendart = { apiKey };
  }
  if (!Object.keys(patch).length) {
    output.write(`credentials_reused=${Boolean(existing && Object.keys(existing.providers).length)} credentials_saved=false\n`); return 0;
  }
  if (await ask("위 경로에 키를 평문 저장하려면 SAVE: ") !== "SAVE") { output.write("credentials_saved=false\n"); return 0; }
  await saveLocalCredentials(patch, projectRoot, { confirmed: true, homeDir });
  output.write("credentials_saved=true\n"); return 0;
}
export async function runCredentialSetup(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write("setup_requires_interactive_terminal\n"); return 2; }
  // Never keep readline attached during hidden input: it would echo raw data.
  const ask = async (question: string) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { return await terminal.question(question); } finally { terminal.close(); }
  };
  try { return await runCredentialSetupFlow(process.cwd(), ask, q => readHiddenLine(process.stdin, process.stdout, q), process.stdout, homedir(), async label => {
    const choice = await readTerminalChoice(process.stdin, process.stdout, `${label} 키 재사용`, ["기존 키 사용 (기본)", "새로 입력"], false, false);
    return choice.kind === "cancelled" ? "cancel" : choice.kind === "selected" && choice.values[0] === 0 ? "reuse" : "replace";
  }); }
  catch (e) { process.stderr.write(`${e instanceof SafeCredentialError ? e.code : "setup_failed"}\n`); return 2; }
}
