import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { ACTION_TIMEOUT, OPERATIONS_KEY, SENDING_LIMIT, UNCERTAIN_HOLD, accountDigest, createOperations, inviteDebit, runOnce } from "../lib/operations.ts";
import { type Outcome, outcomeSchema } from "../lib/models.ts";
import { HISTORY_LAG, isUncertain, noAnswer, routeFailure } from "../lib/outcome.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

function memoryStore() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
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
  return { calls, post, watch: (store: ReturnType<typeof memoryStore>) => { storage = store; }, async answer(reply: { status: number; body: unknown } | Error) { answers.shift()!(reply); await new Promise((resolve) => setImmediate(resolve)); } };
}

const ok: Outcome = { ok: true, httpStatus: 200, transactionState: "OK", code: null, message: null, detail: null };
const unlockBody = { stationNumber: 2002, standNumber: 12, bikeNumber: 20449 };

test("F1: an unlock in flight blocks a second send after closing and reopening the bike, any other action, and another tab", async () => {
  let clock = 0;
  const storage = memoryStore();
  const tab = createOperations(() => storage, () => clock);
  const otherTab = createOperations(() => storage, () => clock);
  const route = slowRoute();
  const first = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy", "same bike reopened");
  assert.equal(await runOnce(tab, "book:20449", route.post("/api/bookings", unlockBody)), "busy", "another action meanwhile");
  assert.equal(await runOnce(otherTab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy", "another tab");
  assert.equal(tab.sending(), true);
  assert.equal(otherTab.busy(), true);
  assert.equal(route.calls.length, 1);
  clock += 90_000;
  await route.answer({ status: 504, body: null });
  const outcome = await first;
  assert.ok(outcome !== "busy" && outcome !== "unsaved" && isUncertain(outcome));
  assert.equal(tab.sending(), false);
  assert.equal(tab.get("unlock:20449")?.status, "uncertain");
  assert.equal(otherTab.get("unlock:20449")?.status, "uncertain");
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy", "uncertain: no blind Confirmer");
  assert.equal(route.calls.length, 1);
  clock += UNCERTAIN_HOLD + 1;
  assert.equal(tab.get("unlock:20449"), null);
  const again = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  await route.answer({ status: 200, body: ok });
  assert.deepEqual(await again, ok);
  assert.equal(route.calls.length, 2);
  assert.equal(tab.get("unlock:20449"), null);
});

test("F1: a clear refusal frees the bike at once, and a lock left by a closed tab expires", async () => {
  let clock = 0;
  const storage = memoryStore();
  const tab = createOperations(() => storage, () => clock);
  const route = slowRoute();
  const refused = runOnce(tab, "book:20449", route.post("/api/bookings", unlockBody));
  await route.answer({ status: 400, body: { error: "Ce vélo est déjà réservé.", code: "local.bike.reserved" } });
  assert.equal((await refused) !== "busy" && isUncertain(await refused as Outcome), false);
  assert.equal(tab.get("book:20449"), null);
  const closed = createOperations(() => storage, () => clock);
  assert.equal(closed.begin("unlock:1"), "started");
  const survivor = createOperations(() => storage, () => clock);
  assert.equal(survivor.begin("unlock:2"), "busy");
  clock += SENDING_LIMIT + 1;
  const lost = survivor.get("unlock:1");
  assert.equal(lost?.status, "uncertain", "a tab closed during the unlock never brings Confirmer back silently");
  assert.equal(isUncertain(lost!.outcome!), true);
  assert.equal(survivor.begin("unlock:1"), "busy");
  assert.equal(survivor.begin("unlock:2"), "started");
  clock += UNCERTAIN_HOLD;
  assert.equal(survivor.get("unlock:1"), null);
});

test("F1: a POST that never answers ends uncertain after the action timeout and frees the lock", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const storage = memoryStore();
  const tab = createOperations(() => storage);
  const other = createOperations(() => storage);
  const route = slowRoute();
  const first = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  t.mock.timers.tick(ACTION_TIMEOUT - 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tab.sending(), true);
  t.mock.timers.tick(1);
  const outcome = await first;
  assert.ok(outcome !== "busy" && outcome !== "unsaved" && isUncertain(outcome));
  assert.equal(tab.sending(), false);
  assert.equal(tab.busy(), false);
  assert.equal(other.busy(), false);
  assert.equal(tab.get("unlock:20449")?.status, "uncertain");
  assert.equal(tab.begin("book:1"), "started");
  assert.equal(route.calls.length, 1);
});

test("F1: without storage the same tab is still locked in memory", async () => {
  const tab = createOperations(() => null);
  const route = slowRoute();
  const first = runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody));
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy");
  await route.answer(new TypeError("offline"));
  assert.equal(isUncertain(await first as Outcome), true);
  assert.equal(await runOnce(tab, "unlock:20449", route.post("/api/unlock", unlockBody)), "busy");
  assert.equal(route.calls.length, 1);
});

test("F2: the invite is recorded before sending; after an uncertain answer it survives closing and reloading until explicitly cleared", async () => {
  let clock = Date.parse("2026-10-29T12:00:00Z");
  const storage = memoryStore();
  const key = `invite:${await accountDigest("me@example.test")}`;
  const tab = createOperations(() => storage, () => clock);
  const route = slowRoute();
  route.watch(storage);
  const first = runOnce(tab, key, route.post("/api/account/promocode", { expectedCost: 50 }), { keep: true, meta: { cost: 50, balance: 120 } });
  assert.match(route.calls[0].stored!, /"status":"sending"/, "pending persisted before the request left");
  await route.answer({ status: 503, body: { error: "Le service est momentanément indisponible.", code: "unavailable" } });
  await first;
  clock += 24 * 3_600_000;
  const reloaded = createOperations(() => storage, () => clock);
  const pending = reloaded.get(key);
  assert.equal(pending?.status, "uncertain");
  assert.deepEqual(pending?.meta, { cost: 50, balance: 120 });
  assert.equal(await runOnce(reloaded, key, route.post("/api/account/promocode", { expectedCost: 50 }), { keep: true }), "busy");
  assert.equal(route.calls.length, 1);
  reloaded.clear(key);
  const retry = runOnce(reloaded, key, route.post("/api/account/promocode", { expectedCost: 50 }), { keep: true });
  await route.answer({ status: 200, body: { ...ok, promoCode: "CODE" } });
  assert.equal((await retry as Outcome).ok, true);
  assert.equal(route.calls.length, 2);
  assert.equal(reloaded.get(key), null);
});

test("F2: a page closed during the invite leaves it uncertain, never forgotten; no storage means nothing is sent", async () => {
  let clock = 0;
  const storage = memoryStore();
  const closed = createOperations(() => storage, () => clock);
  assert.equal(closed.begin("invite:abc", { keep: true }), "started");
  clock += SENDING_LIMIT + 1;
  const next = createOperations(() => storage, () => clock);
  assert.equal(next.get("invite:abc")?.status, "uncertain");
  assert.equal(isUncertain(next.get("invite:abc")!.outcome!), true);
  assert.equal(next.begin("invite:abc", { keep: true }), "busy");
  const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
  const route = slowRoute();
  assert.equal(await runOnce(createOperations(() => blocked), "invite:abc", route.post("/api/account/promocode", {}), { keep: true }), "unsaved");
  assert.equal(route.calls.length, 0);
});

test("F2: Vérifier mon solde detects the debit from the history, and allows a retry only when the balance proves nothing left", () => {
  const at = Date.parse("2026-10-29T12:00:00Z");
  const before = { at, cost: 50, balance: 120 };
  const later = at + 10 * 60_000;
  assert.equal(inviteDebit(before, { balance: 70, movements: [{ date: "2026-10-29T12:00:03Z", amount: -50 }] }, later), "debited");
  assert.equal(inviteDebit(before, { balance: 70, movements: [{ date: "2026-10-29", amount: -50 }] }, later), "debited");
  assert.equal(inviteDebit(before, { balance: 120, movements: [{ date: "2026-10-01T08:00:00Z", amount: -50 }] }, later), "not-debited");
  assert.equal(inviteDebit(before, { balance: 125, movements: [{ date: "2026-10-29T12:30:00Z", amount: 5 }] }, later), "not-debited");
  assert.equal(inviteDebit(before, { balance: 70, movements: [] }, later), "unknown", "balance dropped without a visible movement");
  assert.equal(inviteDebit(before, { balance: null, movements: [] }, later), "unknown");
  assert.equal(inviteDebit({ ...before, balance: null }, { balance: 120, movements: [] }, later), "unknown");
  assert.equal(inviteDebit(before, { balance: 120, movements: [{ date: "2026-10-29", amount: -50 }] }, later), "not-debited", "another invite earlier the same day");
  assert.equal(inviteDebit({ ...before, balance: null }, { balance: 70, movements: [{ date: "2026-10-29", amount: -50 }] }, later), "unknown");
  assert.equal(inviteDebit(before, { balance: 120, movements: [] }, at + HISTORY_LAG - 1), "unknown", "the rewards history may still lag");
  assert.equal(inviteDebit(before, { balance: 120, movements: [] }, at + HISTORY_LAG), "not-debited");
  assert.equal(inviteDebit(before, { balance: 70, movements: [{ date: "2026-10-29T12:00:03Z", amount: -50 }] }, at + 30_000), "debited");
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
  assert.equal(reopened.begin(`contact:${mine}`, { keep: true }), "busy");
  reopened.clear(`contact:${mine}`);
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

test("R3: another debit after the invite no longer blocks it forever once the history had time to show the invite", () => {
  const at = Date.parse("2026-10-29T12:00:00Z");
  const before = { at, cost: 50, balance: 120 };
  const booking = { balance: 110, movements: [{ date: "2026-10-29T12:01:00Z", amount: -10 }] };
  assert.equal(inviteDebit(before, booking, at + HISTORY_LAG - 1), "unknown");
  assert.equal(inviteDebit(before, booking, at + HISTORY_LAG), "not-debited");
  assert.equal(inviteDebit(before, { balance: 71, movements: [] }, at + HISTORY_LAG), "not-debited");
  assert.equal(inviteDebit(before, { balance: 70, movements: [] }, at + HISTORY_LAG), "unknown");
  assert.equal(inviteDebit(before, { balance: 60, movements: [{ date: "2026-10-29T12:01:00Z", amount: -10 }] }, at + HISTORY_LAG), "unknown");
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
