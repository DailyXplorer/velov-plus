import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { type Locks, createOperations, runOnce, settleHeld, UNSAVED, UNSHARED, blockedMessage } from "../lib/operations.ts";
import { bookingCheck, unlockCheck } from "../lib/bike-action.ts";
import { accountCall, postBooking, postRelease } from "../lib/cyclocity.ts";
import { postPromoCode } from "../lib/promo.ts";
import { postContactMail } from "../lib/contact-mail.ts";
import { CONTACT_BODY_LIMIT, contactBodySchema, contactFits } from "../lib/contact-models.ts";
import { readJsonBody } from "../lib/auth-protocol.ts";
import { createSessionGate } from "../lib/session-gate.ts";
import { type Stats, COMPLETE_TTL, PARTIAL_TTL, createStatsCache } from "../lib/stats.ts";
import { createThrottle } from "../lib/refresh-gate.ts";
import { RATE_LIMITED, clientAddress, createRateLimit } from "../lib/rate-limit.ts";
import { type Booking, type Outcome, type Trip, formatCount, formatCountSans, formatDuration, formatPhone } from "../lib/models.ts";
import { HISTORY_LAG, NOT_APPLIED, isUncertain, noAnswer } from "../lib/outcome.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
function sharedLocks(): Locks {
  let tail: Promise<unknown> = Promise.resolve();
  return { request<T>(_name: string, run: () => Promise<T>) { const result = tail.then(run); tail = result.catch(() => {}); return result; } };
}

test("F1: a second tab acquiring between the first tab's read and write is refused by the shared Web Lock", async () => {
  const storage = memoryStore();
  const locks = sharedLocks();
  const other = createOperations(() => storage, Date.now, () => locks);
  let racing: Promise<string> | null = null;
  const racedStore = { ...storage, setItem: (key: string, value: string) => { racing ??= other.begin("unlock:20449"); storage.setItem(key, value); } };
  const tab = createOperations(() => racedStore, Date.now, () => locks);
  assert.equal(await tab.begin("unlock:20449"), "started");
  assert.ok(racing, "the other tab really tried in the middle of the write");
  assert.equal(await racing, "busy");
  let sent = 0;
  const send = async (): Promise<Outcome> => { sent += 1; return noAnswer(""); };
  assert.equal(await runOnce(other, "invite:abc", send, { keep: true }), "busy");
  assert.equal(sent, 0);
});

test("F1: without Web Locks, invites, bookings and unlocks are refused before anything is sent; other writes still work", async () => {
  const tab = createOperations(() => memoryStore());
  let sent = 0;
  const send = async (): Promise<Outcome> => { sent += 1; return { ok: true, httpStatus: 200, transactionState: null, code: null, message: null, detail: null }; };
  for (const key of ["invite:abc", "book:1", "unlock:1"]) assert.equal(await runOnce(tab, key, send), "unshared", key);
  assert.equal(sent, 0);
  assert.equal(blockedMessage("unshared", false), UNSHARED);
  assert.match(UNSHARED, /Rien n’a été envoyé\.$/);
  assert.equal((await runOnce(tab, "rate:trip-1", send)) !== "unshared", true);
  assert.equal(sent, 1);
  const broken = createOperations(() => memoryStore(), Date.now, () => ({ request: () => Promise.reject(new Error("lock manager gone")) }));
  assert.equal(await broken.begin("unlock:1"), "unshared");
  assert.match(source("components/operations.ts"), /navigator\.locks\.request\(name, run\)/);
});

test("F1: every operation gets its own id", async () => {
  const storage = memoryStore();
  const tab = createOperations(() => storage);
  await runOnce(tab, "rate:1", async () => noAnswer(""));
  await runOnce(tab, "rate:2", async () => noAnswer(""));
  const [first, second] = [tab.get("rate:1")!.id, tab.get("rate:2")!.id];
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test("F4: a late check of an older operation cannot clear a newer one with the same key", async () => {
  let clock = 0;
  const storage = memoryStore();
  const locks = sharedLocks();
  const tab = createOperations(() => storage, () => clock, () => locks);
  const otherTab = createOperations(() => storage, () => clock, () => locks);
  await runOnce(tab, "unlock:20449", async () => noAnswer("Le serveur ne répond pas."));
  clock += HISTORY_LAG;
  let answer!: (check: "applied") => void;
  const late = settleHeld(tab, "unlock:20449", () => new Promise((resolve) => { answer = resolve; }), () => clock);
  await tick();
  assert.equal((await settleHeld(otherTab, "unlock:20449", async () => "unchanged", () => clock))?.kind, "refused");
  let release!: (outcome: Outcome) => void;
  const newer = runOnce(otherTab, "unlock:20449", () => new Promise<Outcome>((resolve) => { release = resolve; }));
  await tick();
  const newerId = otherTab.get("unlock:20449")!.id;
  answer("applied");
  assert.deepEqual(await late, { kind: "done" });
  assert.equal(tab.get("unlock:20449")?.id, newerId, "the newer send is still held");
  assert.equal(await tab.begin("unlock:20449"), "busy");
  release(noAnswer(""));
  await newer;
  assert.equal(tab.get("unlock:20449")?.status, "uncertain");
});

const trip = (id: string, bikeNumber: number, startedAt: string) => ({ id, bikeNumber, startedAt }) as Trip;

test("F3: an uncertain unlock stays held until the trips prove it, then the targeted check settles it", async () => {
  let clock = Date.parse("2026-10-29T12:00:00Z");
  const storage = memoryStore();
  const locks = sharedLocks();
  const tab = createOperations(() => storage, () => clock, () => locks);
  await runOnce(tab, "unlock:20449", async () => noAnswer("Le serveur ne répond pas."), { meta: { stationNumber: 2002, standNumber: 12, bikeNumber: 20449 } });
  clock += 30 * 86_400_000;
  const held = createOperations(() => storage, () => clock, () => locks).get("unlock:20449");
  assert.equal(held?.status, "uncertain");
  assert.equal(held?.meta.bikeNumber, 20449, "the original target is kept");
  const at = Date.parse("2026-10-29T12:00:00Z");
  assert.deepEqual(unlockCheck({ ongoing: [trip("t-1", 20449, "2026-10-29T12:00:05Z")], latest: null }, 20449, at), { check: "applied", tripId: "t-1" });
  assert.deepEqual(unlockCheck({ ongoing: [], latest: trip("t-2", 20449, "2026-10-29T12:00:05Z") }, 20449, at), { check: "applied", tripId: null }, "a short ride already docked");
  assert.deepEqual(unlockCheck({ ongoing: [], latest: trip("t-0", 20449, "2026-10-20T08:00:00Z") }, 20449, at), { check: "unchanged", tripId: null }, "an older ride on the same bike proves nothing");
  assert.deepEqual(unlockCheck({ ongoing: [trip("t-3", 111, "2026-10-29T12:00:05Z")], latest: null }, 20449, at), { check: "unchanged", tripId: null });
  assert.deepEqual(unlockCheck({ ongoing: null, latest: null }, 20449, at), { check: "unknown", tripId: null });
  const recent = createOperations(() => storage, () => at + HISTORY_LAG - 1, () => locks);
  assert.equal((await settleHeld(recent, "unlock:20449", async () => "unchanged", () => at + HISTORY_LAG - 1))?.kind, "uncertain", "no trip yet, but still inside the dock window");
  assert.deepEqual(await settleHeld(tab, "unlock:20449", async () => "unchanged", () => clock), { kind: "refused", outcome: { ...noAnswer("Le serveur ne répond pas."), message: NOT_APPLIED } });
  assert.equal(tab.get("unlock:20449"), null);
});

test("F3: an uncertain booking is settled by the bookings list only", () => {
  const booking = (bikeNumber: number | null) => ({ id: "b", stationNumber: 2002, stationName: "Bellecour", standNumber: 12, bikeNumber, endsAt: null, lat: null, lon: null }) satisfies Booking;
  assert.equal(bookingCheck([booking(20449)], 20449), "applied");
  assert.equal(bookingCheck([], 20449), "unchanged");
  assert.equal(bookingCheck([booking(111)], 20449), "unchanged");
  assert.equal(bookingCheck([booking(null)], 20449), "unknown");
  assert.equal(bookingCheck(null, 20449), "unknown");
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /bookingCheck\(await accountJson\("\/api\/bookings", z\.array\(bookingSchema\), "", sender\), bikeNumber\)/);
  assert.match(bike, /unlockCheck\(await accountJson\("\/api\/trips\/current", tripCheckSchema, "", sender\), bikeNumber, held\.at\)/);
});

type Reply = { status: number; text?: string; headers?: Record<string, string> };
function recorder(reply: Reply) {
  const calls: RequestInit[] = [];
  const send = (async (_url: string | URL | Request, init?: RequestInit) => { calls.push(init ?? {}); return new Response(reply.text ?? null, { status: reply.status, headers: reply.headers }); }) as typeof fetch;
  return { calls, send };
}
const auth = { accountId: "acc-1", token: "client", identity: "user" };
const bookingBody = { stationId: "st-uuid", stationNumber: 2002, standNumber: 12, subscriptionId: "sub-1", bikeId: "bike-uuid" };

test("R1: no mutation follows a redirect, and an unexpected 3xx is uncertain", async () => {
  const redirect = { status: 307, headers: { Location: "https://api.cyclocity.fr/elsewhere" } };
  const writes: [string, (send: typeof fetch) => Promise<Outcome>][] = [
    ["release", (send) => postRelease({ ...auth, subscriptionId: "sub-1", body: { stationNumber: 2002, standNumber: 12, bikeNumber: 20449 } }, send)],
    ["booking", async (send) => (await postBooking({ ...auth, body: bookingBody }, send)).outcome],
    ["account", async (send) => (await accountCall("https://api.cyclocity.fr/contracts/lyon/accounts/acc-1/rewards", { method: "PATCH", headers: {} }, auth, "Échec.", send)).outcome],
    ["promo", (send) => postPromoCode(auth, send)],
    ["mail", (send) => postContactMail({ ...auth, body: { complaintType: "TRIP", message: "Bonjour" } }, send)]
  ];
  for (const [name, write] of writes) {
    for (const status of [301, 302, 307, 308]) {
      const { calls, send } = recorder({ ...redirect, status });
      const outcome = await write(send);
      assert.equal(calls.length, 1, name);
      assert.equal(calls[0].redirect, "manual", name);
      assert.equal(outcome.ok, false, `${name} ${status}`);
      assert.equal(isUncertain(outcome), true, `${name} ${status}`);
    }
  }
});

test("R2: a 2xx booking answer that does not match the contract is uncertain, never a success", async () => {
  const reply = { id: "bk-1", stationNumber: 2002, standNumber: 12, bikeId: "bike-uuid", endTime: "2026-10-29T12:15:00" };
  for (const [label, answer] of [["HTML", { status: 200, text: "<html>maintenance</html>" }], ["empty 204", { status: 204 }], ["other bike", { status: 200, text: JSON.stringify({ ...reply, bikeId: "other" }) }], ["other station", { status: 200, text: JSON.stringify({ ...reply, stationNumber: 3001 }) }]] as const) {
    const { outcome, booking } = await postBooking({ ...auth, body: bookingBody }, recorder(answer).send);
    assert.equal(outcome.ok, false, label);
    assert.equal(booking, null, label);
    assert.equal(isUncertain(outcome), true, label);
    assert.equal(outcome.code, "local.booking.unreadable", label);
  }
  const { outcome, booking } = await postBooking({ ...auth, body: bookingBody }, recorder({ status: 200, text: JSON.stringify(reply) }).send);
  assert.equal(outcome.ok, true);
  assert.equal(booking?.id, "bk-1");
});

test("F6: a dashboard or bookings answer that arrives after the logout started is dropped, and its request aborted", async () => {
  const gate = createSessionGate();
  const shown: string[] = [];
  let answer!: (value: string) => void;
  const load = async () => {
    const stamp = gate.stamp();
    const value = await new Promise<string>((resolve) => { answer = resolve; });
    if (stamp.live()) shown.push(value);
    return stamp.signal;
  };
  const pending = load();
  gate.end();
  answer("old account");
  const signal = await pending;
  assert.deepEqual(shown, []);
  assert.equal(signal.aborted, true);
  const next = load();
  answer("new account");
  assert.equal((await next).aborted, false);
  assert.deepEqual(shown, ["new account"]);
  const companion = source("components/companion.tsx");
  assert.match(companion, /async function logout\(\) \{\n\s+session\.current\.close\(\);/);
  assert.match(companion, /function connected\(\) \{\n\s+session\.current\.end\(\);/);
  assert.match(companion, /const data = await getJson\("\/api\/dashboard", dashboardSchema, "[^"]+", stamp\.signal\);\n\s+return stamp\.live\(\) \? data : null;/);
  assert.match(companion, /\} catch \(error\) \{\n\s+if \(!stamp\.live\(\)\) return null;/);
  assert.match(companion, /if \(stamp\.live\(\)\) setBookings\(list\);/);
  assert.match(companion, /if \(stamp\.live\(\) && error instanceof ApiError && error\.status === 401\)/);
});

const stats = (complete: boolean) => ({ complete }) as Stats;

test("F7: the stats screen cache expires like the API cache and is forgotten on trip end, account change and point changes", () => {
  let clock = 0;
  const cache = createStatsCache(() => clock);
  cache.set("me", stats(true));
  assert.equal(cache.get("me")?.complete, true);
  assert.equal(cache.get("other"), null);
  clock += COMPLETE_TTL - 1;
  assert.ok(cache.get("me"));
  clock += 1;
  assert.equal(cache.get("me"), null);
  cache.set("me", stats(false));
  clock += PARTIAL_TTL;
  assert.equal(cache.get("me"), null);
  cache.set("me", stats(true));
  cache.clear();
  assert.equal(cache.get("me"), null);
  const companion = source("components/companion.tsx");
  assert.match(companion, /dockedTrips\.current\.add\(tripId\);\n\s+forgetStats\(\);/);
  assert.match(companion, /function connected\(\) \{\n\s+session\.current\.end\(\);[\s\S]*?\n\s+forgetStats\(\);/);
  assert.match(companion, /setBookings\(\[\]\);\n\s+dropStats\(\);/);
  assert.match(companion, /changed: \(\) => \{ forgetStats\(\); void loadBookings\(\); \}/);
  assert.match(companion, /onChanged=\{\(\) => \{ forgetStats\(\); void loadDashboard\(\); \}\}/);
  assert.match(source("components/stats.tsx"), /useEffect\(\(\) => \{ if \(!cache\.get\(account\)\) void load\(\); \}, \[account, load, revision\]\);/);
});

test("volume: bookings reads are single-flight, coalesced and at least five seconds apart", async () => {
  let clock = 0;
  const waits: number[] = [];
  let runs = 0;
  let finish!: () => void;
  const load = createThrottle(() => { runs += 1; return new Promise<void>((resolve) => { finish = resolve; }); }, 5_000, () => clock, async (ms) => { waits.push(ms); clock += ms; });
  const first = load();
  for (let index = 0; index < 20; index++) void load();
  assert.equal(runs, 1);
  clock += 1_000;
  finish();
  await tick();
  assert.equal(runs, 2, "the calls made meanwhile become one trailing read");
  assert.deepEqual(waits, [4_000]);
  finish();
  await first;
  assert.equal(runs, 2);
  clock += 60_000;
  void load();
  assert.equal(runs, 3);
  finish();
  assert.match(source("components/companion.tsx"), /const \[loadBookings\] = useState\(\(\) => createThrottle\(/);
});

test("F11: the contact form and route share one byte budget that fits every message the form accepts", async () => {
  const cjk = { complaintType: "TRIP", message: "漢".repeat(1500), tripToken: "T".repeat(128) };
  const worst = { complaintType: "SUBSCRIPTION", message: `a${"\u0001".repeat(1498)}a`, tripToken: "\"".repeat(128) };
  for (const body of [cjk, worst]) {
    assert.equal(contactBodySchema.safeParse(body).success, true);
    assert.equal(contactFits(body), true);
    const raw = JSON.stringify(body);
    assert.ok(new TextEncoder().encode(raw).length > 4096);
    const request = new Request("https://velovplus.test/api/account/contact", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(new TextEncoder().encode(raw).length) }, body: raw });
    assert.deepEqual(await readJsonBody(request, CONTACT_BODY_LIMIT), body);
  }
  assert.equal(contactFits({ message: "x".repeat(CONTACT_BODY_LIMIT) }), false);
  assert.ok(CONTACT_BODY_LIMIT <= 16_384, "still bounded");
  assert.match(source("app/api/account/contact/route.ts"), /readJsonBody\(request, CONTACT_BODY_LIMIT\)/);
  assert.match(source("components/contact-support.tsx"), /if \(!parsed\.success \|\| !contactFits\(parsed\.data\)\) \{/);
});

test("hardening: the login route allows ten attempts a minute per address, then answers 429 in French", () => {
  let clock = 0;
  const allowed = createRateLimit(10, 60_000, () => clock);
  for (let index = 0; index < 10; index++) assert.equal(allowed("203.0.113.7"), true);
  assert.equal(allowed("203.0.113.7"), false);
  assert.equal(allowed("198.51.100.2"), true);
  clock += 60_000;
  assert.equal(allowed("203.0.113.7"), true);
  assert.equal(clientAddress(new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })), "203.0.113.7");
  assert.equal(clientAddress(new Request("https://x.test", { headers: { "x-vercel-forwarded-for": "198.51.100.2", "x-forwarded-for": "1.2.3.4" } })), "198.51.100.2");
  assert.equal(RATE_LIMITED, "Trop de tentatives de connexion. Réessayez dans une minute.");
  const route = source("app/api/auth/login/route.ts");
  assert.match(route, /if \(!allowed\(clientAddress\(request\)\)\) \{\n\s+const response = jsonResponse\(\{ error: RATE_LIMITED, code: "rate" \}, null, 429\);/);
});

test("hardening: the CSP allows the app, its fonts, OSM tiles and Vercel, nothing else", async () => {
  const { contentSecurityPolicy } = await import("../next.config.ts");
  const directives = Object.fromEntries(contentSecurityPolicy.split("; ").map((part: string) => { const [name, ...values] = part.split(" "); return [name, values]; }));
  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.ok(directives["img-src"].includes("https://tile.openstreetmap.org"));
  assert.deepEqual(directives["font-src"], ["'self'", "https://vercel.live"]);
  assert.ok(directives["connect-src"].includes("'self'"));
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
  assert.doesNotMatch(contentSecurityPolicy, /cyclocity|\*(?!\.)/);
  assert.match(source("next.config.ts"), /\{ key: "Content-Security-Policy", value: contentSecurityPolicy \}/);
  assert.doesNotMatch(directives["script-src"].join(" "), /unsafe-eval/, "production stays without eval");
  assert.match(source("components/companion.tsx"), /^"use client";\n\nimport "@\/lib\/zod-jitless";\n/, "zod is configured before any schema of the client graph exists");
  assert.match(source("lib/zod-jitless.ts"), /z\.config\(\{ jitless: true \}\);/);
});

test("parity: French thousands separators for quantities, whole minutes for durations", () => {
  assert.equal(formatCount(1380), "1 380");
  assert.equal(formatCount(-1000), "-1 000");
  assert.equal(formatCountSans(2380), "2 380");
  assert.equal(formatDuration(12.5), "13 min");
  assert.equal(formatDuration(12.4), "12 min");
  assert.equal(formatDuration(125), "2 h 5 min");
  assert.equal(formatDuration(60 * 1200), "1 200 h 0 min");
  const dashboard = source("components/dashboard.tsx");
  assert.doesNotMatch(dashboard, /\$\{trip\.duration\} min|\{data\.rewards\.balance \?\? "—"\}|\{data\.trips\?\.length \?\? "—"\}|\{trips\.length\} trajet|\+\{rule\.points\}|\{movement\.amount\}<|toLocaleString/);
  assert.doesNotMatch(source("components/trip-sheet.tsx"), /\$\{trip\.duration\} min/);
  const invite = source("components/invite-friend.tsx");
  assert.match(invite, /Il vous manque \{formatCountSans\(cost - balance\)\} points\./);
  assert.match(invite, /<p>\{costText\} points sont débités dès la création du code/);
  assert.doesNotMatch(invite, /\{cost\} points/);
});

test("parity: labels use DM Sans, warnings use the grey ink, no brown", () => {
  const css = source("app/globals.css");
  assert.match(css, /h3\.metric-label, h3\.trip-rate-title \{ font-family: var\(--font\); font-weight: 500; \}/);
  assert.doesNotMatch(css, /#9c7856/i);
  assert.match(css, /\.data-notice \{ margin-bottom: 24px; color: var\(--ink-soft\);/);
  assert.match(source("components/trip-sheet.tsx"), /<h3 id="trip-rate-title" className="trip-rate-title">Évaluation du vélo<\/h3>/);
  assert.match(source("components/account-actions.tsx"), /<h3 className="metric-label">Reçus<\/h3>/);
});

test("F1/F3: booking and unlock are tracked in the shared store or not sent at all", async () => {
  const locks = sharedLocks();
  const meta = { stationNumber: 2002, standNumber: 12, bikeNumber: 20449 };
  for (const broken of [{ getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} }, { getItem: () => "{illisible", setItem: () => {}, removeItem: () => {} }]) {
    for (const key of ["book:20449", "unlock:20449"]) {
      let sent = 0;
      const outcome = await runOnce(createOperations(() => broken, Date.now, () => locks), key, async () => { sent += 1; return noAnswer(""); }, { keep: true, meta });
      assert.equal(outcome, "unsaved", key);
      assert.equal(blockedMessage("unsaved", false), UNSAVED);
      assert.equal(sent, 0, `${key}: nothing sent`);
    }
  }
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /runOnce\(operations, key, \(\) => sendBikeAction\(action, \{ \.\.\.place, account: account\?\.email \?\? null \}\), \{ keep: true, meta: \{ stationNumber: place\.stationNumber, standNumber: place\.standNumber, bikeNumber: place\.bikeNumber \} \}\)/);
});

test("F3: a failed trip history read is unknown, never proof that the unlock did nothing", async () => {
  const velov = source("lib/velov.ts");
  assert.match(velov, /trips\("trips\?status=FINISHED"\)\.catch\(\(\) => null\)/);
  assert.match(velov, /if \(!history\) return \{ ongoing: null, latest: null \};/);
  assert.doesNotMatch(/export async function getTripCheck[\s\S]*?\n\}/.exec(velov)![0], /\.catch\(\(\) => \[\]\)/);
  const at = Date.parse("2026-10-29T12:00:00Z");
  const storage = memoryStore();
  const locks = sharedLocks();
  const tab = createOperations(() => storage, () => at, () => locks);
  await runOnce(tab, "unlock:20449", async () => noAnswer("Le serveur ne répond pas."), { keep: true, meta: { bikeNumber: 20449 } });
  const later = at + HISTORY_LAG + 60_000;
  const settled = await settleHeld(tab, "unlock:20449", async () => unlockCheck({ ongoing: null, latest: null }, 20449, at).check, () => later);
  assert.equal(settled?.kind, "uncertain");
  assert.equal(tab.get("unlock:20449")?.status, "uncertain", "the lock stays held");
});

test("profile phone numbers display grouped with non-breaking spaces, other formats stay as stored", () => {
  assert.equal(formatPhone("+33612345678"), "+33\u00a06\u00a012\u00a034\u00a056\u00a078");
  assert.equal(formatPhone("0612345678"), "06\u00a012\u00a034\u00a056\u00a078");
  assert.equal(formatPhone("+33 1 23 45 67 89"), "+33\u00a01\u00a023\u00a045\u00a067\u00a089");
  assert.equal(formatPhone("+41791234567"), "+41791234567");
  assert.equal(formatPhone("12345"), "12345");
});
