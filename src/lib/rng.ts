/**
 * Mulberry32 — small, fast, seed-only deterministic PRNG.
 *
 * Shared by every game that needs reproducible randomness from a round seed
 * (same seed → same stream). No global state: each call returns an independent
 * generator. Games stay independent of *each other* by depending on this shared
 * lib rather than copying the implementation around.
 */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
