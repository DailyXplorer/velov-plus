import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { postBooking, postRelease, postVia, refusal } from "../lib/cyclocity.ts";
import { postContactMail } from "../lib/contact-mail.ts";
import { postPromoCode } from "../lib/promo.ts";
import { isUncertain, networkFailure, noAnswer, routeFailure, technicalLine } from "../lib/outcome.ts";
import { beforeSend, errorResponse } from "../lib/session.ts";
import { SessionRevoked, VelovError } from "../lib/auth-protocol.ts";
import { readFileSync } from "node:fs";

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

test("an uncertain message states only its cause, with a joined « peut-être »; the instruction is left to the uncertain note", async () => {
  assert.equal((await release(gateway(502))).message, "Vélo’v ne répond pas. Le vélo est peut-⁠être déverrouillé.");
  assert.equal(await book(gateway(502)).then((outcome) => outcome.message), "Vélo’v ne répond pas. Le vélo est peut-⁠être réservé.");
  assert.equal((await via(gateway(502))).message, "Vélo’v ne répond pas. Les 15 minutes ont peut-⁠être été ajoutées.");
  assert.equal((await mail(timeout)).message, "Vélo’v ne répond pas. Votre message a peut-⁠être déjà été envoyé.");
  const replies: Reply[] = [gateway(500), gateway(502), timeout, { status: 403, text: "<html>Forbidden</html>" }, { status: 200, body: {} }, { status: 200, body: { transactionState: "SOMETHING_NEW" } }];
  for (const reply of replies) {
    for (const call of [release, book, promo, via, mail]) {
      const outcome = await call(reply);
      if (!isUncertain(outcome)) continue;
      assert.doesNotMatch(outcome.message ?? "", /réessayer|actualisez|n’a pas abouti|session/i, `${call.name} ${reply instanceof Error ? reply.name : reply.status}`);
      assert.doesNotMatch(outcome.message ?? "", /peut-être/, "peut-être keeps its word joiner");
    }
  }
  for (const file of ["lib/cyclocity.ts", "lib/bike-action.ts", "lib/promo.ts", "lib/trip-end.ts", "lib/operations.ts", "components/account-actions.tsx", "components/auto-renewal.tsx", "components/contact-support.tsx", "components/invite-friend.tsx", "components/via-action.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /peut-être/, file);
    assert.doesNotMatch(source, /[Aa]ctualisez la page avant de réessayer/, file);
  }
});

test("a read that fails before the write is a clear « nothing sent », only an expired session still signs out", async () => {
  for (const failure of [new VelovError("unavailable", "Certaines informations Vélo’v ne sont pas disponibles pour le moment."), new TypeError("fetch failed")]) {
    const thrown = await beforeSend(async () => { throw failure; }).catch((error: unknown) => error);
    const response = errorResponse(thrown);
    const outcome = routeFailure(response.status, await response.json(), "");
    assert.equal(outcome.code, "local.unavailable");
    assert.equal(outcome.message, "Vélo’v ne répond pas. Rien n’a été envoyé.");
    assert.equal(isUncertain(outcome), false, failure.message);
  }
  await assert.rejects(beforeSend(async () => { throw new SessionRevoked(); }), SessionRevoked);
  assert.equal(await beforeSend(async () => 42), 42);
  for (const route of ["unlock", "bookings", "trips/[id]/rate", "account/rewards", "account/promocode", "account/profile", "account/favorites/[number]", "account/via", "account/auto-renewal", "account/contact"]) {
    const source = readFileSync(`app/api/${route}/route.ts`, "utf8");
    const write = source.slice(source.search(/async function (POST|PATCH|DELETE|bookmark)\(/));
    assert.match(write, /beforeSend\(\(\) => getSession\(request\)\)/, route);
  }
});

test("the technical line names the state, the HTTP status, the code and the detail, and omits what is unknown", () => {
  assert.equal(technicalLine({ ok: false, httpStatus: 200, transactionState: "TIME_OUT", code: "release.timeout", message: "La borne ne répond pas.", detail: "Borne 4" }), "TransactionState TIME_OUT · HTTP 200 · Code release.timeout · Borne 4");
  assert.equal(technicalLine(routeFailure(503, { error: "Le service est momentanément indisponible.", code: "unavailable" }, "")), "HTTP 503 · Code unavailable");
  assert.equal(technicalLine({ ok: false, httpStatus: 409, transactionState: null, code: null, message: null, detail: null }), "HTTP 409");
  assert.equal(technicalLine(networkFailure("Le serveur ne répond pas.", new DOMException("aborted", "TimeoutError"), 0, 40_000)), "HTTP aucune réponse · Code network · Délai dépassé après 40 s · TimeoutError");
});
