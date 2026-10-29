import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { postPromoCode } from "../lib/promo.ts";
import { promoBodySchema } from "../lib/promo-models.ts";
import { preparePromoStorage, promoStorageKey, readPromoCodes, savePromoCode } from "../lib/promo-storage.ts";

const original = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("Real network forbidden"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = original; });
const auth = { accountId: "account/test", token: "app-token", identity: "user-token" };
function recorder(status: number, body?: unknown, network = false) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (network) throw new TypeError("lost response");
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, send };
}

test("promocode debits once with no body, the rewards Accept and authenticated browser headers", async () => {
  const { calls, send } = recorder(200, { promoCode: "INVITE-EXAMPLE", offerId: 1, badgeId: 2, badgeType: "EXTERNAL", rewardsSpent: 50 });
  const result = await postPromoCode(auth, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/account%2Ftest/rewards/consume/promocode");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, undefined);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("accept"), "application/vnd.rewards.v5+json");
  assert.equal(headers.get("content-type"), null);
  assert.equal(headers.get("authorization"), "Taknv1 app-token");
  assert.equal(headers.get("identity"), "user-token");
  assert.match(headers.get("user-agent")!, /^Mozilla\//);
  assert.deepEqual([result.ok, result.httpStatus, result.promoCode], [true, 200, "INVITE-EXAMPLE"]);
});

test("unexpected or missing metadata never discards a returned promo code", async () => {
  for (const body of [{ promoCode: "KEEP-ME" }, { promoCode: "KEEP-ME", offerId: null, badgeId: {}, rewardsSpent: "unexpected" }]) {
    const result = await postPromoCode(auth, recorder(200, body).send);
    assert.equal(result.promoCode, "KEEP-ME");
    assert.equal(result.ok, true);
  }
});

test("every failure preserves raw HTTP/code/message and is never retried", async () => {
  for (const status of [400, 401, 403, 409, 429, 500, 502, 503, 504]) {
    const { calls, send } = recorder(status, { code: "rewards.exception.insufficient.rewards", message: "Not enough rewards" });
    const result = await postPromoCode(auth, send);
    assert.equal(calls.length, 1);
    assert.deepEqual([result.ok, result.httpStatus, result.code, result.detail, result.promoCode], [false, status, "rewards.exception.insufficient.rewards", "Not enough rewards", null]);
  }
  const lost = recorder(200, {}, true);
  const result = await postPromoCode(auth, lost.send);
  assert.equal(lost.calls.length, 1);
  assert.equal(result.code, "network");
});

test("success without a code warns about possible debit and does not call a process or retry", async () => {
  for (const status of [200, 204]) {
    const { calls, send } = recorder(status, { offerId: 1 });
    const result = await postPromoCode(auth, send);
    assert.equal(calls.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.code, "local.promo.unreadable");
    assert.match(result.message!, /avant de recommencer/);
  }
});

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}

test("codes persist across reopening, append rather than overwrite, and deduplicate", () => {
  const store = memoryStore();
  preparePromoStorage(store, "account-key");
  savePromoCode(store, "account-key", "CODE-A");
  savePromoCode(store, "account-key", "CODE-B");
  savePromoCode(store, "account-key", "CODE-A");
  assert.deepEqual(readPromoCodes(store, "account-key").map((entry) => entry.code), ["CODE-A", "CODE-B"]);
  assert.deepEqual(readPromoCodes(store, "another-account"), []);
});

test("storage failure is detected before the caller may debit, corrupt storage is never erased", () => {
  const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.throws(() => preparePromoStorage(blocked, "key"), /quota/);
  const store = memoryStore();
  store.setItem("key", "corrupt-but-recoverable-code");
  assert.throws(() => preparePromoStorage(store, "key"));
  assert.throws(() => savePromoCode(store, "key", "NEW-CODE"));
  assert.equal(store.getItem("key"), "corrupt-but-recoverable-code");
});

test("storage keys are account-scoped digests, not clear-text addresses", async () => {
  const first = await promoStorageKey("one@example.test");
  assert.equal(first, await promoStorageKey(" ONE@example.test "));
  assert.notEqual(first, await promoStorageKey("two@example.test"));
  assert.match(first, /^velov:promocodes:v1:[0-9a-f]{64}$/);
});

test("confirmation price is validated and no extra request fields accepted", () => {
  assert.equal(promoBodySchema.safeParse({ expectedCost: 50 }).success, true);
  for (const body of [{}, { expectedCost: -1 }, { expectedCost: 0.5 }, { expectedCost: "50" }, { expectedCost: 50, accountId: "other" }]) assert.equal(promoBodySchema.safeParse(body).success, false);
});
