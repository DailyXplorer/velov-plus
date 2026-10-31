export function createForgetter(send: () => Promise<Response>) {
  let pending: Promise<boolean> = Promise.resolve(true);
  return {
    forget() {
      const sent = send().then((response) => response.ok, () => false);
      pending = Promise.all([pending, sent]).then(([, ok]) => ok);
      return pending;
    },
    settled: () => pending
  };
}

export const forgetting = createForgetter(() => fetch("/api/auth/forget", { method: "POST", signal: AbortSignal.timeout(10_000) }));
