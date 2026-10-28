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
