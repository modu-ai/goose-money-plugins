import { boundedBody } from './global-market-data.js';
import { compareInstants, ExactInstantSchema } from './exact-instant.js';
import { z } from 'zod';
const Role = z.enum(['company-analysis', 'disclosure-event', 'market-behavior', 'valuation', 'fact-check-report-qa']);
type RoleId = z.infer<typeof Role>;
const Ref = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const Time = ExactInstantSchema;
const validInstants=(values:(string|null)[])=>values.every(value=>value===null||Time.safeParse(value).success);
const Evidence = z.object({ evidence_ref: Ref, origin: z.enum(['actual', 'synthetic']), received_at: Time, source_as_of: Time.nullable() }).strict();
export const GoosePlanSchema = z.object({ run_id: Ref, requested_scope: z.string().min(1).max(2000), roles: z.array(Role).min(1).max(5), cutoff_at: Time, evidence: z.array(Evidence).max(200), execution_preference: z.enum(['sequential', 'parallel_if_available']).default('sequential'), timeout_ms: z.number().int().min(1).max(60000).default(30000) }).strict().superRefine((x, c) => { if(!validInstants([x.cutoff_at,...x.evidence.flatMap(e=>[e.received_at,e.source_as_of])]))return; if (new Set(x.roles).size !== x.roles.length || new Set(x.evidence.map(e => e.evidence_ref)).size !== x.evidence.length)
    c.addIssue({ code: 'custom', message: 'duplicate_plan_identity' }); for (const e of x.evidence)
    if (compareInstants(e.received_at, x.cutoff_at) > 0 || (e.source_as_of && (compareInstants(e.source_as_of, x.cutoff_at) > 0 || compareInstants(e.source_as_of, e.received_at) > 0)))
        c.addIssue({ code: 'custom', message: 'evidence_after_cutoff' }); });
const Finding = z.object({ claim_id: Ref, kind: z.enum(['fact', 'calculation', 'assumption', 'estimate']), text: z.string().min(1).max(2000), source_refs: z.array(Ref).max(20), formula_id: Ref.nullable() }).strict().superRefine((x, c) => { if (['fact', 'calculation'].includes(x.kind) && x.source_refs.length === 0)
    c.addIssue({ code: 'custom', message: 'fact_without_evidence' }); if ((x.kind === 'calculation') !== (x.formula_id !== null))
    c.addIssue({ code: 'custom', message: 'formula_kind_conflict' }); });
export const GooseRoleResultSchema = z.object({ run_id: Ref, role_id: Role, findings: z.array(Finding).max(50), tool_operation_ids: z.array(z.string().max(80)).max(30), counterevidence: z.array(z.string().max(2000)).max(20), unresolved: z.array(z.string().max(2000)).max(30) }).strict().superRefine((x, c) => { if (new Set(x.findings.map(f => f.claim_id)).size !== x.findings.length)
    c.addIssue({ code: 'custom', message: 'duplicate_claim_id' }); });
const allowed: Record<RoleId, readonly string[]> = {
    'company-analysis': ['search_instruments', 'resolve_instrument', 'get_instrument_profile', 'get_us_product_profile', 'get_fundamentals', 'get_sec_company_concept'],
    'disclosure-event': ['search_instruments', 'resolve_instrument', 'get_public_filings', 'get_market_headlines', 'get_sec_submissions', 'get_overseas_ice_actions'],
    'market-behavior': ['search_instruments', 'resolve_instrument', 'get_market_snapshot', 'get_price_history', 'get_us_price_history', 'get_intraday_price_history', 'get_market_flows', 'get_credit_balances', 'get_short_sale_activity', 'get_stock_lending_activity', 'get_us_market_snapshot', 'get_index_futures_snapshot', 'get_domestic_etf_snapshot', 'get_overseas_futures_snapshot', 'get_domestic_futures_price_history', 'get_domestic_futures_intraday_history', 'get_overseas_futures_price_history', 'get_overseas_futures_intraday_history', 'get_historical_intraday_price_history', 'get_global_index_history', 'get_market_industry_investor_aggregates', 'get_global_index_period_history'],
    'valuation': ['get_fundamentals', 'get_sec_company_concept'],
    'fact-check-report-qa': [],
};
export interface RoleTask {
    readonly run_id: string;
    readonly role_id: RoleId;
    readonly requested_scope: string;
    readonly cutoff_at: string;
    readonly evidence_refs: readonly string[];
    readonly allowed_tool_operation_ids: readonly string[];
}
export interface SequentialRoleRunner {
    run(task: RoleTask, signal: AbortSignal): Promise<unknown>;
}
const NativeReceipt = z.object({ run_id: Ref, role_id: Role, child_id: Ref, observation_origin: z.enum(['actual', 'synthetic']), started_at: Time, completed_at: Time, result: GooseRoleResultSchema }).strict().refine(x => validInstants([x.started_at,x.completed_at]) && compareInstants(x.started_at, x.completed_at) <= 0);
export interface NativeRoleExecutor {
    kind: 'host_native';
    runAll(tasks: readonly RoleTask[], signal: AbortSignal): Promise<unknown>;
}
const RoleRecord = z.object({ role_id: Role, skill: z.string(), phase: z.literal('analysis'), requested_scope: z.string(), input_refs: z.array(Ref), output_path: z.null(), data_class: z.enum(['public_actual', 'synthetic', 'mixed_or_empty']), tool_operation_ids: z.array(z.string()), cutoff_at: Time, started_at: Time, completed_at: Time, observed_child_id: Ref.nullable(), validation_state: z.enum(['schema_validated', 'failed', 'timed_out']), failure: z.enum(['role_failed', 'role_result_invalid', 'role_timeout']).nullable(), completion_status: z.enum(['response_observed', 'execution_unconfirmed']), result: GooseRoleResultSchema.nullable(), warnings: z.array(z.string()) }).strict();
export const GooseExecutionResultSchema = z.object({ contract: z.literal('moai.goose.execution.v1'), run_id: Ref, execution_mode: z.enum(['single_role', 'sequential', 'host_native_parallel', 'synthetic_parallel_test', 'native_dispatch_unverified']), host_execution_verified: z.literal(false), host_execution_attested: z.boolean(), single_writer: z.literal('goose'), report_rendered: z.literal(false), factual_accuracy_verified: z.literal(false), records: z.array(RoleRecord).min(1).max(5), warnings: z.array(z.string()).min(1) }).strict().superRefine((x, c) => {
    if(!validInstants(x.records.flatMap(r=>[r.cutoff_at,r.started_at,r.completed_at])))return;
    if (x.host_execution_attested !== (x.execution_mode === 'host_native_parallel'))
        c.addIssue({ code: 'custom', message: 'execution_claim_conflict' });
    if (new Set(x.records.map(r => r.role_id)).size !== x.records.length)
        c.addIssue({ code: 'custom', message: 'duplicate_role_record' });
    for (const r of x.records) {
        if (r.skill !== `references/roles/${r.role_id}/PROCEDURE.md` || JSON.stringify(r.tool_operation_ids) !== JSON.stringify(r.result?.tool_operation_ids ?? []))
            c.addIssue({ code: 'custom', message: 'record_metadata_conflict' });
        if (compareInstants(r.started_at, r.completed_at) > 0 || (r.validation_state === 'schema_validated') !== (r.result !== null) || (r.validation_state === 'schema_validated') !== (r.failure === null) || r.completion_status !== (r.failure === null ? 'response_observed' : 'execution_unconfirmed'))
            c.addIssue({ code: 'custom', message: 'record_state_conflict' });
        if (r.result && (r.result.run_id !== x.run_id || r.result.role_id !== r.role_id || r.result.findings.some(f => f.source_refs.some(id => !r.input_refs.includes(id))) || r.result.tool_operation_ids.some(op => !allowed[r.role_id].includes(op))))
            c.addIssue({ code: 'custom', message: 'role_context_conflict' });
    }
    const parallel = x.execution_mode === 'host_native_parallel' || x.execution_mode === 'synthetic_parallel_test';
    if (parallel) {
        if (x.records.length < 2 || x.records.some(r => !r.observed_child_id) || new Set(x.records.map(r => r.observed_child_id)).size !== x.records.length || !x.records.some((a, i) => x.records.some((b, j) => i !== j && compareInstants(a.started_at, b.completed_at) < 0 && compareInstants(b.started_at, a.completed_at) < 0)))
            c.addIssue({ code: 'custom', message: 'parallel_evidence_missing' });
    }
});
async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; try {
    return await Promise.race([work(controller.signal), new Promise<T>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('role_timeout')); }, ms); })]);
}
finally {
    if (timer)
        clearTimeout(timer);
} }
export async function executeGoosePlan(input: unknown, runner: SequentialRoleRunner, options: {
    nativeExecutor?: NativeRoleExecutor;
    clock?: () => string;
} = {}) {
    boundedBody(input);
    const checked = GoosePlanSchema.safeParse(input);
    if (!checked.success)
        throw new Error('invalid_input');
    const plan = checked.data;
    const clock = options.clock ?? (() => new Date().toISOString());
    const ids = plan.evidence.map(e => e.evidence_ref);
    const data_class = plan.evidence.length > 0 && plan.evidence.every(e => e.origin === 'actual') ? 'public_actual' as const : plan.evidence.length > 0 && plan.evidence.every(e => e.origin === 'synthetic') ? 'synthetic' as const : 'mixed_or_empty' as const;
    const tasks = Object.freeze(plan.roles.map(role_id => Object.freeze({ run_id: plan.run_id, role_id, requested_scope: plan.requested_scope, cutoff_at: plan.cutoff_at, evidence_refs: Object.freeze([...ids]), allowed_tool_operation_ids: Object.freeze([...allowed[role_id]]) })));
    function validate(raw: unknown, role: RoleId) { boundedBody(raw); const r = GooseRoleResultSchema.safeParse(raw); if (!r.success || r.data.run_id !== plan.run_id || r.data.role_id !== role || r.data.findings.some(f => f.source_refs.some(id => !ids.includes(id))) || r.data.tool_operation_ids.some(op => !allowed[role].includes(op)))
        throw new Error('role_result_invalid'); return r.data; }
    function record(role: RoleId, started_at: string, completed_at: string, result: z.infer<typeof GooseRoleResultSchema> | null, failure: 'role_failed' | 'role_result_invalid' | 'role_timeout' | null, child: string | null = null) { return { role_id: role, skill: `references/roles/${role}/PROCEDURE.md`, phase: 'analysis' as const, requested_scope: plan.requested_scope, input_refs: ids, output_path: null, data_class, tool_operation_ids: result?.tool_operation_ids ?? [], cutoff_at: plan.cutoff_at, started_at, completed_at, observed_child_id: child, validation_state: failure === 'role_timeout' ? 'timed_out' as const : failure ? 'failed' as const : 'schema_validated' as const, failure, completion_status: failure ? 'execution_unconfirmed' as const : 'response_observed' as const, result, warnings: ['Role text remains attributed evidence/analysis; Goose alone may compose the final report. No renderer or filesystem write is performed here.', ...(failure ? ['Failure/timeout is a coordinator observation, not proof the worker stopped. Abort is cooperative; no automatic retry.'] : [])] }; }
    let mode: 'single_role' | 'sequential' | 'host_native_parallel' | 'synthetic_parallel_test' | 'native_dispatch_unverified' = tasks.length === 1 ? 'single_role' : 'sequential';
    const records: ReturnType<typeof record>[] = [];
    const warnings = ['Execution adapter does not install/launch a host by itself. Native execution is host-attested from validated supplied receipts, not independently verified by this library. Caller-supplied origin labels are a trusted host boundary, not proof by themselves.', 'Runner must enforce actual tool capabilities and data egress; result auditing is not a security sandbox. Accounts/trading/portfolio role are excluded.'];
    if (tasks.length > 1 && plan.execution_preference === 'parallel_if_available' && options.nativeExecutor?.kind === 'host_native') {
        mode = 'native_dispatch_unverified';
        const start = clock();
        try {
            const raw = await withTimeout(s => options.nativeExecutor!.runAll(tasks, s), plan.timeout_ms);
            boundedBody(raw, { maxBytes: 1500000, maxNodes: 50000 });
            const receipts = z.array(NativeReceipt).length(tasks.length).parse(raw);
            const end = clock();
            if (new Set(receipts.map(r => r.role_id)).size !== tasks.length || receipts.some(r => r.run_id !== plan.run_id || !plan.roles.includes(r.role_id) || compareInstants(r.started_at, start) < 0 || compareInstants(r.completed_at, end) > 0) || new Set(receipts.map(r => r.observation_origin)).size !== 1 || new Set(receipts.map(r => r.child_id)).size !== tasks.length || !receipts.some((a, i) => receipts.some((b, j) => i !== j && compareInstants(a.started_at, b.completed_at) < 0 && compareInstants(b.started_at, a.completed_at) < 0)))
                throw new Error('role_result_invalid');
            for (const task of tasks) {
                const r = receipts.find(r => r.role_id === task.role_id)!;
                records.push(record(task.role_id, r.started_at, r.completed_at, validate(r.result, task.role_id), null, r.child_id));
            }
            mode = receipts[0]!.observation_origin === 'actual' ? 'host_native_parallel' : 'synthetic_parallel_test';
        }
        catch (error) {
            records.length = 0;
            const failure = error instanceof Error && error.message === 'role_timeout' ? 'role_timeout' : 'role_result_invalid';
            for (const task of tasks)
                records.push(record(task.role_id, start, clock(), null, failure));
            warnings.push('Native dispatch failed or receipts were invalid; no retry or silent sequential redispatch was attempted.');
        }
    }
    else {
        if (plan.execution_preference === 'parallel_if_available' && tasks.length > 1)
            warnings.push('Native launcher absent: observed sequential fallback, not simulated child agents.');
        for (const task of tasks) {
            const start = clock();
            try {
                const result = validate(await withTimeout(s => runner.run(task, s), plan.timeout_ms), task.role_id);
                records.push(record(task.role_id, start, clock(), result, null));
            }
            catch (error) {
                const failure = error instanceof Error && error.message === 'role_timeout' ? 'role_timeout' : error instanceof Error && error.message === 'role_result_invalid' ? 'role_result_invalid' : 'role_failed';
                records.push(record(task.role_id, start, clock(), null, failure));
            }
        }
    }
    return GooseExecutionResultSchema.parse({ contract: 'moai.goose.execution.v1', run_id: plan.run_id, execution_mode: mode, host_execution_verified: false, host_execution_attested: mode === 'host_native_parallel', single_writer: 'goose', report_rendered: false, factual_accuracy_verified: false, records, warnings });
}
