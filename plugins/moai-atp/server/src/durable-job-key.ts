import { z } from 'zod';
import { canonicalJson, sha256Hex } from './durable-job-repro.js';
// Job key (Refs #106, design docs/design/durable-job-and-stock-link.md §3) — the pure key
// computation only: hash(user principal, request canonical form, target identifier, cutoff_at,
// input data snapshot hash, code version). canonicalJson/sha256Hex are reused from the repro
// package, never duplicated. No exclusive creation, no persistence, no network/file/DB/process
// access: T1/T2 acceptance, J-03/J-04 retention and reuse stay with the caller, and undecided
// values (§10) are never invented. The principal is opaque (never parsed), cutoff_at and
// code_version are caller observations — the same argument pattern as the repro build inputs.

const s = (min: number, max: number) => z.string().min(min).max(max);
/** One bound shared with the repro package's REQUEST_CANONICAL_MAX: a request this module keys
 * must stay packageable by buildReproPackage. */
const REQUEST_CANONICAL_MAX = 65536;

const KeyInputSchema = z.object({
  principal: s(1, 256),
  request: z.unknown(),
  target_id: s(1, 128),
  cutoff_at: s(1, 64),
  input_snapshot: z.unknown(),
  code_version: s(1, 128),
}).strict();

/** §3's six materials. `request` and `input_snapshot` enter as raw objects and are canonicalized
 * here; the other four are caller-normalized opaque strings. */
export type JobKeyInput = {
  principal: string;
  request: unknown;
  target_id: string;
  cutoff_at: string;
  input_snapshot: unknown;
  code_version: string;
};

/** §3 job key: sha256 over the canonical form of six named material slots. The request and the
 * raw snapshot are canonicalized inside, so caller-side key insertion order can never reach the
 * key (array order still can — it is semantic); named slots keep equal strings in different
 * materials from colliding. Deterministic by construction: no time, no randomness, no call
 * order. Malformed materials throw `error_code=invalid_input`. */
export function computeJobKey(input: JobKeyInput): string {
  const r = KeyInputSchema.safeParse(input);
  if (!r.success) throw new Error('error_code=invalid_input');
  const i = r.data;
  const request_canonical = canonicalJson(i.request);
  if (request_canonical.length > REQUEST_CANONICAL_MAX) throw new Error('error_code=invalid_input');
  const material = {
    principal: i.principal,
    request_canonical,
    target_id: i.target_id,
    cutoff_at: i.cutoff_at,
    input_data_snapshot_hash: sha256Hex(canonicalJson(i.input_snapshot)),
    code_version: i.code_version,
  };
  return sha256Hex(canonicalJson(material));
}
