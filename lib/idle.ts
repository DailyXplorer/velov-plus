export function whenIdle(work: () => void, timeout = 1_000) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(work, 50);
  return () => clearTimeout(id);
}
