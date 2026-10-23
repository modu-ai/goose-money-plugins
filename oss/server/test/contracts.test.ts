import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registryUrl = new URL("../../../contracts/report-data-source-registry-r1.json", import.meta.url);
const normalizedContractUrl = new URL("../../../contracts/kis-normalized-data-contract-v1.json", import.meta.url);
const wireBindingUrl = new URL("../../../contracts/r01-consumer-wire-binding-v1.json", import.meta.url);

test("TypeScript slice references the existing 147-field registry and draft JSON contract without copying it", async () => {
  const registry = JSON.parse(await readFile(registryUrl, "utf8")) as { registry_id: string; field_registry: unknown[] };
  const normalized = JSON.parse(await readFile(normalizedContractUrl, "utf8")) as { contract_id: string; version: string; scope: { transport: string } };
  const wire = JSON.parse(await readFile(wireBindingUrl, "utf8")) as { contract_id?: string; value_bindings?: unknown[] };
  assert.equal(registry.field_registry.length, 147);
  assert.equal(registry.registry_id, "moai.stock.report-data-source-registry");
  assert.equal(normalized.contract_id, "moai.stock.data.v1");
  assert.equal(normalized.version, "0.3.0-draft");
  assert.match(normalized.scope.transport, /stdio/);
  assert.equal(wire.contract_id, "moai.stock.report.r01.consumer-wire.v1");
  assert.equal(wire.value_bindings?.length, 7);
});
