import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { ACTION_TIMEOUT, OPERATIONS_KEY, SENDING_LIMIT, type Locks, accountDigest, createOperations, historySince, inviteDebit, runOnce, settleHeld } from "../lib/operations.ts";
import { type Outcome, outcomeSchema } from "../lib/models.ts";
import { HISTORY_LAG, isUncertain, noAnswer, routeFailure } from "../lib/outcome.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

function memoryStore() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}

export function sharedLocks(): Locks {
  let tail: Promise<unknown> = Promise.resolve();
  return { request<T>(_name: string, run: () => Promise<T>) { const result = tail.then(run); tail = result.catch(() => {}); return result; } };
}

function slowRoute() {
  const calls: { url: string; body: unknown; stored: string | null }[] = [];
  const answers: ((reply: { status: number; body: unknown } | Error) => void)[] = [];
  let storage: ReturnType<typeof memoryStore> | null = null;
  const send = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "null")), stored: storage?.getItem(OPERATIONS_KEY) ?? null });
    return new Promise<Response>((resolve, reject) => answers.push((reply) => reply instanceof Error ? reject(reply) : resolve(Response.json(reply.body, { status: reply.status }))));
  }) as unknown as typeof fetch;
  const post = (url: string, body: unknown) => async (): Promise<Outcome> => {
    try {
      const response = await send(url, { method: "POST", body: JSON.stringify(body) });
      const raw: unknown = await response.json().catch(() => null);
      const parsed = outcomeSchema.safeParse(raw);
      return response.ok && parsed.success ? parsed.data : routeFailure(response.status, raw, "Réponse inattendue.");
    } catch {
      return noAnswer("Le serveur ne répond pas.");
    }
  };
  return { calls, post, watch: (store: ReturnType<typeof memoryStore>) => { storage = store; }, async answer(reply: { status: number; body: unknown } | Error) { await new Promise((resolve) => setImmediate(resolve)); answers.shift()!(reply); await new Promise((resolve) => setImmediate(resolve)); } };
}

const ok: Outcome = { ok: true, httpStatus: 200, transactionState: "OK", code: null, message: null, detail: null };
const unlockBody = { stationNumber: 2002, standNumber: 12, bikeNumber: 20449 };

test("F1: an unlock in flight blocks a second send after closing and reopening the bike, any other action, and another tab", async () => {
  let clock = 0;
  const storage = memoryStore();
  const locks = sharedLocks();
  const tab = createOperations(() => storage, () => clock, () => locks);
  const otherTab = createOperations(() => storage, () => clock, () => locks);
  const route = slowRoute();
  const first = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy", "same bike reopened");
  assert.equal(await runOnce(tab, "book:20449", route.post("/api/bookings", unlockBody)), "busy", "another action meanwhile");
  assert.equal(await runOnce(otherTab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy", "another tab");
  assert.equal(tab.sending(), true);
  assert.equal(otherTab.busy(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(route.calls.length, 1);
  clock += 90_000;
  await route.answer({ status: 504, body: null });
  const outcome = await first;
  assert.ok(typeof outcome !== "string" && isUncertain(outcome));
  assert.equal(tab.sending(), false);
  assert.equal(tab.get("unlock:20449")?.status, "uncertain");
  assert.equal(otherTab.get("unlock:20449")?.status, "uncertain");
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy", "uncertain: no blind Confirmer");
  assert.equal(route.calls.length, 1);
  clock += 24 * 3_600_000;
  assert.equal(tab.get("unlock:20449")?.status, "uncertain", "time alone never proves the unlock failed");
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy");
  assert.equal((await settleHeld(tab, "unlock:20449", async () => "unchanged", () => clock))?.kind, "refused", "no trip for that bike after the dock window");
  assert.equal(tab.get("unlock:20449"), null);
  const again = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  await new Promise((resolve) => setImmediate(resolve));
  await route.answer({ status: 200, body: ok });
  assert.deepEqual(await again, ok);
  assert.equal(route.calls.length, 2);
  assert.equal(tab.get("unlock:20449"), null);
});

test("F1: a clear refusal frees the bike at once, and a lock left by a closed tab becomes uncertain, never forgotten", async () => {
  let clock = 0;
  const storage = memoryStore();
  const locks = sharedLocks();
  const tab = createOperations(() => storage, () => clock, () => locks);
  const route = slowRoute();
  const refused = runOnce(tab, "book:20449", route.post("/api/bookings", unlockBody));
  await new Promise((resolve) => setImmediate(resolve));
  await route.answer({ status: 400, body: { error: "Ce vélo est déjà réservé.", code: "local.bike.reserved" } });
  assert.equal((await refused) !== "busy" && isUncertain(await refused as Outcome), false);
  assert.equal(tab.get("book:20449"), null);
  const closed = createOperations(() => storage, () => clock, () => locks);
  assert.equal(await closed.begin("unlock:1"), "started");
  const survivor = createOperations(() => storage, () => clock, () => locks);
  assert.equal(await survivor.begin("unlock:2"), "busy");
  clock += SENDING_LIMIT + 1;
  const lost = survivor.get("unlock:1");
  assert.equal(lost?.status, "uncertain", "a tab closed during the unlock never brings Confirmer back silently");
  assert.equal(isUncertain(lost!.outcome!), true);
  assert.equal(await survivor.begin("unlock:1"), "busy");
  assert.equal(await survivor.begin("unlock:2"), "started");
  clock += 7 * 86_400_000;
  assert.equal(survivor.get("unlock:1")?.status, "uncertain");
});

test("F1: a POST that never answers ends uncertain after the action timeout and frees the lock", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const storage = memoryStore();
  const locks = sharedLocks();
  const tab = createOperations(() => storage, Date.now, () => locks);
  const other = createOperations(() => storage, Date.now, () => locks);
  const route = slowRoute();
  const first = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(ACTION_TIMEOUT - 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tab.sending(), true);
  t.mock.timers.tick(1);
  const outcome = await first;
  assert.ok(typeof outcome !== "string" && isUncertain(outcome));
  assert.equal(tab.sending(), false);
  assert.equal(tab.busy(), false);
  assert.equal(other.busy(), false);
  assert.equal(tab.get("unlock:20449")?.status, "uncertain");
  assert.equal(await tab.begin("book:1"), "started");
  assert.equal(route.calls.length, 1);
});

test("F1: without storage the same tab is still locked in memory", async () => {
  const locks = sharedLocks();
  const tab = createOperations(() => null, Date.now, () => locks);
  const route = slowRoute();
  const first = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy");
  await new Promise((resolve) => setImmediate(resolve));
  await route.answer(new TypeError("offline"));
  assert.equal(isUncertain(await first as Outcome), true);
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy");
  assert.equal(route.calls.length, 1);
});

test("F2: the invite is recorded before sending; after an uncertain answer it survives closing and reloading until explicitly cleared", async () => {
  let clock = Date.parse("2026-10-29T12:00:00Z");
  const storage = memoryStore();
  const key = `invite:${await accountDigest("me@example.test")}`;
  const locks = sharedLocks();
  const tab = createOperations(() => storage, () => clock, () => locks);
  const route = slowRoute();
  route.watch(storage);
  const first = runOnce(tab, key, route.post("/api/account/promocode", { expectedCost: 50 }), { keep: true, meta: { cost: 50, balance: 120 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(route.calls[0].stored!, /"status":"sending"/, "pending persisted before the request left");
  await route.answer({ status: 503, body: { error: "Le service est momentanément indisponible.", code: "unavailable" } });
  await first;
  clock += 24 * 3_600_000;
  const reloaded = createOperations(() => storage, () => clock, () => locks);
  const pending = reloaded.get(key);
  assert.equal(pending?.status, "uncertain");
  assert.deepEqual(pending?.meta, { cost: 50, balance: 120 });
  assert.equal(await runOnce(reloaded, key, route.post("/api/account/promocode", { expectedCost: 50 }), { keep: true }), "busy");
  assert.equal(route.calls.length, 1);
  await reloaded.clear(key, pending!.id);
  const retry = runOnce(reloaded, key, route.post("/api/account/promocode", { expectedCost: 50 }), { keep: true });
  await new Promise((resolve) => setImmediate(resolve));
  await route.answer({ status: 200, body: { ...ok, promoCode: "CODE" } });
  assert.equal((await retry as Outcome).ok, true);
  assert.equal(route.calls.length, 2);
  assert.equal(reloaded.get(key), null);
});

test("F2: a page closed during the invite leaves it uncertain, never forgotten; no storage means nothing is sent", async () => {
  let clock = 0;
  const storage = memoryStore();
  const locks = sharedLocks();
  const closed = createOperations(() => storage, () => clock, () => locks);
  assert.equal(await closed.begin("invite:abc", { keep: true }), "started");
  clock += SENDING_LIMIT + 1;
  const next = createOperations(() => storage, () => clock, () => locks);
  assert.equal(next.get("invite:abc")?.status, "uncertain");
  assert.equal(isUncertain(next.get("invite:abc")!.outcome!), true);
  assert.equal(await next.begin("invite:abc", { keep: true }), "busy");
  const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
  const route = slowRoute();
  assert.equal(await runOnce(createOperations(() => blocked, Date.now, () => locks), "invite:abc", route.post("/api/account/promocode", {}), { keep: true }), "unsaved");
  assert.equal(route.calls.length, 0);
});

test("F2: a net balance never proves the invite was not debited; only a complete history since the request does", () => {
  const at = Date.parse("2026-10-29T12:00:00Z");
  const before = { at, cost: 50 };
  const later = at + 10 * 60_000;
  const complete = (movements: { date: string | null; amount: number }[]) => ({ complete: true, movements });
  assert.equal(inviteDebit(before, complete([{ date: "2026-10-29T12:00:03Z", amount: -50 }]), later), "debited");
  assert.equal(inviteDebit(before, complete([{ date: "2026-10-29T12:00:03Z", amount: -50 }]), at + 30_000), "debited");
  assert.equal(inviteDebit(before, complete([{ date: "2026-10-29T12:30:00Z", amount: 5 }, { date: "2026-10-01T08:00:00Z", amount: -50 }]), later), "not-debited");
  assert.equal(inviteDebit(before, { complete: false, movements: [{ date: "2026-10-29T12:01:00Z", amount: 1 }] }, later), "unknown", "the review case: credit of 1, history unavailable");
  assert.equal(inviteDebit(before, { complete: false, movements: [] }, later), "unknown");
  assert.equal(inviteDebit(before, complete([{ date: "2026-10-29", amount: -50 }]), later), "unknown", "a same-day debit without a time proves nothing");
  assert.equal(inviteDebit(before, complete([{ date: null, amount: -50 }]), later), "unknown");
  assert.equal(inviteDebit(before, complete([]), at + HISTORY_LAG - 1), "unknown", "the rewards history may still lag");
  assert.equal(inviteDebit(before, complete([]), at + HISTORY_LAG), "not-debited");
  assert.equal(inviteDebit(before, complete([{ date: "2026-10-29T12:01:00Z", amount: -10 }]), at + HISTORY_LAG), "not-debited", "another debit is not the invite");
});

test("F4: contact and extra-time states are kept per account and per trip, independently of any dialog", async () => {
  const storage = memoryStore();
  const mine = await accountDigest("me@example.test");
  const other = await accountDigest("other@example.test");
  const tab = createOperations(() => storage);
  const route = slowRoute();
  for (const key of [`contact:${mine}`, `via:${mine}:trip-1`]) {
    const sent = runOnce(tab, key, route.post("/api/account/contact", { message: "Bonjour" }), { keep: true, meta: { number: 2002, name: "Bellecour" } });
    await route.answer(new TypeError("offline"));
    await sent;
  }
  const reopened = createOperations(() => storage);
  assert.equal(reopened.get(`contact:${mine}`)?.status, "uncertain");
  assert.equal(reopened.get(`via:${mine}:trip-1`)?.meta.name, "Bellecour");
  assert.equal(reopened.get(`contact:${other}`), null);
  assert.equal(reopened.get(`via:${mine}:trip-2`), null);
  assert.equal(await reopened.begin(`contact:${mine}`, { keep: true }), "busy");
  await reopened.clear(`contact:${mine}`, reopened.get(`contact:${mine}`)!.id);
  assert.equal(reopened.get(`contact:${mine}`), null);
  assert.equal(reopened.get(`via:${mine}:trip-1`)?.status, "uncertain");
  assert.equal(route.calls.length, 2);
});

test("R2: unlock and booking stay locked until their route can no longer answer", () => {
  for (const route of ["app/api/unlock/route.ts", "app/api/bookings/route.ts"]) {
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(readFileSync(route, "utf8"))?.[1]);
    assert.ok(ACTION_TIMEOUT > maxDuration * 1000, `${route}: ${ACTION_TIMEOUT} ms vs maxDuration ${maxDuration} s`);
  }
  assert.equal(ACTION_TIMEOUT, 65_000);
  assert.ok(ACTION_TIMEOUT < SENDING_LIMIT);
});

test("F2: the history read for an invite is complete only once it reaches a movement older than the request or the last page", async () => {
  const since = Date.parse("2026-10-29T11:55:00Z");
  const pages = (list: { last: boolean; movements: { id: string; date: string | null; amount: number }[] }[]) => {
    const asked: number[] = [];
    return { asked, fetch: async (page: number) => { asked.push(page); if (!list[page]) throw new Error("unavailable"); return list[page]; } };
  };
  const recent = (id: string, minute: number, amount = 5) => ({ id, date: `2026-10-29T12:${String(minute).padStart(2, "0")}:00Z`, amount });
  const reached = pages([{ last: false, movements: [recent("a", 3, -50), { id: "b", date: "2026-10-28T09:00:00Z", amount: 5 }] }]);
  assert.deepEqual(await historySince(reached.fetch, since), { complete: true, movements: [{ date: "2026-10-29T12:03:00Z", amount: -50 }, { date: "2026-10-28T09:00:00Z", amount: 5 }] });
  assert.deepEqual(reached.asked, [0]);
  const last = pages([{ last: true, movements: [recent("a", 3)] }]);
  assert.equal((await historySince(last.fetch, since)).complete, true);
  const deeper = pages([{ last: false, movements: [recent("a", 9)] }, { last: false, movements: [recent("b", 8), { id: "c", date: "2026-10-20", amount: 5 }] }]);
  assert.equal((await historySince(deeper.fetch, since)).complete, true);
  assert.deepEqual(deeper.asked, [0, 1]);
  const repeated = pages([{ last: false, movements: [recent("a", 9)] }, { last: false, movements: [recent("a", 9)] }]);
  assert.equal((await historySince(repeated.fetch, since)).complete, false, "a repeated page stops the loop but proves nothing");
  const capped = pages(Array.from({ length: 9 }, (_, page) => ({ last: false, movements: [recent(`p${page}`, 10)] })));
  assert.equal((await historySince(capped.fetch, since, 5)).complete, false);
  assert.deepEqual(capped.asked, [0, 1, 2, 3, 4]);
  await assert.rejects(historySince(pages([{ last: false, movements: [recent("a", 9)] }]).fetch, since));
  assert.equal((await historySince(pages([{ last: false, movements: [{ id: "a", date: "2026-10-29", amount: 5 }] }, { last: true, movements: [] }]).fetch, since)).complete, true, "a same-day movement does not prove the window is covered");
});

test("R4: an uncertain extra-time request is never offered again for that trip, and the next trip starts free", async () => {
  const storage = memoryStore();
  const mine = await accountDigest("me@example.test");
  const tab = createOperations(() => storage);
  const route = slowRoute();
  const sent = runOnce(tab, `via:${mine}:trip-1`, route.post("/api/account/via", { stationNumber: 2002 }), { keep: true, meta: { number: 2002, name: "Bellecour" } });
  await route.answer({ status: 504, body: null });
  await sent;
  assert.equal(await runOnce(tab, `via:${mine}:trip-1`, route.post("/api/account/via", { stationNumber: 2002 }), { keep: true }), "busy");
  const next = runOnce(tab, `via:${mine}:trip-2`, route.post("/api/account/via", { stationNumber: 2002 }), { keep: true });
  await route.answer({ status: 200, body: ok });
  assert.deepEqual(await next, ok);
  assert.equal(route.calls.length, 2);
  const via = readFileSync("components/via-action.tsx", "utf8");
  assert.doesNotMatch(via, /Nouvelle demande|operations\.clear/);
  assert.match(via, /\{failure && isUncertain\(failure\) \? <Button variant="ghost" onClick=\{close\}>Fermer<\/Button> : <>/);
});

test("an uncertain unlock stays held in memory when the browser can read storage but cannot write it", async () => {
  const store = { ...memoryStore(), setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
  const locks = sharedLocks();
  const tab = createOperations(() => store, Date.now, () => locks);
  let posts = 0;
  const send = async (): Promise<Outcome> => { posts += 1; return routeFailure(504, null, "Réponse inattendue."); };
  const first = await runOnce(tab, "unlock:1", send);
  assert.ok(typeof first !== "string" && isUncertain(first));
  assert.equal(tab.get("unlock:1")?.status, "uncertain");
  assert.equal(await runOnce(tab, "unlock:1", send), "busy");
  assert.equal(posts, 1);
});

test("a sending entry restored after a reload re-renders once its two minutes pass, so its sheet turns uncertain", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 1_000_000;
  const store = memoryStore();
  store.setItem(OPERATIONS_KEY, JSON.stringify({ "unlock:42": { id: "restored", status: "sending", at: clock - 60_000, keep: true, outcome: null, meta: { bikeNumber: 42 } } }));
  const operations = createOperations(() => store, () => clock);
  let fired = 0;
  operations.subscribe(() => { fired++; });
  assert.equal(operations.get("unlock:42")?.status, "sending");
  clock += 59_000;
  t.mock.timers.tick(59_000);
  assert.equal(fired, 0);
  clock += 1_001;
  t.mock.timers.tick(1_001);
  assert.equal(fired, 1);
  assert.equal(operations.get("unlock:42")?.status, "uncertain");
});
