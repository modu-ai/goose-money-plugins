import { createHash } from 'node:crypto';
import { z } from 'zod';
// Reproduction package (Refs #106, design docs/design/durable-job-and-stock-link.md §7, Refs #29).
// Pure assembly/hashing logic only — no persistence, no network/file/DB/process access. The job
// key is an injected optional field: piece 1 (§3) has not been built, so no key is computed or
// invented here. Code version (build SHA), receipt ids and receipt times are caller observations
// passed as arguments, the same pattern as the piece-1 permission recheck. Raw snapshots, node
// results and the final report enter as hashes only and are never stored (정의서 395행: 비밀·계좌
// 원문은 넣지 않음) — the request enters as the caller's §3 canonical form, whose content rule
// (no raw secrets in it) is the caller's normalization duty; this module owns only its shape.

/** Deterministic serialization: object keys sorted (recursively), array order preserved. Only
 * JSON-representable values are accepted — undefined, bigint, symbols, functions and non-finite
 * numbers are refused rather than silently coerced. Piece 1's job-key hash (§3) reuses this. */
export function canonicalJson(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string': return JSON.stringify(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(v)) throw new Error('error_code=invalid_input');
        return JSON.stringify(v);
      case 'bigint':
      case 'undefined':
      case 'symbol':
      case 'function':
        throw new Error('error_code=invalid_input');
    }
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    // Only plain records serialize: a Date/Map/class instance would silently hash as `{}` and two
    // different values would collide (codex P2) — unsupported instances are refused instead.
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error('error_code=invalid_input');
    const o = v as Record<string, unknown>;
    const body = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',');
    return `{${body}}`;
  };
  return canonical(value);
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** §7 field list. `job_key` is present only when the caller injected one (piece 1 pending). */
export type ProviderReceipt = { node_id: string; receipt_id: string; received_at: string };
export type NodeResultHash = { node_id: string; result_hash: string };
export type ReproPackage = {
  request_canonical: string;
  job_key?: string;
  code_version: string;
  input_data_snapshot_hash: string;
  provider_receipts: ProviderReceipt[];
  node_result_hashes: NodeResultHash[];
  final_report_hash?: string;
  package_hash: string;
};

export type ReproBuildInput = {
  request: unknown;
  job_key?: string;
  code_version: string;
  input_snapshot: unknown;
  provider_receipts: ProviderReceipt[];
  node_results: { node_id: string; result: unknown }[];
  final_report?: unknown;
};

export type ReproVerifyInput = {
  input_snapshot: unknown;
  node_results: { node_id: string; result: unknown }[];
  final_report?: unknown;
};

export type ReproVerifyVerdict = { ok: true } | { ok: false; mismatches: string[] };

const s = (min: number, max: number) => z.string().min(min).max(max);
const hash64 = z.string().regex(/^[0-9a-f]{64}$/);
/** Build and verify share one bound: a package this module builds must stay verifiable (codex P2). */
const REQUEST_CANONICAL_MAX = 65536;
const NodeId = s(1, 128);
const ReceiptSchema = z.object({ node_id: NodeId, receipt_id: s(1, 256), received_at: s(1, 64) }).strict();
const BuildInputSchema = z.object({
  request: z.unknown(),
  job_key: s(1, 256).optional(),
  code_version: s(1, 128),
  input_snapshot: z.unknown(),
  provider_receipts: z.array(ReceiptSchema).max(1000),
  node_results: z.array(z.object({ node_id: NodeId, result: z.unknown() }).strict()).max(1000),
  final_report: z.unknown().optional(),
}).strict();
const PackageSchema = z.object({
  request_canonical: s(1, REQUEST_CANONICAL_MAX),
  job_key: s(1, 256).optional(),
  code_version: s(1, 128),
  input_data_snapshot_hash: hash64,
  provider_receipts: z.array(ReceiptSchema).max(1000),
  node_result_hashes: z.array(z.object({ node_id: NodeId, result_hash: hash64 }).strict()).max(1000),
  final_report_hash: hash64.optional(),
  package_hash: hash64,
}).strict();
const VerifyInputSchema = z.object({
  input_snapshot: z.unknown(),
  node_results: z.array(z.object({ node_id: NodeId, result: z.unknown() }).strict()).max(1000),
  final_report: z.unknown().optional(),
}).strict();

const byNodeId = <T extends { node_id: string }>(a: T, b: T): number =>
  a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0;
const byNodeThenReceipt = (a: ProviderReceipt, b: ProviderReceipt): number =>
  byNodeId(a, b)
  || (a.receipt_id < b.receipt_id ? -1 : a.receipt_id > b.receipt_id ? 1 : 0)
  // Final tiebreaker so caller order can never reach the package hash (codex P2); records equal on
  // all three keys are identical values, interchangeable in either position.
  || (a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : 0);

/** Assemble the §7 package from caller observations. Caller-side list order is normalized away
 * (nodes by node_id, receipts by node_id then receipt_id); duplicate node ids in one build are a
 * caller bug. Raw snapshot/results/report never leave this function — only their hashes do. */
export function buildReproPackage(input: ReproBuildInput): ReproPackage {
  const r = BuildInputSchema.safeParse(input);
  if (!r.success) throw new Error('error_code=invalid_input');
  const i = r.data;
  const seen = new Set<string>();
  for (const n of i.node_results) {
    if (seen.has(n.node_id)) throw new Error('error_code=invalid_input');
    seen.add(n.node_id);
  }
  const request_canonical = canonicalJson(i.request);
  if (request_canonical.length > REQUEST_CANONICAL_MAX) throw new Error('error_code=invalid_input');
  const withoutHash = {
    request_canonical,
    ...(i.job_key !== undefined ? { job_key: i.job_key } : {}),
    code_version: i.code_version,
    input_data_snapshot_hash: sha256Hex(canonicalJson(i.input_snapshot)),
    provider_receipts: [...i.provider_receipts].sort(byNodeThenReceipt),
    node_result_hashes: [...i.node_results]
      .sort(byNodeId)
      .map((n) => ({ node_id: n.node_id, result_hash: sha256Hex(canonicalJson(n.result)) })),
    ...(i.final_report !== undefined ? { final_report_hash: sha256Hex(canonicalJson(i.final_report)) } : {}),
  };
  return { ...withoutHash, package_hash: sha256Hex(canonicalJson(withoutHash)) };
}

/** T10: re-run the analysis on the same inputs (caller observations of the recomputation) and
 * compare against the package. A malformed package is a verdict (`invalid_package`), not a crash;
 * malformed observations are a caller bug (`error_code=invalid_input`). */
export function verifyReproPackage(pkg: unknown, observed: ReproVerifyInput): ReproVerifyVerdict {
  const o = VerifyInputSchema.safeParse(observed);
  if (!o.success) throw new Error('error_code=invalid_input');
  const seen = new Set<string>();
  for (const n of o.data.node_results) {
    if (seen.has(n.node_id)) throw new Error('error_code=invalid_input');
    seen.add(n.node_id);
  }
  const p = PackageSchema.safeParse(pkg);
  if (!p.success) return { ok: false, mismatches: ['invalid_package'] };
  const pkgRec = p.data;
  const mismatches: string[] = [];

  const { package_hash, ...rest } = pkgRec;
  if (sha256Hex(canonicalJson(rest)) !== package_hash) mismatches.push('package_hash');
  if (sha256Hex(canonicalJson(o.data.input_snapshot)) !== pkgRec.input_data_snapshot_hash) mismatches.push('input_data_snapshot_hash');

  const recorded = new Map(pkgRec.node_result_hashes.map((n) => [n.node_id, n.result_hash]));
  const recomputed = new Map(o.data.node_results.map((n) => [n.node_id, sha256Hex(canonicalJson(n.result))]));
  for (const [id, hash] of recorded) {
    if (!recomputed.has(id)) mismatches.push(`node_result_missing:${id}`);
    else if (recomputed.get(id) !== hash) mismatches.push(`node_result_hashes:${id}`);
  }
  for (const id of recomputed.keys()) if (!recorded.has(id)) mismatches.push(`node_result_extra:${id}`);

  if (pkgRec.final_report_hash !== undefined) {
    if (o.data.final_report === undefined) mismatches.push('final_report_not_reproduced');
    else if (sha256Hex(canonicalJson(o.data.final_report)) !== pkgRec.final_report_hash) mismatches.push('final_report_hash');
  } else if (o.data.final_report !== undefined) {
    mismatches.push('final_report_extra');
  }
  return mismatches.length ? { ok: false, mismatches } : { ok: true };
}
