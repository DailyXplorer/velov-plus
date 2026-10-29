export function createSessionGate() {
  let generation = 0;
  let open = true;
  let controller = new AbortController();
  function invalidate() {
    generation += 1;
    controller.abort();
    controller = new AbortController();
  }
  return {
    end() {
      invalidate();
      open = true;
    },
    close() {
      invalidate();
      open = false;
    },
    stamp() {
      const at = generation;
      const live = open;
      return { signal: live ? controller.signal : AbortSignal.abort(), live: () => live && at === generation };
    }
  };
}
