import assert from "node:assert/strict";
import { test } from "node:test";
import { PRECISE_FIX, QUICK_FIX, describeLocationFailure, findPosition, shortAgent } from "../lib/geo.ts";

type Reply = { position: { lat: number } } | { code: number; message: string };
/** Answers each getCurrentPosition call with the next scripted reply, and records the options it was given. */
function fakeGeolocation(...replies: Reply[]) {
  const calls: (PositionOptions | undefined)[] = [];
  const geolocation = {
    getCurrentPosition(success: PositionCallback, failure?: PositionErrorCallback | null, options?: PositionOptions) {
      calls.push(options);
      const reply = replies.shift();
      if (!reply) throw new Error("unexpected extra getCurrentPosition call");
      if ("position" in reply) success({ coords: { latitude: reply.position.lat } } as GeolocationPosition);
      else failure?.(reply as GeolocationPositionError);
    }
  };
  return { calls, geolocation };
}
const here = { position: { lat: 45.76 } };
const denied = { code: 1, message: "User denied Geolocation" };
const unavailable = { code: 2, message: "Position unavailable" };
const timeout = { code: 3, message: "Timeout expired" };

test("a quick fix that answers is the only request", async () => {
  const { calls, geolocation } = fakeGeolocation(here);
  assert.equal((await findPosition(geolocation)).coords.latitude, 45.76);
  assert.deepEqual(calls, [QUICK_FIX]);
  assert.deepEqual(QUICK_FIX, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
});

for (const first of [timeout, unavailable]) {
  test(`code ${first.code} retries once with high accuracy and no cache`, async () => {
    const { calls, geolocation } = fakeGeolocation(first, here);
    assert.equal((await findPosition(geolocation)).coords.latitude, 45.76);
    assert.deepEqual(calls, [QUICK_FIX, PRECISE_FIX]);
    assert.deepEqual(PRECISE_FIX, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
}

test("a failed retry is not retried again and reports the retry's error", async () => {
  const { calls, geolocation } = fakeGeolocation(unavailable, timeout);
  await assert.rejects(findPosition(geolocation), timeout);
  assert.equal(calls.length, 2);
});

test("a refusal never retries", async () => {
  const { calls, geolocation } = fakeGeolocation(denied);
  await assert.rejects(findPosition(geolocation), denied);
  assert.deepEqual(calls, [QUICK_FIX]);
});

const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const permissions = (state: PermissionState) => ({ query: async () => ({ state }) as PermissionStatus });

test("each code has its own French message", async () => {
  const messages = await Promise.all([denied, unavailable, timeout].map(async (error) => (await describeLocationFailure(error, { userAgent: safariMac })).message));
  assert.deepEqual(messages, [
    "Localisation refusée. Autorisez-la pour ce site dans votre navigateur, puis dans les réglages de localisation de votre appareil.",
    "Votre appareil ne trouve pas votre position. Vérifiez que le service de localisation est activé pour ce navigateur.",
    "La localisation a pris trop de temps. Réessayez."
  ]);
});

test("the raw line carries the code, the browser message, the browser and the permission state", async () => {
  assert.equal((await describeLocationFailure(denied, { userAgent: safariMac, permissions: permissions("denied") })).raw, "Code 1 · User denied Geolocation · Safari macOS · Permission denied");
  assert.equal((await describeLocationFailure({ code: 2, message: "" }, { userAgent: safariMac })).raw, "Code 2 · — · Safari macOS");
  const throwing = { query: () => { throw new TypeError("unsupported"); } };
  assert.equal((await describeLocationFailure(timeout, { userAgent: safariMac, permissions: throwing })).raw, "Code 3 · Timeout expired · Safari macOS");
});

test("the user agent shortens to browser and system", () => {
  assert.equal(shortAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"), "Chrome macOS");
  assert.equal(shortAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "Safari iOS");
  assert.equal(shortAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"), "Chrome iOS");
  assert.equal(shortAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"), "Chrome Android");
  assert.equal(shortAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"), "Edge Windows");
  assert.equal(shortAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0"), "Firefox macOS");
});
