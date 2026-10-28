// SPEC-ATP-ROLES-001 (card t35, regression-fix round R1): the non-regression table of the Goose planner.
//
// WHAT THIS TABLE IS
//   A fixed list of requests (legitimate, non-trade requests, plus the inputs of the retained routing probes) with the status, step count and
//   step ids the planner produced at commit 2d78f33 (the audited head of sync iteration 1; commit 024e905 is the original planner and its result is
//   kept in `at024` for the rows that existed then). `roles-nonregression.test.ts` asserts that the CURRENT planner returns exactly that triple for
//   every row. It is a regression net: a later change that moves any row fails the test, so an over-block cannot ride in unnoticed with a trade-form fix.
//   It does NOT claim that the planner classifies every phrasing; a sentence that is absent from the table is unmeasured.
// HOW A ROW MAY CHANGE
//   An intentional change goes in its own commit that edits the row's `status` / `steps` / `modes` AND fills `reason` (the integrity test requires a
//   non-empty reason for every row whose expectation differs from `baseline`). `baseline` ("status:steps") is the 2d78f33 measurement and never changes.
// ROW GROUPS
//   adversarial-1 / adversarial-2 / reread-extra3: the legitimate (class N / M) sentences of the sync auditor's probe sets, as the auditor classified them.
//   routing-probe-*: every input of the retained plan-phase probes (trade guards and unsupported / account rows included, so they stay blocked).
//   curated: representative backtest / strategy / mental-support / company-research / English rule-text sentences chosen for this table.
// Rows whose 2d78f33 status was already `blocked` or `unsupported` are in the table only when they are probe inputs. All sentences are synthetic.
// PINS (fix round 6)
//   The table itself is pinned by `roles-nonregression.test.ts`: the exact row count and a SHA-256 digest of the (sentence, baseline status,
//   baseline steps) pairs in table order, computed by `tablePairsDigest` at the end of this file. Deleting, adding, reordering or re-measuring a row
//   therefore fails a test even though the planner assertions would not notice. The comment block above the pins in that test file states how an
//   intentional table change must be made (own commit, pins updated with a reason, never together with a planner change).
import { createHash } from 'node:crypto';

export interface NonRegressionRow{
 readonly text:string;
 readonly status:'ready'|'clarification_required'|'blocked'|'unsupported';
 readonly steps:number;
 /** Step ids joined with `+` ('' for no steps). */
 readonly modes:string;
 readonly group:string;
 /** The 2d78f33 measurement as `status:steps`. Never edited. */
 readonly baseline:string;
 /** The 024e905 measurement as `status:steps` (information only). */
 readonly at024:string;
 /** Required when the expectation differs from `baseline`: why the change is intended. */
 readonly reason?:string;
}
export const NONREGRESSION_ROWS:readonly NonRegressionRow[]=[
 {text:"삼성전자 실적 분석 보고서",status:'ready',steps:2,modes:'analyze+report',group:"adversarial-1 legitimate",baseline:'ready:2',at024:'ready:2'},
 {text:"논문 근거로 매수·매도 규칙 설계",status:'ready',steps:1,modes:'strategy',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매도 신호 규칙을 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"이동평균 교차 매수 전략 백테스트해줘",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수 시점과 매도 시점을 정하는 전략 설계",status:'ready',steps:1,modes:'strategy',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 매수세 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"외국인 매도량 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"기관 순매수 상위 종목 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수하고 매도하는 규칙을 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"strategy 손절 규칙 정리",status:'ready',steps:1,modes:'strategy',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"ATS가 무엇인가요",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"자동매매가 뭔가요?",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"자동매매 시스템의 위험성 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"공매도 제도 설명 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"주문 체결 원리 설명해줘",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"이체 한도 제도 설명",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자 기업 분석 리포트 HTML로",status:'ready',steps:2,modes:'analyze+report',group:"adversarial-1 legitimate",baseline:'ready:2',at024:'ready:2'},
 {text:"SK하이닉스 수급 분석해줘",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"반도체 ETF 비교 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"KODEX 200 ETF 보유 종목 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수 후 보유 전략의 과거 성과 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"바이앤홀드 전략 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"buy and hold strategy backtest",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"explain how a limit order works",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자를 사야 할까요? 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"지금 삼성전자 사도 될까요? 기업 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔아야 하나요? 실적 분석해줘",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수 타이밍 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"금융 사고 사례 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"교사 사고 예방 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 기업조사주세요",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"도서관 사서 업무 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"사서 자격증 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 주가 분석 보고서 써줘",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"투자 심리 불안해요 멘탈 관리",status:'ready',steps:1,modes:'mental-support',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수 후회돼요 마음이 불안해",status:'ready',steps:1,modes:'mental-support',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"어제 삼성전자 매수했는데 불안해요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 10주 매수했어요. 실적 분석 보고서 부탁",status:'ready',steps:2,modes:'analyze+report',group:"adversarial-1 legitimate",baseline:'ready:2',at024:'ready:2'},
 {text:"매도 주문의 종류 설명",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"조건식 HTS 등록 방법 설명",status:'ready',steps:1,modes:'conditions',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"주문하고 체결되는 과정 설명",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"이체하고 받는 입장에서 세금 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 차트 분석 보고서 HTML",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose strategy 손절 규칙 정리",status:'ready',steps:1,modes:'strategy',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose-backtest 이동평균 전략",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'clarification_required:0'},
 {text:"/goose-backtest 매수하고 매도하는 규칙",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'clarification_required:0'},
 {text:"매수 신호가 나오면 매수하는 전략을 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"손절매 규칙 설계 논문 근거",status:'ready',steps:1,modes:'strategy',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자와 SK하이닉스 실적 비교 분석 보고서",status:'ready',steps:2,modes:'analyze+report',group:"adversarial-1 legitimate",baseline:'ready:2',at024:'ready:2'},
 {text:"매도 압력이 커진 종목 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"what is a market order",status:'clarification_required',steps:0,modes:'',group:"adversarial-1 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"backtest a strategy that buys 10 shares when RSI < 30",status:'ready',steps:1,modes:'backtest',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수가 몰린 종목 분석 보고서",status:'ready',steps:2,modes:'analyze+report',group:"adversarial-1 legitimate",baseline:'ready:2',at024:'ready:2'},
 {text:"주식 매수 주문 방법 설명 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-1 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"how to buy AAPL",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"why did the fund buy AAPL",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"buy-side research report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"should I buy AAPL? analysis report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"what happens when insiders sell shares",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"explain short selling",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"the short squeeze analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"buy signal backtest",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"sell rules design",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"when to sell a stock",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"analysts buy rating summary",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Buy low sell high strategy explained",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"buy now pay later companies analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Sell in May and go away strategy backtest",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Sell-side analyst report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"short interest analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"short-term momentum backtest",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Short selling ban impact report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"purchase price allocation analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"purchase agreement review",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Sell-through rate analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"buyback analysis report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Buy box share analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"why do people sell in panic? report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"backtest: buy when RSI < 30, sell when RSI > 70",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"strategy: buy on golden cross and sell on death cross, backtest it",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"compare buy vs rent analysis report",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"The CEO said they will buy more chips; analyze the supply chain",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자 팔고서 후회돼요 마음이 불안해",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 나서 불안해요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 나니 후회돼요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"어제 삼성전자 팔고 불안해요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"주식 다 팔고 나서 우울해요",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 mental-support",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"손절하고 나서 마음이 힘들어요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"손절해서 속상해요",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 mental-support",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"청산 당해서 불안해요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"팔고 나니까 주가가 올라서 멘탈이 나갔어요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 후회 중이에요 마음 관리 도와줘",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"손절했는데 후회돼요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"손절 규칙 설계해줘",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자 손절해야 할까요? 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"익절 기준 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"청산 절차 설명",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"주문 부탁 문구 예시",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"매수 부탁하는 방법 설명",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자 팔아도 될까요 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자 팔아야 할 시점 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"팔아 번 돈 세금 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"사놓은 주식 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"매수해 놓은 종목 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수해 둔 종목 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"매수해 두어야 할 종목 분석",status:'ready',steps:1,modes:'analyze',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 사는 타이밍 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"팔고 싶은데 불안해요",status:'ready',steps:1,modes:'mental-support',group:"adversarial-2 mental-support",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 있는 외국인 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자를 사 모은 사람들 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"삼성전자 사주 분석 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"우리 회사 사주조합 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"고객에게 사과해 주세요 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 매수 요청 증가 원인 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"매도 바람이 분 이유 분석",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"공매도 부탁 사례 연구 보고서",status:'ready',steps:1,modes:'report',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 사서 모으는 전략 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"적립식으로 사 모으는 전략 백테스트",status:'ready',steps:1,modes:'backtest',group:"adversarial-2 legitimate",baseline:'ready:1',at024:'ready:1'},
 {text:"buy button design review",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"short stories analysis",status:'clarification_required',steps:0,modes:'',group:"adversarial-2 legitimate",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"백테스트: buy when RSI < 30, sell when RSI > 70",status:'ready',steps:1,modes:'backtest',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"논문 근거로 buy when price > SMA20, sell when below 전략 설계",status:'ready',steps:1,modes:'strategy',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"buy when MACD crosses up; sell when it crosses down. backtest",status:'clarification_required',steps:0,modes:'',group:"reread-extra3",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Rules: buy at open, sell at close. backtest",status:'clarification_required',steps:0,modes:'',group:"reread-extra3",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"이동평균 전략 백테스트: buy at golden cross",status:'ready',steps:1,modes:'backtest',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"손실 뒤 마음이 불안해",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"만회 충동이 들어요 멘탈 관리",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 마음이 불안해",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"팔고서 후회 중",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"손절하고 불안해요",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"다 팔아버리고 싶어요 불안해",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"사고 나서 떨어져서 불안해요",status:'ready',steps:1,modes:'mental-support',group:"reread-extra3",baseline:'ready:1',at024:'ready:1'},
 {text:"전부 청산하고 나니 허탈해요",status:'clarification_required',steps:0,modes:'',group:"reread-extra3",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"/goose 삼성전자 매수해",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 삼성전자 10주 사줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 삼성전자 팔아줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose buy 005930 now",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 매도 예약 걸어줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 매일 아침 자동으로 매매해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 지금 매수 주문해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 주문 취소해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 송금 실행해",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 전략 실행해",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'unsupported:0'},
 {text:"/goose 백테스트 결과대로 실제 주문 넣어",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose strategy 논문으로 설계",status:'ready',steps:1,modes:'strategy',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose backtest 과거 검증",status:'ready',steps:1,modes:'backtest',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"goose-strategy 논문으로 설계",status:'ready',steps:1,modes:'strategy',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose goose-backtest 과거 검증",status:'ready',steps:1,modes:'backtest',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose-backtest 과거 검증",status:'ready',steps:1,modes:'backtest',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose-strategy 논문으로 설계",status:'ready',steps:1,modes:'strategy',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose conditions HTS 조건식 초안",status:'ready',steps:1,modes:'conditions',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/전략가 논문으로 전략 설계",status:'ready',steps:1,modes:'strategy',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/trade 삼성전자 매수해",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/account 잔고 조회",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 내 계좌 보유 종목 보여줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 잔고 조회",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 내 수익률 알려줘",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 내 포트폴리오 성과 분석",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 자동매매 시스템 구축해줘",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 퀀트 시스템트레이딩 엔진 만들어줘",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 팀 에이전트 상시 실행해줘",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 전략을 ATS로 보내서 실행해",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 24시간 돌아가는 매매 봇 만들어",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 예약 주문 자동화해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose CrewAI로 트레이딩 팀 구성해",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'clarification_required:0'},
 {text:"/goose 삼성전자 사줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 논문 근거로 퀀트 엔진 만들어줘",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'ready:1'},
 {text:"/goose 내 포트폴리오 성과 분석 보고서",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'ready:1'},
 {text:"/goose 논문 전략 실행해",status:'unsupported',steps:0,modes:'',group:"routing-probe-v4",baseline:'unsupported:0',at024:'unsupported:1'},
 {text:"/goose ATS가 무엇인가요",status:'clarification_required',steps:0,modes:'',group:"routing-probe-v4",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"/goose 내 계좌 수익률 알려줘",status:'blocked',steps:0,modes:'',group:"routing-probe-v4",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 논문 근거로 매수·매도 규칙 설계",status:'ready',steps:1,modes:'strategy',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose 매도 신호 규칙을 백테스트",status:'ready',steps:1,modes:'backtest',group:"routing-probe-v4",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose 삼성전자 실적 분석 보고서",status:'ready',steps:2,modes:'analyze+report',group:"routing-probe-v4",baseline:'ready:2',at024:'ready:2'},
 {text:"/goose 매매 봇 만들어서 삼성전자 사줘",status:'blocked',steps:0,modes:'',group:"routing-probe-extra",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 자동매매 시스템 구축하고 지금 매수 주문해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-extra",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 100만원 이체해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-extra",baseline:'blocked:0',at024:'blocked:0'},
 {text:"/goose 예수금 출금해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-extra",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose-strategy 삼성전자 사줘",status:'blocked',steps:0,modes:'',group:"routing-probe-h11",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose-strategy 논문 전략",status:'ready',steps:1,modes:'strategy',group:"routing-probe-h11",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose-order 삼성전자 매수",status:'blocked',steps:0,modes:'',group:"routing-probe-h11",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose-order 보고서",status:'ready',steps:1,modes:'report',group:"routing-probe-h11",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose 삼성전자 10주 매수하고 실적 분석 보고서",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'ready:2'},
 {text:"/goose 이체하고 종목 분석 보고서",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'ready:2'},
 {text:"/goose 자동매매 시스템 실행해줘 논문 전략 보고서",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'ready:2'},
 {text:"/goose 실제 매매 실행해줘",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose CrewAI로 자율매매 에이전트 팀 돌려줘",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose 100주 사줘",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"/goose goose-strategy 삼성전자 사줘",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'ready:1'},
 {text:"/goose 기업 조사 주세요",status:'clarification_required',steps:0,modes:'',group:"routing-probe-fix2",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"/goose 계좌 없이 기업 실적 분석",status:'ready',steps:1,modes:'analyze',group:"routing-probe-fix2",baseline:'ready:1',at024:'ready:1'},
 {text:"/goose 이체 비용이 수익률에 미치는 영향 분석",status:'clarification_required',steps:0,modes:'',group:"routing-probe-fix2",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"/goose 내 ETF 보유 종목 수익률",status:'blocked',steps:0,modes:'',group:"routing-probe-fix2",baseline:'blocked:0',at024:'clarification_required:0'},
 {text:"백테스트: buy AAPL when RSI < 30, sell AAPL when RSI > 70",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"strategy: buy if close crosses above SMA20, sell if close crosses below SMA20. backtest it",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Backtest rule: buy once RSI < 30 and sell after 5 days",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"전략 설계: buy on breakout, sell on stop",status:'ready',steps:1,modes:'strategy',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"백테스트 규칙 buy before earnings, sell after earnings",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"Rules: buy above SMA50, sell below SMA50. 전략 백테스트",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"논문 기반 전략: buy low sell high 를 백테스트",status:'ready',steps:2,modes:'strategy+backtest',group:"curated",baseline:'ready:2',at024:'ready:2'},
 {text:"이동평균 전략 백테스트 buy at golden cross, sell at death cross",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"moving average crossover: buy when fast > slow, sell when fast < slow, backtest",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"전략 설계 논문: buy when price > SMA20",status:'ready',steps:1,modes:'strategy',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"Signal definition: buy at close if RSI<30. 백테스트",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"buy when RSI < 30, sell when RSI > 70",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"Strategy rules: buy the dip, sell the rip. backtest",status:'ready',steps:1,modes:'strategy',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"백테스트: sell when the 20-day moving average crosses below the 60-day",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"논문 근거 전략 설계 buy signal sell signal 정의",status:'ready',steps:1,modes:'strategy',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"전략: buy and hold vs buy the dip 비교 백테스트",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 나서 불안해요 마음 정리 도와줘",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 나니까 마음이 편해요",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 나서 후회하는 심리 분석",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"팔고 나서 불안한 마음 어떻게 다스리죠",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 후회돼요",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"SK하이닉스 팔고 불안해서 잠이 안 와요",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"손절하고 나서 멘탈이 무너졌어요",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 팔고 나서 속상해요",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"팔고 나니 주가가 올랐어요 멘탈 관리",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"삼성전자 2분기 실적 분석 보고서",status:'ready',steps:2,modes:'analyze+report',group:"curated",baseline:'ready:2',at024:'ready:2'},
 {text:"SK하이닉스 재무 점검 리포트",status:'ready',steps:2,modes:'analyze+report',group:"curated",baseline:'ready:2',at024:'ready:2'},
 {text:"반도체 업종 공시 분석 보고서 HTML",status:'ready',steps:2,modes:'analyze+report',group:"curated",baseline:'ready:2',at024:'ready:2'},
 {text:"ETF 구성 비교 점검",status:'ready',steps:1,modes:'analyze',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"코스피200 선물 수급 분석",status:'ready',steps:1,modes:'analyze',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"논문 근거로 변동성 돌파 전략 설계",status:'ready',steps:1,modes:'strategy',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"이동평균 교차 전략 과거 검증 계획",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"백테스트 비용 모형 점검",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"walk-forward 검증 설계",status:'ready',steps:1,modes:'backtest',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"HTS 조건식 초안 작성",status:'ready',steps:1,modes:'conditions',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"조건식 MTS 변환 방법",status:'ready',steps:1,modes:'conditions',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"만회 충동이 들어요",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"손실이 커서 마음이 힘들어요",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"투자 후회 멘탈 관리 방법",status:'ready',steps:1,modes:'mental-support',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"구매 후기 분석 보고서",status:'ready',steps:1,modes:'report',group:"curated",baseline:'ready:1',at024:'ready:1'},
 {text:"purchase order process explained in a report",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"sell-side research report summary",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"buy-side vs sell-side analyst comparison report",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"how to buy AAPL stock explained",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"why did the fund sell AAPL last quarter analysis",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"buy rating changes summary report",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"short interest analysis report",status:'clarification_required',steps:0,modes:'',group:"curated",baseline:'clarification_required:0',at024:'clarification_required:0'},
 {text:"백테스트 결과 해석 보고서",status:'ready',steps:2,modes:'backtest+report',group:"curated",baseline:'ready:2',at024:'ready:2'},
];

/** The part of a row that the pins cover: the sentence and its 2d78f33 measurement. */
export type NonRegressionPairRow=Pick<NonRegressionRow,'text'|'baseline'>;

// CANONICAL FORM of the pinned pairs
//   One JSON array with one element per row, in table order. Each element is the three-element array [sentence, baseline status, baseline steps]:
//   the sentence as a JSON string, the status as a JSON string, the step count as a JSON number. `baseline` ("status:steps") is split at its single
//   colon. The text is `JSON.stringify` output with no indent and no extra whitespace, for example
//     [["삼성전자 실적 분석 보고서","ready",2],["삼성전자 매수세 분석","clarification_required",0]]
//   Non-ASCII characters are kept as they are (not \u-escaped) and the string is hashed as UTF-8. Nothing but these three fields enters the form, so
//   a change to status / steps / modes / group / at024 / reason does not move the digest. A baseline that is not `<letters_>:<digits>` throws.
export function tablePairsCanonical(rows:readonly NonRegressionPairRow[]):string{
 return JSON.stringify(rows.map(row=>{
  const match=/^([a-z_]+):(\d+)$/.exec(row.baseline);
  if(match===null)throw new Error(`baseline ${JSON.stringify(row.baseline)} of ${JSON.stringify(row.text)} is not <status>:<steps>`);
  return [row.text,match[1],Number(match[2])];
 }));
}

/** Lower-case hex SHA-256 of `tablePairsCanonical(rows)` encoded as UTF-8. */
export function tablePairsDigest(rows:readonly NonRegressionPairRow[]):string{
 return createHash('sha256').update(tablePairsCanonical(rows),'utf8').digest('hex');
}
