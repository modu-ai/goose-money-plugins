import assert from "node:assert/strict";
import test from "node:test";
import { normalizeKrQuote } from "../src/normalize-kr-quote.js";
import { ModelInputEnvelopeSchema, selectQuoteEnvelope, assertActualDataClaim } from "../src/model-input-envelope.js";
const fixture = () => normalizeKrQuote({stck_prpr: "70000"}, {
  symbol: "000660", board: "J", receivedAt: "2026-10-22T01:00:00Z", origin: "synthetic",
});
test("v2 preserves synthetic provenance and denies actual-data claims", () => {
  const envelope = selectQuoteEnvelope(fixture(), ["last", "open"]);
  assert.equal(envelope.provenance.origin, "synthetic");
  assert.equal(envelope.provenance.rights_status, "pending");
  assert.equal(envelope.input.facts[1]?.status, "missing");
  assert.throws(() => assertActualDataClaim(envelope), /actual_data_claim_not_supported/);
  assert.deepEqual(ModelInputEnvelopeSchema.parse(JSON.parse(JSON.stringify(envelope))), envelope);
});
test("v2 rejects provenance stripping, mismatched clocks and duplicate facts", () => {
  const envelope = selectQuoteEnvelope(fixture(), ["last"]);
  assert.equal(ModelInputEnvelopeSchema.safeParse({...envelope, provenance: undefined}).success, false);
  assert.equal(ModelInputEnvelopeSchema.safeParse({...envelope, input: {...envelope.input, times: {...envelope.input.times, received_at: "2026-10-21T00:00:00Z"}}}).success, false);
  assert.equal(ModelInputEnvelopeSchema.safeParse({...envelope, input: {...envelope.input, facts: [...envelope.input.facts, ...envelope.input.facts]}}).success, false);
});
test("v2 rejects fabricated presence and invalid canonical DTOs", () => {
  const envelope = selectQuoteEnvelope(fixture(), ["last"]);
  const fact = envelope.input.facts[0]!;
  assert.equal(ModelInputEnvelopeSchema.safeParse({...envelope, input: {...envelope.input, facts: [{...fact, value: null}]}}).success, false);
  assert.throws(() => selectQuoteEnvelope({...fixture(), data: {...fixture().data, last: "NaN"}}, ["last"]));
});

test("actual claim requires at least one nonmissing validated fact", () => {
 const dto=normalizeKrQuote({stck_prpr:"-1",acml_vol:"1.5",prdy_vrss:"2",prdy_vrss_sign:"3"},{symbol:"000660",board:"J",receivedAt:"2026-10-22T01:00:00Z",origin:"actual"});
 assert.throws(()=>assertActualDataClaim(selectQuoteEnvelope(dto,["last","volume","change"])),/actual_data_claim_not_supported/);
});
