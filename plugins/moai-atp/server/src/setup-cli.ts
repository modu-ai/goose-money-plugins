import { createInterface } from "node:readline/promises";
import { readTerminalChoice } from "./terminal-choice.js";
import { homedir } from "node:os";
import { deleteLocalCredentials } from "./local-credentials.js";
import { deleteHoldings, HoldingsError } from "./user-holdings.js";
import { readInvestorContext, saveInvestorContext, deleteInvestorContext, deleteOnboardingMarker, setupWasPresented, markSetupPresented, UserContextError, type InvestorContextAnswers } from "./user-context.js";

type Output = { write(value: string): unknown };
export type SetupAction = "reuse" | "edit" | "delete" | "delete-onboarding" | "delete-holdings" | "delete-local-data";
const choices = {
  objectives: ["long_term_growth", "income", "capital_preservation", "learning"],
  timeHorizon: ["under_1y", "1_3y", "3_5y", "5y_plus", "unspecified"],
  experience: ["new", "some", "experienced", "unspecified"],
  riskTolerance: ["low", "medium", "high", "unspecified"],
  riskCapacity: ["low", "medium", "high", "unspecified"],
  liquidityNeed: ["low", "medium", "high", "unspecified"],
  assetScope: ["domestic_equity", "domestic_etf", "domestic_futures", "overseas_equity", "overseas_etf", "overseas_futures"],
} as const;
const labels: Record<keyof InvestorContextAnswers, string> = {
  objectives: "투자 목표", timeHorizon: "투자 기간", experience: "투자 경험",
  riskTolerance: "변동성을 감내할 의향", riskCapacity: "손실을 감당할 여력",
  liquidityNeed: "가까운 시기의 자금 필요", assetScope: "관심 자산군",
};
const answerLabels: Record<string, string> = {
  long_term_growth: "장기 성장", income: "배당 수입", capital_preservation: "원금 보전", learning: "학습",
  under_1y: "1년 미만", "1_3y": "1~3년", "3_5y": "3~5년", "5y_plus": "5년 이상",
  unspecified: "미정", new: "초보", some: "일부 경험", experienced: "풍부한 경험",
  low: "낮음", medium: "보통", high: "높음", domestic_equity: "국내 주식", domestic_etf: "국내 ETF",
  domestic_futures: "국내 선물", overseas_equity: "해외 주식", overseas_etf: "해외 ETF", overseas_futures: "해외 선물",
};
export async function runSetupFlow(projectRoot: string, ask: (question: string) => Promise<string>, output: Output, homeDir = homedir(), action: SetupAction = "reuse", select?: (question: string, options: readonly string[], multi: boolean) => Promise<string>): Promise<number> {
  output.write("모두의 주식 · MoAI ATP — 로컬 공통 프로필 설정\n");
  // Design #9 §4 S1: one explicit confirmation clears the three decided local stores (rows 1·4·6).
  // The onboarding-presented marker (row 5) stays out — P-02 is undecided; --delete-onboarding
  // remains the opt-in path, and no deletion logic lives here: each store keeps its own guard.
  if (action === "delete-local-data") {
    const confirmed = await ask("로컬에 저장된 개인 데이터(공급자 키·투자 프로필·보유 snapshot)를 모두 삭제하려면 DELETE를 입력하세요: ") === "DELETE";
    if (!confirmed) {
      output.write("credentials_deleted=false\n");
      output.write("profile_deleted=false\n");
      output.write("holdings_deleted=false\n");
      return 0;
    }
    output.write(`credentials_deleted=${await deleteLocalCredentials(projectRoot, { confirmed, homeDir })}\n`);
    output.write(`profile_deleted=${await deleteInvestorContext(projectRoot, { confirmed, homeDir })}\n`);
    output.write(`holdings_deleted=${await deleteHoldings(projectRoot, { confirmed, homeDir })}\n`);
    return 0;
  }
  if (action === "delete-holdings") {
    const confirmed = await ask("PC에 저장한 보유 snapshot을 삭제하려면 DELETE를 입력하세요: ") === "DELETE";
    if (!confirmed) { output.write("holdings_deleted=false\n"); return 0; }
    output.write(`holdings_deleted=${await deleteHoldings(projectRoot, { confirmed, homeDir })}\n`); return 0;
  }
  const existing = await readInvestorContext(projectRoot, homeDir);
  if (action === "delete") {
    const confirmed = await ask("모든 프로젝트에서 공유하는 프로필을 삭제하려면 DELETE를 입력하세요: ") === "DELETE";
    if (!confirmed) { output.write("profile_deleted=false\n"); return 0; }
    output.write(`profile_deleted=${await deleteInvestorContext(projectRoot, { confirmed, homeDir })}\n`); return 0;
  }
  if (action === "delete-onboarding") {
    const confirmed = await ask("온보딩 제시 표시를 삭제하려면 DELETE를 입력하세요: ") === "DELETE";
    if (!confirmed) { output.write("onboarding_deleted=false\n"); return 0; }
    output.write(`onboarding_deleted=${await deleteOnboardingMarker(projectRoot, { confirmed, homeDir })}\n`); return 0;
  }
  if (existing && action === "reuse") {
    output.write(`profile_reused=true revision=${existing.revision}\n`); return 0;
  }
  if (!existing && action === "reuse" && await setupWasPresented(projectRoot, homeDir)) {
    output.write("onboarding_already_presented=true profile_available=false\n"); return 0;
  }
  output.write("첫 설정에서 투자 맥락 인터뷰를 한 번 제시합니다. 답변 거절·미정·일부 항목 미정 선택이 가능하며, 거절하거나 중단한 답변은 저장하거나 추정하지 않습니다. 명시 확인된 프로필만 여러 프로젝트에서 공유합니다. 응답은 ~/.goose/context/profile.json에 평문으로 저장되며 keystore와 분리됩니다. 제시 여부만 onboarding.json에 기록합니다. 진단·투자 적합성 판정이 아니며 백업·동기화는 별도입니다.\n");
  await markSetupPresented(projectRoot, homeDir);
  if (await ask("선택형 인터뷰를 시작하려면 YES를 입력하세요: ") !== "YES") {
    output.write("profile_saved=false\n"); return 0;
  }
  const answers: Record<string, string | string[]> = {};
  for (const key of Object.keys(choices) as (keyof InvestorContextAnswers)[]) {
    const values: readonly string[] = choices[key];
    const multi = key === "objectives" || key === "assetScope";
    for (;;) {
      const raw = select ? await select(labels[key], values.map(v => answerLabels[v] ?? v), multi) : await ask(`${labels[key]}: ${values.map((v, i) => `${i + 1}) ${answerLabels[v] ?? v}`).join(" / ")}${multi ? " (복수: 쉼표)" : ""}\n번호 또는 CANCEL: `);
      if (raw === "CANCEL") { output.write("profile_saved=false\n"); return 0; }
      if (!raw.trim()) continue;
      const indices = raw.split(",").map(v => { const text = v.trim(); return /^\d+$/.test(text) ? Number(text) - 1 : values.findIndex(value => (answerLabels[value] ?? value) === text); });
      if ((!multi && indices.length !== 1) || new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= values.length)) continue;
      answers[key] = multi ? indices.map(i => values[i]!) : values[indices[0]!]!; break;
    }
  }
  if (await ask("이 공통 프로필을 저장하려면 SAVE를 입력하세요: ") !== "SAVE") { output.write("profile_saved=false\n"); return 0; }
  const saved = await saveInvestorContext(answers as InvestorContextAnswers, projectRoot, { confirmed: true, homeDir, replace: action === "edit" });
  output.write(`profile_saved=true revision=${saved.revision}\n`); return 0;
}
export async function runSetup(action: SetupAction = "reuse"): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write("setup_requires_interactive_terminal\n"); return 2; }
  const ask = async (question: string) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { return await terminal.question(question); } finally { terminal.close(); }
  };
  const select = async (question: string, options: readonly string[], multi: boolean) => {
    const result = await readTerminalChoice(process.stdin, process.stdout, question, options, multi);
    if (result.kind === "cancelled") return "CANCEL";
    if (result.kind === "selected") return result.values.map(index => String(index + 1)).join(",");
    // Free input selects explicitly supported labels; arbitrary private notes are not stored.
    return ask(`${question} — 항목 이름 또는 번호${multi ? " (복수: 쉼표)" : ""}, 중단은 CANCEL: `);
  };
  try { return await runSetupFlow(process.cwd(), ask, process.stdout, homedir(), action, select); }
  catch (e) { process.stderr.write(`${e instanceof UserContextError || e instanceof HoldingsError ? e.code : "setup_failed"}\n`); return 2; }
}
