import {createRequire} from 'node:module';
import {z} from 'zod';

export const REPORT_WORKFLOW_IDS=['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13'] as const;
const WorkflowSchema=z.object({
 id:z.enum(REPORT_WORKFLOW_IDS),title:z.string().min(1),command:z.string(),alias:z.string(),skill:z.string(),workflow_ref:z.string(),
 scope:z.enum(['partial_data','manual_only','conditional','deferred']),
 provider_tools:z.array(z.string().regex(/^get_[a-z_]+$/)),local_tools:z.array(z.enum(['build_report_input','render_report_html'])),
 sections:z.array(z.string()),input_requirements:z.string().min(1),calculation:z.string().min(1),limitations:z.string().min(1),
}).strict();
const require=createRequire(import.meta.url);
const document=z.object({contract:z.literal('moai.report-workflows.v1'),reports:z.array(WorkflowSchema).length(13)}).strict().parse(require('../contracts/report-workflows.v1.json'));
for(const [index,row] of document.reports.entries()){
 if(row.id!==REPORT_WORKFLOW_IDS[index]||row.command!==`/goose report ${row.id}`||row.alias!==`/goose ${row.id.toLowerCase()}`||row.skill!==`goose-report-${row.id.toLowerCase()}`||row.workflow_ref!==`references/reports/${row.id}.md`)throw new Error('report_workflow_contract_mismatch');
}

/** Fixed packaged instructions only. Neither this lookup nor the router calls providers. */
export function getReportWorkflow(id:string){
 const row=document.reports.find(item=>item.id===id);
 // Return fresh arrays so a caller cannot mutate later routing plans.
 return row?{...row,provider_tools:[...row.provider_tools],local_tools:[...row.local_tools],sections:[...row.sections]}:undefined;
}
