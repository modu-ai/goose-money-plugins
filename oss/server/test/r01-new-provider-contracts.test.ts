import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const flowContractUrl = new URL("../contracts/r01-flow-risk-provider-extension-v1.json", import.meta.url);
const chartContractUrl = new URL("../contracts/r01-chart-interval-provider-support-v1.json", import.meta.url);
const supplierRegistryUrl = new URL("../../../contracts/report-data-source-registry-r1.json", import.meta.url);
const r01RuntimeUrl = new URL("../contracts/r01-chart-runtime-contract-v1.json", import.meta.url);

async function readJson(url: URL): Promise<Record<string, any>> {
  return JSON.parse(await readFile(url, "utf8")) as Record<string, any>;
}

test("flow-risk extension records pinned official KIS fields without claiming live or production support", async () => {
  const contract = await readJson(flowContractUrl);
  const operations = new Map(contract.operations.map((operation: any) => [operation.operation_ref, operation]));
  const metrics = new Map(contract.canonical_metrics.map((metric: any) => [metric.metric_id, metric]));

  assert.equal(contract.source_basis.pinned_commit, "2077773a69a428daf63e148182511f068cc45de3");
  assert.equal(contract.scope.mcp_runtime_exposure, "none; current implementation remains get_market_snapshot only");
  assert.equal(contract.scope.orders_transfers_auto_trading, false);
  assert.match(contract.status, /no live requests/i);

  const shortSale = operations.get("KIS-134") as any;
  assert.equal(shortSale.tr_id, "FHPST04830000");
  assert.equal(shortSale.field_root_binding, "pending; chk_daily_short_sale applies one column map to both root frames and does not establish which field belongs to which root");
  assert.ok(shortSale.checked_sample_fields.includes("ssts_tr_pbmn_rlim"));
  assert.match(shortSale.sample_type_note, /NUMERIC_COLUMNS empty/i);
  for (const field of ["ssts_cntg_qty", "ssts_vol_rlim", "ssts_tr_pbmn", "ssts_tr_pbmn_rlim"]) {
    assert.ok(shortSale.sample_response_roots.length === 2, "KIS-134 exposes object and array roots in the helper");
    assert.ok((metrics as any).get(field === "ssts_cntg_qty" ? "short_sale.volume" : field === "ssts_vol_rlim" ? "short_sale.volume_ratio" : field === "ssts_tr_pbmn" ? "short_sale.amount" : "short_sale.amount_ratio"));
  }
  assert.equal((metrics as any).get("short_sale.volume_ratio").denominator_status.includes("do not name a denominator"), true);
  assert.equal((metrics as any).get("short_sale.amount").currency, null);

  const credit = operations.get("KIS-110") as any;
  assert.equal(credit.tr_id, "FHPST04760000");
  assert.ok(credit.checked_sample_fields.includes("deal_date"));
  assert.ok(credit.checked_sample_fields.includes("stlm_date"));
  assert.ok(credit.checked_sample_fields.includes("whol_stln_rmnd_stcn"));
  assert.match(credit.sample_parameters.FID_INPUT_DATE_1.meaning, /settlement date/i);
  assert.equal((metrics as any).get("credit_loan.trade_date").provider_field, "deal_date");
  assert.equal((metrics as any).get("credit_loan.settlement_date").provider_field, "stlm_date");
  assert.notEqual((metrics as any).get("credit_loan.trade_date").provider_field, (metrics as any).get("credit_loan.settlement_date").provider_field);
  assert.match((metrics as any).get("credit_loan.repayment_shares").interpretation_guard, /Do not label as forced liquidation/i);
  assert.ok((metrics as any).get("credit_loan.new_shares").json_path.endsWith("whol_loan_new_stcn"));
  assert.match((metrics as any).get("credit_lending.balance_shares").semantic_guard, /separate/i);

  const loan = operations.get("KIS-135") as any;
  assert.equal(loan.tr_id, "HHPST074500C0");
  assert.equal(loan.field_path_status.includes("output1"), true);
  assert.ok(loan.checked_sample_fields.includes("prdy_rmnd_vrss"));
  for (const [metricId, field] of [
    ["stock_loan.trade_date", "bsop_date"],
    ["stock_loan.new_shares", "new_stcn"],
    ["stock_loan.repaid_shares", "rdmp_stcn"],
    ["stock_loan.balance_shares", "rmnd_stcn"],
    ["stock_loan.balance_amount", "rmnd_amt"],
  ]) {
    assert.equal((metrics as any).get(metricId)?.json_path, `$.output1[*].${field}`);
  }
  const unresolvedChange = (metrics as any).get("stock_loan.balance_change_unresolved");
  assert.equal(unresolvedChange.json_path, "$.output1[*].prdy_rmnd_vrss");
  assert.equal(unresolvedChange.unit, null);
  assert.match(unresolvedChange.unit_status, /not established/i);

  const interpretation = contract.runtime_policy.interpretation_guards.join(" ");
  assert.match(interpretation, /Short-sale trading volume and amount are flows/);
  assert.match(interpretation, /Stock lending\/loan balances are not equivalent/);
  assert.match(interpretation, /not proof of an imminent or executed forced sale/i);
  assert.equal(contract.external_short_balance_candidate.official_semantics.some((note: string) => /T\+2/.test(note)), true);
  assert.equal(contract.external_short_balance_candidate.rights_status.startsWith("pending"), true);
});

test("new flow and corporate-action overlap stays additive and does not rewrite report-owned IDs", async () => {
  const contract = await readJson(flowContractUrl);
  const registry = await readJson(supplierRegistryUrl);
  const runtime = await readJson(r01RuntimeUrl);
  const review = contract.integration_notes.existing_requirement_overlap_review;

  assert.equal(registry.field_registry.length, 147);
  assert.equal(runtime.fields.length, 48);
  assert.equal(contract.ownership.base_147_field_registry_modified, false);
  assert.equal(contract.ownership.report_consumer_files_modified, false);
  assert.equal(review.items.find((item: any) => item.topic === "short-sale daily flow")?.coverage, "partial");
  assert.equal(review.items.find((item: any) => item.topic === "reported short-position balance")?.coverage, "missing");
  assert.equal(review.items.find((item: any) => item.topic === "credit-loan balance/change")?.coverage, "missing");
  assert.match(review.status, /not owner acceptance/i);
  assert.match(review.items.find((item: any) => item.topic === "price and daily volume")?.consumer_v13_coverage, /^present:/);
  assert.match(review.items.find((item: any) => item.topic === "turnover \/ transaction amount")?.consumer_v13_coverage, /^present:/);
  assert.match(review.items.find((item: any) => item.topic === "short-sale daily flow")?.consumer_v13_coverage, /^partial:/);
  assert.match(review.items.find((item: any) => item.topic === "reported short-position balance")?.consumer_v13_coverage, /^present:/);
  assert.match(review.items.find((item: any) => item.topic === "KIS stock-loan balance and change")?.consumer_v13_coverage, /^present:/);
  assert.ok(contract.interpretation_contract.investor_question_flow.includes("반대 근거"));

  const holding = contract.integration_notes.future_risk_sources.find((item: any) => item.topic === "major shareholding reports");
  assert.match(holding.guard, /not automatically a share pledge/i);
  const cb = contract.integration_notes.future_risk_sources.find((item: any) => item.topic === "CB issuance / conversion dilution");
  assert.ok(cb.confirmed_fields.includes("cv_prc"));
  assert.ok(cb.confirmed_fields.includes("cvisstk_cnt"));
  assert.ok(cb.confirmed_fields.includes("cvisstk_tisstk_vs"));
  assert.match(contract.integration_notes.future_risk_sources.find((item: any) => item.topic.startsWith("trading suspension"))?.specific_guards.join(" "), /record date as ex-dividend/i);
});

test("V13 consumer handoff is reconciled read-only with provider units and timestamps still blocked", async () => {
  const contract = await readJson(flowContractUrl);
  const reconciliation = contract.consumer_v13_reconciliation;

  assert.equal(reconciliation.consumer_owner_files_read_only, true);
  assert.equal(reconciliation.report_html_modified, false);
  assert.equal(reconciliation.summary.consumer_risk_metric_count, 11);
  assert.equal(reconciliation.summary.consumer_provider_field_bindings, 10);
  assert.deepEqual(reconciliation.summary.consumer_derived_without_provider_metric_id, ["R01.flow_risk.credit_change_million"]);
  assert.equal(reconciliation.consumer_bindings.find((item: any) => item.consumer_id === "R01.flow_risk.credit_change_million")?.supplier_derivation_candidate_id, "credit_loan.balance_change_amount");
  assert.equal(reconciliation.summary.live_projection, "false; fixtures only");
  assert.match(reconciliation.summary.consumer_status_note, /Ten provider-bound metrics remain verification_pending/i);
  assert.match(reconciliation.reconciliation_gaps.join(" "), /short-sale amount-ratio field/);
  assert.match(reconciliation.reconciliation_gaps.join(" "), /publication (timestamp|instant)/);
  assert.ok(reconciliation.sources[0].sha256.length === 64);
  assert.ok(reconciliation.sources[1].sha256.length === 64);

  const chart = await readJson(chartContractUrl);
  const v13 = chart.consumer_v13_reconciliation;
  assert.equal(v13.live_projection, "false; offline synthetic examples only");
  assert.match(v13.consumer_timeframes.h1, /12 five-minute bars/);
  assert.match(v13.consumer_timeframes.week, /ISO Mondays/);
  assert.match(v13.consumer_timeframes.month, /calendar months/);
  assert.match(v13.volume_turnover_reconciliation.consumer_fixture_turnover_formula, /only to construct synthetic examples/);
  assert.match(v13.volume_turnover_reconciliation.provider_rule, /Never use close×volume/);
  assert.match(v13.gaps.join(" "), /direct-versus-local equivalence/);
  assert.match(v13.gaps.join(" "), /exact base interval/);
});

test("chart contract separates provider periods from blocked minute aggregation and carries display safeguards", async () => {
  const contract = await readJson(chartContractUrl);
  const intervals = new Map(contract.interval_readiness.map((item: any) => [item.interval_id, item]));
  const view = contract.chart_view_contract;

  assert.deepEqual(view.interval_controls, ["5m", "1h", "1d", "1w", "1mo"]);
  assert.match(view.volume_and_turnover, /separate series\/units/i);
  assert.match(view.moving_averages, /toggle and visible legend/i);
  assert.deepEqual(view.proposed_defaults_only.sma_windows, [5, 20, 60, 120]);
  assert.equal(view.proposed_defaults_only.user_confirmed, false);
  assert.equal((intervals.get("1d") as any).availability, "provider_candidate");
  assert.equal((intervals.get("1w") as any).availability, "provider_candidate");
  assert.equal((intervals.get("1mo") as any).availability, "provider_candidate");
  for (const id of ["5m", "1h"]) {
    const interval = intervals.get(id) as any;
    assert.equal(interval.availability, "derived_candidate_not_implemented");
    assert.match(interval.derivation, /Do not derive from daily bars/i);
    assert.ok(interval.activation_blockers.some((blocker: string) => /base interval must be confirmed exactly/.test(blocker)));
  }
  assert.match(contract.bar_contract.aggregation.turnover, /Never sum cumulative rows/);
  assert.match(contract.bar_contract.gaps_and_finality.join(" "), /disable that chart toggle/i);
  assert.match(contract.bar_contract.gaps_and_finality.join(" "), /active candle incomplete/);
  assert.equal(contract.rights_and_security.orders_transfers_auto_trading, false);
});
