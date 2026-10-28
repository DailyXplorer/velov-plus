import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { refresh, verifyAccess, VelovError, type Tokens } from "./auth-protocol";

export const COOKIE = { access: "vv_access", refresh: "vv_refresh", identity: "vv_identity", device: "vv_device" };
export type Session = { email: string; accessToken: string; renewed: Tokens | null };

function writeCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
}

export function setSessionCookies(response: NextResponse, tokens: Tokens, deviceId?: string) {
  writeCookie(response, COOKIE.access, tokens.access_token, tokens.expires_in);
  writeCookie(response, COOKIE.refresh, tokens.refresh_token, tokens.refresh_expires_in);
  writeCookie(response, COOKIE.identity, tokens.id_token, tokens.refresh_expires_in);
  if (deviceId) writeCookie(response, COOKIE.device, deviceId, 365 * 86_400);
}

export function clearSessionCookies(response: NextResponse) {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.identity]) writeCookie(response, name, "", 0);
}

export async function getSession(request: NextRequest): Promise<Session | null> {
  const access = request.cookies.get(COOKIE.access)?.value;
  if (access) {
    try { return { email: await verifyAccess(access), accessToken: access, renewed: null }; }
    catch { /* A refresh token can recover an expired access token. */ }
  }
  const token = request.cookies.get(COOKIE.refresh)?.value;
  if (!token) return null;
  const tokens = await refresh(token);
  return { email: await verifyAccess(tokens.access_token), accessToken: tokens.access_token, renewed: tokens };
}

export function jsonResponse(data: unknown, session: Session | null = null, status = 200) {
  const response = NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  if (session?.renewed) setSessionCookies(response, session.renewed);
  return response;
}

export function errorResponse(error: unknown) {
  const known = error instanceof VelovError;
  const status = known ? error.code === "expired" ? 401 : error.code === "origin" ? 403 : error.code === "credentials" ? 401 : error.code === "device" ? 409 : 503 : 503;
  const response = jsonResponse({ error: known ? error.message : "Le service est momentanément indisponible. Réessayez dans un instant.", code: known ? error.code : "unavailable" }, null, status);
  if (known && error.code === "expired") clearSessionCookies(response);
  return response;
}
