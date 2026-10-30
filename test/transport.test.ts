import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { sendWrite } from "../lib/write-transport.ts";
import { postRelease } from "../lib/cyclocity.ts";
import { isUncertain } from "../lib/outcome.ts";

async function server(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const stats = { connections: 0, requests: 0, bodies: [] as string[] };
  const instance = createServer({ keepAlive: true }, (request, response) => {
    stats.requests++;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { stats.bodies.push(body); handle(request, response); });
  });
  instance.on("connection", () => { stats.connections++; });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
  return { stats, origin, close: () => new Promise<void>((resolve) => { instance.closeAllConnections(); instance.close(() => resolve()); }) };
}

test("every write opens its own connection, even right after a read warmed one", async () => {
  const local = await server((_, response) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"transactionState":"OK"}'); });
  try {
    await (await fetch(`${local.origin}/read`)).text();
    const first = await sendWrite(`${local.origin}/one`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' });
    assert.deepEqual([first.status, await first.json()], [200, { transactionState: "OK" }]);
    const second = await sendWrite(`${local.origin}/two`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"b":2}' });
    assert.equal(second.status, 200);
    assert.deepEqual([local.stats.requests, local.stats.connections], [3, 3]);
    assert.deepEqual(local.stats.bodies, ["", '{"a":1}', '{"b":2}']);
  } finally { await local.close(); }
});

test("a 421 answer is never resent and leaves an unlock uncertain", async () => {
  const local = await server((_, response) => { response.writeHead(421); response.end(); });
  try {
    const release = { accountId: "acc-1", subscriptionId: "sub-1", token: "client", identity: "user", body: { stationNumber: 2002, standNumber: 1, bikeNumber: 20449 } };
    const outcome = await postRelease(release, (url, init) => sendWrite(String(url).replace("https://api.cyclocity.fr", local.origin), init));
    assert.equal(local.stats.requests, 1);
    assert.equal(outcome.httpStatus, 421);
    assert.equal(isUncertain(outcome), true);
  } finally { await local.close(); }
});

test("form bodies keep their encoding and a timeout surfaces as a TimeoutError", async () => {
  const local = await server((request, response) => { response.writeHead(200, { "Content-Type": "text/plain" }); response.end(request.headers["content-type"]); });
  try {
    const encoded = await sendWrite(`${local.origin}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token" }) });
    assert.match(await encoded.text(), /^application\/x-www-form-urlencoded/);
    assert.equal(local.stats.bodies[0], "grant_type=refresh_token");
    const form = new FormData();
    form.set("message", "Bonjour");
    const multipart = await sendWrite(`${local.origin}/mail`, { method: "POST", body: form });
    assert.match(await multipart.text(), /^multipart\/form-data; boundary=/);
    assert.match(local.stats.bodies[1], /Bonjour/);
  } finally { await local.close(); }
  const silent = await server(() => {});
  try {
    await assert.rejects(sendWrite(`${silent.origin}/slow`, { method: "POST", body: "{}", signal: AbortSignal.timeout(50) }), (error: Error) => error.name === "TimeoutError");
  } finally { await silent.close(); }
});

test("no server-side write defaults to the pooled global fetch", () => {
  for (const file of ["lib/cyclocity.ts", "lib/promo.ts", "lib/contact-mail.ts", "lib/auth-protocol.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /(send: typeof fetch|http: Http) = fetch\b/, file);
  }
});
