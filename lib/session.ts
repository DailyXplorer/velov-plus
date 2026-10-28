// No secret here: kept free of "server-only" so tests can import it.
import { NextRequest, NextResponse } from "next/server.js";
import { refresh, SessionRevoked, verifyAccess, VelovError, type Tokens } from "./auth-protocol.ts";

export const COOKIE = { access: "vv_access", refresh: "vv_refresh", identity: "vv_identity", device: "vv_device" };
export type Session = { email: string; accessToken: string; renewed: Tokens | null; device: string | null };

/** maxAge null: a browser-session cookie. */
function writeCookie(response: NextResponse, name: string, value: string, maxAge: number | null) {
  response.cookies.set(name, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", ...(maxAge === null ? {} : { maxAge }) });
}

/** The device id the account was first linked with, when the cookie holds a well-formed one. */
export function deviceOf(request: NextRequest) {
  const value = request.cookies.get(COOKIE.device)?.value;
  return value && /^[a-zA-Z0-9-]{16,80}$/.test(value) ? value : null;
}

export function setDeviceCookie(response: NextResponse, deviceId: string) {
  writeCookie(response, COOKIE.device, deviceId, 365 * 86_400);
}

export function setSessionCookies(response: NextResponse, tokens: Tokens, deviceId?: string | null) {
  // Keycloak sends refresh_expires_in 0 for a refresh token without its own expiry.
  const lifetime = tokens.refresh_expires_in || null;
  writeCookie(response, COOKIE.access, tokens.access_token, tokens.expires_in);
  writeCookie(response, COOKIE.refresh, tokens.refresh_token, lifetime);
  writeCookie(response, COOKIE.identity, tokens.id_token, lifetime);
  if (deviceId) setDeviceCookie(response, deviceId);
}

export function clearSessionCookies(response: NextResponse) {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.identity]) writeCookie(response, name, "", 0);
}

export async function getSession(request: NextRequest): Promise<Session | null> {
  const device = deviceOf(request);
  const access = request.cookies.get(COOKIE.access)?.value;
  if (access) {
    try { return { email: await verifyAccess(access), accessToken: access, renewed: null, device }; }
    catch { /* A refresh token can recover an expired access token. */ }
  }
  const token = request.cookies.get(COOKIE.refresh)?.value;
  if (!token) return null;
  const tokens = await refresh(token);
  return { email: await verifyAccess(tokens.access_token), accessToken: tokens.access_token, renewed: tokens, device };
}

/** Writes renewed tokens on every answer, error or not: the old refresh token may already be spent. */
export function jsonResponse(data: unknown, session: Session | null = null, status = 200) {
  const response = NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  if (session?.renewed) setSessionCookies(response, session.renewed, session.device);
  return response;
}

/** Cookies are cleared only when the identity provider refused the refresh token, never on a Cyclocity 401. */
export function errorResponse(error: unknown, session: Session | null = null) {
  const known = error instanceof VelovError;
  const status = known ? error.code === "expired" ? 401 : error.code === "origin" ? 403 : error.code === "credentials" ? 401 : error.code === "device" ? 409 : 503 : 503;
  const response = jsonResponse({ error: known ? error.message : "Le service est momentanément indisponible. Réessayez dans un instant.", code: known ? error.code : "unavailable" }, session, status);
  if (error instanceof SessionRevoked) clearSessionCookies(response);
  return response;
}
