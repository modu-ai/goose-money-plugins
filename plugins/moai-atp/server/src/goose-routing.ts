export const GOOSE_MODES=['setup','analyze','conditions','strategy','backtest','mental-support','report'] as const;
export type GooseMode=typeof GOOSE_MODES[number];
const refs:Record<GooseMode,string>={setup:'SKILL.md',analyze:'references/catalog.json',conditions:'references/workflows/conditions.md',strategy:'references/workflows/strategy.md',backtest:'references/workflows/backtest.md','mental-support':'references/workflows/mental-support.md',report:'references/report-writing.md'};

// SPEC-ATP-ROLES-001 design.md 3.2 / 3.5. Fixed answers for plans that carry no steps.
/** Fixed sentence F: trade-execution and ATS-class requests (ATS wording plus strategy / backtest alternatives). */
export const GOOSE_SENTENCE_F='이 플러그인은 지원하지 않으며 별도 시스템(ATS)의 영역입니다. 대신 전략 수립(매매 전략 명세로 정리)이나 백테스트(과거 자료 검증 계획)는 다시 요청해 주시면 도와드릴 수 있습니다. 실거래는 사용자께서 직접 판단·실행하십시오.';
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

/** Trade-execution lexicon (design.md 3.1): commands only; bare nouns and explanations are not forms. */
export const GOOSE_TRADE_FORMS:readonly GooseForm[]=Object.freeze([
 // Existing baseline order wording, kept verbatim.
 {id:'order_command',pattern:/(?:주문|매수|매도).{0,6}(?:넣어|실행|해줘|해 줘)/u,split:false},
 {id:'ko_buysell_verb',pattern:new RegExp(`(?:매수|매도)\\s*(?:해${IMPERATIVE}|해${END}|하(?:자|라|세요|십시오)|진행${NOT_STATUS}|처리(?:해|하))`,'u')},
 // `삼성전자 매수` as a whole request (a bare trailing noun); preceded by whitespace or the start so `매수·매도 규칙 설계` is untouched.
 {id:'ko_buysell_bare_terminal',pattern:/(?:^|\s)(?:매수|매도)[\s.!?~]*$/u},
 // One-syllable verb stems (사, 팔) count only as their own word: `조사 주세요` / `연사 주세요` are not orders. The boundary is "not preceded by a Hangul syllable", checked on the
 // original and the punctuation-stripped view (whitespace kept); the whitespace-collapsed view would erase the boundary, so these forms skip it.
 {id:'ko_sa_jwo',pattern:/(?<![가-힣])사\s*(?:줘|주세요|주라|줄래|달라)/u,split:false,loose:/(?<![가-힣])사\s*(?:줘|주세요|주라|줄래|달라)/u},
 {id:'ko_n_ju_sa',pattern:new RegExp(`\\d[\\d,.]*\\s*주\\s*(?:만\\s*)?사(?:(?:라|자|요)(?![가-힣])|[\\s.!?~]*$)`,'u')},
 {id:'ko_pal_a_jwo',pattern:/(?<![가-힣])팔\s*아\s*(?:줘|주세요|주라|줄래|버려|라)|\d[\d,.]*\s*주\s*(?:만\s*)?팔(?:아|자|라)/u,split:/\d[\d,.]*주(?:만)?팔(?:아|자|라)/u,loose:/(?<![가-힣])팔\s*아\s*(?:줘|주세요|주라|줄래|버려|라)|\d[\d,.]*\s*주\s*(?:만\s*)?팔(?:아|자|라)/u},
 {id:'order_place',pattern:new RegExp(`주문\\s*(?:해${IMPERATIVE}|해${END}|넣|걸어|접수|내\\s*줘|보내|진행${NOT_STATUS})`,'u')},
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
 {id:'fund_withdraw_deposit',pattern:new RegExp(`(?:출금|입금)\\s*(?:해(?![석설야도])|하(?:자|라|세요)|실행|진행${NOT_STATUS}|처리|부탁|좀)`,'u')},
 // Connective trade / transfer commands anywhere in the sentence (`삼성전자 10주 매수하고 실적 분석 보고서`, `이체하고 종목 분석 보고서`).
 {id:'ko_buysell_connective',pattern:BUYSELL_CONNECTIVE,split:false,loose:BUYSELL_CONNECTIVE},
 {id:'ko_fund_connective',pattern:FUND_CONNECTIVE,split:false,loose:FUND_CONNECTIVE},
 // `사고` / `팔고` are also the noun "accident" / a common word, so they count only with object evidence: a quantity, a 5-6 digit code or an object particle.
 {id:'ko_sa_go',pattern:/(?:\d[\d,.]*\s*(?:주|개|만원|원어치|억)|\d{5,6}|[을를])\s*(?:만\s*)?(?:사|팔)고(?![가-힣])(?!\s*(?:싶|있|계시|계신|[파팔]))/u},
 // Account-change commands (REQ-SAF-001 / spec 0.2.0 scope: account changes are excluded). A bare noun (`계좌 해지 절차`) is not a form.
 {id:'account_change',pattern:new RegExp(`계좌\\s*(?:를\\s*|을\\s*)?(?:명의\\s*|비밀번호\\s*|한도\\s*)?(?:개설|해지|폐쇄|해약|이전|변경|수정|삭제|등록)\\s*(?:해(?![석설야도])|하(?:자|라|세요|십시오|고)|시켜|좀|부탁|요(?![가-힣])|${END})|(?:거래|이체|출금|입금|주문)\\s*한도\\s*(?:를\\s*|을\\s*)?(?:변경|수정|올려|내려|늘려|높여|낮춰|조정)`,'u')},
 {id:'en_buy_sell',pattern:/(?<![a-z0-9-])(?:buy|sell)\s+(?:(?:\d[\d,.]*\s+(?:shares?\s+(?:of\s+)?)?)?\d{5,6}\b|\d[\d,.]*\s+(?:shares?|stocks?)\b|\S+.{0,30}\b(?:now|immediately|asap|at\s+market|right\s+away)\b)/u},
 {id:'en_order',pattern:/\b(?:place|submit|send|put\s+in|make)\s+(?:an?\s+|the\s+|my\s+)?(?:buy\s+|sell\s+|market\s+|limit\s+|stop\s+)?orders?\b|\bcancel\s+(?:the\s+|my\s+|an?\s+)?(?:buy\s+|sell\s+|limit\s+|stop\s+)?orders?\b|\b(?:modify|amend)\s+(?:the\s+|my\s+|an?\s+)?orders?\b/u},
 {id:'en_transfer',pattern:/\b(?:transfer|wire|withdraw|deposit)\s+(?:[$₩€¥]?\d|funds?\b|money\b|cash\b|krw\b|usd\b|my\b)|\btransfer\b.{0,30}\b(?:account|bank)\b/u},
]);
// "Fund movement" forms select F_T; every other trade-execution form (and any ATS-class form) selects F.
const FUND_MOVEMENT_FORM_IDS=new Set(['fund_transfer_ko','fund_withdraw_deposit','ko_fund_connective','en_transfer']);

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
 const blockedActions:string[]=[];
 if(tradeForms.length)blockedActions.push('orders_or_transfers');
 const accountRequest=matchesAccount(text);
 if(accountRequest)blockedActions.push('account_access');
 const modes=new Set<GooseMode>();if(explicit)modes.add(explicit);
 if(!explicit||explicit!=='setup'){
  if(/조건식|HTS|MTS/i.test(text))modes.add('conditions');
  if((/논문|전략.{0,10}(?:설계|만들)/.test(text))&&!/전략.{0,10}(?:만들지|설계하지)/.test(text))modes.add('strategy');
  if(/백테스트|과거.{0,8}검증|walk.?forward/i.test(text))modes.add('backtest');
  if(/멘탈|불안|마음|후회|만회.{0,8}충동/.test(text))modes.add('mental-support');
  if(/보고서|리포트|HTML/i.test(text))modes.add('report');
  if(/(?:종목|기업|수급|실적|공시|재무|ETF|선물).{0,12}(?:분석|비교|점검)|분석.{0,10}(?:종목|기업|ETF|선물)/i.test(text))modes.add('analyze');
 }
 const unsupported:string[]=[];
 if(/게시|댓글|자료실.{0,8}(?:올려|업로드)/.test(text))unsupported.push('community_service_not_configured');
 if(/(?:조건식|조건).{0,10}(?:자동.{0,3}등록|저장해)/.test(text))unsupported.push('automatic_condition_registration_unavailable');
 if(/전략.{0,6}실행해/.test(text))unsupported.push('strategy_execution_engine_unavailable');
 if(atsForms.length)unsupported.push('ats_scope_unsupported');
 // The account rule decides first when a request asks for holdings or account returns; a backtest / strategy request about simulated results is not a performance request.
 const performanceRequest=!accountRequest&&matchesAny(PERFORMANCE_FORMS,text)&&!PERFORMANCE_INPUT.test(text.toLowerCase())&&!modes.has('backtest')&&!modes.has('strategy');
 if(performanceRequest)unsupported.push('performance_inputs_missing');
 const order:GooseMode[]=['setup','mental-support','conditions','strategy','analyze','backtest','report'];
 const chosen=order.filter(mode=>modes.has(mode));
 const status=blockedActions.length?'blocked':unsupported.length?'unsupported':chosen.length?'ready':'clarification_required';
 // Every blocked or unsupported plan has zero steps, whatever its reason code or mode word.
 const steps=status==='blocked'||status==='unsupported'?[]:chosen.map((mode,index)=>({id:mode,workflow_ref:refs[mode],depends_on:index?[chosen[index-1]!]:[],execution_status:'not_run' as const,requirements:mode==='backtest'?['explicit_rules','validated_history','cost_model','supported_execution_engine']:mode==='report'?['validated_source_receipts','cutoff_and_units','report_input_validation']:[]}));
 const fundMovementOnly=tradeForms.length>0&&atsForms.length===0&&tradeForms.every(id=>FUND_MOVEMENT_FORM_IDS.has(id));
 const clarification=status==='clarification_required'?'어떤 대상에 대해 어떤 도움을 원하시나요?'
  :tradeForms.length||atsForms.length?(fundMovementOnly?GOOSE_SENTENCE_F_T:GOOSE_SENTENCE_F)
  :accountRequest?GOOSE_SENTENCE_ACCOUNT:performanceRequest?GOOSE_SENTENCE_PERFORMANCE:null;
 return {contract:'moai.goose.workflow-plan.v1' as const,status,explicit_mode:explicit??null,migrated_legacy_command:migrated,steps,report_id:modes.has('report')||modes.has('analyze')?(/ETF/i.test(text)?'R12':/선물/.test(text)?'R13':'R01'):null,blocked_actions:blockedActions,unsupported_actions:unsupported,clarification,execution_authority:'plan_only' as const,host_registration:'unverified' as const,provider_dispatches:0,raw_request_retained:false};
}
