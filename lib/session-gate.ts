export function createSessionGate() {
  let generation = 0;
  let controller = new AbortController();
  return {
    end() {
      generation += 1;
      controller.abort();
      controller = new AbortController();
    },
    stamp() {
      const at = generation;
      return { signal: controller.signal, live: () => at === generation };
    }
  };
}
