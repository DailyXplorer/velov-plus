import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { postContactMail } from "../lib/contact-mail.ts";
import { contactBodySchema, contactMessage } from "../lib/contact-models.ts";
import { readJsonBody } from "../lib/auth-protocol.ts";

const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("Real network forbidden"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });
const auth = { accountId: "account/id", token: "app-token", identity: "user-token" };
const body = { complaintType: "TRIP" as const, message: "Bonjour, merci de vérifier.", tripToken: "ABC123" };
function recorder(status: number | Error, reply: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (status instanceof Error) throw status;
    return new Response(status === 204 ? null : JSON.stringify(reply), { status });
  }) as typeof fetch;
  return { calls, send };
}

test("mail uses one multipart POST with documented headers, fields and the selected trip token", async () => {
  const { calls, send } = recorder(204);
  const outcome = await postContactMail({ ...auth, body }, send);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/account%2Fid/mail");
  const init = calls[0].init;
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("Authorization"), "Taknv1 app-token");
  assert.equal(headers.get("Identity"), "user-token");
  assert.equal(headers.get("Accept"), "multipart/form-data");
  assert.equal(headers.get("Content-Type"), null, "fetch must supply its multipart boundary");
  assert.match(headers.get("User-Agent") ?? "", /^Mozilla\//);
  assert.equal(init.cache, "no-store");
  assert.ok(init.signal);
  assert.ok(init.body instanceof FormData);
  assert.deepEqual([...init.body.entries()], [["complaintType", "TRIP"], ["message", "Bonjour, merci de vérifier.\n\nCode du trajet : ABC123"]]);
  const encoded = new Request("https://example.test", { method: "POST", body: init.body });
  assert.match(encoded.headers.get("Content-Type") ?? "", /^multipart\/form-data; boundary=/);
});

test("mail omits all trip fields when none is selected", async () => {
  const { calls, send } = recorder(200);
  await postContactMail({ ...auth, body: { complaintType: "SUBSCRIPTION", message: "Une question" } }, send);
  assert.deepEqual([...(calls[0].init.body as FormData).entries()], [["complaintType", "SUBSCRIPTION"], ["message", "Une question"]]);
});

test("every mail refusal retains its raw status, code and message without any retry", async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
    const { calls, send } = recorder(status, { code: "mail.invalid", message: "Invalid complaintType" });
    const result = await postContactMail({ ...auth, body }, send);
    assert.deepEqual([result.ok, result.httpStatus, result.code, result.detail], [false, status, "mail.invalid", "Invalid complaintType"]);
    assert.equal(calls.length, 1);
  }
  for (const error of [new TypeError("fetch failed"), new DOMException("Timeout", "TimeoutError")]) {
    const { calls, send } = recorder(error);
    const result = await postContactMail({ ...auth, body }, send);
    assert.deepEqual([result.ok, result.httpStatus, result.code], [false, 0, "network"]);
    assert.equal(calls.length, 1);
  }
});

test("contact validation accepts only supported categories and bounded message and trip fields", () => {
  assert.deepEqual(contactBodySchema.parse({ ...body, message: "  Bonjour  " }).message, "Bonjour");
  for (const invalid of [{ ...body, complaintType: "OTHER" }, { ...body, message: " " }, { ...body, message: "x".repeat(1501) }, { ...body, tripId: "../escape" }, { ...body, tripToken: "A\nB" }, { ...body, extra: true }, { complaintType: "TRIP", message: "Hi", tripId: "1" }]) assert.equal(contactBodySchema.safeParse(invalid).success, false);
  assert.equal(contactMessage({ complaintType: "PAYMENT", message: " Question " }), "Question");
});

test("the route body reader rejects oversized multibyte messages before any upstream write", async () => {
  const request = new Request("https://example.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ complaintType: "TRIP", message: "é".repeat(2100) }) });
  assert.equal(await readJsonBody(request), undefined);
});
