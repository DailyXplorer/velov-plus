import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CALLBACK, CLIENT_ID, IAM, OIDC, VelovError, login, makeAuthorization, readCallback, readForm, refresh, requireSameOrigin } from "../lib/auth-protocol.ts";

test("a login starts with a unique state, nonce and S256 proof", () => {
  const first = makeAuthorization();
  const second = makeAuthorization();
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.verifier, second.verifier);
  assert.equal(first.url.origin, IAM);
  assert.equal(first.url.searchParams.get("redirect_uri"), CALLBACK);
  assert.equal(first.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(first.url.searchParams.get("code_challenge"), createHash("sha256").update(first.verifier).digest("base64url"));
});

test("only the expected callback for this login can supply a code", () => {
  assert.equal(readCallback(`${CALLBACK}?state=expected&code=authorized`, "expected"), "authorized");
  for (const url of [
    `${CALLBACK}?state=foreign&code=authorized`,
    `${CALLBACK}?state=expected`,
    `${CALLBACK}?state=expected&code=x&error=access_denied`,
    "https://other.example/openid_connect_login?state=expected&code=x",
    "https://velov.grandlyon.com/other?state=expected&code=x"
  ]) assert.throws(() => readCallback(url, "expected"), VelovError);
});

test("credentials are never posted to a form outside the identity provider", async () => {
  let requests = 0;
  const http: typeof fetch = async () => {
    requests++;
    return new Response('<form id="kc-form-login" action="https://other.example/collect"><input name="username"/></form>');
  };
  await assert.rejects(login({ email: "person@example.com", code: "123456" }, "test-device", http), (error: unknown) => error instanceof VelovError && error.code === "protocol");
  assert.equal(requests, 1);
});

test("the provider's hidden form fields survive the login step", () => {
  const form = readForm('<form id="kc-form-login" action="/realms/vls-default/login-actions/authenticate?session_code=x"><input type="hidden" name="session" value="preserved"/><input name="username"/></form>', "kc-form-login");
  assert.equal(form.url.origin, IAM);
  assert.equal(form.fields.get("session"), "preserved");
  assert.equal(form.fields.has("username"), false);
});

test("an invalid credential response asks for a new login", () => {
  assert.throws(() => readForm('<form id="kc-form-login" action="/realms/vls-default/login-actions/authenticate"></form>', "vls-form-device-id"), (error: unknown) => error instanceof VelovError && error.code === "credentials");
});

test("another website cannot submit login or logout on the user's behalf", () => {
  requireSameOrigin(new Request("https://app.example/api/auth/login", { headers: { origin: "https://app.example" } }));
  requireSameOrigin(new Request("http://localhost:3000/api/auth/login", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }));
  for (const origin of [null, "https://other.example", "https://app.example.other.example"]) {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    assert.throws(() => requireSameOrigin(new Request("https://app.example/api/auth/login", { headers })), (error: unknown) => error instanceof VelovError && error.code === "origin");
  }
});

test("a browser session renews with its refresh token and without a password", async () => {
  const tokens = { access_token: "new-access", refresh_token: "new-refresh", id_token: "new-identity", expires_in: 1800, refresh_expires_in: 2500000 };
  const http: typeof fetch = async (input, init) => {
    assert.equal(String(input), `${OIDC}/token`);
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof URLSearchParams);
    assert.equal(init.body.get("client_id"), CLIENT_ID);
    assert.equal(init.body.get("grant_type"), "refresh_token");
    assert.equal(init.body.get("refresh_token"), "existing-refresh");
    assert.equal(init.body.has("password"), false);
    return Response.json(tokens);
  };
  assert.deepEqual(await refresh("existing-refresh", http), tokens);
});

test("a rejected refresh expires the session; an outage preserves the option to retry", async () => {
  const rejected: typeof fetch = async () => new Response(null, { status: 400 });
  const unavailable: typeof fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(refresh("test-token", rejected), (error: unknown) => error instanceof VelovError && error.code === "expired");
  await assert.rejects(refresh("test-token", unavailable), (error: unknown) => error instanceof VelovError && error.code === "unavailable");
});
