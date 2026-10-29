import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("account actions no longer display experimental labels, without removing their confirmations", () => {
  for (const file of ["auto-renewal", "via-action", "contact-support", "invite-friend"]) {
    const component = source(`components/${file}.tsx`);
    assert.doesNotMatch(component, /Expérimental/);
    assert.match(component, /Confirmer/);
    assert.match(component, /<Modal/);
  }
});

test("the renewal setting uses the subscription card inset, not a second horizontal padding", () => {
  assert.match(source("components/auto-renewal.tsx"), /className="setting-row renewal-setting"/);
  assert.match(source("app/globals.css"), /\.account-section \.renewal-setting\s*\{[^}]*padding-inline:\s*0;/);
});

test("contact support keeps the form without a secondary mail link", () => {
  const source = readFileSync(new URL("../components/contact-support.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Ouvrir ma messagerie à la place|mailto:/);
  assert.match(source, /Écrire au service client/);
  assert.match(source, />Confirmer</);
});

const dialogs = ["account-actions", "auto-renewal", "contact-support", "via-action", "invite-friend", "bike-actions"];

test("a confirmed action closes its dialog: no success panel, no second button to dismiss it", () => {
  const success = /Coordonnées enregistrées|Utilisation automatique (activée|désactivée)\.|Station (ajoutée aux|retirée des) favoris|Message envoyé au service client|Vélo’v vous accorde 15 minutes|Vélo déverrouillé à la borne|Demande envoyée|success=/;
  for (const file of dialogs) {
    const component = source(`components/${file}.tsx`);
    assert.doesNotMatch(component, success, file);
    // Only the invite code is information worth a "Fermer" button.
    if (file !== "invite-friend") assert.doesNotMatch(component, />Fermer<|"Fermer" :/, file);
  }
});

test("the profile confirmation is the question alone, without a before/after list", () => {
  const component = source("components/account-actions.tsx");
  assert.match(component, /title="Enregistrer les modifications \?" onClose=\{\(\) => setAsking\(null\)\}\n\s+run=\{[\s\S]*?\}\}\/>/);
  assert.doesNotMatch(component, /Avant :|\.changes\b/);
});

test("failures stay in the dialog with the raw status, and Confirmer stays available to retry", () => {
  for (const file of dialogs) {
    const component = source(`components/${file}.tsx`);
    assert.match(component, /bike-action-raw|<Raw|<RawStatus/, file);
    assert.match(component, />Confirmer</, file);
  }
});

test("the exceptions keep their result: the invite code with Copier and Fermer, the inline rating thanks", () => {
  const invite = source("components/invite-friend.tsx");
  assert.match(invite, /outcome\?\.ok \? "Fermer" : "Annuler"/);
  assert.match(invite, /"Copié" : "Copier"/);
  const rating = source("components/trip-sheet.tsx");
  assert.match(rating, /Merci ! \+5 points<\/p>/);
});

test("the unlock instruction is given before confirming, since the sheet closes on success", () => {
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /60 secondes pour appuyer sur le bouton de la borne \{place\.standNumber\}/);
  assert.match(bike, /onDone\(\);/);
  assert.match(source("components/station-bikes.tsx"), /<StationActions bike=\{opened\.bike\} station=\{station\} onDone=\{onClose\}\/>/);
});
