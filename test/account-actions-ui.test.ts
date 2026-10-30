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
    if (file !== "invite-friend") assert.doesNotMatch(component.replace(/(?:isUncertain\(failure\)|uncertain(?: && failure)?|step\.kind === "uncertain") \? (?:<>)?<Button variant="\w+"(?: disabled=\{\w+\})? onClick=\{\w+\}>Fermer</g, ""), />Fermer<|"Fermer" :/, file);
  }
});

test("the profile confirmation is the question alone, without a before/after list", () => {
  const component = source("components/account-actions.tsx");
  assert.match(component, /title="Enregistrer les modifications \?" onClose=\{\(\) => setAsking\(null\)\}\n\s+onDone=[^\n]*\n\s+run=\{[^\n]*\}\/>/);
  assert.doesNotMatch(component, /Avant :|\.changes\b/);
});

test("failures stay in the dialog as the French message alone, and Confirmer stays available to retry", () => {
  for (const file of dialogs) {
    const component = source(`components/${file}.tsx`);
    assert.doesNotMatch(component, /HTTP |Code \{|httpStatus \|\||TransactionState|\.raw\b/, file);
    assert.match(component, />Confirmer</, file);
  }
});

test("no screen renders a technical line: it goes to the browser console only", () => {
  for (const file of ["ui", "dashboard", "companion", "station-bikes", "stats", "trip-sheet", "guest", "login", "toast", ...dialogs]) {
    assert.doesNotMatch(source(`components/${file}.tsx`), /bike-action-raw|<Raw|RawLine|RawStatus|\.raw\b|HTTP \{/, file);
  }
  assert.doesNotMatch(source("app/globals.css"), /bike-action-raw/);
});

test("after a failure whose outcome is uncertain, the dialog says so and offers Fermer alone, never Confirmer again", () => {
  for (const file of ["bike-actions", "invite-friend", "contact-support", "via-action"]) {
    const component = source(`components/${file}.tsx`);
    assert.match(component, /isUncertain\(\w+\) \? <p className="uncertain-note">\{[^}]*UNCERTAIN/, file);
  }
  for (const [file, again] of [["contact-support", "Écrire un nouveau message"]]) {
    assert.match(source(`components/${file}.tsx`), new RegExp(`\\{failure && isUncertain\\(failure\\) \\? <><Button variant="ghost" onClick=\\{\\w+\\}>Fermer<\\/Button><Button variant="secondary" onClick=\\{\\w+\\}>${again}<\\/Button><\\/> : <>[\\s\\S]*?>Confirmer<\\/Button><\\/>\\}`), file);
  }
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /\{uncertain \? <><Button variant="ghost" onClick=\{onClose\}>Fermer<\/Button><Button variant="secondary" pending=\{checking\} onClick=\{onVerify\}>Vérifier<\/Button><\/> : <>[\s\S]*?>Confirmer<\/Button>\s*<\/>\}/);
  assert.match(bike, /uncertain=\{failure !== null && isUncertain\(failure\)\}/);
  assert.match(bike, /step\.action === "unlock" \? UNCERTAIN_UNLOCK : UNCERTAIN/);
  assert.match(bike, /if \(action === "book" && isUncertain\(outcome\)\) account\?\.changed\(\);/);
  const invite = source("components/invite-friend.tsx");
  assert.match(invite, /const settled = shown !== null && \(shown\.ok \|\| isUncertain\(shown\)\)/);
  assert.match(invite, /: uncertain \? <Button variant="secondary"[^\n]*>Vérifier mes points<\/Button>\n\s+: !settled \? <Button[^\n]*>Confirmer</);
});

test("the invite code keeps its result with Copier and Fermer", () => {
  const invite = source("components/invite-friend.tsx");
  assert.match(invite, /settled \? "Fermer" : "Annuler"/);
  assert.match(invite, /"Copié" : "Copier"/);
});

test("a successful rating shows nothing: the trip-ended sheet closes and the detail sheet drops the rating card", () => {
  const rating = source("components/trip-sheet.tsx");
  assert.doesNotMatch(rating, /Merci|trip-rate-done|kind: "done" \}/);
  assert.match(rating, /function rated\(\) \{\n\s+ratedHere\.add\(trip\.id\);\n\s+forgetStats\(\);\n\s+onRated\(\);\n\s+\}/);
  assert.match(rating, /<RateBike trip=\{trip\} bikeNumber=\{trip\.bikeNumber\} onLater=\{close\} onRated=\{close\}\/>/);
  assert.match(rating, /const rated = trip\.isRated === true \|\| ratedHere\.has\(trip\.id\) \|\| ratedNow === trip\.id;/);
  assert.match(rating, /\{!rated && [^\n]*<RateBike [^\n]*onRated=\{\(\) => setRatedNow\(trip\.id\)\}\/>/);
  assert.doesNotMatch(source("app/globals.css"), /trip-rate-done/);
});

test("the unlock instruction is given before confirming, since the sheet closes on success", () => {
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /60 secondes pour appuyer sur le bouton de la borne \{place\.standNumber\}/);
  assert.match(bike, /onDone\(\);/);
  assert.match(source("components/station-bikes.tsx"), /<StationActions bike=\{opened\.bike\} station=\{station\} onDone=\{onClose\}\/>/);
});

test("F1: unlock and booking go through the shared operation store, and the drawers cannot close while sending", () => {
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /await runOnce\(operations, key, \(\) => sendBikeAction\(action, place\), \{ keep: true, meta: \{ stationNumber: place\.stationNumber, standNumber: place\.standNumber, bikeNumber: place\.bikeNumber \} \}\)/);
  assert.match(bike, /useOperation\(`unlock:\$\{place\.bikeNumber\}`\)/);
  assert.match(bike, /useOperation\(`book:\$\{place\.bikeNumber\}`\)/);
  assert.doesNotMatch(bike, /inFlight/);
  assert.match(bike, /reserving && !wantsUnlock \?/);
  assert.match(bike, /useEffect\(\(\) => \{ if \(bookedNow\) \{ void operations\.clear\(`book:\$\{place\.bikeNumber\}`, reservingId\); setFailure\(null\); setStep\(\{ kind: "start" \}\); \} \}/);
  assert.match(bike, /<Modal titleId="booking-unlock-title" onClose=\{sending \? \(\) => \{\} : onClose\}>/);
  const drawer = source("components/station-bikes.tsx");
  assert.match(drawer, /function back\(\) \{\n\s+if \(sending\) return;/);
  assert.match(drawer, /<Modal titleId="station-bikes-title" onClose=\{sending \? \(\) => \{\} : onClose\}/);
  assert.match(drawer, /onClick=\{back\} disabled=\{sending\}/);
  assert.match(drawer, /onClick=\{onClose\} disabled=\{sending\} aria-label="Fermer"/);
  assert.match(source("components/operations.ts"), /addEventListener\("storage"/);
});

test("F2: the invite state lives in the store, Obtenir un code keeps it, and a retry needs a complete history first", () => {
  const invite = source("components/invite-friend.tsx");
  assert.match(invite, /runOnce\(operations, operationKey, [\s\S]*?\{ keep: true, meta: \{ cost, balance: balance \?\? -1 \} \}\)/);
  assert.match(invite, /function open\(\) \{\n\s+if \(!operation\) setOutcome\(null\);/);
  assert.match(invite, /uncertain && verification\?\.kind === "not-debited" \? <Button onClick=\{\(\) => void retry\(\)\}>Je n’ai pas été débité, réessayer<\/Button>/);
  assert.equal(invite.match(/débité, réessayer/g)?.length, 1);
  assert.match(invite, /async function retry\(\) \{\n\s+if \(!operationKey\) return;[\s\S]*?await retryVerified\(operations, operationKey, verification, /);
  assert.match(invite, /\{uncertain \|\| verification\?\.kind === "debited" \? <a className="text-link" href="#account">Écrire au service client<\/a> : null\}/);
  assert.doesNotMatch(invite, /pendingAccounts|finally \{/);
  assert.match(invite, /getJson\(`\/api\/account\/rewards\?since=\$\{held\.at - DEBIT_SLACK\}`, rewardsHistorySchema, /);
  assert.match(invite, /inviteDebit\(\{ at: held\.at, cost: Number\(held\.meta\.cost\) \}, history, Date\.now\(\)\)/);
  assert.doesNotMatch(invite, /readDashboard|rewards\.balance/);
});

test("confirmation titles keep a non-breaking space before the question mark", () => {
  assert.match(source("components/invite-friend.tsx"), /<h2 id=\{titleId\}>Obtenir un code\u00a0\?<\/h2>/);
  assert.match(source("components/contact-support.tsx"), /<h2 id=\{titleId\}>Envoyer au service client\u00a0\?<\/h2>/);
});

test("F3: profile, favourites, auto-spend, renewal and rating check the real state instead of re-offering Confirmer", () => {
  const actions = source("components/account-actions.tsx");
  assert.match(actions, /else if \(isUncertain\(outcome\)\) await verify\(\);/);
  assert.match(actions, /\{uncertain \? <><Button variant="ghost" disabled=\{busy\} onClick=\{onClose\}>Fermer<\/Button><Button variant="secondary" pending=\{checking\} onClick=\{\(\) => void verify\(\)\}>Vérifier<\/Button><\/> : <>/);
  for (const check of ["autoSpendCheck", "favoriteCheck", "profileCheck"]) assert.match(actions, new RegExp(`check=\\{async \\(\\) => ${check}\\(`), check);
  const renewal = source("components/auto-renewal.tsx");
  assert.match(renewal, /if \(isUncertain\(outcome\)\) await resolve\(\); else setFailure\(outcome\);/);
  assert.match(renewal, /\{uncertain && failure \? <><Button[^\n]*?>Fermer<\/Button><Button[^\n]*?>Vérifier<\/Button><\/>/);
  const rating = source("components/trip-sheet.tsx");
  assert.match(rating, /if \(!isUncertain\(outcome\)\) return setRefused\(outcome\);\n\s+await verify\(\);/);
  assert.match(rating, /\{operation \? <>\{!sendingHere \? <TextButton onClick=\{onLater\}>Plus tard<\/TextButton> : null\}<Button variant="secondary"[^\n]*?>Vérifier<\/Button><\/> : <>/);
});

test("F4: contact and extra time keep their state per account outside the dialog", () => {
  const contact = source("components/contact-support.tsx");
  assert.match(contact, /runOnce\(operations, operationKey, [\s\S]*?\{ keep: true \}\)/);
  assert.match(contact, /onClick=\{\(\) => operation \? setStatus\(true\) : setOpen\(true\)\}/);
  assert.match(contact, /async function writeAgain\(\) \{[\s\S]*?await operations\.clear\(operationKey, operation\.id\);\n\s+setMessage\(""\);/);
  const via = source("components/via-action.tsx");
  assert.match(via, /const operationKey = digest \? `via:\$\{digest\}:\$\{tripId\}` : null;/);
  assert.match(via, /\{ keep: true, meta: \{ number: station\.number, name: station\.name \} \}/);
  assert.match(via, /\{\(reviewing \|\| held\) && station \?/);
  assert.doesNotMatch(via, /setOpen\(false\); setReviewing\(false\); setFailure\(null\); \} \}\n[^\n]*setFailure\(null\);\s*\}/);
});

test("a booking confirmed by the bookings reread leaves the uncertain message for the booked sheet", () => {
  const bike = source("components/bike-actions.tsx");
  assert.match(bike, /const bookedNow = booking !== null && reserving\?\.status === "uncertain";/);
  assert.match(bike, /if \(bookedNow\) \{ void operations\.clear\([^)]*\); setFailure\(null\); setStep\(\{ kind: "start" \}\);/);
  assert.match(bike, /\{booking \? <p className="bike-action-mine"><BookedUntil endsAt=\{booking\.endsAt\}\/><\/p> : null\}/);
});

test("the README says time alone never frees an uncertain unlock, booking or invite", () => {
  const readme = source("README.md");
  assert.match(readme, /Le temps qui passe ne prouve rien : un déverrouillage incertain reste bloqué jusqu’à ce que la relecture des trajets montre un trajet avec ce vélo/);
  assert.doesNotMatch(readme, /deux minutes après un résultat incertain/);
});
