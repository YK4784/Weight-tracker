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

// The question to ask before signing out while changes haven't synced, since
// signing out removes them. Null when nothing is waiting.
export function signOutWarning(count) {
  if (!Number.isInteger(count) || count < 1) return null;
  return (count === 1 ? "1 change on this device hasn’t" : count + " changes on this device haven’t") + " synced yet. Sign out anyway?";
}
