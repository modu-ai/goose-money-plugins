#!/usr/bin/env node
/** Execute synthetic roles; verify emitted references, never just an installed file count. */
import assert from 'node:assert/strict';
import { realpathSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeGoosePlan } from '../server/dist/src/goose-orchestrator.js';
const root = fileURLToPath(new URL('../skills/goose/', import.meta.url));
const roles = ['company-analysis', 'disclosure-event', 'market-behavior', 'valuation', 'fact-check-report-qa'];
const start = '2026-10-22T08:00:00Z', finish = '2026-10-22T08:00:10Z';
const plan = { run_id: 'synthetic-procedure-reference-regression', requested_scope: 'Offline synthetic procedure reference resolution only',
  roles, cutoff_at: start, evidence: [{ evidence_ref: 'synthetic-only', origin: 'synthetic', received_at: start, source_as_of: null }] };
function result(task) { return { run_id: task.run_id, role_id: task.role_id, findings: [], tool_operation_ids: [], counterevidence: [], unresolved: ['Synthetic only; no host/model or source invocation.'] }; }
function verify(execution) {
  assert.equal(execution.host_execution_verified, false);
  assert.equal(execution.report_rendered, false);
  assert.deepEqual(execution.records.map(r => r.role_id), roles);
  const realRoot = realpathSync(root), resolved = [];
  for (const record of execution.records) {
    assert.equal(record.validation_state, 'schema_validated');
    assert.equal(record.data_class, 'synthetic');
    assert.equal(record.skill, `references/roles/${record.role_id}/PROCEDURE.md`);
    const path = resolve(root, record.skill), real = realpathSync(path);
    assert.ok(real.startsWith(realRoot + sep));
    assert.equal(real, path, 'procedure components must not use symlinks');
    const info = lstatSync(path); assert.ok(info.isFile() && !info.isSymbolicLink());
    assert.ok(info.size > 0 && info.size <= 65_536, 'procedure file must be bounded');
    const text = readFileSync(path, 'utf8');
    assert.ok(text.includes(`name: ${record.role_id}`));
    assert.ok(text.includes('## Workflow') || record.role_id === 'fact-check-report-qa');
    resolved.push(record.skill);
  }
  return resolved;
}
const sequential = await executeGoosePlan(plan, { async run(task) { return result(task); } }, { clock: () => finish });
assert.equal(sequential.execution_mode, 'sequential');
const paths = verify(sequential);
let tick = 0;
const parallel = await executeGoosePlan({ ...plan, execution_preference: 'parallel_if_available' },
  { async run() { throw new Error('unexpected_sequential_dispatch'); } }, {
    clock: () => tick++ === 0 ? start : finish,
    nativeExecutor: { kind: 'host_native', async runAll(tasks) {
      return tasks.map((task, i) => ({ run_id: task.run_id, role_id: task.role_id, child_id: `synthetic-child-${i}`, observation_origin: 'synthetic',
        started_at: '2026-10-22T08:00:01Z', completed_at: '2026-10-22T08:00:09Z', result: result(task) }));
    } },
  });
assert.equal(parallel.execution_mode, 'synthetic_parallel_test');
assert.equal(parallel.host_execution_attested, false);
assert.deepEqual(verify(parallel), paths);
process.stdout.write(JSON.stringify({ status: 'passed', synthetic_only: true, modes: [sequential.execution_mode, parallel.execution_mode], resolved_procedure_paths: paths, real_host_execution: false }) + '\n');
