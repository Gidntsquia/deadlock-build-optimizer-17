/** Small numeric helpers shared by the generator modules. */

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Parses numbers that the assets API ships as strings ("0.75m", "40", "{s:sign}"-prefixed values, plain numbers). */
export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = parseFloat(m[0]);
      return Number.isFinite(n) ? n : fallback;
    }
  }
  return fallback;
}

export const round = (x: number, digits = 4): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** 53-bit string hash (cyrb53). Used for the determinism check, not for security. */
export function hashString(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Comparator: higher score first, then lower id. Keeps every ranking deterministic. */
export function byScoreThenId<T extends { score: number; id: number }>(a: T, b: T): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.id - b.id;
}

/** JSON.stringify with floats rounded, so hashes do not depend on the last bits of a double. */
export function stableStringify(value: unknown, digits = 6): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? round(v, digits) : v));
}

export function fmtSouls(n: number): string {
  return n.toLocaleString('en-US');
}
