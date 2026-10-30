import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { CLIENT_ID, OIDC, SessionRevoked, VelovError, endSession, readJsonBody, refresh } from "../lib/auth-protocol.ts";
import { type Session, errorResponse, forgetSession, setSessionCookies } from "../lib/session.ts";
import { NextResponse } from "next/server.js";
import { readFileSync } from "node:fs";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const tokens = { access_token: "new-access", refresh_token: "new-refresh", id_token: "new-identity", expires_in: 1800, refresh_expires_in: 2_500_000 };
const renewed: Session = { email: "person@example.com", accessToken: "new-access", renewed: tokens, device: "device-0123456789abcdef" };

test("an error after a refresh still hands the renewed tokens to the browser", () => {
  for (const error of [new VelovError("unavailable", "Vélo’v ne répond pas."), new VelovError("expired", "Cyclocity a refusé la session."), new Error("boom")]) {
    const response = errorResponse(error, renewed);
    assert.equal(response.cookies.get("vv_access")?.value, "new-access");
    assert.equal(response.cookies.get("vv_refresh")?.value, "new-refresh");
    assert.equal(response.cookies.get("vv_identity")?.value, "new-identity");
    assert.equal(response.cookies.get("vv_device")?.maxAge, 365 * 86_400);
  }
});

test("a Cyclocity 401 keeps the session cookies; only a refused refresh token clears them", () => {
  const downstream = errorResponse(new VelovError("expired", "Votre session doit être renouvelée."));
  assert.equal(downstream.status, 401);
  assert.equal(downstream.cookies.get("vv_refresh"), undefined);
  const revoked = errorResponse(new SessionRevoked());
  assert.equal(revoked.status, 401);
  for (const name of ["vv_access", "vv_refresh", "vv_identity"]) assert.deepEqual([revoked.cookies.get(name)?.value, revoked.cookies.get(name)?.maxAge], ["", 0], name);
  assert.equal(revoked.cookies.get("vv_device"), undefined);
});

test("a refresh token without its own expiry makes browser-session cookies, not deleted ones", () => {
  const response = NextResponse.json({});
  setSessionCookies(response, { ...tokens, refresh_expires_in: 0 });
  assert.equal(response.cookies.get("vv_refresh")?.value, "new-refresh");
  assert.equal(response.cookies.get("vv_refresh")?.maxAge, undefined);
  assert.equal(response.cookies.get("vv_identity")?.maxAge, undefined);
  assert.equal(response.cookies.get("vv_access")?.maxAge, 1800);
});

test("parallel requests with one refresh token share a single refresh", async () => {
  let calls = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const http: typeof fetch = async () => { calls++; await gate; return Response.json(tokens); };
  const pending = [refresh("shared-refresh", http), refresh("shared-refresh", http), refresh("shared-refresh", http)];
  release();
  for (const result of await Promise.all(pending)) assert.deepEqual(result, tokens);
  assert.equal(calls, 1);
  assert.deepEqual(await refresh("shared-refresh", http), tokens);
  assert.equal(calls, 1);
});

test("a failed refresh is not remembered", async () => {
  let calls = 0;
  const outage: typeof fetch = async () => { calls++; return new Response(null, { status: 503 }); };
  const healthy: typeof fetch = async () => { calls++; return Response.json(tokens); };
  await assert.rejects(refresh("flaky-refresh", outage), (error: unknown) => error instanceof VelovError && error.code === "unavailable");
  assert.deepEqual(await refresh("flaky-refresh", healthy), tokens);
  assert.equal(calls, 2);
});

test("a refresh never follows a redirect, and a refused one revokes the session", async () => {
  let redirect: RequestRedirect | undefined;
  const moved: typeof fetch = async (_input, init) => { redirect = init?.redirect; return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }); };
  await assert.rejects(refresh("moved-refresh", moved), (error: unknown) => error instanceof VelovError && error.code === "unavailable" && !(error instanceof SessionRevoked));
  assert.equal(redirect, "manual");
  for (const status of [400, 401]) {
    await assert.rejects(refresh(`refused-${status}`, async () => Response.json({ error: "invalid_grant" }, { status })), (error: unknown) => error instanceof SessionRevoked);
  }
});

test("a logout posts the refresh token to the provider and reports whether it confirmed", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const answer = (status: number): typeof fetch => async (input, init) => { calls.push({ url: String(input), init: init ?? {} }); return new Response(null, { status }); };
  assert.equal(await endSession({ refreshToken: "rt", idToken: "it" }, answer(204)), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${OIDC}/logout`);
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.body instanceof URLSearchParams);
  assert.deepEqual(Object.fromEntries(calls[0].init.body), { client_id: CLIENT_ID, refresh_token: "rt" });
  assert.equal(await endSession({ refreshToken: "rt" }, answer(400)), false);
  assert.equal(await endSession({ refreshToken: "rt" }, async () => { throw new TypeError("fetch failed"); }), false);
  calls.length = 0;
  assert.equal(await endSession({ idToken: "it" }, answer(302)), true);
  assert.equal(new URL(calls[0].url).searchParams.get("id_token_hint"), "it");
  assert.equal(calls[0].init.method, undefined);
  assert.equal(await endSession({}, answer(500)), true);
});

test("a request body is read up to 4 KB of JSON, nothing more", async () => {
  const post = (body: string, type = "application/json") => new Request("https://app.example/api", { method: "POST", headers: { "content-type": type }, body });
  assert.deepEqual(await readJsonBody(post('{"bikeNumber":1}')), { bikeNumber: 1 });
  assert.equal(await readJsonBody(post("{not json")), undefined);
  assert.equal(await readJsonBody(post('{"bikeNumber":1}', "text/plain")), undefined);
  assert.equal(await readJsonBody(post(JSON.stringify({ padding: "x".repeat(4096) }))), undefined);
  const chunks = [new TextEncoder().encode('{"padding":"'), new TextEncoder().encode("x".repeat(5000)), new TextEncoder().encode('"}')];
  const stream = new ReadableStream({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); } });
  assert.equal(await readJsonBody(new Request("https://app.example/api", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit)), undefined);
});

test("forgetting a session locally empties the three session cookies without calling Vélo’v", () => {
  const response = forgetSession();
  for (const name of ["vv_access", "vv_refresh", "vv_identity"]) assert.deepEqual([response.cookies.get(name)?.value, response.cookies.get(name)?.maxAge], ["", 0], name);
  assert.equal(response.cookies.get("vv_device"), undefined);
});

test("continuing as a guest and every expiry forget the session cookies", () => {
  const source = readFileSync("components/companion.tsx", "utf8");
  const guest = /function continueAsGuest\(\) \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
  assert.match(guest, /forgetSession\(\)/);
  assert.match(readFileSync("app/api/auth/forget/route.ts", "utf8"), /requireSameOrigin\(request\);[\s\S]*forgetSession\(\)/);
  assert.doesNotMatch(source, /Session expirée/);
  assert.equal(source.match(/kind: "signedOut", message: "Votre session a expiré/g)?.length, 1);
  assert.equal(source.match(/\bexpire\(\)/g)?.length, 2);
});
