import assert from "node:assert/strict";
import { test } from "node:test";
import { patchProfile } from "../lib/cyclocity.ts";
import { type Dashboard, formatName, profileBodySchema } from "../lib/models.ts";
import { changesOf, draftOf } from "../lib/profile-draft.ts";

const auth = { accountId: "acc-1", token: "client", identity: "user" };
const profile: Dashboard["profile"] = {
  firstName: "Jean", lastName: "Dupont", email: "jean.dupont@example.com", locked: false, complete: true,
  phoneNumber: "+33612345678", address: "1 rue Exemple", addressComplement: null, zipCode: "69001", city: "Lyon", country: "FR", favorites: []
};

function recorder(status: number, body: unknown = {}) {
  const calls: RequestInit[] = [];
  const send = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, send };
}

test("a first or last name is trimmed, its inner spaces collapsed, and limited to letters, spaces, apostrophes and hyphens", () => {
  assert.deepEqual(profileBodySchema.parse({ firstName: "  Jean   Pierre ", lastName: "d’Artagnan-Lefèvre" }), { firstName: "Jean Pierre", lastName: "d’Artagnan-Lefèvre" });
  assert.deepEqual(profileBodySchema.parse({ lastName: "O'Neil" }), { lastName: "O'Neil" });
  assert.deepEqual(profileBodySchema.parse({ firstName: "Zoë" }), { firstName: "Zoë" });
  assert.equal(profileBodySchema.parse({ lastName: "x".repeat(50) }).lastName?.length, 50);
  for (const body of [
    { firstName: "" }, { firstName: "   " }, { lastName: "x".repeat(51) }, { firstName: "Jean2" }, { lastName: "Dupont." }, { firstName: "Jean\nPierre" },
    { lastName: "-Dupont" }, { firstName: "<b>" }, { firstName: "Jean", sex: "M" }, { firstName: 42 }
  ]) assert.equal(profileBodySchema.safeParse(body).success, false, JSON.stringify(body));
});

test("the form sends only the fields that changed, and nothing when nothing changed", () => {
  assert.equal(changesOf(profile, draftOf(profile)), null);
  assert.equal(changesOf(profile, { ...draftOf(profile), firstName: " Jean " }), null);
  const renamed = changesOf(profile, { ...draftOf(profile), lastName: "  Dupont  de la  Tour " });
  assert.ok(renamed && "body" in renamed);
  assert.deepEqual(renamed.body, { lastName: "Dupont de la Tour" });
  const both = changesOf(profile, { ...draftOf(profile), firstName: "Jeanne", city: "Villeurbanne" });
  assert.ok(both && "body" in both);
  assert.deepEqual(both.body, { firstName: "Jeanne", city: "Villeurbanne" });
});

test("an unchanged name is sent as Vélo’v stores it, never reformatted", () => {
  const lower = { ...profile, firstName: "jean", lastName: "dupont" };
  const result = changesOf(lower, { ...draftOf(lower), city: "Villeurbanne" });
  assert.ok(result && "body" in result);
  assert.deepEqual(result.body, { city: "Villeurbanne" });
});

test("an empty or invalid name is a message to fix, not a request", () => {
  assert.deepEqual(changesOf(profile, { ...draftOf(profile), firstName: "  " }), { error: "Saisissez votre prénom." });
  assert.deepEqual(changesOf(profile, { ...draftOf(profile), lastName: "" }), { error: "Saisissez votre nom." });
  const invalid = changesOf(profile, { ...draftOf(profile), lastName: "Dupont3" });
  assert.ok(invalid && "error" in invalid);
  assert.match(invalid.error, /^Nom invalide/);
});

test("a name change is one PATCH with the names first, and a refusal says so with Vélo’v's raw status", async () => {
  const done = recorder(200, { id: "acc-1" });
  assert.equal((await patchProfile({ ...auth, body: { firstName: "Jean", lastName: "Dupont" } }, done.send)).ok, true);
  assert.equal(done.calls.length, 1);
  assert.equal(String(done.calls[0].body), '{"firstName":"Jean","lastName":"Dupont"}');
  for (const status of [400, 403]) {
    const refused = recorder(status, { code: "accounts.exception.validation.failed", message: "Account invalid" });
    const outcome = await patchProfile({ ...auth, body: { lastName: "Dupont" } }, refused.send);
    assert.equal(refused.calls.length, 1);
    assert.deepEqual([outcome.ok, outcome.httpStatus, outcome.code, outcome.message], [false, status, "accounts.exception.validation.failed", "Vélo’v n’a pas accepté ce changement de nom."]);
  }
  const coordinates = await patchProfile({ ...auth, body: { city: "Lyon" } }, recorder(400, { code: "accounts.exception.validation.failed" }).send);
  assert.match(coordinates.message ?? "", /téléphone/);
});

test("names are shown with French capitalisation", () => {
  assert.equal(formatName("jean-pierre de la tour"), "Jean-Pierre de la Tour");
  assert.equal(formatName("JEAN DUPONT"), "Jean Dupont");
  assert.equal(formatName("valéry giscard d’estaing"), "Valéry Giscard d’Estaing");
  assert.equal(formatName("d'artagnan"), "D'Artagnan");
  assert.equal(formatName("de la tour"), "De la Tour");
  assert.equal(formatName("jean du pont des arts le grand"), "Jean du Pont des Arts le Grand");
  assert.equal(formatName("o'neil"), "O'Neil");
  assert.equal(formatName("élise  lefèvre "), "Élise Lefèvre");
  assert.equal(formatName(""), "");
});
