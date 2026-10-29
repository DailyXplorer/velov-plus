import { z } from "zod";
import { type Outcome, outcomeSchema } from "./models.ts";
import { isUncertain, noAnswer } from "./outcome.ts";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const OPERATIONS_KEY = "velov:operations:v1";
export const SENDING_LIMIT = 2 * 60_000;
export const UNCERTAIN_HOLD = 2 * 60_000;
export const ACTION_TIMEOUT = 65_000;
export const HISTORY_LAG = 2 * 60_000;
export const BUSY = "Une autre action est en cours. Attendez sa réponse avant de recommencer.";
export const UNSAVED = "Ce navigateur ne peut pas suivre cette action. Rien n’a été envoyé.";
const LOST = "La page a été fermée avant la réponse. L’action a peut-être abouti.";

const operationSchema = z.object({
  status: z.enum(["sending", "uncertain"]), at: z.number(), keep: z.boolean(),
  outcome: outcomeSchema.nullable(), meta: z.record(z.string(), z.union([z.string(), z.number()]))
});
export type Operation = z.infer<typeof operationSchema>;
type Meta = Operation["meta"];

export async function accountDigest(account: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account.trim().toLowerCase()));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createOperations(storage: () => Store | null, now: () => number = Date.now) {
  const running = new Set<string>();
  const memory = new Map<string, Operation>();
  const listeners = new Set<() => void>();
  let version = 0;

  function saved(): Record<string, Operation> | null {
    try {
      const raw = storage()?.getItem(OPERATIONS_KEY);
      if (raw === undefined) return null;
      return raw === null ? {} : z.record(z.string(), operationSchema).parse(JSON.parse(raw));
    } catch { return null; }
  }
  function live(entry: Operation | undefined): Operation | null {
    if (!entry) return null;
    const age = now() - entry.at;
    if (entry.status === "sending" && age > SENDING_LIMIT) return entry.keep || age <= SENDING_LIMIT + UNCERTAIN_HOLD ? { ...entry, status: "uncertain", outcome: entry.outcome ?? noAnswer(LOST) } : null;
    if (entry.status === "uncertain" && !entry.keep && age > UNCERTAIN_HOLD) return null;
    return entry;
  }
  function changed() {
    version += 1;
    for (const listener of listeners) listener();
  }
  function write(key: string, entry: Operation | null, required: boolean) {
    if (entry) memory.set(key, entry); else memory.delete(key);
    try {
      const store = storage();
      const all = saved();
      if (!store || !all) throw new Error("storage unavailable");
      if (entry) all[key] = entry; else delete all[key];
      if (Object.keys(all).length) store.setItem(OPERATIONS_KEY, JSON.stringify(all)); else store.removeItem(OPERATIONS_KEY);
    } catch (error) {
      if (required) throw error;
    }
  }

  function get(key: string): Operation | null {
    const all = saved();
    const entry = live(all ? all[key] : memory.get(key));
    if (running.has(key) && entry?.status !== "sending") return { status: "sending", at: now(), keep: false, outcome: null, meta: {} };
    return entry;
  }
  function busy() {
    if (running.size) return true;
    const all = saved() ?? Object.fromEntries(memory);
    return Object.values(all).some((entry) => live(entry)?.status === "sending");
  }

  return {
    get, busy,
    sending: () => running.size > 0,
    version: () => version,
    changed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(key: string, { keep = false, meta = {} }: { keep?: boolean; meta?: Meta } = {}): "started" | "busy" | "unsaved" {
      if (busy() || get(key)) return "busy";
      try { write(key, { status: "sending", at: now(), keep, outcome: null, meta }, keep); }
      catch { return "unsaved"; }
      running.add(key);
      changed();
      return "started";
    },
    finish(key: string, outcome: Outcome) {
      running.delete(key);
      const entry = memory.get(key) ?? saved()?.[key];
      write(key, outcome.ok || !isUncertain(outcome) ? null : { status: "uncertain", at: now(), keep: entry?.keep ?? false, outcome, meta: entry?.meta ?? {} }, false);
      changed();
    },
    clear(key: string) {
      if (running.has(key)) return;
      write(key, null, false);
      changed();
    }
  };
}

export type Operations = ReturnType<typeof createOperations>;

export async function runOnce<T extends Outcome>(operations: Operations, key: string, send: () => Promise<T>, options?: { keep?: boolean; meta?: Meta }): Promise<T | Outcome | "busy" | "unsaved"> {
  const started = operations.begin(key, options);
  if (started !== "started") return started;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Outcome>((resolve) => { timer = setTimeout(() => resolve(noAnswer("Le serveur ne répond pas.")), ACTION_TIMEOUT); });
  let outcome: T | Outcome;
  try { outcome = await Promise.race([send(), late]); }
  catch { outcome = noAnswer("Le serveur ne répond pas."); }
  finally { clearTimeout(timer); }
  operations.finish(key, outcome);
  return outcome;
}

export type DebitCheck = "debited" | "not-debited" | "unknown";

export function inviteDebit(before: { at: number; balance: number | null; cost: number }, after: { balance: number | null; movements: { date: string | null; amount: number }[] }, now: number): DebitCheck {
  const since = before.at - 5 * 60_000;
  const dropped = before.balance !== null && after.balance !== null && after.balance < before.balance;
  const debit = after.movements.some(({ date, amount }) => amount === -before.cost && date !== null && (date.length === 10 ? dropped && Date.parse(`${date}T23:59:59Z`) >= since : Date.parse(date) >= since));
  if (debit) return "debited";
  if (now - before.at < HISTORY_LAG) return "unknown";
  return before.balance !== null && after.balance !== null && before.balance - after.balance < before.cost ? "not-debited" : "unknown";
}
