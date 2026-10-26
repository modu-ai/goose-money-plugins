import {body as historicalStockBody} from '../historical-stock-bars-fixtures.js';
import {dailyBody,minuteBody,overseasDailyBody,overseasMinuteBody} from '../futures-history-fixtures.js';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createStockMcpServer} from '../synthetic-member-access.js';
import daily from './kis039_daily_rows_synthetic.json' with {type:'json'};
import flow from './kis115_investor_flow_synthetic.json' with {type:'json'};
serveStdio(()=>createStockMcpServer({rightsEnabled:true,openDartEnabled:true,secEnabled:true,directoryEnabled:true,clock:()=> '2026-10-22T01:00:00Z',
 marketOrderbookTransport:{origin:'synthetic',async send(){return {status:200,tr_cont:'',body:{rt_cd:'0',output1:{bidp1:'100',askp1:'101',aspr_acpt_hour:'RAW CLOCK'},output2:[]}};}},
 historicalStockTransport:{origin:'synthetic',async send(){return {status:200,tr_cont:'',body:structuredClone(historicalStockBody)};}},
 futuresHistoryTransport:{origin:'synthetic',async send(r){return {status:200,tr_cont:'',body:structuredClone(r.operation==='kis.kr_futures_daily_history'?dailyBody:r.operation==='kis.kr_futures_minute_history'?minuteBody:r.operation==='kis.overseas_futures_daily_history'?overseasDailyBody:overseasMinuteBody)};}},
 etfProductTransport:{origin:'synthetic',async send(r){const output={std_pdno:'SYNTHETIC0001',prdt_eng_name:'Synthetic Product'};return {status:200,tr_cont:null,body:{rt_cd:'0',output:r.query.PDNO==='EMPTY'?[]:r.query.PDNO==='AMBIG'?[output,output]:output}};}},
 historyBreadthTransport:{origin:'synthetic',async send(r){return {status:200,tr_cont:null,body:{rt_cd:'0',...(r.operation==='kis.us_daily_history'?{output1:{rsym:'DNASAAPL'},output2:[]}:{output1:{stck_prpr:'100'},output2:[]})}};}},
 instrumentDirectory:{async load(){return {origin:'synthetic',source_received_at:'2026-10-22T00:00:00Z',source_as_of:null,source_url:'https://example.invalid/synthetic',coverage:'empty synthetic fixture',entries:[]};}},
 overseasFuturesTransport:{origin:'synthetic',async send(){return {status:200,tr_cont:null,body:{rt_cd:'0',output1:{last_price:'-1.25'}}};}},
 globalMarketTransport:{origin:'synthetic',async send(r){return {status:200,tr_cont:null,body:{rt_cd:'0',...(r.operation==='kis.us_quote'?{output:{rsym:'DNASAAPL',last:'100'}}:r.operation==='kis.futures_quote'?{output1:{hts_kor_isnm:'SYNTHETIC FUTURE',futs_prpr:'350'},output2:{},output3:{}}:{output:{stck_prpr:'100',nav:'100'}})}};}},
 secTransport:{origin:'synthetic',async send(r){return {status:200,body_text:JSON.stringify(r.operation==='sec.company_concept'?{cik:320193,entityName:'Synthetic Company',taxonomy:'us-gaap',tag:'Assets',label:'Assets',units:{USD:[]}}:{cik:320193,name:'Synthetic Company',tickers:[],exchanges:[],filings:{recent:{accessionNumber:[],filingDate:[],reportDate:[],acceptanceDateTime:[],form:[],primaryDocument:[],primaryDocDescription:[]},files:[]}})};}},
 historyTransport:{origin:'synthetic_fixture',async send(r){return {status:200,tr_cont:null,body:r.operation_ref==='KIS-039'?daily.response:flow.response};}},
 referenceTransport:{origin:'synthetic',async send(r){return {status:200,tr_cont:null,body:{rt_cd:'0',output:r.operation==='kis.profile'?{pdno:'000660',prdt_type_cd:'300',prdt_name:'Synthetic Company'}:[{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'Synthetic title'}]}};}},
 openDartTransport:{origin:'synthetic',async send(){return {status:'013',message:'no data fixture'};}},
 marketRiskTransport:{origin:'synthetic',async send(r){return {status:200,tr_cont:null,body:{rt_cd:'0',...(r.operation==='kis.credit'?{output:[]} :r.operation==='kis.short_sale'?{output1:{},output2:[]}:{output1:[]})}};}},
 filingsTransport:{origin:'synthetic',async send(){return {status:'013',message:'no data fixture'};}},
}),{legacy:'serve'});
