export const REFRESH_INTERVAL = 5_000;

export function createRefreshGate(interval = REFRESH_INTERVAL, now: () => number = Date.now) {
  let last = -Infinity;
  return (busy: boolean) => {
    if (busy || now() - last < interval) return false;
    last = now();
    return true;
  };
}

export function createRevisionLoader<T>(load: () => Promise<T | null>, apply: (value: T) => void) {
  let revision = 0;
  let current: Promise<T | null> | null = null;
  let queued: Promise<T | null> | null = null;
  function start(): Promise<T | null> {
    const at = revision;
    current = load().catch(() => null).then((value) => {
      current = null;
      if (value === null || at !== revision) return null;
      apply(value);
      return value;
    });
    return current;
  }
  function request(): Promise<T | null> {
    if (!current) return start();
    queued ??= current.then(() => { queued = null; return start(); });
    return queued;
  }
  return {
    request,
    bump() { revision += 1; if (current) void request(); },
    busy: () => current !== null
  };
}

export function createThrottle(run: () => Promise<void>, gap = REFRESH_INTERVAL, now: () => number = Date.now, wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  let current: Promise<void> | null = null;
  let again = false;
  let last = -Infinity;
  async function loop() {
    do {
      again = false;
      const delay = last + gap - now();
      if (delay > 0) await wait(delay);
      last = now();
      await run().catch(() => {});
    } while (again);
    current = null;
  }
  return () => {
    if (current) { again = true; return current; }
    current = loop();
    return current;
  };
}
