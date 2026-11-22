// Account helpers that don't touch the DOM, so Node can test them.
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
