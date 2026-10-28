import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { postVia } from "../lib/cyclocity.ts";
import { fullStations, viaBodySchema } from "../lib/via-models.ts";
import { VIA_STATION_IDENTIFIER } from "../lib/guesses.ts";
import type { Station } from "../lib/models.ts";

const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("Real fetch forbidden in tests"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });
const auth = { accountId: "account/one", subscriptionId: "subscription/one", token: "app", identity: "user", stationId: 1234 };
function recorder(status: number | Error, body?: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (status instanceof Error) throw status;
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
  }) as typeof fetch;
  return { calls, send };
}

test("via uses the number assumption, subscription media type and exactly one POST", async () => {
  const { calls, send } = recorder(200, { transactionState: "OK" });
  const outcome = await postVia(auth, send);
  assert.equal(VIA_STATION_IDENTIFIER, "number");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/account%2Fone/subscriptions/subscription%2Fone/via");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, '{"stationId":1234}');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("Authorization"), "Taknv1 app");
  assert.equal(headers.get("Identity"), "user");
  assert.match(headers.get("User-Agent") ?? "", /^Mozilla\//);
  assert.equal(headers.get("Content-Type"), "application/vnd.subscription.v6+json");
  assert.equal(headers.get("Accept"), null);
  assert.equal(outcome.ok, true);
});

test("via retains raw status, code and message and never retries any failure", async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
    const { calls, send } = recorder(status, { code: "via.refused", message: "Station not full" });
    const outcome = await postVia(auth, send);
    assert.equal(calls.length, 1);
    assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.code, outcome.detail], [false, status, "via.refused", "Station not full"]);
  }
  const lost = recorder(new TypeError("connection lost"));
  const result = await postVia(auth, lost.send);
  assert.equal(lost.calls.length, 1);
  assert.equal(result.code, "network");
  assert.equal(result.httpStatus, 0);
});

test("via fallback supports a UUID without a second submission", async () => {
  const { calls, send } = recorder(200);
  await postVia({ ...auth, stationId: "00000000-0000-0000-0000-000000000001" }, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, '{"stationId":"00000000-0000-0000-0000-000000000001"}');
});

test("via input accepts only one positive safe station number", () => {
  assert.equal(viaBodySchema.safeParse({ stationNumber: 1234 }).success, true);
  for (const value of [{ stationNumber: 0 }, { stationNumber: -1 }, { stationNumber: "1234" }, { stationNumber: 1.2 }, { stationNumber: 1234, subscriptionId: "other" }, {}]) assert.equal(viaBodySchema.safeParse(value).success, false);
});

test("picker excludes nonfull/closed stations, searches accents and sorts nearest first", () => {
  const base: Station = { id: "1", number: 1, name: "Étoile", address: "Rue exemple", lat: 0, lon: 1, mechanical: 4, electrical: 0, stands: 0, open: true };
  const stations = [base, { ...base, number: 2, name: "B", lon: 0 }, { ...base, number: 3, stands: 1 }, { ...base, number: 4, open: false }];
  assert.deepEqual(fullStations(stations, "", { lat: 0, lon: 0 }).map((s) => s.number), [2, 1]);
  assert.deepEqual(fullStations(stations, "etoile", null).map((s) => s.number), [1]);
  assert.deepEqual(fullStations(stations, "2", null).map((s) => s.number), [2]);
});


test("via requires an explicit OK transaction state, not just HTTP success", async () => {
  for (const transactionState of ["NOK", "ABORT", "TIME_OUT", "PENDING", "UNKNOWN"]) {
    const { calls, send } = recorder(200, { transactionState });
    const outcome = await postVia(auth, send);
    assert.equal(calls.length, 1);
    assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.transactionState], [false, 200, transactionState]);
  }
  for (const status of [200, 204]) {
    const { calls, send } = recorder(status);
    const outcome = await postVia(auth, send);
    assert.equal(calls.length, 1);
    assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.transactionState], [false, status, null]);
  }
});


test("via accepts the direct TransactionState string used by VLSKit", async () => {
  for (const state of ["OK", "NOK", "ABORT", "TIME_OUT", "RUNNING", "UNSTARTED", "NOT_CONNECTED", "UNKNOW"]) {
    const { calls, send } = recorder(200, state);
    const outcome = await postVia(auth, send);
    assert.equal(calls.length, 1);
    assert.deepEqual([outcome.ok, outcome.transactionState], [state === "OK", state]);
  }
});
