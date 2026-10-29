import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type Check, HISTORY_LAG, NOT_APPLIED, isUncertain, noAnswer, routeFailure, settle } from "../lib/outcome.ts";
import { autoSpendCheck, favoriteCheck, profileCheck, ratingCheck, renewalCheck } from "../lib/checks.ts";
import { sendStars } from "../lib/trip-end.ts";
import type { Dashboard, Outcome, Trip } from "../lib/models.ts";
import { createOperations, runOnce, settleHeld } from "../lib/operations.ts";

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
  assert.deepEqual(await settle(timeout, reading("applied"), 0, () => 0), { kind: "done" });
  assert.deepEqual(await settle(noAnswer("Le serveur ne répond pas."), reading("unchanged"), 0, () => HISTORY_LAG), { kind: "refused", outcome: { ...noAnswer("Le serveur ne répond pas."), message: NOT_APPLIED } });
  assert.deepEqual(await settle(timeout, reading("unknown"), 0, () => 0), { kind: "uncertain", outcome: timeout });
  assert.deepEqual(await settle(timeout, reading(new Error("offline")), 0, () => 0), { kind: "uncertain", outcome: timeout });
  assert.equal(reads, 4);
  const refusal = routeFailure(400, { error: "Ce réglage n’est pas valide.", code: "invalid" }, "");
  assert.deepEqual(await settle(refusal, reading("applied"), 0, () => 0), { kind: "refused", outcome: refusal });
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

const memoryStore = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("R2: an uncertain setting stays held after Fermer and in another tab, and only a real read past the history lag frees Confirmer", async () => {
  for (const key of ["autoSpend:abc", "favorite:abc:2002", "profile:abc", "renewal:abc:sub-1"]) {
    let clock = 0;
    const storage = memoryStore();
    const tab = createOperations(() => storage, () => clock);
    let writes = 0;
    const lost = async () => { writes++; return noAnswer("Le serveur ne répond pas."); };
    const first = await runOnce(tab, key, lost, { keep: true, meta: { wanted: 1 } });
    assert.ok(first !== "busy" && first !== "unsaved" && isUncertain(first));
    const reopened = createOperations(() => storage, () => clock);
    assert.equal(reopened.get(key)?.status, "uncertain", key);
    assert.equal(reopened.get(key)?.meta.wanted, 1, key);
    assert.equal(await runOnce(reopened, key, lost, { keep: true }), "busy", `${key}: Confirmer after reopening`);
    clock += 1_000;
    assert.equal((await settleHeld(reopened, key, async () => "unchanged", () => clock))?.kind, "uncertain", `${key}: the read may lag`);
    assert.equal((await settleHeld(reopened, key, async () => "unknown", () => clock))?.kind, "uncertain", key);
    assert.equal(tab.get(key)?.status, "uncertain", key);
    clock += HISTORY_LAG;
    assert.deepEqual(await settleHeld(reopened, key, async () => "unchanged", () => clock), { kind: "refused", outcome: { ...noAnswer("Le serveur ne répond pas."), message: NOT_APPLIED } });
    assert.equal(tab.get(key), null, key);
    await runOnce(tab, key, lost, { keep: true });
    assert.deepEqual(await settleHeld(tab, key, async () => "applied", () => clock), { kind: "done" });
    assert.equal(tab.get(key), null, key);
    assert.equal(writes, 2, key);
  }
});

test("R2: a setting in flight blocks any other action, even from another tab", async () => {
  const storage = memoryStore();
  const tab = createOperations(() => storage);
  let answer: (outcome: Outcome) => void = () => {};
  const sending = runOnce(tab, "renewal:abc:sub-1", () => new Promise<Outcome>((resolve) => { answer = resolve; }), { keep: true });
  assert.equal(await runOnce(createOperations(() => storage), "autoSpend:abc", async () => noAnswer(""), { keep: true }), "busy");
  answer({ ok: true, httpStatus: 200, transactionState: null, code: null, message: null, detail: null });
  assert.equal((await sending as Outcome).ok, true);
});

test("R2: the four settings write through the shared operation store and reopen on Fermer and Vérifier alone", () => {
  const actions = source("components/account-actions.tsx");
  assert.match(actions, /const outcome = await runOnce\(operations, operationKey, run, \{ keep: true, meta \}\);/);
  for (const key of ["`autoSpend:\\$\\{digest\\}`", "`favorite:\\$\\{digest\\}:\\$\\{station\\.number\\}`", "`profile:\\$\\{digest\\}`"]) assert.match(actions, new RegExp(`const operationKey = digest \\? ${key} : null;`), key);
  assert.match(actions, /const next = operation \? operation\.meta\.wanted === 1 : !value;/);
  assert.match(actions, /const next = operation \? operation\.meta\.wanted === 1 : !favorite;/);
  assert.match(actions, /const held = heldProfile\(useOperation\(operationKey\)\);/);
  assert.match(actions, /const uncertain = operation\?\.status === "uncertain" \?/);
  assert.match(actions, /const settled = await settleHeld\(operations, operationKey, check\);/);
  assert.doesNotMatch(actions, /kind: "uncertain"|\bsettle\(/);
  const renewal = source("components/auto-renewal.tsx");
  assert.match(renewal, /const operationKey = digest && subscriptionId \? `renewal:\$\{digest\}:\$\{subscriptionId\}` : null;/);
  assert.match(renewal, /await runOnce\(operations, operationKey, [\s\S]*?\{ keep: true, meta: \{ wanted: next \? 1 : 0 \} \}\);/);
  assert.match(renewal, /const next = operation \? operation\.meta\.wanted === 1 : !actual;/);
  assert.match(renewal, /const uncertain = operation\?\.status === "uncertain";/);
  assert.match(renewal, /await settleHeld\(operations, operationKey, /);
  assert.doesNotMatch(renewal, /setUncertain|\bsettle\(/);
  assert.match(source("components/trip-sheet.tsx"), /await settleHeld\(operations, `rate:\$\{trip\.id\}`, /);
  const dashboard = source("components/dashboard.tsx");
  for (const tag of ["AutoSpendSetting", "ProfileCoordinates", "AutoRenewal"]) assert.match(dashboard, new RegExp(`<${tag} [^\\n]*account=\\{data\\.profile\\.email\\}`), tag);
  assert.equal(dashboard.match(/<FavoriteButton [^\n]*account=\{account\}/g)?.length, 2);
  assert.match(source("components/companion.tsx"), /<StationsPage [^\n]*account=\{state\.data\.profile\.email\}/);
});
