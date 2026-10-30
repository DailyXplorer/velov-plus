import { z } from "zod";
import { type Outcome, outcomeSchema } from "./models.ts";
import { type Check, type Settled, HISTORY_LAG, isUncertain, networkFailure, noAnswer, settle, technicalLine } from "./outcome.ts";
import { journal } from "./journal.ts";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Locks = { request<T>(name: string, run: () => Promise<T>): Promise<T> };

export const OPERATIONS_KEY = "velov:operations:v1";
export const OPERATIONS_LOCK = "velov:operations";
export const SENDING_LIMIT = 2 * 60_000;
export const ACTION_TIMEOUT = 65_000;
export const BUSY = "Une autre action est en cours. Attendez sa réponse avant de recommencer.";
export const UNSAVED = "Ce navigateur ne peut pas suivre cette action. Rien n’a été envoyé.";
export const UNSHARED = "Ce navigateur ne peut pas empêcher un double envoi depuis un autre onglet. Rien n’a été envoyé.";
const LOST = "La page a été fermée avant la réponse. L’action a peut-\u2060être abouti.";
const COSTLY = /^(invite|book|unlock):/;

const operationSchema = z.object({
  id: z.string().default(""), status: z.enum(["sending", "uncertain"]), at: z.number(), keep: z.boolean(),
  outcome: outcomeSchema.nullable(), meta: z.record(z.string(), z.union([z.string(), z.number()]))
});
export type Operation = z.infer<typeof operationSchema>;
export type Blocked = "busy" | "unsaved" | "unshared";
type Meta = Operation["meta"];

export function blockedMessage(blocked: Blocked, held: boolean): string | null {
  if (blocked === "unsaved") return UNSAVED;
  if (blocked === "unshared") return UNSHARED;
  return held ? null : BUSY;
}

export const ACCOUNT_HEADER = "x-velov-account";

export async function accountDigest(account: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account.trim().toLowerCase()));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createOperations(storage: () => Store | null, now: () => number = Date.now, locks: () => Locks | null = () => null) {
  const running = new Map<string, string>();
  const memory = new Map<string, Operation>();
  const listeners = new Set<() => void>();
  const expiring = new Map<string, ReturnType<typeof setTimeout>>();
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
    if (entry.status === "sending" && now() - entry.at > SENDING_LIMIT) return { ...entry, status: "uncertain", outcome: entry.outcome ?? noAnswer(LOST) };
    return entry;
  }
  function stored(key: string) {
    return saved()?.[key] ?? memory.get(key);
  }
  function changed() {
    version += 1;
    for (const listener of listeners) listener();
    watchSending();
  }
  function watchSending() {
    for (const [key, entry] of Object.entries(saved() ?? Object.fromEntries(memory))) {
      const mark = `${key}:${entry.id}`;
      const wait = entry.at + SENDING_LIMIT - now() + 1;
      if (entry.status !== "sending" || running.has(key) || expiring.has(mark) || wait <= 0) continue;
      const timer = setTimeout(() => { expiring.delete(mark); changed(); }, wait);
      timer.unref?.();
      expiring.set(mark, timer);
    }
  }
  function write(key: string, entry: Operation | null, required: boolean) {
    try {
      const store = storage();
      const all = saved();
      if (!store || !all) throw new Error("storage unavailable");
      if (entry) all[key] = entry; else delete all[key];
      if (Object.keys(all).length) store.setItem(OPERATIONS_KEY, JSON.stringify(all)); else store.removeItem(OPERATIONS_KEY);
      memory.delete(key);
    } catch (error) {
      if (required) throw error;
      if (entry) memory.set(key, entry); else memory.delete(key);
    }
  }
  function locked<T>(run: () => T): Promise<T> {
    const manager = locks();
    return manager ? manager.request(OPERATIONS_LOCK, async () => run()) : Promise.resolve().then(run);
  }

  function get(key: string): Operation | null {
    const entry = live(stored(key));
    const id = running.get(key);
    if (id !== undefined && entry?.status !== "sending") return { id, status: "sending", at: now(), keep: false, outcome: null, meta: {} };
    return entry;
  }
  function busy() {
    if (running.size) return true;
    const all = saved() ?? Object.fromEntries(memory);
    return Object.values(all).some((entry) => live(entry)?.status === "sending");
  }

  watchSending();
  return {
    get, busy,
    sending: () => running.size > 0,
    version: () => version,
    changed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async begin(key: string, { keep = false, meta = {} }: { keep?: boolean; meta?: Meta } = {}): Promise<"started" | Blocked> {
      if (COSTLY.test(key) && !locks()) return "unshared";
      const id = crypto.randomUUID();
      let result: "started" | Blocked;
      try {
        result = await locked((): "started" | Blocked => {
          if (busy() || get(key)) return "busy";
          try { write(key, { id, status: "sending", at: now(), keep, outcome: null, meta }, keep); }
          catch { return "unsaved"; }
          running.set(key, id);
          return "started";
        });
      } catch { return "unshared"; }
      if (result === "started") changed();
      return result;
    },
    async finish(key: string, outcome: Outcome) {
      const id = running.get(key);
      const record = () => {
        const entry = stored(key);
        if (entry && entry.id !== id) return;
        write(key, outcome.ok || !isUncertain(outcome) ? null : { id: id ?? "", status: "uncertain", at: now(), keep: entry?.keep ?? false, outcome, meta: entry?.meta ?? {} }, false);
      };
      await locked(record).catch(record);
      running.delete(key);
      changed();
    },
    async drop(prefix: string) {
      await locked(() => {
        for (const key of Object.keys(saved() ?? Object.fromEntries(memory))) if (key.startsWith(prefix) && !running.has(key)) write(key, null, false);
      }).catch(() => {});
      changed();
    },
    async clear(key: string, id: string): Promise<boolean> {
      if (running.has(key)) return false;
      const cleared = await locked(() => {
        if (stored(key)?.id !== id) return false;
        write(key, null, false);
        return stored(key) === undefined;
      }).catch(() => false);
      changed();
      return cleared;
    }
  };
}

export type Operations = ReturnType<typeof createOperations>;

export async function runOnce<T extends Outcome>(operations: Operations, key: string, send: () => Promise<T>, options?: { keep?: boolean; meta?: Meta }): Promise<T | Outcome | Blocked> {
  const started = await operations.begin(key, options);
  if (started !== "started") return started;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  const late = new Promise<Outcome>((resolve) => { timer = setTimeout(() => resolve(networkFailure("Le serveur ne répond pas.", new DOMException("", "TimeoutError"), startedAt)), ACTION_TIMEOUT); });
  let outcome: T | Outcome;
  try { outcome = await Promise.race([send(), late]); }
  catch (error) { outcome = networkFailure("Le serveur ne répond pas.", error, startedAt); }
  finally { clearTimeout(timer); }
  if (!outcome.ok) journal(`${key.split(":")[0]} · ${technicalLine(outcome)}`);
  await operations.finish(key, outcome);
  return outcome;
}

export async function settleHeld(operations: Operations, key: string, check: (held: Operation) => Promise<Check>, now: () => number = Date.now): Promise<Settled | null> {
  const held = operations.get(key);
  if (held?.status !== "uncertain") return null;
  const settled = await settle(held.outcome ?? noAnswer(LOST), () => check(held), held.at, now);
  if (settled.kind !== "uncertain") await operations.clear(key, held.id);
  return settled;
}

export type DebitCheck = "debited" | "not-debited" | "unknown";
export type Verification = { id: string; kind: "checking" | DebitCheck | "failed" };

export function verificationOf(operation: Operation | null, verification: Verification | null): Verification | null {
  if (operation) return verification?.id === operation.id ? verification : null;
  return verification?.kind === "debited" ? verification : null;
}

export async function retryVerified(operations: Operations, key: string, verification: Verification | null, start: () => Promise<unknown>): Promise<boolean> {
  const held = operations.get(key);
  if (held?.status !== "uncertain" || verificationOf(held, verification)?.kind !== "not-debited") return false;
  if (!await operations.clear(key, held.id)) return false;
  await start();
  return true;
}

export function signedAmount(direction: string | null | undefined, amount: number): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return direction === "DEBIT" ? -amount : direction === "CREDIT" ? amount : null;
}

export const rewardsHistorySchema = z.object({ complete: z.boolean(), movements: z.array(z.object({ date: z.string().nullable(), amount: z.number().nullable() })) });
export type RewardsHistory = z.infer<typeof rewardsHistorySchema>;
export const DEBIT_SLACK = 5 * 60_000;
export const HISTORY_PAGES = 5;

const endOfDay = (date: string) => Date.parse(date.length === 10 ? `${date}T23:59:59Z` : date);

export async function historySince(fetchPage: (page: number) => Promise<{ last: boolean; movements: ({ id: string } & RewardsHistory["movements"][number])[] }>, since: number, maxPages = HISTORY_PAGES): Promise<RewardsHistory> {
  const movements: RewardsHistory["movements"] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(page);
    const fresh = batch.movements.filter((movement) => !seen.has(movement.id));
    if (batch.movements.length && !fresh.length) return { complete: false, movements };
    for (const movement of fresh) { seen.add(movement.id); movements.push({ date: movement.date, amount: movement.amount }); }
    if (batch.last || !batch.movements.length || fresh.some((movement) => movement.date !== null && endOfDay(movement.date) < since)) return { complete: true, movements };
  }
  return { complete: false, movements };
}

export function inviteDebit(before: { at: number; cost: number }, history: RewardsHistory, now: number): DebitCheck {
  const since = before.at - DEBIT_SLACK;
  const debits = history.movements.filter(({ amount }) => amount === -before.cost);
  if (debits.some(({ date }) => date !== null && date.length > 10 && Date.parse(date) >= since)) return "debited";
  if (now - before.at < HISTORY_LAG || !history.complete) return "unknown";
  if (history.movements.some(({ amount, date }) => amount === null && (date === null || !Number.isFinite(endOfDay(date)) || endOfDay(date) >= since))) return "unknown";
  return debits.some(({ date }) => date === null || !Number.isFinite(endOfDay(date)) || endOfDay(date) >= since) ? "unknown" : "not-debited";
}
