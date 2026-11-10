import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {buildReportInput,renderReportInputHtml} from '../src/report-pipeline.js';

const at='2026-11-10T03:00:00Z';
function report(){
 return renderReportInputHtml(buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성 인쇄 차트',venue:'KRX',currency:'KRW'},cutoff:at,received_at:at,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:{contract:'moai.stock.quote-snapshot.v1',provider:'kis',origin:'synthetic',provenance:{origin:'synthetic',validation_status:'synthetic_fixture',source_as_of:null,received_at:at},data:{last:'12345',open:'12000',high:'12500',low:'11900',previous_close:'12000',change:'345',change_percent:'2.875',volume:'1000'}}}}]}));
}
// Evaluate the generated stylesheet's simple class rules, including active media and cascade order.
// Actual CSS layout/pagination remains a separate browser/PDF check; this is no browser substitute.
function declarations(html:string,classes:string[],print:boolean,width:number){
 const result:Record<string,{value:string;priority:number;order:number}>={};let order=0;
 function rules(css:string){
  let position=0;
  while(position<css.length){
   const start=css.indexOf('{',position);if(start<0)break;
   let end=start+1,depth=1;while(end<css.length&&depth){if(css[end]==='{')depth++;if(css[end]==='}')depth--;end++;}
   const selector=css.slice(position,start).trim(),body=css.slice(start+1,end-1);position=end;
   if(selector.startsWith('@media')){
    const max=/max-width\s*:\s*(\d+)px/.exec(selector),min=/min-width\s*:\s*(\d+)px/.exec(selector);
    if((!selector.includes('print')||print)&&(!selector.includes('screen')||!print)&&(!max||width<=Number(max[1]))&&(!min||width>=Number(min[1])))rules(body);
   }else if(!selector.startsWith('@'))for(const part of selector.split(',')){
    const selected=part.trim();if(!/^(?:\.[\w-]+)+$/.test(selected))continue;
    const names=selected.slice(1).split('.');if(!names.every(name=>classes.includes(name)))continue;
    for(const declaration of body.split(';')){
     const colon=declaration.indexOf(':');if(colon<0)continue;
     const name=declaration.slice(0,colon).trim(),raw=declaration.slice(colon+1).trim(),priority=names.length+(/!important\s*$/.test(raw)?1000:0),value=raw.replace(/\s*!important\s*$/,'');
     const expanded=name==='overflow'?Object.fromEntries(['overflow-x','overflow-y'].map((axis,index)=>[axis,value.split(/\s+/)[index]??value])):{[name]:value};
     for(const [property,part] of Object.entries(expanded)){order++;if(!result[property]||priority>=result[property]!.priority)result[property]={value:part,priority,order};}
    }
   }
  }
 }
 for(const match of html.matchAll(/<style>([\s\S]*?)<\/style>/g))rules(match[1]!.replace(/\/\*[\s\S]*?\*\//g,''));
 const computed=Object.fromEntries(Object.entries(result).map(([name,entry])=>[name,entry.value]));
 const x=computed['overflow-x']??'visible',y=computed['overflow-y']??'visible';
 computed['overflow-x']=x==='visible'&&!['visible','clip'].includes(y)?'auto':x==='clip'&&!['visible','clip'].includes(y)?'hidden':x;
 computed['overflow-y']=y==='visible'&&!['visible','clip'].includes(x)?'auto':y==='clip'&&!['visible','clip'].includes(x)?'hidden':y;
 return computed;
}
function renderChart(html:string,width:number,height:number,engine=true){
 const context=vm.createContext({console,setTimeout,clearTimeout});
 vm.runInContext(readFileSync(new URL('../../assets/report-runtime/echarts-6.1.0.min.js',import.meta.url),'utf8'),context);
 const real=context.echarts,charts:any[]=[],status={textContent:''},elements=new Map();
 real.setPlatformAPI({measureText:(text:string)=>({width:String(text).length*8})});
 const specs=JSON.parse(/<script id="chart-specs" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!);
 for(const spec of specs.echart)elements.set(spec.id,{clientWidth:width,dataset:{},closest:()=>({querySelector:()=>status})});
 const adapter={init(){const chart=real.init(null,null,{renderer:'svg',ssr:true,width,height});charts.push(chart);return chart;}};
 Object.assign(context,{document:{body:{},getElementById:(id:string)=>id==='chart-specs'?{textContent:JSON.stringify(specs)}:elements.get(id)},window:engine?{echarts:adapter}:{},echarts:adapter,getComputedStyle:()=>({getPropertyValue:()=> '#D71920'}),ResizeObserver:class{observe(){}}});
 const runtime=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(match=>match[1]!.includes('window.__moaiEcharts'))![1]!;
 try{vm.runInContext(runtime,context);return {svg:charts.map(chart=>chart.renderToSVGString()).join(''),layouts:charts.flatMap(chart=>{const data=chart.getModel().getSeriesByIndex(0).getData();return Array.from({length:data.count()},(_,index)=>data.getItemLayout(index));}),states:[...elements.values()].map(element=>element.dataset.renderStatus),status:status.textContent};}
 finally{for(const chart of charts)chart.dispose();}
}

for(const width of [640,390])test(`active print styles keep the real bundled ECharts bars visible within a ${width}px printable container`,()=>{
 const html=report(),scroll=declarations(html,['chart-scroll'],true,width),chart=declarations(html,['echart'],true,width);
 const output=renderChart(html,width,parseInt(chart.height??'320',10));
 assert.equal(output.layouts.length,4);assert.equal((output.svg.match(/ecmeta_ssr_type="chart"/g)??[]).length,4);assert.deepEqual(output.states,['ready']);
 assert.notEqual(scroll.display,'none','the SVG-bearing chart-scroll must participate in print layout');
 assert.equal(scroll['overflow-x'],'visible','later reader styles must not restore horizontal print scrolling');
 assert.equal(scroll['overflow-y'],'visible','print must not compute a vertical scroll container');
 assert.equal(chart.width,'100%');assert.equal(chart['min-width'],'0');
 for(const bar of output.layouts){assert.ok(bar.x>=0&&bar.width>0);assert.ok(bar.x+bar.width<=width,JSON.stringify(bar));}
 assert.match(html,/>12,345<\/td>/);assert.match(html,/표의 원수치가 기준/);
});
test('print table wrappers let all raw rows participate in pagination without scroll-container clipping',()=>{
 const html=report(),table=declarations(html,['table-wrap'],true,640);
 assert.equal(table['overflow-x'],'visible');assert.equal(table['overflow-y'],'visible');
 assert.match(html,/>12,345<\/td>/);
});
test('the stylesheet check expands overflow shorthand in cascade order and computes the coupled axes',()=>{
 const styles=(body:string)=>`<style>@media print{${body}}</style>`;
 const laterLonghand=declarations(styles('.chart-scroll{overflow:visible}.chart-scroll{overflow-x:auto}'),['chart-scroll'],true,640);
 assert.equal(laterLonghand['overflow-x'],'auto');assert.equal(laterLonghand['overflow-y'],'auto');
 const laterShorthand=declarations(styles('.chart-scroll{overflow-x:auto;overflow:visible}'),['chart-scroll'],true,640);
 assert.equal(laterShorthand['overflow-x'],'visible');assert.equal(laterShorthand['overflow-y'],'visible');
});
test('screen scrolling, wide scatter minimum width and engine-missing raw-value fallback remain available',()=>{
 const html=report(),screen=declarations(html,['chart-scroll'],false,390),wideScreen=declarations(html,['echart','wide-chart'],false,390),widePrint=declarations(html,['echart','wide-chart'],true,640);
 assert.equal(screen['overflow-x'],'auto');assert.notEqual(screen.display,'none');assert.equal(wideScreen['min-width'],'600px');assert.equal(widePrint['min-width'],'0');
 const fallback=renderChart(html,640,320,false);assert.deepEqual(fallback.states,['engine_missing']);assert.equal(fallback.svg,'');assert.match(fallback.status,/원수치를 확인/);assert.match(html,/>12,345<\/td>/);
});
