import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { patchAutoRenewal } from "../lib/cyclocity.ts";
import { autoRenewalBodySchema, completeRenewalChange, renewalStateOf } from "../lib/renewal-models.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("Unexpected network access"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });
const auth = { accountId: "account", subscriptionId: "subscription", token: "app-token", identity: "user-token", autoRenewal: true };
function recorder(status: number, body?: unknown, network = false) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); if (network) throw new TypeError("Lost reply"); return new Response(status === 204 ? null : JSON.stringify(body), { status }); }) as typeof fetch;
  return { send, calls };
}
test("renewal PATCH sends the source-supported isAutoRenewal body exactly once", async () => {
  const { send, calls } = recorder(204);
  const outcome = await patchAutoRenewal(auth, send);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cyclocity.fr/contracts/lyon/accounts/account/subscriptions/subscription");
  assert.equal(calls[0].init.method, "PATCH");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("Authorization"), "Taknv1 app-token");
  assert.equal(headers.get("Identity"), "user-token");
  assert.match(headers.get("User-Agent")!, /^Mozilla\//);
  assert.equal(headers.get("Content-Type"), "application/vnd.subscription.v6+json");
  assert.equal(calls[0].init.body, '{"isAutoRenewal":true}');
});
test("renewal preserves raw non-2xx details including 401 and never retries or tries another field", async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
    const { send, calls } = recorder(status, { code: "source.refused", message: "Source message" });
    const result = await patchAutoRenewal({ ...auth, autoRenewal: false }, send);
    assert.equal(calls.length, 1);
    assert.deepEqual([result.ok, result.httpStatus, result.code, result.detail], [false, status, "source.refused", "Source message"]);
    assert.equal(calls[0].init.body, '{"isAutoRenewal":false}');
  }
  const network = recorder(200, {}, true);
  assert.equal((await patchAutoRenewal(auth, network.send)).code, "network");
  assert.equal(network.calls.length, 1);
});
test("renewal button is strictly opt-in and state stays unknown when absent", () => {
  assert.deepEqual(renewalStateOf(undefined), { autoRenewal: null, autoRenewalAllowed: false });
  assert.deepEqual(renewalStateOf({ periods: [{ renewalDetails: { autoRenewalValue: false, autoRenewalBtn: true } }] }), { autoRenewal: false, autoRenewalAllowed: true });
  assert.equal(renewalStateOf({ isLocked: true, periods: [{ renewalDetails: { autoRenewalBtn: true } }] }).autoRenewalAllowed, false);
  assert.equal(autoRenewalBodySchema.safeParse({ subscriptionId: "../other", autoRenewal: true }).success, false);
  assert.equal(autoRenewalBodySchema.safeParse({ ...auth }).success, false);
});
test("successful renewal rereads actual state even if different, and failed reread never repeats mutation", async () => {
  let writes = 0, reads = 0;
  const write = async () => { writes++; return patchAutoRenewal(auth, recorder(204).send); };
  const actual = await completeRenewalChange(write, async () => { reads++; return { autoRenewal: false, autoRenewalAllowed: true }; });
  assert.deepEqual([writes, reads, actual.autoRenewal, actual.verified], [1, 1, false, true]);
  const unknown = await completeRenewalChange(write, async () => { reads++; throw new Error("No reply"); });
  assert.deepEqual([writes, reads, unknown.ok, unknown.autoRenewal, unknown.verified], [2, 2, true, null, false]);
  const rejected = await completeRenewalChange(() => patchAutoRenewal(auth, recorder(400).send), async () => { throw new Error("Must not read after refusal"); });
  assert.equal(rejected.ok, false);
});
