import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { appToken, fetchTransient, getStations, getWithAppToken } from "../lib/upstream.ts";
import { VelovError } from "../lib/auth-protocol.ts";

// Nothing here may reach Cyclocity: each test installs its own fetch, and the real one fails loudly.
const realFetch = globalThis.fetch;
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
function serve(reply: (call: Call, index: number) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return reply(call, calls.length - 1);
  }) as typeof fetch;
}
beforeEach(() => { calls = []; globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

const url = "https://api.cyclocity.fr/contracts/lyon/stations/2002";

test("a gateway error is retried with a fresh timeout per attempt, and the discarded body is cancelled", async () => {
  let cancelled = 0;
  serve((_call, index) => index === 0 ? new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 502 }) : Response.json({ ok: true }));
  const response = await fetchTransient(url, { headers: { Accept: "application/json" } });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(cancelled, 1);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.notEqual(calls[0].init.signal, calls[1].init.signal);
});

test("a network failure is retried, a timeout or another status is not", async () => {
  serve((_call, index) => { if (index === 0) throw new TypeError("fetch failed"); return Response.json({}); });
  assert.equal((await fetchTransient(url)).status, 200);
  assert.equal(calls.length, 2);
  calls = [];
  serve(() => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
  await assert.rejects(fetchTransient(url), (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  assert.equal(calls.length, 1);
  calls = [];
  serve(() => new Response(null, { status: 500 }));
  assert.equal((await fetchTransient(url)).status, 500);
  assert.equal(calls.length, 1);
});

test("the last gateway error is returned after three attempts", async () => {
  serve(() => new Response("Bad Gateway", { status: 503 }));
  assert.equal((await fetchTransient(url)).status, 503);
  assert.equal(calls.length, 3);
});

test("only reads and the client token request may be retried", async () => {
  serve(() => Response.json({}));
  for (const method of ["POST", "DELETE", "PUT", "post"]) {
    await assert.rejects(fetchTransient("https://api.cyclocity.fr/contracts/lyon/accounts/a/bookings", { method }), /refuses/);
  }
  await assert.rejects(fetchTransient("https://api.cyclocity.fr/contracts/lyon/accounts/a/trips/t/rate", { method: "POST" }), /refuses/);
  assert.equal(calls.length, 0);
  await fetchTransient("https://api.cyclocity.fr/auth/environments/PRD/client_tokens", { method: "POST" });
  assert.equal(calls.length, 1);
});

function tokens(...values: string[]) {
  let requests = 0;
  return { source: appToken(async () => values[requests++]), requests: () => requests };
}
const withToken = (token: string) => ({ Authorization: `Taknv1 ${token}` });
const authorization = (call: Call) => (call.init.headers as Record<string, string>).Authorization;

test("a 401 from a stale app token renews the token and tries once more", async () => {
  const { source, requests } = tokens("stale", "fresh");
  serve((call) => new Response(null, { status: authorization(call) === "Taknv1 stale" ? 401 : 200 }));
  assert.equal((await getWithAppToken(source, url, withToken)).status, 200);
  assert.deepEqual(calls.map(authorization), ["Taknv1 stale", "Taknv1 fresh"]);
  assert.equal(requests(), 2);
});

test("a 401 that survives a fresh app token is returned after one retry", async () => {
  const { source } = tokens("first", "second", "third");
  serve(() => new Response(null, { status: 401 }));
  assert.equal((await getWithAppToken(source, url, withToken)).status, 401);
  assert.equal(calls.length, 2);
});

test("parallel 401s renew the app token once; a token is dropped only while it is still the current one", async () => {
  const { source, requests } = tokens("stale", "fresh", "unexpected");
  serve((call) => new Response(null, { status: authorization(call) === "Taknv1 stale" ? 401 : 200 }));
  await source.get();
  const answers = await Promise.all([getWithAppToken(source, url, withToken), getWithAppToken(source, url, withToken), getWithAppToken(source, url, withToken)]);
  assert.deepEqual(answers.map((answer) => answer.status), [200, 200, 200]);
  assert.equal(requests(), 2);
  source.drop("stale");
  assert.equal(await source.get(), "fresh");
  assert.equal(requests(), 2);
});

const information = { data: { stations: [
  { station_id: "2002", name: "2002 - BELLECOUR / SAINT-EXUPÉRY", lat: 45.7578, lon: 4.832, address: "Place Bellecour" },
  { station_id: "7001", name: [{ text: "GARE D’OULLINS", language: "fr" }], lat: 45.71, lon: 4.81 },
  { station_id: "9001", name: "", lat: 45.7, lon: 4.8 }
] } };
const status = { last_updated: 1_772_444_000, data: { stations: [
  { station_id: "2002", num_vehicles_available: 5, num_docks_available: 10, is_renting: true, vehicle_types_available: [{ vehicle_type_id: "electrical", count: 2 }] },
  { station_id: "7001", num_bikes_available: 0, num_docks_available: 20, is_renting: 0 },
  { station_id: "9001", num_docks_available: 1, is_renting: 1 }
] } };
const gbfs = (call: Call) => Response.json(call.url.endsWith("station_information.json") ? information : status);

test("stations: one shared GBFS load, cached 45 s, and the last list served when Vélo’v fails", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-28T12:00:00Z") });
  serve(() => new Response(null, { status: 500 }));
  await assert.rejects(getStations(), (error: unknown) => error instanceof VelovError && error.code === "unavailable");

  calls = [];
  serve(gbfs);
  const loads = await Promise.all([getStations(), getStations(), getStations()]);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal((call.init as { next?: unknown }).next, undefined);
  const { stations, updatedAt } = loads[0];
  assert.deepEqual(loads[1], loads[0]);
  assert.equal(updatedAt, new Date(1_772_444_000 * 1000).toISOString());
  assert.deepEqual(stations.map((station) => [station.name, station.mechanical, station.electrical, station.stands, station.open]), [
    ["Bellecour / Saint-Exupéry", 3, 2, 10, true], ["Gare d’Oullins", 0, 0, 20, false], ["Station 9001", 0, 0, 1, true]
  ]);

  mock.timers.tick(44_000);
  assert.deepEqual(await getStations(), loads[0]);
  assert.equal(calls.length, 2);

  mock.timers.tick(2_000);
  serve(() => new Response(null, { status: 500 }));
  assert.deepEqual(await getStations(), loads[0]);
  assert.equal(calls.length, 4);
});
