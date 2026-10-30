import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

const NULL_BODY = new Set([204, 205, 304]);

function toResponse(message: IncomingMessage, body: Buffer) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
  }
  const status = message.statusCode ?? 0;
  return new Response(NULL_BODY.has(status) ? null : new Uint8Array(body), { status, statusText: message.statusMessage, headers });
}

export const sendWrite = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const encoded = init.body == null ? null : new Response(init.body);
  const body = encoded ? Buffer.from(await encoded.arrayBuffer()) : null;
  const headers = new Headers(init.headers);
  const type = encoded?.headers.get("content-type");
  if (type && !headers.has("content-type")) headers.set("content-type", type);
  if (body) headers.set("content-length", String(body.length));
  headers.set("connection", "close");
  const signal = init.signal ?? undefined;
  signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const fail = (error: unknown) => reject(signal?.aborted ? signal.reason : error);
    const outgoing = (url.protocol === "http:" ? httpRequest : httpsRequest)(url, { method: init.method ?? "GET", headers: Object.fromEntries(headers), agent: false, signal }, (message) => {
      const chunks: Buffer[] = [];
      message.on("data", (chunk: Buffer) => chunks.push(chunk));
      message.on("end", () => { try { resolve(toResponse(message, Buffer.concat(chunks))); } catch (error) { fail(error); } });
      message.on("error", fail);
    });
    outgoing.on("error", fail);
    outgoing.end(body ?? undefined);
  });
}) as typeof fetch;

export const sendByMethod = ((input: string | URL | Request, init: RequestInit = {}) => (init.method ?? "GET").toUpperCase() === "GET" ? fetch(input, init) : sendWrite(input, init)) as typeof fetch;
