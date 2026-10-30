import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { ACTION_TIMEOUT_MS, postBooking, postRelease } from "../lib/cyclocity.ts";
import { VelovError } from "../lib/auth-protocol.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

type Reply = { status: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error;
function recorder(reply: Reply) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (reply instanceof Error) throw reply;
    return new Response(reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body)), { status: reply.status, headers: reply.headers });
  }) as typeof fetch;
  return { calls, send };
}

const tokens = { accountId: "acc-1", token: "client", identity: "user" };
const release = { ...tokens, subscriptionId: "sub-1", body: { stationNumber: 2002, standNumber: 1, bikeNumber: 20449 } };
const booking = { ...tokens, body: { stationId: "st-uuid", stationNumber: 2002, standNumber: 12, subscriptionId: "sub-1", bikeId: "bike-uuid" } };

test("a release posts the app's body to the subscription's trips, once, with both tokens and a browser agent", async () => {
  const { calls, send } = recorder({ status: 200, body: { transactionState: "OK" } });
  const outcome = await postRelease(release, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/acc-1/subscriptions/sub-1/trips");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Taknv1 client");
  assert.equal(headers.Identity, "user");
  assert.equal(headers["Content-Type"], "application/vnd.trip.v6+json");
  assert.match(headers["User-Agent"], /^Mozilla\//);
  assert.equal(String(calls[0].init.body), '{"stationNumber":2002,"standNumber":1,"bikeNumber":20449,"typeFrom":"SMARTPHONE"}');
  assert.deepEqual(outcome, { ok: true, httpStatus: 200, transactionState: "OK", code: null, message: null, detail: null });
});

test("a release succeeds on transactionState OK only, not on HTTP 200", async () => {
  for (const [state, message] of [
    ["NOK", "Le vélo n’a pas pu être déverrouillé."], ["ABORT", "Le déverrouillage a été annulé."],
    ["TIME_OUT", "La borne n’a pas répondu à temps."], ["NOT_CONNECTED", "Aucun vélo n’est accroché à cette borne."],
    ["SOMETHING_NEW", "Vélo’v ne répond pas. Le vélo est peut-\u2060être déverrouillé."], [undefined, "Vélo’v ne répond pas. Le vélo est peut-\u2060être déverrouillé."]
  ] as const) {
    const outcome = await postRelease(release, recorder({ status: 200, body: state ? { transactionState: state } : {} }).send);
    assert.equal(outcome.ok, false, String(state));
    assert.equal(outcome.transactionState, state ?? null);
    assert.equal(outcome.message, message);
  }
});

test("release refusals map to the app's French messages and keep the raw code and message", async () => {
  const reserved = await postRelease(release, recorder({ status: 404, body: { code: "trips.exception.bookings.already.reserved", message: "Bike reserved by another user" } }).send);
  assert.deepEqual([reserved.ok, reserved.httpStatus, reserved.code, reserved.detail], [false, 404, "trips.exception.bookings.already.reserved", "Bike reserved by another user"]);
  assert.match(reserved.message ?? "", /^Vélo réservé par un autre usager/);
  for (const [code, message] of [
    ["kiwi.exception.customer.insuffisant.right", "Abonnement hors validité."],
    ["trips.exception.invalid.customer.maxBikesRented", "Impossible de libérer le vélo, un autre trajet est en cours."],
    ["kiwi.exception.customer.rent.time.limit", "Délai entre deux courses non écoulé."],
    ["kiwi.exception.customer.paymentmode.not.valid", "Veuillez mettre à jour votre mode de paiement."],
    ["kiwi.exception.no.release.bike", "Problème technique lors de la libération du vélo."]
  ]) assert.equal((await postRelease(release, recorder({ status: 400, body: { code } }).send)).message, message);
});

test("a refusal without a JSON body falls back to the Bloot-Error-Code header, and a bare 403 stays uncertain", async () => {
  const header = await postRelease(release, recorder({ status: 400, text: "", headers: { "Bloot-Error-Code": "kiwi.exception.customer.insuffisant.right" } }).send);
  assert.deepEqual([header.code, header.message], ["kiwi.exception.customer.insuffisant.right", "Abonnement hors validité."]);
  const tomcat = await postRelease(release, recorder({ status: 403, text: "<html><body>HTTP Status 403</body></html>" }).send);
  assert.equal(tomcat.code, null);
  assert.equal(tomcat.message, "Vélo’v ne répond pas. Le vélo est peut-\u2060être déverrouillé.");
  assert.match(tomcat.detail ?? "", /403/);
});

test("a release is never retried: gateway errors, a lost answer and an expired session each cost exactly one call", async () => {
  for (const status of [500, 502, 503, 504]) {
    const { calls, send } = recorder({ status, text: "<html>Bad Gateway</html>" });
    const outcome = await postRelease(release, send);
    assert.equal(calls.length, 1, String(status));
    assert.deepEqual([outcome.ok, outcome.httpStatus], [false, status]);
  }
  const lost = recorder(new DOMException("The operation timed out.", "TimeoutError"));
  const outcome = await postRelease(release, lost.send);
  assert.equal(lost.calls.length, 1);
  assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.code, outcome.detail], [false, 0, "network", "TimeoutError"]);
  assert.equal(outcome.message, "Vélo’v ne répond pas. Le vélo est peut-\u2060être déverrouillé.");
  const expired = recorder({ status: 401 });
  await assert.rejects(postRelease(release, expired.send), (error) => error instanceof VelovError && error.code === "expired");
  assert.equal(expired.calls.length, 1);
});

test("a booking posts CreateBooking in the app's field order, as plain JSON without Accept, once", async () => {
  const reply = { id: "bk-1", contractName: "lyon", accountId: "acc-1", subscriptionId: "sub-1", stationId: "st-uuid", stationNumber: 2002, standNumber: 12, bikeId: "bike-uuid", endTime: "2026-03-02T09:47:14" };
  const { calls, send } = recorder({ status: 200, body: reply });
  const { outcome, booking: booked } = await postBooking(booking, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/acc-1/bookings");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Taknv1 client");
  assert.equal(headers.Identity, "user");
  assert.equal(headers["Content-Type"], "application/json; charset=UTF-8");
  assert.equal(headers.Accept, undefined);
  assert.match(headers["User-Agent"], /^Mozilla\//);
  assert.equal(String(calls[0].init.body), '{"stationId":"st-uuid","stationNumber":2002,"standNumber":12,"subscriptionId":"sub-1","bikeId":"bike-uuid"}');
  assert.equal(outcome.ok, true);
  assert.deepEqual(booked, { id: "bk-1", stationNumber: 2002, standNumber: 12, bikeId: "bike-uuid", endTime: "2026-03-02T09:47:14" });
});

test("booking refusals map to French messages, unknown ones to the app's generic one", async () => {
  for (const [code, message] of [
    ["booking.exception.bike.already.reserved", "Ce vélo est déjà réservé par un autre usager."],
    ["bookings.exception.not.authorized", "Vous avez déjà une réservation en cours, ou moins de 10 points."],
    ["rewards.exception.something", "La réservation de votre vélo n’a pas fonctionné."]
  ]) {
    const { outcome, booking: booked } = await postBooking(booking, recorder({ status: 400, body: { code, message: "raw" } }).send);
    assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.code, outcome.message, outcome.detail, booked], [false, 400, code, message, "raw", null]);
  }
});

test("a booking is never retried either", async () => {
  for (const reply of [{ status: 502, text: "Bad Gateway" }, new TypeError("fetch failed")] as Reply[]) {
    const { calls, send } = recorder(reply);
    const { outcome } = await postBooking(booking, send);
    assert.equal(calls.length, 1);
    assert.equal(outcome.ok, false);
  }
  const expired = recorder({ status: 401 });
  await assert.rejects(postBooking(booking, expired.send), (error) => error instanceof VelovError && error.code === "expired");
  assert.equal(expired.calls.length, 1);
});

test("the booking and unlock routes outlive the action timeout, so the platform never cuts an answer that may confirm a booking or a release", () => {
  for (const route of ["app/api/bookings/route.ts", "app/api/unlock/route.ts"]) {
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(readFileSync(route, "utf8"))?.[1]);
    assert.ok(maxDuration * 1000 >= 2 * ACTION_TIMEOUT_MS, `${route}: maxDuration ${maxDuration}`);
  }
});
