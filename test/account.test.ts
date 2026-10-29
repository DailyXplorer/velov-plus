import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { patchAutoSpend, patchProfile, postPeriodReport, putStationBookmark } from "../lib/cyclocity.ts";
import { VelovError } from "../lib/auth-protocol.ts";
import { normalizePhone, profileBodySchema } from "../lib/models.ts";

// Nothing here may reach Cyclocity: every call goes through the recorder, and the real fetch is made to fail loudly.
const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

type Reply = { status: number; body?: unknown; text?: string } | Error;
function recorder(reply: Reply) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (reply instanceof Error) throw reply;
    return new Response(reply.status === 204 ? null : reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body)), { status: reply.status });
  }) as typeof fetch;
  return { calls, send };
}

const auth = { accountId: "acc-1", token: "client", identity: "user" };
const ACCOUNT = "https://api.cyclocity.fr/contracts/lyon/accounts/acc-1";
const pdf = Buffer.from("%PDF-1.4 receipt").toString("base64");

/** Every write of this file, with a reply that makes it succeed. */
const writes: { name: string; ok: Reply; run: (send: typeof fetch) => Promise<unknown> }[] = [
  { name: "autoSpend", ok: { status: 200, body: { balance: 6, autoSpend: false } }, run: (send) => patchAutoSpend({ ...auth, autoSpend: false }, send) },
  { name: "bookmark add", ok: { status: 200, text: "2002" }, run: (send) => putStationBookmark({ ...auth, stationNumber: 2002, on: true }, send) },
  { name: "bookmark remove", ok: { status: 204 }, run: (send) => putStationBookmark({ ...auth, stationNumber: 2002, on: false }, send) },
  { name: "receipt", ok: { status: 200, body: { filename: "p-1-period-receipt.pdf", translations: { content: pdf } } }, run: (send) => postPeriodReport({ ...auth, subscriptionId: "sub-1", periodId: "p-1" }, send) },
  { name: "profile", ok: { status: 200, body: {} }, run: (send) => patchProfile({ ...auth, body: { city: "Lyon" } }, send) }
];

function headersOf(init: RequestInit) {
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Taknv1 client");
  assert.equal(headers.Identity, "user");
  assert.match(headers["User-Agent"], /^Mozilla\//);
  return headers;
}

test("autoSpend is a PATCH of the rewards with the app's media type and body, once", async () => {
  const { calls, send } = recorder({ status: 200, body: { balance: 6, autoSpend: false, total: 30 } });
  const result = await patchAutoSpend({ ...auth, autoSpend: false }, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ACCOUNT}/rewards`);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(headersOf(calls[0].init)["Content-Type"], "application/vnd.rewards.v5+json");
  assert.equal(String(calls[0].init.body), '{"autoSpend":false}');
  assert.deepEqual([result.ok, result.httpStatus, result.autoSpend], [true, 200, false]);
});

test("a favourite is a POST to add and a DELETE to remove, with the trailing slash, the account Accept and no body", async () => {
  for (const [on, method, reply] of [[true, "POST", { status: 200, text: "2002" }], [false, "DELETE", { status: 204 }]] as const) {
    const { calls, send } = recorder(reply);
    const outcome = await putStationBookmark({ ...auth, stationNumber: 2002, on }, send);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ACCOUNT}/stationbookmarks/2002/`);
    assert.equal(calls[0].init.method, method);
    const headers = headersOf(calls[0].init);
    assert.equal(headers.Accept, "application/vnd.account.v4+json");
    assert.equal(headers["Content-Type"], undefined);
    assert.equal(calls[0].init.body, undefined);
    assert.equal(outcome.ok, true);
  }
});

test("a receipt is a POST without body under Accept: application/json, decoded to the PDF bytes", async () => {
  const { calls, send } = recorder({ status: 200, body: { id: 0, filename: "p-1-period-receipt.pdf", mimeType: "application/pdf", translations: { id: 0, locale: "fr_FR", content: pdf } } });
  const { outcome, pdf: file } = await postPeriodReport({ ...auth, subscriptionId: "sub-1", periodId: "p-1" }, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ACCOUNT}/subscriptions/sub-1/periods/p-1/reports`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(headersOf(calls[0].init).Accept, "application/json");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(outcome.ok, true);
  assert.equal(file?.filename, "p-1-period-receipt.pdf");
  assert.equal(file?.bytes.toString("latin1"), "%PDF-1.4 receipt");
});

test("a receipt that is not a PDF is refused, not downloaded", async () => {
  const { outcome, pdf: file } = await postPeriodReport({ ...auth, subscriptionId: "sub-1", periodId: "p-1" }, recorder({ status: 200, body: { translations: { content: Buffer.from("<html>").toString("base64") } } }).send);
  assert.deepEqual([outcome.ok, outcome.code, file], [false, "local.receipt.unreadable", null]);
});

test("a profile change is a PATCH of the account with only the changed fields, in the app's order", async () => {
  const { calls, send } = recorder({ status: 200, body: {} });
  await patchProfile({ ...auth, body: { address: { name: "1 rue Exemple", complement: "" }, phoneNumber: "+33600000000", country: "FR" } }, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ACCOUNT);
  assert.equal(calls[0].init.method, "PATCH");
  const headers = headersOf(calls[0].init);
  assert.equal(headers["Content-Type"], "application/vnd.account.v4+json");
  assert.equal(headers.Accept, undefined);
  assert.equal(String(calls[0].init.body), '{"country":"FR","phoneNumber":"+33600000000","address":{"name":"1 rue Exemple","complement":""}}');
});

test("a refused profile keeps Vélo’v's code and raw message", async () => {
  const outcome = await patchProfile({ ...auth, body: { phoneNumber: "+33639980000" } }, recorder({ status: 400, body: { code: "accounts.exception.validation.failed", message: "Account invalid phone number" } }).send);
  assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.code, outcome.detail], [false, 400, "accounts.exception.validation.failed", "Account invalid phone number"]);
  assert.match(outcome.message ?? "", /téléphone/);
});

test("no account write is ever retried: gateway errors, a lost answer and an expired session each cost one call", async () => {
  for (const write of writes) {
    for (const status of [500, 502, 503, 504]) {
      const { calls, send } = recorder({ status, text: "<html>Bad Gateway</html>" });
      await write.run(send);
      assert.equal(calls.length, 1, `${write.name} ${status}`);
    }
    const lost = recorder(new TypeError("fetch failed"));
    await write.run(lost.send);
    assert.equal(lost.calls.length, 1, `${write.name} network`);
    const expired = recorder({ status: 401 });
    await assert.rejects(write.run(expired.send), (error) => error instanceof VelovError && error.code === "expired");
    assert.equal(expired.calls.length, 1, `${write.name} 401`);
    const done = recorder(write.ok);
    await write.run(done.send);
    assert.equal(done.calls.length, 1, `${write.name} ok`);
  }
});

test("the profile body accepts only the fields the site edits, trimmed, and at least one of them", () => {
  assert.deepEqual(profileBodySchema.parse({ city: " Lyon ", zipCode: "69008" }), { city: "Lyon", zipCode: "69008" });
  for (const body of [
    {}, { email: "x@example.com" }, { sex: "M" }, { address: { name: "x".repeat(39), complement: "" } }, { address: { name: "", complement: "" } },
    { country: "France" }, { phoneNumber: "0600000000" }, { city: "Ly\non" }, { zipCode: "<script>" }, null
  ]) assert.equal(profileBodySchema.safeParse(body).success, false, JSON.stringify(body));
});

test("French phone numbers are written in the international form the API expects", () => {
  assert.equal(normalizePhone("06 12 34 56 78", "FR"), "+33612345678");
  assert.equal(normalizePhone("06.12.34.56.78", "FR"), "+33612345678");
  assert.equal(normalizePhone("0041 79 123 45 67", "CH"), "+41791234567");
  assert.equal(normalizePhone("+33 6 12 34 56 78", "BE"), "+33612345678");
  assert.equal(normalizePhone("0612345678", "BE"), "0612345678");
});
