import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { type Locks, type Verification, createOperations, historySince, inviteDebit, retryVerified, runOnce, signedAmount, verificationOf } from "../lib/operations.ts";
import { bookingRows } from "../lib/cyclocity.ts";
import { bookingCheck, sendBikeAction } from "../lib/bike-action.ts";
import { createSessionGate } from "../lib/session-gate.ts";
import { type Stats, createStatsCache } from "../lib/stats.ts";
import { CONTACT_BODY_LIMIT, contactBodySchema, contactFits } from "../lib/contact-models.ts";
import { HISTORY_LAG, isUncertain, networkDetail, networkFailure, noAnswer } from "../lib/outcome.ts";
import { formatDuration } from "../lib/models.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function memoryStore() {
  const map = new Map<string, string>();
  return { map, failWrites: false, getItem: (key: string) => map.get(key) ?? null, setItem(key: string, value: string) { if (this.failWrites) throw new Error("quota"); map.set(key, value); }, removeItem(key: string) { if (this.failWrites) throw new Error("quota"); map.delete(key); } };
}
function sharedLocks(): Locks {
  let tail: Promise<unknown> = Promise.resolve();
  return { request<T>(_name: string, run: () => Promise<T>) { const result = tail.then(run); tail = result.catch(() => {}); return result; } };
}
const KEY = "invite:digest";

async function uncertainInvite(tab: ReturnType<typeof createOperations>, cost: number) {
  const result = await runOnce(tab, KEY, async () => noAnswer("Vélo’v ne répond pas."), { keep: true, meta: { cost, balance: 1000 } });
  assert.equal(typeof result, "object");
  return tab.get(KEY)!;
}

test("F1: a verification of an older invite never authorises clearing or replaying the newer one", async () => {
  const storage = memoryStore();
  const locks = sharedLocks();
  const tabA = createOperations(() => storage, Date.now, () => locks);
  const tabB = createOperations(() => storage, Date.now, () => locks);
  const old = await uncertainInvite(tabA, 200);
  const verifiedOld: Verification = { id: old.id, kind: "not-debited" };

  assert.equal(await tabB.clear(KEY, old.id), true);
  const replacement = await uncertainInvite(tabB, 200);
  assert.notEqual(replacement.id, old.id);

  assert.equal(verificationOf(tabA.get(KEY), verifiedOld), null, "the old verdict is not shown for the new operation");
  assert.equal(verificationOf(null, verifiedOld), null);
  assert.deepEqual(verificationOf(null, { id: old.id, kind: "debited" }), { id: old.id, kind: "debited" }, "a debit found and settled stays explained");
  let sent = 0;
  assert.equal(await retryVerified(tabA, KEY, verifiedOld, async () => { sent += 1; }), false);
  assert.equal(sent, 0);
  assert.equal(tabA.get(KEY)?.id, replacement.id, "the unverified replacement is still held");
});

test("F1: a retry clears exactly the verified id and starts once, only if that clear succeeded", async () => {
  const storage = memoryStore();
  const tab = createOperations(() => storage, Date.now, () => sharedLocks());
  const held = await uncertainInvite(tab, 200);
  let sent = 0;
  assert.equal(await retryVerified(tab, KEY, { id: held.id, kind: "unknown" }, async () => { sent += 1; }), false);
  assert.equal(await retryVerified(tab, KEY, { id: held.id, kind: "checking" }, async () => { sent += 1; }), false);
  storage.failWrites = true;
  assert.equal(await retryVerified(tab, KEY, { id: held.id, kind: "not-debited" }, async () => { sent += 1; }), false, "a clear that did not persist starts nothing");
  storage.failWrites = false;
  assert.equal(sent, 0);
  assert.equal(await tab.clear(KEY, "another-id"), false);
  assert.equal(await retryVerified(tab, KEY, { id: held.id, kind: "not-debited" }, async () => { sent += 1; }), true);
  assert.equal(sent, 1);
  assert.equal(tab.get(KEY), null);
});

test("F1: the invite dialog binds its verdict to the operation id and explains the cost held in the proof", () => {
  const invite = source("components/invite-friend.tsx");
  assert.match(invite, /const verification = verificationOf\(operation, checked\);/);
  assert.match(invite, /setVerification\(\{ id: held\.id, kind: check \}\);/);
  assert.match(invite, /await retryVerified\(operations, operationKey, verification,/);
  assert.doesNotMatch(invite, /operations\.clear\(operationKey, operation\.id\)/);
  assert.match(invite, /const shownCost = heldCost \?\? cost;/);
  assert.match(invite, /const samePrice = cost !== null && cost === heldCost;/);
});

test("F2: an unreadable booking row or root is never an empty list", () => {
  assert.throws(() => bookingRows([{}]));
  assert.throws(() => bookingRows([{ id: "b1", stationNumber: 1001 }, { id: "b2" }]));
  assert.throws(() => bookingRows({ bookings: [] }));
  assert.throws(() => bookingRows("[]"));
  assert.deepEqual(bookingRows(null), []);
  assert.deepEqual(bookingRows([]), []);
  assert.equal(bookingRows([{ id: "b1", stationNumber: 1001, bikeId: "x" }])[0].id, "b1");
  assert.equal(bookingCheck(null, 42), "unknown");
  assert.match(source("lib/velov.ts"), /const bookings = bookingRows\(await read\(`\/accounts\/\$\{accountId\}\/bookings`, z\.unknown\(\), session, "\*\/\*"\)\);/);
});

test("F2: an unknown or missing direction, or an ambiguous amount, is not a credit", () => {
  assert.equal(signedAmount("DEBIT", 50), -50);
  assert.equal(signedAmount("CREDIT", 50), 50);
  assert.equal(signedAmount("UNKNOWN", 50), null);
  assert.equal(signedAmount(undefined, 50), null);
  assert.equal(signedAmount(null, 50), null);
  assert.equal(signedAmount("DEBIT", -50), null);
  assert.equal(signedAmount("CREDIT", Number.NaN), null);
  assert.match(source("lib/velov.ts"), /amount: signedAmount\(movement\.direction, movement\.amount\)/);
});

test("F2: a recent row of unknown direction leaves the invite unknown, after the lag and with a complete history", async () => {
  const at = Date.parse("2026-10-29T10:00:00Z");
  const pages = [{ last: false, movements: [{ id: "m1", date: "2026-10-29T10:00:30Z", amount: signedAmount("UNKNOWN", 50) }] }, { last: true, movements: [] }];
  const history = await historySince(async (page) => pages[page], at - 5 * 60_000);
  assert.equal(history.complete, true);
  assert.equal(inviteDebit({ at, cost: 50 }, history, at + HISTORY_LAG + 1), "unknown");
  const undated = { complete: true, movements: [{ date: null, amount: null }] };
  assert.equal(inviteDebit({ at, cost: 50 }, undated, at + HISTORY_LAG + 1), "unknown");
  const older = { complete: true, movements: [{ date: "2026-10-20T10:00:00Z", amount: null }] };
  assert.equal(inviteDebit({ at, cost: 50 }, older, at + HISTORY_LAG + 1), "not-debited", "an unreadable row before the request proves nothing either way");
});

test("F5: once the logout starts, no new read is accepted until the next session opens", async () => {
  const gate = createSessionGate();
  const shown: string[] = [];
  const answers: ((value: string) => void)[] = [];
  const read = async () => {
    const stamp = gate.stamp();
    const value = await new Promise<string>((resolve) => { answers.push(resolve); });
    if (stamp.live()) shown.push(value);
    return stamp.signal;
  };
  gate.close();
  const watcherRead = read();
  assert.equal(gate.stamp().live(), false);
  answers.shift()!("old account");
  assert.equal((await watcherRead).aborted, true);
  gate.close();
  const late = read();
  answers.shift()!("old account again");
  await late;
  assert.deepEqual(shown, []);
  gate.end();
  const next = read();
  answers.shift()!("new account");
  assert.equal((await next).aborted, false);
  assert.deepEqual(shown, ["new account"]);
});

test("F5: the logout closes reads and stops the dock watcher before waiting, and again when it ends", () => {
  const companion = source("components/companion.tsx");
  assert.match(companion, /async function logout\(\) \{\n\s+session\.current\.close\(\);\n\s+watch\.current\?\.stop\(\);\n\s+setLoggingOut\(true\);/);
  assert.match(companion, /logoutSchema\.safeParse\([^\n]+\n\s+session\.current\.close\(\);\n\s+watch\.current\?\.stop\(\);/);
  assert.match(companion, /const stamp = session\.current\.stamp\(\);\n\s+if \(!stamp\.live\(\)\) return null;\n\s+setRefreshing\(true\);/);
  assert.match(companion, /function connected\(\) \{\n\s+session\.current\.end\(\);/);
});

test("F8: invalidating the stats notifies the mounted page, which drops answers older than the invalidation", () => {
  const cache = createStatsCache();
  let heard = 0;
  const unsubscribe = cache.subscribe(() => { heard += 1; });
  const before = cache.revision();
  cache.set("a@example.test", { complete: true } as Stats);
  cache.invalidate();
  assert.equal(heard, 1);
  assert.equal(cache.revision(), before + 1);
  assert.equal(cache.get("a@example.test"), null);
  cache.clear();
  assert.equal(heard, 1, "clearing an incomplete answer does not trigger another load");
  unsubscribe();
  cache.invalidate();
  assert.equal(heard, 1);
  const companion = source("components/companion.tsx");
  assert.match(companion, /function refreshAll\(\) \{\n[^\n]+\n\s+forgetStats\(\);/);
  const stats = source("components/stats.tsx");
  assert.match(stats, /const revision = useSyncExternalStore\(cache\.subscribe, cache\.revision, \(\) => 0\);/);
  assert.match(stats, /\[account, load, revision\]\);/);
  assert.equal(stats.match(/if \(at !== cache\.revision\(\)\) return;/g)?.length, 2);
});

test("F9: the shared multibyte fixture fits the common 10240-byte JSON budget", () => {
  const fixture = JSON.parse(source("test/fixtures/contact-multibyte.json")) as { limitBytes: number; body: unknown; jsonBytes: number; accepted: boolean };
  assert.equal(CONTACT_BODY_LIMIT, fixture.limitBytes);
  assert.equal(new TextEncoder().encode(JSON.stringify(fixture.body)).length, fixture.jsonBytes);
  assert.ok(fixture.jsonBytes > 4096);
  assert.equal(contactBodySchema.safeParse(fixture.body).success, fixture.accepted);
  assert.equal(contactFits(fixture.body), fixture.accepted);
});

test("network: a failed request keeps the browser error name and the elapsed time", async () => {
  assert.equal(networkDetail(new DOMException("signal timed out", "TimeoutError"), 40_000), "Délai dépassé après 40 s · TimeoutError");
  assert.equal(networkDetail(new DOMException("aborted", "AbortError"), 250), "Requête interrompue après 0,3 s · AbortError");
  assert.equal(networkDetail(new TypeError("Failed to fetch"), 1_200), "Pas de réponse après 1,2 s · TypeError (Failed to fetch)");
  const failed = networkFailure("Le serveur ne répond pas.", new TypeError("Load failed"), 1_000, 13_400);
  assert.equal(failed.code, "network");
  assert.equal(failed.detail, "Pas de réponse après 12 s · TypeError (Load failed)");
  assert.equal(isUncertain(failed), true);
  let clock = 5_000;
  const send = (async () => { clock += 30_000; throw new DOMException("signal timed out", "TimeoutError"); }) as unknown as typeof fetch;
  const outcome = await sendBikeAction("unlock", { stationNumber: 1001, standNumber: 3, bikeNumber: 42 }, send, () => clock);
  assert.equal(outcome.detail, "Délai dépassé après 30 s · TimeoutError");
  assert.equal(isUncertain(outcome), true);
  for (const file of ["components/invite-friend.tsx", "components/contact-support.tsx", "components/via-action.tsx", "components/auto-renewal.tsx", "components/account-actions.tsx"]) {
    assert.match(source(file), /networkFailure\(/, file);
    assert.doesNotMatch(source(file), /noAnswer\(|(failure|failed)\(0, "network", "/, file);
  }
});

test("a late « Trajet terminé », a pending unlock or a write callback never reaches the next account", () => {
  const companion = source("components/companion.tsx");
  const docked = /docked: \(tripId, latest\) => \{[\s\S]*?\n      \},/.exec(companion)?.[0] ?? "";
  assert.match(docked, /const stamp = session\.current\.stamp\(\);/);
  assert.match(docked, /if \(trip && stamp\.live\(\)\) setEnded\(trip\);/);
  for (const name of ["connected", "logout"]) {
    const body = new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n  \\}`).exec(companion)?.[0] ?? "";
    assert.match(body, /setEnded\(null\);/, name);
    assert.match(body, /setUnlocking\(null\);/, name);
  }
  const dialog = source("components/account-actions.tsx");
  assert.match(dialog, /if \(outcome\.ok\) \{ if \(stamp\.live\(\)\) \{ onDone\(\); onClose\(\); \} \}/);
  assert.match(dialog, /if \(settled\?\.kind === "done" && stamp\.live\(\)\) \{ onDone\(\); onClose\(\); \}/);
  const actions = source("components/bike-actions.tsx");
  assert.equal(actions.match(/if \(!stamp\.live\(\)\) return/g)?.length, 2, "send and verify both drop a result from another session");
  assert.match(source("lib/session-gate.ts"), /export const sessionGate = createSessionGate\(\);/);
});

test("every account read carries the session signal, so a logout aborts it before it can land old cookies", () => {
  const gate = createSessionGate();
  const stats = gate.stamp();
  gate.close();
  assert.equal(stats.signal.aborted, true);
  assert.equal(gate.stamp().signal.aborted, true, "a read started after the logout never leaves");
  const getJson = source("components/get-json.ts");
  assert.match(getJson, /export function accountJson<T>\(url: string, schema: z\.ZodType<T>, unavailable: string\) \{\n  return getJson\(url, schema, unavailable, sessionGate\.stamp\(\)\.signal\);/);
  assert.match(getJson, /return accountJson\("\/api\/dashboard"/);
  assert.ok(getJson.indexOf("if (signal?.aborted)") >= 0 && getJson.indexOf("if (signal?.aborted)") < getJson.indexOf("await fetch(url"), "an aborted stamp sends nothing");
  assert.match(source("components/stats.tsx"), /accountJson\("\/api\/stats", statsSchema, unavailable\)/);
  assert.match(source("components/bike-actions.tsx"), /bookingCheck\(await accountJson\("\/api\/bookings"/);
  assert.match(source("components/bike-actions.tsx"), /unlockCheck\(await accountJson\("\/api\/trips\/current"/);
  assert.match(source("components/invite-friend.tsx"), /await accountJson\(`\/api\/account\/rewards/);
});

test("browser back is held while an action sends, and leaving a page closes its open dialog", () => {
  const companion = source("components/companion.tsx");
  assert.match(companion, /const sending = useSending\(\);\n  useEffect\(\(\) => \{\n    if \(!sending\) return;\n    const hold = \(\) => window\.history\.pushState\(window\.history\.state, "", window\.location\.href\);\n    hold\(\);\n    window\.addEventListener\("popstate", hold\);\n    return \(\) => window\.removeEventListener\("popstate", hold\);\n  \}, \[sending\]\);/);
  const modal = source("components/ui.tsx");
  assert.match(modal, /window\.addEventListener\("hashchange", leave\);/);
  assert.match(modal, /const leave = \(\) => closing\.current\(\);/);
});

test("parity: review counts are grouped, an uncertain unlock is re-read automatically, durations and logout match iOS", () => {
  assert.match(source("components/station-bikes.tsx"), /\{formatCountSans\(bike\.rating\.count\)\} avis/);
  assert.match(source("components/bike-actions.tsx"), /return pollUnlock\(\(\) => verify\("unlock", false\), pollAt\);/);
  assert.equal(formatDuration(90), "1 h 30 min");
  assert.match(source("components/companion.tsx"), /<Button variant="ghost" disabled=\{loggingOut\} onClick=\{\(\) => setLogoutOpen\(false\)\}>Annuler<\/Button>/);
});

test("QA: no zz- route ships, and nothing wipes the whole localStorage", () => {
  const app = new URL("../app/", import.meta.url);
  assert.deepEqual(readdirSync(app).filter((entry) => entry.startsWith("zz-")), []);
  assert.equal(existsSync(new URL("zz-qa", app)), false);
  for (const folder of ["app", "components", "lib"]) {
    for (const file of readdirSync(new URL(`../${folder}/`, import.meta.url), { recursive: true }).map(String).filter((name) => /\.tsx?$/.test(name))) {
      assert.doesNotMatch(source(`${folder}/${file}`), /localStorage\.clear\(|globalThis\.fetch\s*=|window\.fetch\s*=/, `${folder}/${file}`);
    }
  }
});
