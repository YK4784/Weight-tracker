// Account helpers that don't touch the DOM, so Node can test them.
import { QUEUEABLE_OPS, normalizeState } from "./model.mjs";

export const LEGACY_STORAGE_KEY = "baseline.weight-log.v1";

// A publishable key is "pk_test_" or "pk_live_" followed by the base64-encoded
// Frontend API host and a trailing "$". Returns null for anything else.
export function frontendApiFor(publishableKey) {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/]+={0,2})$/.exec(String(publishableKey ?? "").trim());
  if (!match) return null;
  let decoded;
  try { decoded = atob(match[1]); } catch { return null; }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

export function storageKeyFor(userId) {
  return LEGACY_STORAGE_KEY + ":" + userId;
}

// Logs saved before sign-in existed belong to the first account that signs in
// on this browser. An account that already has a log keeps it, and the old log
// is left in place rather than discarded.
export function claimLegacyLog(storage, userId) {
  const legacy = storage.getItem(LEGACY_STORAGE_KEY);
  const key = storageKeyFor(userId);
  if (legacy === null || storage.getItem(key) !== null) return false;
  storage.setItem(key, legacy);
  storage.removeItem(LEGACY_STORAGE_KEY);
  return true;
}

// Whether this browser holds a log from before accounts that would move into
// the user's account while it's empty: the one the user has claimed, or else
// the unclaimed one (see claimLegacyLog and importBrowserLog in app.mjs). It
// claims nothing. The first-run screen waits while there is one.
export function hasLegacyLog(storage, userId) {
  const saved = storage.getItem(storageKeyFor(userId)) ?? storage.getItem(LEGACY_STORAGE_KEY);
  if (saved === null) return false;
  try { return normalizeState(JSON.parse(saved)).started; } catch { return false; }
}

// The copy of the log kept on this device, so the page can show it before
// sign-in and the server answer. It has its own keys: under storageKeyFor, a
// cached copy would be imported again into any account that became empty.
export const LOG_CACHE_PREFIX = "baseline.log-cache.v1:";
// Whose copy to show on the next start, before Clerk has said who is signed in.
export const LAST_USER_KEY = "baseline.last-user.v1";

export function logCacheKeyFor(userId) {
  return LOG_CACHE_PREFIX + userId;
}

const validUserId = value => typeof value === "string" && value.length > 0;

// The id of the user whose log is cached here, or null.
export function lastUser(storage) {
  try {
    const userId = storage.getItem(LAST_USER_KEY);
    return validUserId(userId) ? userId : null;
  } catch {
    return null;
  }
}

// The cached copy of a user's log, as { userId, savedAt, log } with the log
// normalized, or null. A value that doesn't parse, or that was saved for
// someone else, counts as no copy.
export function readLogCache(storage, userId) {
  if (!validUserId(userId)) return null;
  let record;
  try { record = JSON.parse(storage.getItem(logCacheKeyFor(userId))); } catch { return null; }
  if (record?.userId !== userId || !Number.isFinite(record.savedAt) || record.savedAt <= 0) return null;
  if (typeof record.log !== "object" || record.log === null || Array.isArray(record.log)) return null;
  return { userId, savedAt: record.savedAt, log: normalizeState(record.log) };
}

function cacheKeys(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(LOG_CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

// Caches a user's log as the server last returned it, with the time it
// arrived, and makes them the user shown on the next start. Only one user's
// log is kept: anyone else's is removed. If the copy can't be written, the
// older one is removed too, so a stale log never outlives a newer save.
export function writeLogCache(storage, userId, log, savedAt = Date.now()) {
  if (!validUserId(userId)) throw new Error("A cached log needs a user id.");
  const key = logCacheKeyFor(userId);
  for (const other of cacheKeys(storage)) if (other !== key) storage.removeItem(other);
  try {
    storage.setItem(key, JSON.stringify({ userId, savedAt, log: normalizeState(log) }));
    storage.setItem(LAST_USER_KEY, userId);
  } catch (error) {
    storage.removeItem(key);
    storage.removeItem(LAST_USER_KEY);
    throw error;
  }
}

// Removes every cached log, the last user and every outbox, so no weights stay
// on the device. Called whenever a log closes, such as on sign-out, so changes
// that haven't synced go too, unless `keepOutbox` says they're the only copy
// left and nobody signed out.
export function clearLogCache(storage, { keepOutbox = false } = {}) {
  for (const key of cacheKeys(storage)) storage.removeItem(key);
  storage.removeItem(LAST_USER_KEY);
  if (!keepOutbox) clearOutbox(storage);
}

// The outbox: changes made on this device that the server doesn't have yet,
// oldest first, as [{ id, change }]. Each is a change the app sends (see
// server/ops.mjs) that can wait (see QUEUEABLE_OPS). It's kept per user, so a
// change made offline survives a reload and is sent as the account that made it.
export const OUTBOX_PREFIX = "baseline.outbox.v1:";

export function outboxKeyFor(userId) {
  return OUTBOX_PREFIX + userId;
}

const validItem = item => typeof item?.id === "string" && item.id.length > 0 && QUEUEABLE_OPS.includes(item.change?.op);

// A user's outbox. Anything that doesn't parse, or was saved for someone else,
// counts as empty, and an item that isn't a change that can wait is skipped.
export function readOutbox(storage, userId) {
  if (!validUserId(userId)) return [];
  let record;
  try { record = JSON.parse(storage.getItem(outboxKeyFor(userId))); } catch { return []; }
  if (record?.userId !== userId || !Array.isArray(record.changes)) return [];
  const ids = new Set();
  return record.changes.filter(item => validItem(item) && !ids.has(item.id) && ids.add(item.id)).map(({ id, change }) => ({ id, change }));
}

// Saves a user's outbox. An empty one removes the key. Throws if storage can't
// be written, so the caller knows the changes live only in the page.
export function writeOutbox(storage, userId, items) {
  if (!validUserId(userId)) throw new Error("An outbox needs a user id.");
  if (!items.length) storage.removeItem(outboxKeyFor(userId));
  else storage.setItem(outboxKeyFor(userId), JSON.stringify({ userId, changes: items.map(({ id, change }) => ({ id, change })) }));
}

export function clearOutbox(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(OUTBOX_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

// The start date of the goal whose note about fast loss the user hid, per user.
export const FAST_LOSS_HIDDEN_PREFIX = "baseline.fast-loss-hidden:";

export function fastLossHiddenKeyFor(userId) {
  return FAST_LOSS_HIDDEN_PREFIX + userId;
}

// Removes everything this device holds of a user's log once they've deleted
// it on the server: the cached copy, the last user and every outbox (see
// clearLogCache), a log saved before sign-in that nobody has claimed or that
// this user claimed, and the hidden note. Without the old browser log, nothing
// on this device can be imported into the emptied account.
export function clearDeviceData(storage, userId) {
  clearLogCache(storage);
  storage.removeItem(LEGACY_STORAGE_KEY);
  if (validUserId(userId)) {
    storage.removeItem(storageKeyFor(userId));
    storage.removeItem(fastLossHiddenKeyFor(userId));
  }
}

// A #log link opened while signed out (see parseLogLink in model.mjs). The
// sign-in page takes over the address, so the link waits in sessionStorage,
// which this tab alone sees and which goes when it closes, and fills in the
// weigh-in once, after sign-in. Signing out removes it.
export const LOG_LINK_KEY = "baseline.log-link.v1";

// Keeps the link, as its hash ("#log?weight=84.9"), until takeLogLink.
export function keepLogLink(storage, hash) {
  storage.setItem(LOG_LINK_KEY, hash);
}

// The link kept, which is removed as it's read, or null.
export function takeLogLink(storage) {
  const hash = storage.getItem(LOG_LINK_KEY);
  if (hash === null) return null;
  storage.removeItem(LOG_LINK_KEY);
  return hash.startsWith("#log") ? hash : null;
}

export function forgetLogLink(storage) {
  storage.removeItem(LOG_LINK_KEY);
}

// The quiet line that suggests installing Baseline. Its "Not now" is kept on
// this device as { count, at }: the first hides the line for
// INSTALL_HINT_PAUSE_DAYS, and the second for good. It says nothing about the
// log, so signing out and deleting data leave it.
export const INSTALL_HINT_KEY = "baseline.install-hint.v1";
export const INSTALL_HINT_PAUSE_DAYS = 30;
const DAY_MS = 86_400_000;

// The record kept, with a value that doesn't parse counting as none. Throws
// if storage can't be read.
function installHintRecord(storage) {
  const text = storage.getItem(INSTALL_HINT_KEY);
  let record = null;
  try { record = JSON.parse(text); } catch { /* Counts as no "Not now". */ }
  const count = Number.isInteger(record?.count) && record.count > 0 ? record.count : 0;
  return { count, at: Number.isFinite(record?.at) ? record.at : 0 };
}

// Whether "Not now" still holds at `now`. A device that can't read the
// choice counts as having made it, so the line can't come back on every visit.
export function installHintHidden(storage, now = Date.now()) {
  let record;
  try { record = installHintRecord(storage); } catch { return true; }
  return record.count >= 2 || record.count === 1 && now < record.at + INSTALL_HINT_PAUSE_DAYS * DAY_MS;
}

// Records a "Not now" made at `now`.
export function dismissInstallHint(storage, now = Date.now()) {
  const { count } = installHintRecord(storage);
  storage.setItem(INSTALL_HINT_KEY, JSON.stringify({ count: Math.min(count + 1, 2), at: now }));
}

// What Settings says before signing out while changes haven't synced, since
// signing out removes them. Null when nothing is waiting.
export function signOutWarning(count) {
  if (!Number.isInteger(count) || count < 1) return null;
  return count === 1 ? "1 change on this device hasn’t synced yet. Signing out deletes it, so it won’t be saved."
    : count + " changes on this device haven’t synced yet. Signing out deletes them, so they won’t be saved.";
}
