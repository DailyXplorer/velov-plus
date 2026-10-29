import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { loginSchema } from "@/lib/models";
import { login, readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { deviceOf, errorResponse, jsonResponse, setDeviceCookie, setSessionCookies } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  let device: string | undefined;
  try {
    requireSameOrigin(request);
    const body = await readJsonBody(request);
    if (body === undefined) return jsonResponse({ error: "Vérifiez votre adresse e-mail et votre code secret." }, null, 400);
    const credentials = loginSchema.safeParse(body);
    if (!credentials.success) return jsonResponse({ error: "Saisissez votre adresse e-mail et votre code secret à six chiffres." }, null, 400);
    device = deviceOf(request) ?? randomUUID();
    const { tokens, deviceId } = await login(credentials.data, device);
    const response = jsonResponse({ connected: true });
    setSessionCookies(response, tokens, deviceId);
    return response;
  } catch (error) {
    const response = errorResponse(error);
    if (device) setDeviceCookie(response, device);
    return response;
  }
}
