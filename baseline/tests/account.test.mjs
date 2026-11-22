import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_STORAGE_KEY, claimLegacyLog, frontendApiFor, storageKeyFor } from "../dist/account.mjs";

const keyFor = (kind, host) => "pk_" + kind + "_" + btoa(host + "$");

class MemoryStorage {
  constructor(items = {}) { this.items = new Map(Object.entries(items)); }
  getItem(key) { return this.items.has(key) ? this.items.get(key) : null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}

test("publishable keys decode to their Frontend API host", () => {
  assert.equal(frontendApiFor(keyFor("test", "humble-owl-12.clerk.accounts.dev")), "humble-owl-12.clerk.accounts.dev");
  assert.equal(frontendApiFor(keyFor("live", "clerk.example.com")), "clerk.example.com");
  assert.equal(frontendApiFor("  " + keyFor("test", "a-b.clerk.accounts.dev") + "\n"), "a-b.clerk.accounts.dev");
});

test("missing or malformed publishable keys are rejected", () => {
  for (const key of [undefined, null, "", "pk_test_", "sk_test_" + btoa("x.clerk.accounts.dev$"),
    "pk_test_" + btoa("x.clerk.accounts.dev"), keyFor("test", "localhost"), keyFor("test", "evil.com/path"), "pk_test_%%%"]) {
    assert.equal(frontendApiFor(key), null, String(key));
  }
});

test("each account gets its own storage key", () => {
  assert.equal(storageKeyFor("user_abc"), LEGACY_STORAGE_KEY + ":user_abc");
  assert.notEqual(storageKeyFor("user_a"), storageKeyFor("user_b"));
});

test("the first account to sign in takes over the log saved before sign-in", () => {
  const log = JSON.stringify({ started: true, entries: [{ date: "2026-11-01", weight: 80 }] });
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: log });
  assert.equal(claimLegacyLog(storage, "user_a"), true);
  assert.equal(storage.getItem(storageKeyFor("user_a")), log);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), null);
  assert.equal(claimLegacyLog(storage, "user_b"), false);
  assert.equal(storage.getItem(storageKeyFor("user_b")), null);
});

test("an account with its own log keeps it and the old log is not discarded", () => {
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: "old", [storageKeyFor("user_a")]: "mine" });
  assert.equal(claimLegacyLog(storage, "user_a"), false);
  assert.equal(storage.getItem(storageKeyFor("user_a")), "mine");
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), "old");
});

test("nothing happens when there is no old log", () => {
  const storage = new MemoryStorage();
  assert.equal(claimLegacyLog(storage, "user_a"), false);
  assert.equal(storage.items.size, 0);
});
