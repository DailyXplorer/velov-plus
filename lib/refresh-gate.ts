export const REFRESH_INTERVAL = 5_000;

export function createRefreshGate(interval = REFRESH_INTERVAL, now: () => number = Date.now) {
  let last = -Infinity;
  return (busy: boolean) => {
    if (busy || now() - last < interval) return false;
    last = now();
    return true;
  };
}
