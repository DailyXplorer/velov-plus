import assert from "node:assert/strict";
import { test } from "node:test";
import { type Check, NOT_APPLIED, isUncertain, noAnswer, routeFailure, settle } from "../lib/outcome.ts";
import { autoSpendCheck, favoriteCheck, profileCheck, ratingCheck, renewalCheck } from "../lib/checks.ts";
import { sendStars } from "../lib/trip-end.ts";
import type { Dashboard, Trip } from "../lib/models.ts";

const profile: Dashboard["profile"] = { firstName: "CLAUDE", lastName: "MARTIN", email: "me@example.test", locked: false, complete: true, phoneNumber: "+33612345678", address: "1 place Bellecour", addressComplement: null, zipCode: "69002", city: "Lyon", country: "FR", favorites: [2002] };
const trip = (isRated: boolean | null): Trip => ({ id: "trip-1", status: "FINISHED", startedAt: null, endedAt: null, startStation: null, endStation: null, startStationNumber: null, endStationNumber: null, startStand: null, endStand: null, distance: null, bikeNumber: 20449, bikeType: "mechanical", duration: 12, price: 0, fullPrice: 0, discount: 0, pointsEarned: 0, pointsSpent: 0, litigious: false, isRated, token: null, origin: null });
const dashboard = (change: Partial<Dashboard> = {}): Dashboard => ({
  profile, rewards: { balance: 100, total: 300, autoSpend: true, movements: [], rules: [] },
  subscription: { id: "sub-1", title: "Abonnement", type: "LT", validUntil: null, active: true, autoRenewal: false, autoRenewalAllowed: true },
  paymentValid: true, receipts: null, trips: [trip(false)], ongoing: [], bookings: 0, updatedAt: "2026-10-29T12:00:00Z", warnings: [], ...change
});
const timeout = routeFailure(504, null, "Réponse inattendue.");

test("F3: a timeout or 5xx never re-offers Confirmer blindly; the real state decides", async () => {
  let reads = 0;
  const reading = (check: Check | Error) => async () => { reads++; if (check instanceof Error) throw check; return check; };
  assert.deepEqual(await settle(timeout, reading("applied")), { kind: "done" });
  assert.deepEqual(await settle(noAnswer("Le serveur ne répond pas."), reading("unchanged")), { kind: "refused", outcome: { ...noAnswer("Le serveur ne répond pas."), message: NOT_APPLIED } });
  assert.deepEqual(await settle(timeout, reading("unknown")), { kind: "uncertain", outcome: timeout });
  assert.deepEqual(await settle(timeout, reading(new Error("offline"))), { kind: "uncertain", outcome: timeout });
  assert.equal(reads, 4);
  const refusal = routeFailure(400, { error: "Ce réglage n’est pas valide.", code: "invalid" }, "");
  assert.deepEqual(await settle(refusal, reading("applied")), { kind: "refused", outcome: refusal });
  assert.equal(reads, 4, "a clear refusal needs no read");
});

test("F3: each setting is compared with the dashboard read after the uncertain write", () => {
  assert.equal(autoSpendCheck(dashboard(), true), "applied");
  assert.equal(autoSpendCheck(dashboard(), false), "unchanged");
  assert.equal(autoSpendCheck(dashboard({ rewards: { ...dashboard().rewards, autoSpend: null } }), false), "unknown");
  assert.equal(favoriteCheck(dashboard(), 2002, true), "applied");
  assert.equal(favoriteCheck(dashboard(), 3001, true), "unchanged");
  assert.equal(renewalCheck(dashboard(), "sub-1", true), "unchanged");
  assert.equal(renewalCheck(dashboard(), "sub-1", false), "applied");
  assert.equal(renewalCheck(dashboard({ subscription: "unavailable" }), "sub-1", true), "unknown");
  assert.equal(ratingCheck(dashboard(), "trip-1"), "unchanged");
  assert.equal(ratingCheck(dashboard({ trips: [trip(true)] }), "trip-1"), "applied");
  assert.equal(ratingCheck(dashboard({ trips: [trip(null)] }), "trip-1"), "unknown");
  assert.equal(ratingCheck(dashboard({ trips: null }), "trip-1"), "unknown");
});

test("F3: the profile counts as saved only when every sent field reads back, unchanged only when none moved", () => {
  const body = { city: "Villeurbanne", zipCode: "69100", firstName: "Claude" };
  assert.equal(profileCheck(profile, { ...profile, city: "Villeurbanne", zipCode: "69100" }, body), "applied");
  assert.equal(profileCheck(profile, profile, body), "unchanged");
  assert.equal(profileCheck(profile, { ...profile, city: "Villeurbanne" }, body), "unknown");
  assert.equal(profileCheck(profile, { ...profile, address: "2 rue de la République", addressComplement: "" }, { address: { name: "2 rue de la République", complement: "" } }), "applied");
});

test("F3: the rating answer is an Outcome, so a timeout or 5xx is uncertain and a coded 4xx is a refusal", async () => {
  const replying = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
  assert.equal((await sendStars("trip-1", 20449, 5, replying(200, { rated: true }))).ok, true);
  assert.equal(isUncertain(await sendStars("trip-1", 20449, 5, replying(504, null))), true);
  assert.equal(isUncertain(await sendStars("trip-1", 20449, 5, replying(503, { error: "Le service est momentanément indisponible.", code: "unavailable" }))), true);
  assert.equal(isUncertain(await sendStars("trip-1", 20449, 5, replying(200, null))), true);
  assert.equal(isUncertain(await sendStars("trip-1", 20449, 5, (async () => { throw new DOMException("timeout", "TimeoutError"); }) as typeof fetch)), true);
  const refused = await sendStars("trip-1", 20449, 5, replying(400, { error: "Cette note n’est pas valide.", code: "invalid" }));
  assert.deepEqual([refused.ok, refused.httpStatus, refused.code, refused.message, isUncertain(refused)], [false, 400, "invalid", "Cette note n’est pas valide.", false]);
});
