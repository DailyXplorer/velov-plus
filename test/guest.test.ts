import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FAVORITES_KEY, guestCookie, readFavorites, saveFavorites, startMode, toggleFavorite } from "../lib/guest.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("guest mode reuses the signed-in layout and styles, with no rule of its own", () => {
  const guest = source("components/guest.tsx");
  assert.doesNotMatch(source("app/globals.css"), /\.guest-|bike-signin/);
  assert.match(guest, /<div className="app-layout">/);
  assert.match(guest, /<div className="page-slot"><StationsPage /);
  assert.match(source("components/station-bikes.tsx"), /if \(bike\.status !== "AVAILABLE"[^\n]*return null;\n\s*if \(!account\) return signIn \? \(\n\s*<section className="bike-action"/);
});

test("the signed-in loading skeleton sits in the page slot the phone map layout keys on", () => {
  assert.match(source("app/globals.css"), /\.app-main:has\(\.page-slot:not\(\[hidden\]\) > \.stations-page\)/);
  assert.match(source("components/companion.tsx"), /state\.kind === "loading" \? <div className="page-slot"><PageSkeleton\/><\/div>/);
});

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(FAVORITES_KEY, initial);
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("a session cookie wins over the guest flag", () => {
  assert.equal(startMode({ refresh: "token", guest: "1" }), "session");
  assert.equal(startMode({ refresh: "token" }), "session");
});

test("the guest flag opens guest mode only when set to 1", () => {
  assert.equal(startMode({ guest: "1" }), "guest");
  assert.equal(startMode({ guest: "" }), "signedOut");
  assert.equal(startMode({ guest: "yes" }), "signedOut");
  assert.equal(startMode({ refresh: "", guest: "1" }), "guest");
  assert.equal(startMode({}), "signedOut");
});

test("the guest cookie lasts a year when set and expires at once when cleared", () => {
  assert.equal(guestCookie(true, false), "vv_guest=1; Path=/; SameSite=Lax; Max-Age=31536000");
  assert.equal(guestCookie(false, false), "vv_guest=; Path=/; SameSite=Lax; Max-Age=0");
  assert.equal(guestCookie(true, true), "vv_guest=1; Path=/; SameSite=Lax; Max-Age=31536000; Secure");
});

test("favourites read as an empty list when storage is empty or holds garbage", () => {
  assert.deepEqual(readFavorites(memoryStorage()), []);
  for (const garbage of ["not json", "{\"a\":1}", "null", "42", "\"2002\""]) assert.deepEqual(readFavorites(memoryStorage(garbage)), [], garbage);
});

test("favourites keep valid station numbers once, in order", () => {
  assert.deepEqual(readFavorites(memoryStorage(JSON.stringify([2002, "7", 3.5, -1, 0, null, 2002, 10117, { number: 1 }]))), [2002, 10117]);
});

test("favourites never throw when storage itself fails", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(readFavorites(broken), []);
  assert.doesNotThrow(() => saveFavorites(broken, [2002]));
});

test("saved favourites read back", () => {
  const storage = memoryStorage();
  saveFavorites(storage, [2002, 10117]);
  assert.deepEqual(readFavorites(storage), [2002, 10117]);
});

test("toggling adds a station once and removes it", () => {
  assert.deepEqual(toggleFavorite([], 2002, true), [2002]);
  assert.deepEqual(toggleFavorite([2002], 2002, true), [2002]);
  assert.deepEqual(toggleFavorite([2002, 10117], 2002, false), [10117]);
  assert.deepEqual(toggleFavorite([10117], 2002, false), [10117]);
});
