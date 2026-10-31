import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { OPERATIONS_KEY, type Locks, accountDigest, createOperations, runOnce, settleHeld } from "../lib/operations.ts";
import { patchAutoRenewal, patchAutoSpend, patchProfile, postRating, putStationBookmark } from "../lib/cyclocity.ts";
import { postContactMail } from "../lib/contact-mail.ts";
import { completeRenewalChange } from "../lib/renewal-models.ts";
import { HISTORY_LAG, isUncertain, noAnswer } from "../lib/outcome.ts";
import type { Outcome } from "../lib/models.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}

function sharedLocks(): Locks {
  let tail: Promise<unknown> = Promise.resolve();
  return { request<T>(_name: string, run: () => Promise<T>) { const result = tail.then(run); tail = result.catch(() => {}); return result; } };
}

test("an unlock saved before the account keys holds the bike for every account, and no account's history settles or clears it", async () => {
  let clock = 0;
  const storage = memoryStore();
  const legacy = { id: "", status: "uncertain", at: 0, keep: true, outcome: noAnswer("Le serveur ne répond pas."), meta: { stationNumber: 2002, standNumber: 12, bikeNumber: 42 } };
  storage.setItem(OPERATIONS_KEY, JSON.stringify({ "unlock:42": legacy }));
  const tab = createOperations(() => storage, () => clock, () => sharedLocks());
  const key = `unlock:${await accountDigest("other@example.com")}:42`;
  assert.equal(tab.get(key)?.status, "uncertain");
  clock = HISTORY_LAG + 1;
  let checks = 0;
  const settled = await settleHeld(tab, key, async () => { checks += 1; return "unchanged"; }, () => clock);
  assert.equal(settled?.kind, "uncertain");
  assert.equal(checks, 0, "no account's trips are read for an entry that names no account");
  assert.equal(await tab.clear(key, ""), false);
  assert.equal(tab.get(key)?.status, "uncertain");
  let sent = 0;
  assert.equal(await runOnce(tab, key, async (): Promise<Outcome> => { sent += 1; return noAnswer(""); }), "busy");
  assert.equal(sent, 0);
});

test("an entry under the account key is still checked with the held entry and cleared once settled", async () => {
  let clock = 0;
  const storage = memoryStore();
  const key = `unlock:${await accountDigest("person@example.com")}:42`;
  storage.setItem(OPERATIONS_KEY, JSON.stringify({ [key]: { id: "held", status: "uncertain", at: 0, keep: true, outcome: noAnswer("Le serveur ne répond pas."), meta: { bikeNumber: 42 } } }));
  const tab = createOperations(() => storage, () => clock, () => sharedLocks());
  clock = HISTORY_LAG + 1;
  let seen: unknown = null;
  const settled = await settleHeld(tab, key, async (held) => { seen = held.meta.bikeNumber; return "unchanged"; }, () => clock);
  assert.equal(settled?.kind, "refused");
  assert.equal(seen, 42);
  assert.equal(tab.get(key), null);
});

test("every uncertain check reads the held entry's metadata, never the dialog's own draft or toggle", () => {
  const actions = source("components/account-actions.tsx");
  assert.match(actions, /check: \(held: Operation\) => Promise<Check>/);
  assert.match(actions, /settleHeld\(operations, operationKey, check\)/);
  assert.doesNotMatch(actions, /check=\{async \(\) =>/);
  assert.match(actions, /check=\{async \(held\) => storedProfileCheck\(\(await readDashboard\(digest\)\)\.profile, held\.meta\)\}/);
  assert.match(actions, /check=\{async \(held\) => autoSpendCheck\(await readDashboard\(digest\), held\.meta\.wanted === 1\)\}/);
  assert.match(actions, /check=\{async \(held\) => favoriteCheck\(await readDashboard\(digest\), station\.number, held\.meta\.wanted === 1\)\}/);
  assert.match(source("components/auto-renewal.tsx"), /settleHeld\(operations, operationKey, async \(held\) => renewalCheck\(await readDashboard\(digest\), subscriptionId, held\.meta\.wanted === 1\)\)/);
  assert.match(source("components/trip-sheet.tsx"), /settleHeld\(operations, rateKey, async \(\) => ratingCheck\(await readDashboard\(digest\), trip\.id\)\)/);
});

type Reply = { status: number; text?: string };
const answering = (reply: Reply) => (async () => new Response(reply.status === 204 ? null : reply.text ?? "", { status: reply.status })) as typeof fetch;
const auth = { accountId: "acc-1", token: "client", identity: "user" };
const vote = { bikeNumber: 20449, recommended: false, rating: 30 } as const;

test("a rating answered 200 counts only with Vélo’v's echo of the vote; {} or an empty body stays uncertain", async () => {
  const rate = (reply: Reply) => postRating({ ...auth, tripId: "trip-1", body: vote }, answering(reply));
  for (const reply of [{ status: 200, text: "{}" }, { status: 200, text: "" }, { status: 204 }, { status: 200, text: JSON.stringify({ ...vote, bikeId: 1, rating: 30 }) }, { status: 200, text: JSON.stringify({ bikeId: 20449, recommended: true, contract: "lyon", rating: null }) }]) {
    const outcome = await rate(reply);
    assert.deepEqual([outcome.ok, isUncertain(outcome)], [false, true], JSON.stringify(reply));
  }
  assert.equal((await rate({ status: 200, text: JSON.stringify({ bikeId: 20449, recommended: false, contract: "lyon", rating: 30 }) })).ok, true);
});

test("an account write answered 2xx counts only with its documented answer; any other JSON stays uncertain", async () => {
  const cases: [string, (send: typeof fetch) => Promise<Outcome>, Reply[], Reply][] = [
    ["autoSpend", (send) => patchAutoSpend({ ...auth, autoSpend: false }, send), [{ status: 200, text: "{}" }, { status: 200, text: "" }, { status: 200, text: '{"autoSpend":true}' }], { status: 200, text: '{"balance":6,"autoSpend":false}' }],
    ["favourite add", (send) => putStationBookmark({ ...auth, stationNumber: 2002, on: true }, send), [{ status: 200, text: "{}" }, { status: 200, text: "" }, { status: 200, text: "2001" }], { status: 200, text: "2002" }],
    ["favourite remove", (send) => putStationBookmark({ ...auth, stationNumber: 2002, on: false }, send), [{ status: 200, text: "{}" }, { status: 200, text: '{"maintenance":true}' }], { status: 204 }],
    ["profile", (send) => patchProfile({ ...auth, body: { city: "Lyon" } }, send), [{ status: 200, text: "{}" }, { status: 200, text: "" }, { status: 200, text: '{"id":"acc-2"}' }], { status: 200, text: '{"id":"acc-1","email":"jean.dupont@example.com"}' }],
    ["renewal", (send) => patchAutoRenewal({ ...auth, subscriptionId: "sub-1", autoRenewal: false }, send), [{ status: 200, text: "{}" }, { status: 204 }], { status: 400, text: '{"code":"source.refused"}' }],
    ["contact", (send) => postContactMail({ ...auth, body: { complaintType: "TRIP", message: "Bonjour" } }, send), [{ status: 200, text: "{}" }, { status: 204 }], { status: 400, text: '{"code":"mail.invalid"}' }]
  ];
  for (const [name, run, unproven, proven] of cases) {
    for (const reply of unproven) {
      const outcome = await run(answering(reply));
      assert.deepEqual([outcome.ok, isUncertain(outcome)], [false, true], `${name} ${JSON.stringify(reply)}`);
    }
    const outcome = await run(answering(proven));
    assert.equal(outcome.ok, proven.status < 300, `${name} documented answer`);
  }
});

test("a renewal answered 2xx without proof counts only once the re-read shows the wanted value", async () => {
  const write = () => patchAutoRenewal({ ...auth, subscriptionId: "sub-1", autoRenewal: true }, answering({ status: 200, text: "{}" }));
  const applied = await completeRenewalChange(write, async () => ({ autoRenewal: true, autoRenewalAllowed: true }), true);
  assert.deepEqual([applied.ok, applied.autoRenewal, applied.verified], [true, true, true]);
  const unchanged = await completeRenewalChange(write, async () => ({ autoRenewal: false, autoRenewalAllowed: true }), true);
  assert.deepEqual([unchanged.ok, isUncertain(unchanged), unchanged.autoRenewal], [false, true, false]);
  const unread = await completeRenewalChange(write, async () => { throw new Error("No reply"); }, true);
  assert.deepEqual([unread.ok, isUncertain(unread)], [false, true]);
});

const writeRoutes = ["trips/[id]/rate", "account/rewards", "account/promocode", "account/profile", "account/favorites/[number]", "account/via", "account/auto-renewal", "account/contact"];

test("every account write names the account the page shows, and its route refuses another one before any upstream call", () => {
  for (const route of writeRoutes) {
    const file = source(`app/api/${route}/route.ts`);
    const write = file.slice(file.search(/async function (POST|PATCH|DELETE|bookmark)\(/));
    const refusal = write.search(/if \(!await sameAccount\(request, session\)\) return jsonResponse\(\{ error: ACCOUNT_CHANGED, code: "local\.account\.changed" \}, session, 409\);/);
    assert.ok(refusal > write.indexOf("beforeSend(() => getSession(request))"), route);
    assert.ok(refusal < write.search(/await (rateTrip|setAutoSpend|consumePromoCode|updateProfile|setFavorite|requestExtraTime|setAutoRenewal|contactSupport)\(/), route);
  }
  for (const route of ["dashboard", "account/rewards"]) {
    const file = source(`app/api/${route}/route.ts`);
    const read = file.slice(file.indexOf("async function GET("), file.indexOf("async function PATCH(") > 0 ? file.indexOf("async function PATCH(") : undefined);
    assert.match(read, /if \(await readsOtherAccount\(request, session\)\) return jsonResponse\(\{ error: ACCOUNT_CHANGED, code: "local\.account\.changed" \}, session, 409\);/, route);
  }
  for (const file of ["components/account-actions.tsx", "components/auto-renewal.tsx", "components/contact-support.tsx", "components/invite-friend.tsx", "components/via-action.tsx", "lib/trip-end.ts"]) {
    assert.match(source(file), /\[ACCOUNT_HEADER\]: /, file);
  }
  assert.match(source("components/get-json.ts"), /export function readDashboard\(account\?: string \| null\) \{\n  return accountJson\("\/api\/dashboard", dashboardSchema, "Votre compte est momentanément indisponible\.", account \? \{ \[ACCOUNT_HEADER\]: account \} : undefined\);/);
  const companion = source("components/companion.tsx");
  assert.match(companion, /getJson\("\/api\/bookings", z\.array\(bookingSchema\), "", stamp\.signal, named\(\)\)/, "the bookings reread after a booking");
  assert.match(companion, /getJson\("\/api\/trips\/current", tripCheckSchema, "", stamp\.signal, named\(\)\)/, "the dock watch after an unlock");
  assert.match(companion, /getJson\("\/api\/dashboard", dashboardSchema, "[^"]+", stamp\.signal, named\(\)\)/, "the dashboard reload after a write");
  assert.match(companion, /toaster\.show\(error instanceof ApiError && error\.code === "local\.account\.changed" \? failure\.message : REFRESH_FAILED\)/, "a reload refused for another account says so");
  assert.match(source("components/invite-friend.tsx"), /await accountJson\(`\/api\/account\/rewards\?since=\$\{held\.at - DEBIT_SLACK\}`, rewardsHistorySchema, "[^"]+", \{ \[ACCOUNT_HEADER\]: digest \}\)/);
});

test("a write's late answer or check never refreshes or closes anything once its session ended", () => {
  const renewal = source("components/auto-renewal.tsx");
  assert.equal(renewal.match(/if \(!stamp\.live\(\)\) return;/g)?.length, 2, "renewal confirm and check");
  const rating = source("components/trip-sheet.tsx");
  assert.equal(rating.match(/if \(!stamp\.live\(\)\) return;/g)?.length, 2, "rating submit and check");
  for (const file of ["components/contact-support.tsx", "components/via-action.tsx", "components/invite-friend.tsx"]) {
    assert.match(source(file), /if \(!stamp\.live\(\)\) return;/, file);
  }
});
