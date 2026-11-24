import assert from "node:assert/strict";
import test from "node:test";
import { LAST_USER_KEY, LEGACY_STORAGE_KEY, LOG_CACHE_PREFIX, OUTBOX_PREFIX, claimLegacyLog, clearDeviceData, clearLogCache, clearOutbox, fastLossHiddenKeyFor, frontendApiFor, hasLegacyLog, lastUser, logCacheKeyFor, outboxKeyFor, readLogCache, readOutbox, signOutWarning, storageKeyFor, writeLogCache, writeOutbox } from "../dist/account.mjs";
import { normalizeState } from "../dist/model.mjs";

const keyFor = (kind, host) => "pk_" + kind + "_" + btoa(host + "$");

class MemoryStorage {
  constructor(items = {}) { this.items = new Map(Object.entries(items)); }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.has(key) ? this.items.get(key) : null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}

test("publishable keys decode to their Frontend API host", () => {
  assert.equal(frontendApiFor(keyFor("test", "humble-owl-12.clerk.accounts.dev")), "humble-owl-12.clerk.accounts.dev");
  assert.equal(frontendApiFor(keyFor("live", "clerk.example.com")), "clerk.example.com");
  assert.equal(frontendApiFor("  " + keyFor("test", "a-b.clerk.accounts.dev") + "\n"), "a-b.clerk.accounts.dev");
});

test("keys without base64 padding decode, as Clerk issues them", () => {
  const unpadded = keyFor("test", "enabling-duck-7464.clerk.accounts.dev").replace(/=+$/, "");
  assert.ok(!unpadded.endsWith("="));
  assert.equal(frontendApiFor(unpadded), "enabling-duck-7464.clerk.accounts.dev");
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

test("the first-run screen knows when an old log is waiting to move in, without claiming it", () => {
  const old = JSON.stringify({ started: true, entries: [{ date: "2026-11-01", weight: 80 }] });
  // An unclaimed log, and one this account claimed, wait for it.
  const unclaimed = new MemoryStorage({ [LEGACY_STORAGE_KEY]: old });
  assert.equal(hasLegacyLog(unclaimed, "user_a"), true);
  assert.equal(unclaimed.getItem(LEGACY_STORAGE_KEY), old, "nothing is claimed");
  assert.equal(hasLegacyLog(new MemoryStorage({ [storageKeyFor("user_a")]: old }), "user_a"), true);
  // Another account's claimed log isn't this one's.
  assert.equal(hasLegacyLog(new MemoryStorage({ [storageKeyFor("user_b")]: old }), "user_a"), false);
  // The claimed log is the one that moves in, so an empty one wins over an unclaimed one.
  assert.equal(hasLegacyLog(new MemoryStorage({ [storageKeyFor("user_a")]: JSON.stringify({ entries: [] }), [LEGACY_STORAGE_KEY]: old }), "user_a"), false);
  // An empty, unreadable or missing log has nothing to import.
  for (const saved of [JSON.stringify({ started: false, entries: [] }), "not json", "null"]) {
    assert.equal(hasLegacyLog(new MemoryStorage({ [LEGACY_STORAGE_KEY]: saved }), "user_a"), false, saved);
  }
  assert.equal(hasLegacyLog(new MemoryStorage(), "user_a"), false);
});

const log = {
  started: true,
  units: { weight: "lb", height: "ft" },
  entries: [{ date: "2026-11-02", weight: 80.5, note: "after travel" }, { date: "2026-11-01", weight: 81 }]
};

test("a cached log reads back normalized, with when it was saved and whose it is", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1_790_000_000_000);
  assert.equal(lastUser(storage), "user_a");
  const cached = readLogCache(storage, "user_a");
  assert.equal(cached.userId, "user_a");
  assert.equal(cached.savedAt, 1_790_000_000_000);
  assert.deepEqual(cached.log, normalizeState(log));
  assert.deepEqual(cached.log.entries.map(entry => entry.date), ["2026-11-01", "2026-11-02"]);
  assert.equal(cached.log.entries[1].note, "after travel");
});

test("writing the cache defaults to now and replaces the earlier copy", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1);
  const before = Date.now();
  writeLogCache(storage, "user_a", { ...log, entries: [] });
  const cached = readLogCache(storage, "user_a");
  assert.ok(cached.savedAt >= before && cached.savedAt <= Date.now());
  assert.deepEqual(cached.log.entries, []);
});

test("nothing is cached until a log is written", () => {
  const storage = new MemoryStorage();
  assert.equal(lastUser(storage), null);
  assert.equal(readLogCache(storage, "user_a"), null);
  assert.equal(readLogCache(storage, null), null);
  assert.equal(readLogCache(storage, ""), null);
});

test("a corrupt cached value counts as no copy", () => {
  for (const value of ["{", "null", "42", "[]", '"text"', JSON.stringify({ userId: "user_a", savedAt: 1 }),
    JSON.stringify({ userId: "user_a", savedAt: 1, log: null }), JSON.stringify({ userId: "user_a", savedAt: 1, log: [] }),
    JSON.stringify({ userId: "user_a", savedAt: "yesterday", log }), JSON.stringify({ userId: "user_a", savedAt: -5, log }),
    JSON.stringify({ savedAt: 1, log })]) {
    const storage = new MemoryStorage({ [LAST_USER_KEY]: "user_a", [logCacheKeyFor("user_a")]: value });
    assert.equal(readLogCache(storage, "user_a"), null, value);
  }
});

test("a cache that belongs to a different user is ignored", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1);
  assert.equal(readLogCache(storage, "user_b"), null);
  // A record for user_a stored under user_b's key is not user_b's log.
  storage.setItem(logCacheKeyFor("user_b"), storage.getItem(logCacheKeyFor("user_a")));
  assert.equal(readLogCache(storage, "user_b"), null);
});

test("only one user's log is kept on the device", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1);
  writeLogCache(storage, "user_b", log, 2);
  assert.equal(storage.getItem(logCacheKeyFor("user_a")), null);
  assert.equal(readLogCache(storage, "user_b").savedAt, 2);
  assert.equal(lastUser(storage), "user_b");
});

test("clearing the cache removes every cached log, the last user and every outbox, and nothing else", () => {
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: "old", [storageKeyFor("user_a")]: "browser log", "baseline.fast-loss-hidden:user_a": "2026-11-01" });
  writeLogCache(storage, "user_a", log, 1);
  storage.setItem(logCacheKeyFor("user_c"), "stray");
  writeOutbox(storage, "user_a", [{ id: "1", change: { op: "delete-weight", date: "2026-11-20" } }]);
  storage.setItem(outboxKeyFor("user_c"), "stray");
  clearLogCache(storage);
  assert.equal(lastUser(storage), null);
  assert.equal(readLogCache(storage, "user_a"), null);
  assert.deepEqual(readOutbox(storage, "user_a"), []);
  assert.deepEqual([...storage.items.keys()].filter(key => key.startsWith(LOG_CACHE_PREFIX) || key.startsWith(OUTBOX_PREFIX)), []);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), "old");
  assert.equal(storage.getItem(storageKeyFor("user_a")), "browser log");
  assert.equal(storage.getItem("baseline.fast-loss-hidden:user_a"), "2026-11-01");
  clearLogCache(storage);
  assert.equal(storage.items.size, 3);
});

test("a cache that can't be written leaves no older copy behind", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => writeLogCache(storage, "user_a", log, 2), /Quota/);
  assert.equal(readLogCache(storage, "user_a"), null);
  assert.equal(lastUser(storage), null);
});

test("storage that can't be read counts as no cache", () => {
  const storage = { getItem() { throw new Error("SecurityError"); } };
  assert.equal(lastUser(storage), null);
  assert.equal(readLogCache(storage, "user_a"), null);
});

test("the cache never looks like a log saved before sign-in", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1);
  assert.ok(!logCacheKeyFor("user_a").startsWith(LEGACY_STORAGE_KEY));
  assert.equal(storage.getItem(storageKeyFor("user_a")), null);
  assert.equal(claimLegacyLog(storage, "user_a"), false);
  assert.equal(storage.getItem(storageKeyFor("user_a")), null);
});

const weighIn = { id: "a1", change: { op: "save-weight", date: "2026-11-22", weight: 84.2, note: null } };
const deletion = { id: "a2", change: { op: "delete-weight", date: "2026-11-22" } };

test("an outbox keeps a user's changes in order until it's written again", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(readOutbox(storage, "user_a"), []);
  writeOutbox(storage, "user_a", [weighIn, deletion]);
  assert.deepEqual(readOutbox(storage, "user_a"), [weighIn, deletion]);
  assert.equal(JSON.parse(storage.getItem(outboxKeyFor("user_a"))).userId, "user_a");
  // Another user's outbox is separate, and an empty one leaves no key behind.
  assert.deepEqual(readOutbox(storage, "user_b"), []);
  writeOutbox(storage, "user_a", [deletion]);
  assert.deepEqual(readOutbox(storage, "user_a"), [deletion]);
  writeOutbox(storage, "user_a", []);
  assert.equal(storage.getItem(outboxKeyFor("user_a")), null);
  assert.throws(() => writeOutbox(storage, "", [weighIn]));
});

test("an outbox stored under one user's key never reads back for another", () => {
  const storage = new MemoryStorage();
  writeOutbox(storage, "user_a", [weighIn]);
  storage.setItem(outboxKeyFor("user_b"), storage.getItem(outboxKeyFor("user_a")));
  assert.deepEqual(readOutbox(storage, "user_b"), []);
  assert.deepEqual(readOutbox(storage, ""), []);
  assert.deepEqual(readOutbox(storage, null), []);
});

test("an outbox skips anything that isn't a change that can wait", () => {
  const storage = new MemoryStorage();
  for (const value of ["not json", "null", "[]", JSON.stringify({ userId: "user_a" }), JSON.stringify({ userId: "user_a", changes: {} })]) {
    storage.setItem(outboxKeyFor("user_a"), value);
    assert.deepEqual(readOutbox(storage, "user_a"), [], value);
  }
  storage.setItem(outboxKeyFor("user_a"), JSON.stringify({ userId: "user_a", changes: [
    weighIn, null, { id: "", change: weighIn.change }, { id: "b", change: { op: "set-reminder", hour: 8, timeZone: "UTC" } },
    { id: "c", change: { op: "import", log: {} } }, { id: "d" }, { ...deletion, extra: true }, { id: "a1", change: deletion.change }
  ] }));
  // Valid items keep their order; a repeated id keeps its first change.
  assert.deepEqual(readOutbox(storage, "user_a"), [weighIn, deletion]);
});

test("clearing the cache can keep the outbox, when nobody signed out", () => {
  const storage = new MemoryStorage();
  writeLogCache(storage, "user_a", log, 1);
  writeOutbox(storage, "user_a", [weighIn]);
  clearLogCache(storage, { keepOutbox: true });
  assert.equal(readLogCache(storage, "user_a"), null);
  assert.equal(lastUser(storage), null);
  assert.deepEqual(readOutbox(storage, "user_a"), [weighIn]);
});

test("clearing outboxes removes every user's and nothing else", () => {
  const storage = new MemoryStorage({ other: "kept" });
  writeLogCache(storage, "user_a", log, 1);
  writeOutbox(storage, "user_a", [weighIn]);
  writeOutbox(storage, "user_b", [deletion]);
  clearOutbox(storage);
  assert.deepEqual(readOutbox(storage, "user_a"), []);
  assert.deepEqual(readOutbox(storage, "user_b"), []);
  assert.equal(storage.getItem("other"), "kept");
  assert.equal(readLogCache(storage, "user_a").savedAt, 1);
});

test("an outbox that can't be written says so, and storage that can't be read counts as empty", () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => writeOutbox(storage, "user_a", [weighIn]), /Quota/);
  assert.deepEqual(readOutbox({ getItem() { throw new Error("SecurityError"); } }, "user_a"), []);
});

test("signing out with changes waiting asks first, counting them", () => {
  assert.equal(signOutWarning(0), null);
  assert.equal(signOutWarning(undefined), null);
  assert.equal(signOutWarning(1), "1 change on this device hasn’t synced yet. Signing out deletes it, so it won’t be saved.");
  assert.equal(signOutWarning(2), "2 changes on this device haven’t synced yet. Signing out deletes them, so they won’t be saved.");
});

test("after a deletion, the device keeps nothing of the user's log, and nothing that could be imported again", () => {
  const storage = new MemoryStorage({
    [LEGACY_STORAGE_KEY]: "unclaimed browser log",
    [storageKeyFor("user_a")]: "claimed browser log",
    [storageKeyFor("user_b")]: "someone else's browser log",
    [fastLossHiddenKeyFor("user_a")]: "2026-11-01",
    [fastLossHiddenKeyFor("user_b")]: "2026-10-01",
    "unrelated": "kept"
  });
  writeLogCache(storage, "user_a", log, 1);
  writeOutbox(storage, "user_a", [weighIn]);
  clearDeviceData(storage, "user_a");
  assert.deepEqual([...storage.items.keys()].sort(), [fastLossHiddenKeyFor("user_b"), storageKeyFor("user_b"), "unrelated"].sort());
  assert.equal(fastLossHiddenKeyFor("user_a"), "baseline.fast-loss-hidden:user_a");
  // Nothing is left for the first sign-in on this browser to take over.
  assert.equal(claimLegacyLog(storage, "user_a"), false);
  clearDeviceData(storage, "user_a");
  assert.equal(storage.items.size, 3, "clearing again is harmless");
});

test("clearing device data without a user removes only what belongs to nobody", () => {
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: "old", [storageKeyFor("user_a")]: "mine" });
  clearDeviceData(storage, null);
  assert.deepEqual([...storage.items.keys()], [storageKeyFor("user_a")]);
});

test("a #log link opened while signed out waits for sign-in in this tab, once", async () => {
  const { LOG_LINK_KEY, forgetLogLink, keepLogLink, takeLogLink } = await import("../dist/account.mjs");
  const session = new MemoryStorage();
  assert.equal(takeLogLink(session), null);
  keepLogLink(session, "#log?weight=84.9&note=after%20run");
  assert.equal(session.getItem(LOG_LINK_KEY), "#log?weight=84.9&note=after%20run");
  assert.equal(takeLogLink(session), "#log?weight=84.9&note=after%20run");
  assert.equal(takeLogLink(session), null, "it fills the weigh-in once");
  keepLogLink(session, "#log");
  forgetLogLink(session);
  assert.equal(takeLogLink(session), null, "signing out removes it");
  // Anything else under the key is no link.
  session.setItem(LOG_LINK_KEY, "#settings");
  assert.equal(takeLogLink(session), null);
  assert.equal(session.length, 0);
});

test("the install hint's first Not now hides it for 30 days, and the second for good", async () => {
  const { INSTALL_HINT_KEY, INSTALL_HINT_PAUSE_DAYS, dismissInstallHint, installHintHidden } = await import("../dist/account.mjs");
  assert.equal(INSTALL_HINT_PAUSE_DAYS, 30);
  const day = 86_400_000;
  const start = Date.UTC(2026, 10, 24, 9);
  const storage = new MemoryStorage();
  assert.equal(installHintHidden(storage, start), false);
  dismissInstallHint(storage, start);
  assert.equal(installHintHidden(storage, start), true);
  assert.equal(installHintHidden(storage, start + 30 * day - 1), true);
  assert.equal(installHintHidden(storage, start + 30 * day), false);
  dismissInstallHint(storage, start + 31 * day);
  assert.equal(installHintHidden(storage, start + 31 * day), true);
  assert.equal(installHintHidden(storage, start + 3650 * day), true);
  dismissInstallHint(storage, start + 3650 * day);
  assert.deepEqual(JSON.parse(storage.getItem(INSTALL_HINT_KEY)), { count: 2, at: start + 3650 * day });
  // A value that doesn't parse counts as no Not now.
  for (const value of ["nonsense", "null", "{}", '{"count":-1,"at":1}', '{"count":1.5}', '[]']) {
    assert.equal(installHintHidden(new MemoryStorage({ [INSTALL_HINT_KEY]: value }), start), false, value);
  }
  assert.equal(installHintHidden(new MemoryStorage({ [INSTALL_HINT_KEY]: '{"count":1}' }), start), false, "a Not now with no time has expired");
  // Storage that can't be read can't keep a Not now, so the line stays away.
  const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
  assert.equal(installHintHidden(blocked, start), true);
  // It isn't about the log, so a deletion leaves it.
  const shared = new MemoryStorage();
  dismissInstallHint(shared, start);
  clearDeviceData(shared, "user_a");
  clearLogCache(shared);
  assert.equal(installHintHidden(shared, start + day), true);
});
