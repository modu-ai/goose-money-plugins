import { z } from 'zod';
const InstantText = z.string().max(80).datetime({ offset: true });
/** Exact fraction comparator. Date.parse is used only on whole seconds, never fractional input. */
function parts(value: string): {
    seconds: bigint;
    fraction: string;
} {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    // Stricter project profile: require an explicitly known local offset.
    // RFC 3339 section 4.3 still gives a known UTC instant for -00:00;
    // rejecting it is a profile restriction, not a correction to instant ordering.
    if (!m || m[3] === '-00:00' || !InstantText.safeParse(value).success)
        throw new Error('invalid_instant');
    const ms = Date.parse(m[1]! + m[3]!);
    if (!Number.isFinite(ms) || ms % 1000 !== 0)
        throw new Error('invalid_instant');
    return { seconds: BigInt(ms / 1000), fraction: m[2] ?? '' };
}
export const ExactInstantSchema = InstantText.refine(s => { try {
    parts(s);
    return true;
}
catch {
    return false;
} }, 'invalid_instant');
export function compareInstants(a: string, b: string): -1 | 0 | 1 { const x = parts(a), y = parts(b); if (x.seconds < y.seconds)
    return -1; if (x.seconds > y.seconds)
    return 1; const length = Math.max(x.fraction.length, y.fraction.length); const xf = x.fraction.padEnd(length, '0'), yf = y.fraction.padEnd(length, '0'); return xf < yf ? -1 : xf > yf ? 1 : 0; }
