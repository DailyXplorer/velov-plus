/**
 * One load per key at a time, its result kept for `ttl` ms. A failed load is never kept;
 * with `stale`, it falls back to the last value, however old.
 */
export function memo<T>(ttl: number, { stale = false } = {}) {
  const values = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = values.get(key);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
    const running = pending.get(key);
    if (running) return running;
    const promise = load().then((value) => {
      if (!stale && values.size > 500) for (const [old, entry] of values) if (entry.expiresAt <= Date.now()) values.delete(old);
      values.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    }, (error: unknown) => {
      const last = values.get(key);
      if (stale && last) return last.value;
      throw error;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
