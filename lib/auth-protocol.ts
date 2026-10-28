import { randomBytes, createHash, randomUUID } from "node:crypto";
import { load } from "cheerio";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

export const IAM = "https://iam.cyclocity.fr";
export const REALM = `${IAM}/realms/vls-default`;
export const OIDC = `${REALM}/protocol/openid-connect`;
export const CALLBACK = "https://velov.grandlyon.com/openid_connect_login";
export const CLIENT_ID = "vls-web-lyon";
const jwks = createRemoteJWKSet(new URL(`${OIDC}/certs`));

export const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1), id_token: z.string().min(1),
  expires_in: z.number().positive(), refresh_expires_in: z.number().nonnegative()
});
export type Tokens = z.infer<typeof tokenSchema>;
export type Credentials = { email: string; code: string };
type Http = typeof fetch;

export class VelovError extends Error {
  readonly code: "credentials" | "device" | "expired" | "unavailable" | "protocol" | "origin";
  constructor(code: VelovError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function safeIAMUrl(value: string) {
  const url = new URL(value, IAM);
  if (url.origin !== IAM || !url.pathname.startsWith("/realms/vls-default/")) throw new VelovError("protocol", "Une étape de connexion n’a pas pu être vérifiée.");
  return url;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url);
  // Next.js may use an internal hostname in request.url; Host is the public authority.
  expected.host = request.headers.get("host") ?? expected.host;
  if (origin !== expected.origin) throw new VelovError("origin", "Cette demande doit être effectuée depuis votre espace Vélo’v.");
}

export function makeAuthorization() {
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL(`${OIDC}/auth`);
  url.search = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", scope: "openid email", ui_locales: "fr", redirect_uri: CALLBACK, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, nonce }).toString();
  return { state, nonce, verifier, url };
}

export function readCallback(value: string, state: string) {
  const url = new URL(value);
  const expected = new URL(CALLBACK);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.searchParams.get("state") !== state || url.searchParams.has("error") || !url.searchParams.get("code")) {
    throw new VelovError("protocol", "Le retour de connexion n’a pas pu être vérifié.");
  }
  return url.searchParams.get("code") ?? "";
}

export function readForm(html: string, id: string) {
  const $ = load(html);
  const form = $(`form#${id}`);
  if (form.length !== 1 || !form.attr("action")) {
    const text = $.text().toLocaleLowerCase("fr-FR");
    if (text.includes("autre appareil") || text.includes("another device")) throw new VelovError("device", "Votre compte est déjà utilisé sur un autre appareil. Déconnectez cette session avant de réessayer.");
    if (id === "vls-form-device-id" && $("#kc-form-login").length) throw new VelovError("credentials", "L’email ou le code secret n’a pas été reconnu.");
    throw new VelovError("protocol", "La connexion demande une étape supplémentaire. Réessayez depuis le service officiel.");
  }
  const fields = new URLSearchParams();
  form.find('input[type="hidden"]').each((_, element) => {
    const name = $(element).attr("name");
    if (name) fields.set(name, $(element).attr("value") ?? "");
  });
  return { url: safeIAMUrl(form.attr("action") ?? ""), fields };
}

class LoginTransport {
  private readonly cookies = new Map<string, string>();
  private readonly http: Http;
  constructor(http: Http) { this.http = http; }
  async request(url: URL, fields?: URLSearchParams): Promise<{ kind: "page"; html: string } | { kind: "callback"; url: string }> {
    for (let redirects = 0; redirects < 10; redirects++) {
      safeIAMUrl(url.href);
      const headers: Record<string, string> = { "Accept-Language": "fr" };
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
      if (fields) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const response = await this.http(url, { method: fields ? "POST" : "GET", headers, body: fields?.toString(), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      if ([301, 302, 303].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new VelovError("protocol", "Le serveur de connexion n’a pas répondu comme prévu.");
        const next = new URL(location, url);
        if (next.origin === new URL(CALLBACK).origin && next.pathname === new URL(CALLBACK).pathname) return { kind: "callback", url: next.href };
        url = safeIAMUrl(next.href);
        fields = undefined;
        continue;
      }
      const html = await response.text();
      if (!response.ok) {
        const text = load(html).text().toLowerCase();
        if (text.includes("autre appareil") || text.includes("another device")) throw new VelovError("device", "Votre compte est déjà connecté sur un autre appareil.");
        throw new VelovError("unavailable", "Vélo’v ne peut pas vous connecter pour le moment. Réessayez dans un instant.");
      }
      return { kind: "page", html };
    }
    throw new VelovError("protocol", "La connexion n’a pas pu se terminer.");
  }
}

export async function login(credentials: Credentials, deviceId: string = randomUUID(), http: Http = fetch) {
  const authorization = makeAuthorization();
  const transport = new LoginTransport(http);
  let response = await transport.request(authorization.url);
  if (response.kind !== "page") throw new VelovError("protocol", "Un nouveau formulaire de connexion est nécessaire.");
  const form = readForm(response.html, "kc-form-login");
  form.fields.set("username", credentials.email);
  form.fields.set("password", credentials.code);
  form.fields.set("credentialId", "");
  response = await transport.request(form.url, form.fields);
  if (response.kind === "page") {
    const device = readForm(response.html, "vls-form-device-id");
    device.fields.set("device_id", deviceId);
    response = await transport.request(device.url, device.fields);
  }
  if (response.kind !== "callback") throw new VelovError("protocol", "La connexion n’a pas pu se terminer.");
  const code = readCallback(response.url, authorization.state);
  const tokenResponse = await http(`${OIDC}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: CALLBACK, code, code_verifier: authorization.verifier }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!tokenResponse.ok) throw new VelovError("unavailable", "La session n’a pas pu être ouverte. Réessayez.");
  const raw: unknown = await tokenResponse.json();
  const tokens = tokenSchema.parse(raw);
  const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: REALM, audience: CLIENT_ID, algorithms: ["RS256"] });
  if (payload.nonce !== authorization.nonce) throw new VelovError("protocol", "La réponse de connexion n’a pas pu être vérifiée.");
  return { tokens, deviceId };
}

export async function refresh(refreshToken: string, http: Http = fetch) {
  const response = await http(`${OIDC}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if ([400, 401].includes(response.status)) throw new VelovError("expired", "Votre session a expiré. Reconnectez-vous pour continuer.");
  if (!response.ok) throw new VelovError("unavailable", "Vélo’v est momentanément indisponible.");
  const raw: unknown = await response.json();
  return tokenSchema.parse(raw);
}

export async function verifyAccess(accessToken: string) {
  const { payload } = await jwtVerify(accessToken, jwks, { issuer: REALM, algorithms: ["RS256"] });
  if (payload.azp !== CLIENT_ID) throw new VelovError("expired", "Cette session doit être renouvelée.");
  const email = z.email().safeParse(payload.preferred_username ?? payload.sub);
  if (!email.success) throw new VelovError("protocol", "Le compte associé à cette session n’a pas pu être vérifié.");
  return email.data;
}
