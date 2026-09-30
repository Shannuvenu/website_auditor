// V1 in-memory cache. Swap this object for a Redis-backed one with the same interface later.
const m = new Map<string, { v: unknown; e: number }>();
export const cache = {
  get<T>(k: string): T | undefined { const x = m.get(k); if (!x) return; if (x.e < Date.now()) { m.delete(k); return; } return x.v as T; },
  set(k: string, v: unknown, ttlMs = 60 * 60 * 1000) { m.set(k, { v, e: Date.now() + ttlMs }); },
};
