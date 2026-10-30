import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createToaster } from "../lib/toast.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

test("a toast shows its message and closes itself after five seconds", () => {
  const toaster = createToaster();
  toaster.show("Position introuvable pour le moment.");
  assert.equal(toaster.current()?.message, "Position introuvable pour le moment.");
  mock.timers.tick(4_999);
  assert.notEqual(toaster.current(), null);
  mock.timers.tick(1);
  assert.equal(toaster.current(), null);
});

test("a second toast replaces the first, and the first one's timer cannot close it", () => {
  const toaster = createToaster();
  toaster.show("Première erreur.");
  const first = toaster.current();
  mock.timers.tick(3_000);
  toaster.show("Seconde erreur.");
  const second = toaster.current();
  assert.equal(second?.message, "Seconde erreur.");
  assert.notEqual(second?.id, first?.id);
  mock.timers.tick(2_000);
  assert.equal(toaster.current(), second);
  mock.timers.tick(3_000);
  assert.equal(toaster.current(), null);
});

test("showing the message already on screen keeps the same toast and restarts its five seconds", () => {
  const toaster = createToaster();
  toaster.show("La localisation a pris trop de temps. Réessayez.");
  const shown = toaster.current();
  mock.timers.tick(4_000);
  toaster.show("La localisation a pris trop de temps. Réessayez.");
  assert.equal(toaster.current(), shown);
  mock.timers.tick(4_000);
  assert.equal(toaster.current(), shown);
  mock.timers.tick(1_000);
  assert.equal(toaster.current(), null);
});

test("closing a toast by its id hides it, and a stale id does nothing", () => {
  const toaster = createToaster();
  toaster.show("Première erreur.");
  const stale = toaster.current()!.id;
  toaster.show("Seconde erreur.");
  toaster.dismiss(stale);
  assert.equal(toaster.current()?.message, "Seconde erreur.");
  toaster.dismiss(toaster.current()!.id);
  assert.equal(toaster.current(), null);
});

test("subscribers hear every change until they unsubscribe", () => {
  const toaster = createToaster();
  const heard: (string | null)[] = [];
  const unsubscribe = toaster.subscribe(() => heard.push(toaster.current()?.message ?? null));
  toaster.show("Première erreur.");
  toaster.show("Seconde erreur.");
  mock.timers.tick(5_000);
  unsubscribe();
  toaster.show("Troisième erreur.");
  assert.deepEqual(heard, ["Première erreur.", "Seconde erreur.", null]);
});
