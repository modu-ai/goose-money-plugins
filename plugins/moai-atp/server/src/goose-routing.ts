import {getReportWorkflow} from './report-workflows.js';

export const GOOSE_MODES=['setup','analyze','conditions','strategy','backtest','mental-support','report'] as const;
export type GooseMode=typeof GOOSE_MODES[number];
const refs:Record<GooseMode,string>={setup:'SKILL.md',analyze:'references/catalog.json',conditions:'references/workflows/conditions.md',strategy:'references/workflows/strategy.md',backtest:'references/workflows/backtest.md','mental-support':'references/workflows/mental-support.md',report:'references/report-writing.md'};

// SPEC-ATP-ROLES-001 design.md 3.2 / 3.5. Fixed answers for plans that carry no steps.
/** Fixed sentence F: trade-execution and ATS-class requests, with research-only alternatives. */
export const GOOSE_SENTENCE_F='이 플러그인은 지원하지 않으며 별도 시스템(ATS)의 영역입니다. 대신 기업·시장 조사나 투자 관점과 반증 조건 정리는 다시 요청해 주시면 도와드릴 수 있습니다. 실거래는 사용자께서 직접 판단·실행하십시오.';
/** Fixed sentence F_T: transfer / deposit / withdrawal commands only. Names no ATS and offers no strategy alternative. */
export const GOOSE_SENTENCE_F_T='이 플러그인은 이체·입출금을 지원하지 않습니다. 자금 이동은 사용자께서 직접 하십시오.';
export const GOOSE_SENTENCE_ACCOUNT='읽기 전용 보유·계좌 수익률 조회는 아직 제공하지 않습니다(별도 승인 뒤 제공 예정)';
export const GOOSE_SENTENCE_PERFORMANCE='수익률·성과를 계산할 입력(매입가 또는 자산곡선, 기간, 통화, 입출금 흐름)이 없어 계산할 수 없습니다';

/**
 * `pattern` runs on the NFC + lower-cased text. `split` runs on the separator-collapsed text: omitted = reuse `pattern`, `false` = skip.
 * `loose` (optional) runs on the text with punctuation, symbols and format characters removed but whitespace kept, so a
 * word-boundary check still works on `사_줘` (a collapsed view would glue `조사 주세요` into `조사주세요`).
 */
export interface GooseForm{readonly id:string;readonly pattern:RegExp;readonly split?:RegExp|false;readonly loose?:RegExp}
// Each form is checked on two views of the request: NFC + lower-cased text, and that text with whitespace,
// punctuation, symbols and format characters removed (split-form check). Forms with a wide `.{0,N}` window use a
// tight `split` pattern (or none) because removing whitespace would stretch the window over unrelated words.
// This narrows casual obfuscation only; it does not claim to block paraphrases. Zero steps and the absence of
// any order tool are the last line of defence.
const SEPARATORS=/[\s\p{P}\p{S}\p{Cf}]+/gu;
const MARKS=/[\p{P}\p{S}\p{Cf}]+/gu;
/** Ids of the form(s) in `forms` that match `text`. Pure, no side effects. */
export function matchGooseForms(forms:readonly GooseForm[],text:string):string[]{
 const normalized=text.normalize('NFC').toLowerCase();const collapsed=normalized.replace(SEPARATORS,'');const loose=normalized.replace(MARKS,'');
 return forms.filter(form=>{
  if(form.pattern.test(normalized))return true;
  if(form.loose!==undefined&&form.loose.test(loose))return true;
  const split=form.split===undefined?form.pattern:form.split;
  return split!==false&&split.test(collapsed);
 }).map(form=>form.id);
}
const END='(?=[\\s.!?~]*$)';
const IMPERATIVE='(?:줘|주세요|주라|줄래|라|봐|요|버려)';
const NOT_STATUS='(?!률|도|상황|현황|중)';
// Polite / formal request endings (fix 4, F1): `해 주십시오`, `사 주시겠어요`, `팔아 주실 수 있나요`, `해 주시면`, `해 주시고`. `주시는` (a described giver) is not a request.
// Fix 5 adds the wish `주셨으면` (`매수해 주셨으면 좋겠어요`) and the ability question `줄 수 있나요` (`매수해 줄 수 있나요`, `있어?`, `있을까요`); `줄 수 있는지` (a described ability) is not a request.
const POLITE_GIVE='(?:주(?:십시오|십쇼|시오|시겠|실래|실\\s*수|시면|시고|시죠|시지요|셔요|셨으면)|줄\\s*수\\s*있(?:나요?|어요?|을까요?|니|겠(?:어요?|습니까)|습니까|죠)(?![가-힣]))';
// `부탁` after a trade / transfer noun is a request (`매수 부탁드립니다`, `송금 부탁해`, `매수 부탁하고`); `부탁 문구`, `부탁하는 방법` (noun / description) are not.
// Fix 5 adds the formal wish `바랍니다` / `바라요` (`매수 바랍니다`); `바람` (wind, trend: `매도 바람이 분 이유`) and `바라는` (a described wish) are not requests.
const ASK='(?:부탁(?:해(?![석설야도])|드리|드립|드려|합니|하고|하며|하여|하오|\\s*좀|좀|(?=[\\s.!?~]*$))|바(?:랍니다|라요|래요))';
// Run-now command ending (`실행해`, `돌려줘`, `가동해`, bare `실행` as the whole request); a noun use (`실행 결과`, `실행 구조`) is not a command.
const RUN_NOW=`(?:(?:실행|가동|시작|구동|기동|작동|진행)\\s*(?:해(?![석설야도])|하(?:자|라|세요|십시오)|시켜|좀|부탁|합니다)|(?:실행|가동|시작|구동|기동|작동|진행)${END}|(?:돌려|돌리|켜|띄워)\\s*(?:줘|주세요|주라|줄래|봐|라|달라|버려)|(?:돌려|돌리|켜|띄워)${END})`;
// Connective forms (`매수하고`, `이체하고`, `매수해서`, `매수해 그리고`): the verb is followed by more of the sentence, so the command is not at the end.
// A wish / state (`하고 싶`, `하고 있`, `하고자`) and a rule-design description (`매수하고 매도하는 규칙`) are not commands.
const NOT_WISH='(?!자|\\s*(?:싶|있|계시|계신))';
// A descriptive clause is not a command either: `매수하고 매도하는 규칙`, `주문하고 체결되는 과정`, or a verb phrase that modifies the next noun (`이체하고 받는 입장`).
// These guards need whitespace, so the connective forms run on the original and the punctuation-stripped (whitespace kept) views only, never the collapsed one.
const NOT_RULE_DESIGN='(?![^.!?]{0,14}?(?:하는|되는|할|한|하기|하면)\\s*(?:규칙|전략|신호|시점|타이밍|방법|기준|조건|로직|알고리즘|흐름|과정|절차|구조|방식|원리|프로세스)|\\s*[가-힣]{1,6}는\\s)';
const CONNECTIVE=`(?:하고${NOT_WISH}${NOT_RULE_DESIGN}|해서(?!\\s*(?:안|는\\s*안|손실|이익|수익|손해))|해\\s*(?:놓고|두고|주고|그리고|그다음|그\\s*다음|이후))`;
const BUYSELL_CONNECTIVE=new RegExp(`(?:매수|매도|매매|주문)\\s*${CONNECTIVE}`,'u');
const FUND_CONNECTIVE=new RegExp(`(?:이체|송금|출금|입금)\\s*${CONNECTIVE}`,'u');
// Sell + buy chain (`삼성전자 팔고 SK하이닉스 사서 ...`): a sell connective (`팔고`, `팔고서`, `팔아서`) and a buy connective (`사서`, `사고`, `사고서`) in one clause, in either order.
// Each stem counts only as its own word (not preceded or followed by a Hangul syllable), so `사서 교사`-class words and `금융 사고 사례` (no sell stem) stay out. A wish / state
// (`팔고 싶`, `팔고 있`) and a described method (`사서 비교하는 방법`) end the chain without an order. This is the one place a trade needs no object particle or quantity: the pair is the evidence.
const SELL_STEM='(?<![가-힣])팔(?:고서?|아서)(?![가-힣])(?!\\s*(?:싶|있|계시|계신))';
const BUY_STEM='(?<![가-힣])사(?:서|고서?)(?![가-힣])(?!\\s*(?:싶|있|계시|계신))';
// Evidenced `사고` / `팔고`. A sell stem right after (`사고 파는 전략`, `사고 팔 때`, `사고 팔아야`) is a described action and ends the form; a connective or imperative sell stem
// (`사고 팔고`, `사고 팔아`, `사고 팔아서`) is a chain of orders, and `사고팔고` / `사고팔아` (no space) is checked the same way with the described-clause guard.
const SELL_FOLLOW='팔(?:고|아(?![야도]))';
const DESCRIBED_SELL='[파팔](?!고|아(?![야도]))';
const KO_SA_GO=new RegExp(`(?:\\d[\\d,.]*\\s*(?:주|개|만원|원어치|억)|\\d{5,6}|[을를])\\s*(?:만\\s*)?(?:사|팔)고(?:(?=${SELL_FOLLOW})${NOT_RULE_DESIGN}|(?![가-힣])(?!\\s*(?:싶|있|계시|계신|${DESCRIBED_SELL})))`,'u');
// Quantity evidence (`N주`, `N주식`, `N개`, `N원어치`, a 5-6 digit code) fused to the command word with no space (`10주사줘`, `5개팔아줘`, `005930매수`). The numeric evidence directly in front of the
// command is what makes the one-syllable stem `사` an order here, so no word list is needed and `기업조사주세요` (no number) stays out. The bare `매수` / `매도` must follow the quantity at once
// (`10주 매수 후 6개월` with a space is a narrative) and must not be the start of a noun (`매수세`, `매도량`, `매수자`).
const QUANTITY='(?:\\d[\\d,.]*\\s*(?:주식|주|개|(?:천|만|억)?원어치)|(?<![\\d,.])\\d{5,6}(?!\\d))';
const COMPACT_QUANTITY_ORDER=new RegExp(`${QUANTITY}\\s*(?:사\\s*(?:줘|주세요|주라|줄래|달라)|팔\\s*아\\s*(?:줘|주세요|주라|줄래|버려|라))|${QUANTITY}(?:매수|매도)(?!세|자|인|량|가|금|단|분|비|율|액|일|시|물)`,'u');
const SELL_BUY_CHAIN=new RegExp(`${SELL_STEM}[^.!?]{0,40}?${BUY_STEM}${NOT_RULE_DESIGN}|${BUY_STEM}[^.!?]{0,40}?${SELL_STEM}${NOT_RULE_DESIGN}`,'u');

// One-syllable stems `사` / `팔아` count only as their own word (not preceded by a Hangul syllable), now also with a polite / formal request ending.
const KO_SA_JWO=new RegExp(`(?<![가-힣])사\\s*(?:줘|주세요|주라|줄래|달라|${POLITE_GIVE})`,'u');
const KO_PAL_A_JWO=new RegExp(`(?<![가-힣])팔\\s*아\\s*(?:줘|주세요|주라|줄래|버려|라|${POLITE_GIVE})|\\d[\\d,.]*\\s*주\\s*(?:만\\s*)?팔(?:아|자|라)`,'u');
// Fix 4, L5 and slang / short imperatives. Explicit exit verbs (`손절해줘`, `익절해줘`, `청산해줘`) with a command ending; a rule or procedure noun (`손절 규칙`, `청산 절차`) and a should-I question (`손절해야`) are not commands.
const PLACE_AHEAD='(?:놔|놓아|둬|두어)(?![야도서])';
const SLANG_EXIT=new RegExp(`(?:손절매?|익절|청산)\\s*(?:을\\s*|를\\s*)?(?:해\\s*(?:줘|주세요|주라|줄래|달라|라|요|버려|봐(?![야도]))|해\\s*${POLITE_GIVE}|해\\s*${PLACE_AHEAD}|해${END}|하(?:자|라|세요|십시오|시오|십쇼)|시켜\\s*줘|${ASK})`,'u');
// `매수해놔`, `매도해 둬`, `팔아놔`, `주식 좀 사놔`: leave-it-done endings. `매수해 놓은` / `사놓은` (a state) are not commands. The one-syllable stems keep the own-word boundary.
const PLACE_AHEAD_ORDER=new RegExp(`(?:매수|매도|주문)\\s*해\\s*${PLACE_AHEAD}|(?<![가-힣])(?:팔\\s*아|사)\\s*${PLACE_AHEAD}`,'u');
// `팔아` as the last word (`삼성전자 팔아`, `전부 팔아`, `팔아라`); `팔아야` / `팔아도` and a non-final `팔아 번 돈` are not commands.
const PAL_A_TERMINAL=new RegExp(`(?<![가-힣])팔아(?:\\s*(?:버려|라))?${END}`,'u');
// A final `사` is an order only with object evidence in front of it: an object particle, a quantity or a 5-6 digit code (`삼성전자를 사`, `005930 사`, `삼성전자 10개 사`). A bare name before `사` is not evidence.
const SA_TERMINAL=new RegExp(`(?:${QUANTITY}|[을를])\\s*(?:만\\s*)?사${END}`,'u');
// A bare sell connective as its own word (`삼성전자 팔고 보고서`, `팔고서`): `팔고 싶`, `팔고 있` and a described clause (`팔고 사는 시점`) are not orders.
// A past narrative is not an order either (fix 5, mental support): `팔고 나니(까) ...` (a discovery after selling) and a sell connective followed in the same sentence by an
// emotion / regret word (`팔고 나서 불안해요`, `팔고서 후회 중`, `팔고 마음이 불안해`). The emotion window is short (20 characters) and stops at sentence punctuation. A command that merely
// carries a report request (`삼성전자 팔고 보고서`, `팔고 나서 보고서`) has no such word and stays blocked; a sell + buy chain is checked by its own form.
const PAL_NARRATIVE='(?!\\s*나니(?:까)?(?![가-힣]))(?![^.!?]{0,20}?(?:후회|불안|우울|멘탈|마음|속상|허탈|힘들|걱정|아쉽|억울|두렵|답답|괴롭|심란))';
const PAL_GO_CONNECTIVE=new RegExp(`(?<![가-힣])팔고서?(?![가-힣])(?!\\s*(?:싶|있|계시|계신))${PAL_NARRATIVE}${NOT_RULE_DESIGN}`,'u');
const FUND_TRANSFER_REQUEST=new RegExp(`(?:이체|송금)\\s*(?:을\\s*|를\\s*)?(?:${ASK}|하(?:시오|십시오|십쇼|세요)(?![가-힣]))`,'u');

// English trade commands (fix 4, F2). Imperative position only: the verb starts the request, follows sentence punctuation (`, then`, `. and`), or follows a request lead
// (`please`, `then`, `can you`, `I want you to`, `you should`, `go ahead and`, `let's`). `how to buy`, `why did the fund buy`, `should I buy`, `I want to buy` and `bought` are not in imperative position.
// The object must be a real token: a hyphen (`buy-side`, `sell-off`) or a descriptive head word (`buy and hold`, `buy signal`, `sell rules`, `buy rating`) ends the form. This is a measured range, not a complete English grammar.
// A request lead (`please`, `can you`, `I want you to`, ...) asks the reader to act, so a clause after it is a command whatever it says. A weak lead (the start, sentence punctuation, `then`, `now`, ...) only marks
// a clause position: in a rule description (`백테스트: buy when RSI < 30, sell when RSI > 70`) the same clause is a rule, not an order. A clause counts as a rule text only when it carries a rule-condition marker
// (`when`, `if`, `once`, `after`, `crosses`, a comparison operator, ...) AND the request is about a strategy, a rule or a backtest. Without that context `buy AAPL if it drops` stays a command.
const EN_STRONG_LEAD="\\b(?:please|kindly|(?:can|could|would|will)\\s+you(?:\\s+please)?|(?:i|we)\\s+(?:want|need)\\s+you\\s+to|(?:i|we)\\s*(?:'d|would)\\s+like\\s+you\\s+to|you\\s+(?:should|must|need\\s+to)|go\\s+ahead\\s+and|let\\s*'?s)\\s+";
const EN_WEAK_LEAD="(?:^|[.!?;:,]\\s*(?:(?:and|then|also)\\s+)?|\\b(?:just|then|also|now|first|next)\\s+)";
const EN_RULE_MARK='(?:\\b(?:when|whenever|if|once|after|before|until|unless|while|cross(?:es|ed|ing)?|above|below|golden\\s+cross|death\\s+cross|breakout|at\\s+(?:the\\s+)?(?:open|close))\\b|[<>]=?|≥|≤)';
const EN_RULE_CONTEXT='(?:백테스트|back-?test|전략|strateg|규칙|\\brules?\\b|signal|시그널|논문|walk.?forward|과거.{0,8}검증|simulat|시뮬레이션)';
const EN_RULE_TEXT=`(?:(?<=${EN_RULE_MARK}[^.!?;]*)|(?=[^.!?;]*${EN_RULE_MARK}))(?:(?<=${EN_RULE_CONTEXT}[\\s\\S]*)|(?=[\\s\\S]*${EN_RULE_CONTEXT}))`;
const EN_LEAD_NOT_RULE=`(?:${EN_STRONG_LEAD}|${EN_WEAK_LEAD}(?!${EN_RULE_TEXT}))`;
// Heads that make the word after the verb a rule condition or a descriptive term, not a target: `buy when`, `sell below`, `buy at open`, `buy on a golden cross`, `purchase price`, `buy button`, `buy now pay later`.
const EN_RULE_HEAD='when|whenever|if|once|after|before|until|unless|while|cross(?:es|ed|ing)?|above|below|under|over|on\\s+(?:a\\s+|the\\s+)?(?:golden|death|signal|breakout|cross|open|close|stop|dip|rally)|at\\s+(?:the\\s+)?(?:open|close|golden|death|signal|breakout|cross|next)|price|agreement|button|box|now\\s+pay';
const EN_DESCRIPTIVE=`(?!(?:and|or|vs|versus|low|high|side|signals?|ratings?|recommendations?|rules?|strateg(?:y|ies)|orders?|back|off|in\\s+may|the\\s+(?:dip|rip|rally)|pressure|discipline|decisions?|timing|points?|zones?|levels?|targets?|volume|logic|criteria|triggers?|conditions?|walls?|${EN_RULE_HEAD})\\b|-)`;
const EN_SHORT_DESCRIPTIVE=`(?!(?:selling|interest|term|squeeze|sales?|positions?|ratio|summary|list|version|answer|description|overview|review|intro(?:duction)?|explanation|notes?|report|stor(?:y|ies)|film|article|text|form|history|${EN_RULE_HEAD})\\b|-)`;
const EN_BUY_SELL_COMMAND=new RegExp(`${EN_LEAD_NOT_RULE}(?:buy|sell|purchase)\\s+${EN_DESCRIPTIVE}[^\\s.!?,;]`,'u');
const EN_SHORT_COMMAND=new RegExp(`${EN_LEAD_NOT_RULE}short\\s+${EN_SHORT_DESCRIPTIVE}[^\\s.!?,;]`,'u');

/** Trade-execution lexicon (design.md 3.1): commands only; bare nouns and explanations are not forms. */
export const GOOSE_TRADE_FORMS:readonly GooseForm[]=Object.freeze([
 // Existing baseline order wording, kept verbatim.
 {id:'order_command',pattern:/(?:주문|매수|매도).{0,6}(?:넣어|실행|해줘|해 줘)/u,split:false},
 {id:'ko_buysell_verb',pattern:new RegExp(`(?:매수|매도)\\s*(?:좀\\s*)?(?:해${IMPERATIVE}|해\\s*${POLITE_GIVE}|해${END}|하(?:자|라|세요|십시오|시오|십쇼)|진행${NOT_STATUS}|처리(?:해|하))`,'u')},
 // `삼성전자 매수 부탁드립니다`, `매도 부탁해`, `주문 부탁드립니다`: a request after the noun. Runs on the original and punctuation-stripped views only (a collapsed view would glue `부탁 해외` into `부탁해외`).
 {id:'ko_buysell_request',pattern:new RegExp(`(?:매수|매도|주문)\\s*(?:을\\s*|를\\s*)?(?:좀\\s*)?${ASK}`,'u'),split:false,loose:new RegExp(`(?:매수|매도|주문)\\s*(?:을\\s*|를\\s*)?(?:좀\\s*)?${ASK}`,'u')},
 // `삼성전자 매수` as a whole request (a bare trailing noun); preceded by whitespace or the start so `매수·매도 규칙 설계` is untouched.
 {id:'ko_buysell_bare_terminal',pattern:/(?:^|\s)(?:매수|매도)[\s.!?~]*$/u},
 // One-syllable verb stems (사, 팔) count only as their own word: `조사 주세요` / `연사 주세요` are not orders. The boundary is "not preceded by a Hangul syllable", checked on the
 // original and the punctuation-stripped view (whitespace kept); the whitespace-collapsed view would erase the boundary, so these forms skip it.
 {id:'ko_sa_jwo',pattern:KO_SA_JWO,split:false,loose:KO_SA_JWO},
 {id:'ko_n_ju_sa',pattern:new RegExp(`\\d[\\d,.]*\\s*주\\s*(?:만\\s*)?사(?:(?:라|자|요)(?![가-힣])|[\\s.!?~]*$)`,'u')},
 {id:'ko_pal_a_jwo',pattern:KO_PAL_A_JWO,split:/\d[\d,.]*주(?:만)?팔(?:아|자|라)/u,loose:KO_PAL_A_JWO},
 {id:'order_place',pattern:new RegExp(`주문\\s*(?:해${IMPERATIVE}|해\\s*${POLITE_GIVE}|해${END}|하(?:시오|십시오|십쇼|세요)|넣|걸어|접수|내\\s*줘|보내|진행${NOT_STATUS})`,'u')},
 {id:'order_cancel_modify',pattern:/주문\s*(?:을\s*)?(?:취소|정정|변경|수정)\s*(?:해|하|좀|부탁|요|$)|주문.{0,8}(?:취소|정정)해/u},
 {id:'reserved_order',pattern:/예약\s*(?:주문\s*(?:을\s*)?(?:자동화|걸|넣|해|등록|설정|실행|진행|내)|걸어|걸고|걸자|해\s*줘)|(?:매수|매도)\s*예약\s*(?:걸|해|등록|설정|넣)/u},
 {id:'auto_trading_command',pattern:/자동(?:으로)?\s*(?:매매|매수|매도|주문)\s*해(?![석설])|자동\s*매매\s*(?:돌려|돌리|실행|시작|가동|켜)|(?:매일|매주|매시간|매월|정기적으로|주기적으로).{0,24}(?:매매|매수|매도)\s*(?:해(?![석설])|돌려|실행)/u,split:/자동(?:으로)?(?:매매|매수|매도|주문)해(?![석설])|자동매매(?:돌려|돌리|실행|시작|가동|켜)/u},
 // Running an automated / autonomous trading system or agent team, and real trading, as a run-now command (`자동매매 시스템 실행해줘`, `자율매매 에이전트 팀 돌려줘`, `실제 매매 실행해줘`).
 // Building or keeping such a system running is the ATS-class lexicon below; both can match one request (blocked wins, design.md 3.5).
 {id:'auto_system_run',pattern:new RegExp(`(?:자동|자율|알고리즘)\\s*(?:매매|거래|트레이딩)(?:\\s*(?:시스템|프로그램|봇|엔진|에이전트|팀|프레임워크))*\\s*(?:을\\s*|를\\s*)?${RUN_NOW}`,'u')},
 {id:'real_trading_run',pattern:new RegExp(`(?:실제|실전|라이브)\\s*(?:매매|거래|주문|매수|매도)\\s*(?:을\\s*|를\\s*)?${RUN_NOW}`,'u')},
 {id:'en_auto_trading_run',pattern:/\b(?:run|start|launch|execute|turn\s+on)\s+(?:the\s+|my\s+|an?\s+)?(?:automated|auto|autonomous|algorithmic)[\s-]*trading\b/u},
 {id:'handoff_execute',pattern:/(?:으?로|에|에게)\s*(?:보내|넘겨|넘기|전달|전송)(?:서|고|어)?\s*(?:바로\s*|그대로\s*)?(?:실제\s*)?(?:실행|주문|매매)/u},
 {id:'fund_transfer_ko',pattern:/(?:이체|송금).{0,10}(?:해|실행|진행)/u,split:false},
 {id:'fund_withdraw_deposit',pattern:new RegExp(`(?:출금|입금)\\s*(?:해(?![석설야도])|하(?:자|라|세요|시오|십시오|십쇼)|실행|진행${NOT_STATUS}|처리|부탁|좀)`,'u')},
 // `50만원 송금 부탁드려요`, `이체 부탁드립니다`, `송금하시오`, `이체하십시오`: request / formal endings of a transfer. Original and punctuation-stripped views only.
 {id:'fund_transfer_request',pattern:FUND_TRANSFER_REQUEST,split:false,loose:FUND_TRANSFER_REQUEST},
 // Connective trade / transfer commands anywhere in the sentence (`삼성전자 10주 매수하고 실적 분석 보고서`, `이체하고 종목 분석 보고서`).
 {id:'ko_buysell_connective',pattern:BUYSELL_CONNECTIVE,split:false,loose:BUYSELL_CONNECTIVE},
 {id:'ko_fund_connective',pattern:FUND_CONNECTIVE,split:false,loose:FUND_CONNECTIVE},
 // `사고` / `팔고` are also the noun "accident" / a common word, so they count only with object evidence: a quantity, a 5-6 digit code or an object particle.
 {id:'ko_sa_go',pattern:KO_SA_GO},
 {id:'ko_sell_buy_chain',pattern:SELL_BUY_CHAIN,split:false,loose:SELL_BUY_CHAIN},
 {id:'ko_slang_exit_verb',pattern:SLANG_EXIT,split:false,loose:SLANG_EXIT},
 {id:'ko_place_ahead_order',pattern:PLACE_AHEAD_ORDER,split:false,loose:PLACE_AHEAD_ORDER},
 {id:'ko_pal_a_terminal',pattern:PAL_A_TERMINAL,split:false,loose:PAL_A_TERMINAL},
 {id:'ko_sa_terminal',pattern:SA_TERMINAL,split:false,loose:SA_TERMINAL},
 {id:'ko_pal_go_connective',pattern:PAL_GO_CONNECTIVE,split:false,loose:PAL_GO_CONNECTIVE},
 {id:'ko_quantity_compact_order',pattern:COMPACT_QUANTITY_ORDER,split:false,loose:COMPACT_QUANTITY_ORDER},
 // Account-change commands (REQ-SAF-001 / spec 0.2.0 scope: account changes are excluded). A bare noun (`계좌 해지 절차`) is not a form.
 {id:'account_change',pattern:new RegExp(`계좌\\s*(?:를\\s*|을\\s*)?(?:명의\\s*|비밀번호\\s*|한도\\s*)?(?:개설|해지|폐쇄|해약|이전|변경|수정|삭제|등록)\\s*(?:해(?![석설야도])|하(?:자|라|세요|십시오|고)|시켜|좀|부탁|요(?![가-힣])|${END})|(?:거래|이체|출금|입금|주문)\\s*한도\\s*(?:를\\s*|을\\s*)?(?:변경|수정|올려|내려|늘려|높여|낮춰|조정)`,'u')},
 {id:'en_buy_sell',pattern:/(?<![a-z0-9-])(?:buy|sell)\s+(?:(?:\d[\d,.]*\s+(?:shares?\s+(?:of\s+)?)?)?\d{5,6}\b|\d[\d,.]*\s+(?:shares?|stocks?)\b|\S+.{0,30}\b(?:now|immediately|asap|at\s+market|right\s+away)\b)/u},
 {id:'en_order',pattern:/\b(?:place|submit|send|put\s+in|make)\s+(?:an?\s+|the\s+|my\s+)?(?:buy\s+|sell\s+|market\s+|limit\s+|stop\s+)?orders?\b|\bcancel\s+(?:(?:all|any|every)\s+(?:of\s+)?)?(?:(?:the|my|an?|your)\s+)?(?:(?:open|pending|unfilled|outstanding|active|existing|remaining)\s+)*(?:(?:buy|sell|limit|stop|market)\s+)*orders?\b|\b(?:modify|amend)\s+(?:the\s+|my\s+|an?\s+)?orders?\b/u},
 // `buy AAPL`, `sell all my Tesla shares`, `please purchase 5 shares of X`, `short Tesla` (imperative position, see EN_LEAD). Original view only: the collapsed view would glue words.
 {id:'en_buy_sell_command',pattern:EN_BUY_SELL_COMMAND,split:false},
 {id:'en_short_command',pattern:EN_SHORT_COMMAND,split:false},
 {id:'en_transfer',pattern:/\b(?:transfer|wire|withdraw|deposit)\s+(?:[$₩€¥]?\d|funds?\b|money\b|cash\b|krw\b|usd\b|my\b)|\btransfer\b.{0,30}\b(?:account|bank)\b/u},
]);
// "Fund movement" forms select F_T; every other trade-execution form (and any ATS-class form) selects F.
const FUND_MOVEMENT_FORM_IDS=new Set(['fund_transfer_ko','fund_transfer_request','fund_withdraw_deposit','ko_fund_connective','en_transfer']);

const BUILD='(?:구축|만들|만드|개발|제작|설치|구성|구현|세팅)';
/** ATS-class lexicon (design.md 3.4): building / installing / keeping running a system. No order or execution command forms. */
export const GOOSE_ATS_FORMS:readonly GooseForm[]=Object.freeze([
 {id:'ats_autotrade_system',pattern:new RegExp(`자동\\s*매매\\s*(?:시스템|프로그램|봇|엔진)(?:.{0,6}${BUILD}|.{0,10}(?:운영|배포)\\s*(?:해(?![석설야도])|하(?:자|라|세요|십시오)|시켜|좀|부탁|${END}))|\\b(?:build|create|make|develop|deploy|set\\s+up)\\s+(?:an?\\s+)?(?:automated|algorithmic|auto)[\\s-]*trading\\s+(?:system|platform|engine|bot)`,'u')},
 {id:'ats_trading_bot',pattern:new RegExp(`(?:매매|트레이딩|주식|투자|거래|자동)\\s*(?:봇|bot)\\s*(?:을|를)?\\s*(?:만들|만드|개발|제작|구축|설치|구성|돌려|돌리|운영|띄워|배포)|(?:24\\s*시간|상시|항상|365\\s*일).{0,14}(?:돌아가|돌리|돌려|운영|작동|가동).{0,14}(?:봇|bot)|\\b(?:build|create|make|develop|deploy|run)\\s+(?:an?\\s+)?(?:\\S+\\s+){0,2}(?:trading|stock)\\s*bot`,'u'),split:/(?:매매|트레이딩|주식|투자|거래|자동)(?:봇|bot)(?:을|를)?(?:만들|만드|개발|제작|구축|설치|구성|돌려|돌리|운영|띄워|배포)/u},
 {id:'ats_quant_engine',pattern:new RegExp(`(?:퀀트|시스템\\s*트레이딩).{0,12}엔진.{0,10}(?:만들|만드|구축|개발|제작|설치|구성|구현|돌려|돌리|운영|실행|가동)|\\b(?:build|create|develop)\\s+.{0,12}(?:quant|system\\s*trading)\\s+engine`,'u'),split:/(?:퀀트|시스템트레이딩)(?:시스템트레이딩)?엔진(?:을|를)?(?:만들|만드|구축|개발|제작|설치|구성|구현|돌려|돌리|운영|실행|가동)/u},
 {id:'ats_team_agent',pattern:/팀\s*에이전트.{0,12}(?:상시|구성|만들|만드|운영|실행|돌려|돌리|가동)|(?:트레이딩|매매|투자|주식)\s*(?:에이전트\s*)?팀.{0,8}(?:구성|만들|만드|구축|운영|세팅|상시)|상시\s*(?:실행|운영|가동)?\s*(?:되는\s*)?(?:트레이딩\s*|매매\s*)?에이전트|(?:crewai|autogen|langgraph).{0,20}(?:팀|에이전트).{0,8}(?:구성|만들|구축)/u,split:/팀에이전트(?:상시|구성|만들|만드|운영|실행|돌려|돌리|가동)|(?:트레이딩|매매|투자|주식)(?:에이전트)?팀(?:을)?(?:구성|만들|만드|구축|운영|세팅|상시)|상시(?:실행|운영|가동)?(?:되는)?(?:트레이딩|매매)?에이전트/u},
]);

// Account rule (design.md 3.5): 계좌 / 잔고 / 예수금 / 보유 종목 forms. Public holdings of a fund (`ETF 보유 종목`) are not the user's account.
const FUND_HOLDINGS=/(?:etf|펀드|리츠|지수)\s*(?:의\s*)?(?:구성\s*)?보유\s*종목/gu;
const ACCOUNT_BASELINE=/계좌.{0,6}(?:조회|연결|분석)|(?:잔고|예수금).{0,6}(?:조회|분석)/u;
const ACCOUNT_FORMS:readonly RegExp[]=[
 ACCOUNT_BASELINE,
 /계좌/u,
 /(?<![가-힣])(?:내|제|나의|저의|우리)\s*(?:증권\s*|주식\s*)?(?:잔고|예수금|보유\s*종목)/u,
 /(?:잔고|예수금|보유\s*종목)\s*(?:을\s*|를\s*)?(?:조회|확인|보여|알려|현황|내역|목록|리스트|수익률|출금|입금|이체)/u,
 /\bmy\s+(?:account|holdings|positions|balance)\b|\baccount\s+(?:balance|holdings?|positions?)\b/u,
];
// Performance rule: the user's own return / performance with no price, quantity or ledger input in the request.
const PERFORMANCE_FORMS:readonly RegExp[]=[
 /(?<![가-힣])(?:내|제|나의|저의|우리|내가)\s*(?:투자\s*)?(?:포트폴리오\s*)?(?:수익률|수익|성과|손익)/u,
 /포트폴리오\s*(?:의\s*)?(?:성과|수익률|수익|손익)/u,
 /\bmy\s+(?:portfolio\s+)?(?:returns?|performance|pnl)\b/u,
];
const PERFORMANCE_INPUT=/\d[\d,.]*\s*(?:원|주|달러|usd|krw|%|만원|억원|억)/u;
// An explicit negation next to an account form (`계좌 없이`, `계좌 말고`, `계좌 제외`, `계좌를 연결하지 않고`) says the user does NOT want account data.
// Only the negated phrase is removed; a remaining holdings / balance / deposit form in the same request still counts.
const ACCOUNT_NEGATION=/계좌(?:\s*(?:조회|연결|연동|접근|접속|정보|분석|자료|내역))?\s*(?:을|를|은|는|이|가|와|과|도)?\s*(?:없이|없는|없고|없어도|말고|제외|빼고|뺀|무관하게|상관없이|(?:연결|연동|조회|접근|접속|사용|이용|참조|확인|보|쓰)(?:하)?지\s*(?:않|말)|필요\s*(?:없|하지\s*않))/gu;
// User-owned fund / asset holdings (`내 ETF 보유 종목`, `내가 가진 ETF`). The public-fund-holdings exemption below must not hide these: they are the user's account.
const OWNED_HOLDINGS:readonly RegExp[]=[
 /(?<![가-힣])(?:내|제|나의|저의|우리(?:의)?)\s*(?:etf|펀드|리츠|지수)\s*(?:의\s*)?(?:구성\s*)?(?:보유|잔고|평가)/u,
 /(?<![가-힣])(?:내|제|저|우리)가\s*(?:지금\s*|현재\s*)?(?:가진|가지고\s*있는|갖고\s*있는|보유한|보유\s*중인|들고\s*있는|투자한|산|매수한|소유한)\s*(?:etf|펀드|리츠|주식|종목|코인|자산)/u,
];
function matchesAccount(text:string):boolean{
 const cleaned=text.normalize('NFC').toLowerCase().replace(ACCOUNT_NEGATION,' ');
 return OWNED_HOLDINGS.some(form=>form.test(cleaned))||matchesAny(ACCOUNT_FORMS,cleaned);
}
function matchesAny(forms:readonly RegExp[],text:string):boolean{
 const normalized=text.normalize('NFC').toLowerCase().replace(FUND_HOLDINGS,' ');const views=[normalized,normalized.replace(SEPARATORS,'')];
 return forms.some(form=>views.some(view=>form.test(view)));
}

/** Conservative local planning helper. No model, provider dispatch, storage, evidence issuance or host registration. */
export function planGooseRequest(value:unknown){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x1f\x7f]/.test(value))throw new Error('invalid_input');
 let text=value.trim().replace(/^\/goose(?:\s+|$)/i,'');
 const tradeForms=matchGooseForms(GOOSE_TRADE_FORMS,text);const atsForms=matchGooseForms(GOOSE_ATS_FORMS,text);
 const first=text.split(/\s+/)[0]?.toLowerCase()??'';
 let explicit:GooseMode|undefined;let migrated=false;
 const slashMode=/^\/goose-(.+)$/.exec(first)?.[1];
 if(slashMode!==undefined){
  // Slash legacy form `/goose-<mode>` (H11): non-trading migration only, only for a currently mapped mode, and only when no trade-execution form is present.
  if((GOOSE_MODES as readonly string[]).includes(slashMode)&&tradeForms.length===0){explicit=slashMode as GooseMode;migrated=true;text=text.slice(first.length).trim();}
 }else{
  // Dash legacy forms `goose-<mode>` / `/goose goose-<mode>`: like the slash form, a trade-execution form in the request blocks the migration (REQ-ENT-003, H3 precedes migration).
  // The plain mode word (`/goose strategy ...`) is not a legacy form; it keeps its explicit mode.
  const dashLegacy=first.startsWith('goose-');
  if(!(dashLegacy&&tradeForms.length>0)){
   const legacy=dashLegacy?first.slice(6):first;
   explicit=GOOSE_MODES.includes(legacy as GooseMode)?legacy as GooseMode:undefined;
   migrated=explicit!==undefined&&dashLegacy;
   if(explicit)text=text.slice(first.length).trim();
  }
 }
 // Exact report IDs select packaged instructions, never a provider dispatch.
 let requestedReport:string|undefined;
 const reportToken=text.split(/\s+/)[0]??'';
 if((!explicit||explicit==='report')&&/^[RU]\d/i.test(reportToken)){
  requestedReport=reportToken.toUpperCase();explicit='report';text=text.slice(reportToken.length).trim();
 }
 const reportWorkflow=requestedReport?getReportWorkflow(requestedReport):undefined;
 const blockedActions:string[]=[];
 if(tradeForms.length)blockedActions.push('orders_or_transfers');
 const manualRoute=(!explicit||explicit==='analyze'||explicit==='report')&&!tradeForms.length&&!atsForms.length&&!/계좌|잔고|예수금|조회|연결|api/i.test(text)?(reportWorkflow?.scope==='manual_only'?reportWorkflow.id:/상담|점검|영향|비교/.test(text)?(/^수동\s*입력\s+보유/.test(text)?'R04':/^수동\s*입력\s+비용/.test(text)?'R05':undefined):undefined):undefined;
 const accountRequest=!manualRoute&&matchesAccount(text);
 if(accountRequest)blockedActions.push('account_access');
 const modes=new Set<GooseMode>();if(explicit)modes.add(explicit);
 if(manualRoute||reportWorkflow){modes.add('analyze');modes.add('report');}
 if(!explicit||explicit!=='setup'){
  if(/조건식|HTS|MTS/i.test(text))modes.add('conditions');
  if((/논문|전략.{0,10}(?:설계|만들)/.test(text))&&!/전략.{0,10}(?:만들지|설계하지)/.test(text))modes.add('strategy');
  if(/백테스트|과거.{0,8}검증|walk.?forward/i.test(text.replace(/백테스트\s*(?:(?:는|를|은|을)\s*)?(?:하지\s*(?:말고|않고)|말고|없이|제외하고|빼고)/g,'')))modes.add('backtest');
  if(/멘탈|불안|마음|후회|만회.{0,8}충동/.test(text))modes.add('mental-support');
  if(/보고서|리포트|HTML/i.test(text))modes.add('report');
  if(/(?:종목|기업|수급|실적|공시|재무|ETF|선물).{0,12}(?:분석|비교|점검)|분석.{0,10}(?:종목|기업|ETF|선물)/i.test(text))modes.add('analyze');
 }
 // Revision 6: futures (R13) is held for the initial release. An explicit exclusion such as '선물은 빼고' is not a futures request.
 const futuresText=text.replace(/선물\s*(?:은|는|을|를)?\s*(?:빼고|말고|제외하고|없이)/g,'');
 const reportId=requestedReport?(reportWorkflow?.id??null):manualRoute??(modes.has('report')||modes.has('analyze')?(/ETF/i.test(text)?'R12':/선물/.test(futuresText)?'R13':'R01'):null);
 const unsupported:string[]=[];
 if(requestedReport&&!reportWorkflow)unsupported.push('report_id_not_supported');
 if(reportWorkflow?.scope==='deferred')unsupported.push('report_scope_deferred');
 if(reportId==='R13')unsupported.push('report_release_hold');
 if(/게시|댓글|자료실.{0,8}(?:올려|업로드)/.test(text))unsupported.push('community_service_not_configured');
 if(/(?:조건식|조건).{0,10}(?:자동.{0,3}등록|저장해)/.test(text))unsupported.push('automatic_condition_registration_unavailable');
 if(/전략.{0,6}실행해/.test(text))unsupported.push('strategy_execution_engine_unavailable');
 if(atsForms.length)unsupported.push('ats_scope_unsupported');
 // Revision 6: backtest (R14/F17) is out of the product scope; the mode is detected only to classify the request.
 if(modes.has('backtest'))unsupported.push('backtest_out_of_product_scope');
 // The account rule decides first when a request asks for holdings or account returns; a backtest / strategy request about simulated results is not a performance request.
 const performanceRequest=!accountRequest&&matchesAny(PERFORMANCE_FORMS,text)&&!PERFORMANCE_INPUT.test(text.toLowerCase())&&!modes.has('backtest')&&!modes.has('strategy');
 if(performanceRequest)unsupported.push('performance_inputs_missing');
 const order:GooseMode[]=['setup','mental-support','conditions','strategy','analyze','backtest','report'];
 const chosen=order.filter(mode=>modes.has(mode));
 const status=blockedActions.length?'blocked':unsupported.length?'unsupported':chosen.length?'ready':'clarification_required';
 // Every blocked or unsupported plan has zero steps, whatever its reason code or mode word.
 const steps=status==='blocked'||status==='unsupported'?[]:chosen.map((mode,index)=>({id:mode,workflow_ref:reportWorkflow&&(mode==='analyze'||mode==='report')?reportWorkflow.workflow_ref:refs[mode],depends_on:index?[chosen[index-1]!]:[],execution_status:'not_run' as const,requirements:manualRoute?['explicit_manual_snapshot','private_output','no_provider_calls']:mode==='backtest'?['explicit_rules','validated_history','cost_model','supported_execution_engine']:mode==='report'?['validated_source_receipts','cutoff_and_units','report_input_validation']:[]}));
 const fundMovementOnly=tradeForms.length>0&&atsForms.length===0&&tradeForms.every(id=>FUND_MOVEMENT_FORM_IDS.has(id));
 const clarification=status==='clarification_required'?'어떤 대상에 대해 어떤 도움을 원하시나요?'
  :tradeForms.length||atsForms.length?(fundMovementOnly?GOOSE_SENTENCE_F_T:GOOSE_SENTENCE_F)
  :accountRequest?GOOSE_SENTENCE_ACCOUNT:performanceRequest?GOOSE_SENTENCE_PERFORMANCE:null;
 return {contract:'moai.goose.workflow-plan.v1' as const,status,explicit_mode:explicit??null,migrated_legacy_command:migrated,steps,report_id:reportId,...(reportWorkflow?{report_workflow:reportWorkflow}:{}),blocked_actions:blockedActions,unsupported_actions:unsupported,clarification,execution_authority:'plan_only' as const,host_registration:'unverified' as const,provider_dispatches:0,raw_request_retained:false};
}
