import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { postBooking, postRelease, postVia, refusal } from "../lib/cyclocity.ts";
import { postContactMail } from "../lib/contact-mail.ts";
import { postPromoCode } from "../lib/promo.ts";
import { isUncertain, noAnswer, routeFailure } from "../lib/outcome.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

type Reply = { status: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error;
const answering = (reply: Reply) => (async () => {
  if (reply instanceof Error) throw reply;
  return new Response(reply.text ?? (reply.body === undefined ? null : JSON.stringify(reply.body)), { status: reply.status, headers: reply.headers });
}) as typeof fetch;

const auth = { accountId: "acc-1", token: "client", identity: "user" };
const release = (reply: Reply) => postRelease({ ...auth, subscriptionId: "sub-1", body: { stationNumber: 2002, standNumber: 1, bikeNumber: 20449 } }, answering(reply));
const book = async (reply: Reply) => (await postBooking({ ...auth, body: { stationId: "st", stationNumber: 2002, standNumber: 12, subscriptionId: "sub-1", bikeId: "bike" } }, answering(reply))).outcome;
const promo = (reply: Reply) => postPromoCode(auth, answering(reply));
const via = (reply: Reply) => postVia({ ...auth, subscriptionId: "sub-1", stationId: 1234 }, answering(reply));
const mail = (reply: Reply) => postContactMail({ ...auth, body: { complaintType: "TRIP", message: "Bonjour" } }, answering(reply));
const gateway = (status: number) => ({ status, text: `<html><body>${status} Bad Gateway</body></html>` });
const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");

test("a lost answer is uncertain for every state-changing call: network error, timeout or abort", async () => {
  for (const error of [new TypeError("fetch failed"), timeout, new DOMException("aborted", "AbortError")]) {
    for (const call of [release, book, promo, via, mail]) assert.equal(isUncertain(await call(error)), true, `${call.name} ${error.name}`);
  }
  assert.equal(isUncertain(noAnswer("Le serveur ne répond pas.")), true);
});

test("a 5xx or a gateway page without a refusal code is uncertain, and so is a 5xx with one", async () => {
  for (const status of [500, 502, 503, 504]) {
    for (const call of [release, book, promo, via, mail]) assert.equal(isUncertain(await call(gateway(status))), true, `${call.name} ${status}`);
  }
  assert.equal(isUncertain(await book({ status: 500, body: { code: "booking.exception.internal", message: "boom" } })), true);
});

test("an answer that does not prove a refusal is uncertain: an unread 2xx, a borne time-out, a 4xx without a code", async () => {
  assert.equal(isUncertain(await promo({ status: 200, body: { offerId: 1 } })), true, "debited without a readable code");
  assert.equal(isUncertain(await via({ status: 200, body: { transactionState: "PENDING" } })), true);
  assert.equal(isUncertain(await release({ status: 200, body: { transactionState: "TIME_OUT" } })), true);
  assert.equal(isUncertain(await release({ status: 200, body: {} })), true);
  assert.equal(isUncertain(await book({ status: 403, text: "<html>Forbidden</html>" })), true);
});

test("a 4xx with a Vélo’v error code, from the body or the Bloot header, is a clear refusal", async () => {
  assert.equal(isUncertain(await book({ status: 400, body: { code: "booking.exception.bike.already.reserved", message: "reserved" } })), false);
  assert.equal(isUncertain(await release({ status: 400, body: { code: "trips.exception.invalid.customer.maxBikesRented" } })), false);
  assert.equal(isUncertain(await promo({ status: 409, text: "", headers: { "Bloot-Error-Code": "rewards.exception.balance" } })), false);
  assert.equal(isUncertain(await via({ status: 422, body: { code: "subscriptions.exception.via.refused" } })), false);
  assert.equal(isUncertain(await mail({ status: 400, body: { code: "accounts.exception.mail.invalid" } })), false);
});

test("a definite release failure state is a clear refusal: the borne answered that it kept the bike", async () => {
  for (const transactionState of ["NOK", "ABORT", "NOT_CONNECTED"]) assert.equal(isUncertain(await release({ status: 200, body: { transactionState } })), false, transactionState);
});

test("a refusal by our own server before anything was sent is clear; success is never uncertain", async () => {
  assert.equal(isUncertain(refusal("local.bike.gone", "Ce vélo n’est plus disponible à cette station.")), false);
  assert.equal(isUncertain(refusal("local.promo.price.changed", "L’offre a changé.")), false);
  assert.equal(isUncertain(routeFailure(400, { error: "Cette réservation n’est pas valide.", code: "invalid" }, "")), false);
  assert.equal(isUncertain(routeFailure(403, { error: "Cette action n’est possible que depuis ce site.", code: "origin" }, "")), false);
  assert.equal(isUncertain(await book({ status: 201, body: { id: "b-1", stationNumber: 2002, bikeId: "bike" } })), false);
});

test("our route failing after the confirmation is uncertain: its 503, a platform timeout page, an unreadable 200", () => {
  assert.equal(isUncertain(routeFailure(503, { error: "Le service est momentanément indisponible.", code: "unavailable" }, "")), true);
  assert.equal(isUncertain(routeFailure(504, null, "Réponse inattendue.")), true);
  assert.equal(isUncertain(routeFailure(200, null, "Réponse inattendue.")), true);
  assert.deepEqual(routeFailure(504, null, "Réponse inattendue."), { ok: false, httpStatus: 504, transactionState: null, code: "local.unreadable", message: "Réponse inattendue.", detail: null });
});
