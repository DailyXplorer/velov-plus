export const REFRESH_INTERVAL = 5_000;

export function createRefreshGate(interval = REFRESH_INTERVAL, now: () => number = Date.now) {
  let last = -Infinity;
  return (busy: boolean) => {
    if (busy || now() - last < interval) return false;
    last = now();
    return true;
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
