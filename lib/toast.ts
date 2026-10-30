export type Toast = { id: number; message: string };

export function createToaster(duration = 5_000) {
  let shown: Toast | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastId = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function dismiss(id: number) {
    if (shown?.id !== id) return;
    clearTimeout(timer);
    shown = null;
    notify();
  }

  function show(message: string) {
    clearTimeout(timer);
    if (shown?.message !== message) {
      shown = { id: ++lastId, message };
      notify();
    }
    const { id } = shown;
    timer = setTimeout(() => dismiss(id), duration);
  }

  return {
    show,
    dismiss,
    current: () => shown,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}

export const toaster = createToaster();
