import { z } from "zod";
import type { ParsedKis039DailyBar } from "./r01-kis-field-parsers.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(80);
export const HistoryInputSchema = z.object({
  symbol:z.string().regex(/^\d{6}$/), board:z.enum(["J","NX","UN"]).default("J"),
  start_date:day, end_date:day, interval:z.literal("1d").default("1d"),
  adjustment_code:z.enum(["0","1"]),
}).strict().refine(v=>v.start_date<=v.end_date,"reversed_date_range");
export const HistoryBarSchema = z.object({
  date:day, open:decimal.nullable(), high:decimal.nullable(), low:decimal.nullable(), close:decimal.nullable(),
  volume:decimal.nullable(), turnover:decimal.nullable(),
  currency:z.literal("KRW").nullable(), price_unit:z.literal("KRW/share").nullable(),
  volume_unit:z.literal("shares").nullable(), turnover_unit:z.literal("KRW").nullable(),
  adjusted:z.boolean().nullable(), source_ref:z.string().min(1),
  mapping_status:z.enum(["verified","blocked"]), blockers:z.array(z.string()),
}).strict().superRefine((bar,ctx)=>{
  if (bar.mapping_status==="blocked" && [bar.open,bar.high,bar.low,bar.close,bar.volume,bar.turnover,bar.currency,bar.adjusted].some(v=>v!==null)) ctx.addIssue({code:"custom",message:"blocked_mapping_has_values"});
  if (bar.mapping_status==="verified" && (bar.blockers.length || !bar.currency || !bar.price_unit || !bar.volume_unit || !bar.turnover_unit || bar.adjusted===null)) ctx.addIssue({code:"custom",message:"verified_mapping_missing_semantics"});
});
export const HistoryResultSchema = z.object({
  contract:z.literal("moai.stock.price-history.v1"), provider:z.literal("kis"), operation_id:z.literal("KIS-039"),
  instrument:z.object({market:z.literal("KR"),symbol:z.string().regex(/^\d{6}$/),board:z.enum(["J","NX","UN"])}).strict(),
  interval:z.literal("1d"), requested_start:day,requested_end:day,
  origin:z.enum(["actual","synthetic"]),received_at:z.string().datetime({offset:true}),source_as_of:z.null(),
  rights_status:z.literal("pending"),completeness:z.literal("unknown"),
  bars:z.array(HistoryBarSchema).min(1).max(100),warnings:z.array(z.string()),
}).strict().superRefine((v,ctx)=>{
  if(v.requested_start>v.requested_end)ctx.addIssue({code:"custom",message:"reversed_date_range"});
  for(let i=0;i<v.bars.length;i++){
    const b=v.bars[i]!;
    if(b.date<v.requested_start||b.date>v.requested_end||(i>0&&v.bars[i-1]!.date>=b.date))ctx.addIssue({code:"custom",message:"invalid_bar_range_or_order"});
  }
});
/** No canonical KIS039 values are promoted until authoritative unit/adjustment review resolves all gates. */
export function buildHistoryResult(input:unknown,rows:readonly ParsedKis039DailyBar[]){
  const request=HistoryInputSchema.parse(input);
  if(rows.length===0)throw new Error("empty_response");
  const first=rows[0]!;
  for(const row of rows){
    if(row.symbol_from_request!==request.symbol||row.market_code_from_request!==request.board||row.requested_adjustment_code!==request.adjustment_code||row.observed_payload_origin!==first.observed_payload_origin||row.received_at!==first.received_at)throw new Error("history_context_mismatch");
  }
  return HistoryResultSchema.parse({
    contract:"moai.stock.price-history.v1",provider:"kis",operation_id:"KIS-039",
    instrument:{market:"KR",symbol:request.symbol,board:request.board},interval:"1d",
    requested_start:request.start_date,requested_end:request.end_date,
    origin:first.observed_payload_origin==="synthetic_fixture"?"synthetic":"actual",
    received_at:first.received_at,source_as_of:null,rights_status:"pending",completeness:"unknown",
    bars:rows.map(row=>({date:row.provider_business_date,open:null,high:null,low:null,close:null,volume:null,turnover:null,currency:null,price_unit:null,volume_unit:null,turnover_unit:null,adjusted:null,source_ref:`KIS-039:${request.symbol}:${row.provider_business_date}`,mapping_status:"blocked",blockers:row.canonical_blockers})).sort((a,b)=>a.date.localeCompare(b.date)),
    warnings:["Canonical OHLCV withheld: endpoint units and adjustment semantics remain unresolved.","Business dates are not source publication timestamps; range completeness is unknown."],
  });
}
