// Baseline's service worker. It keeps a copy of Baseline's own files, so the
// app opens without a connection, and it shows weigh-in reminders (see
// server/reminders.mjs), which open today's weigh-in when tapped.
//
// Files come from the network first, so the next load with a connection gets
// a new deploy, and every answer from the network replaces the copy. The copy
// is used when the network fails, answers with an error or takes longer than
// NETWORK_TIMEOUT. Requests to /api/, to other sites (Clerk) and anything but
// GET never go near the cache: the worker leaves them to the browser. The copy
// of the log shown offline is the one in localStorage (see account.mjs), not
// this cache.

// Bump the version when SHELL gains, loses or renames a file, or when the way
// files are stored changes. The new worker then fills a new cache and deletes
// this one. Edits to a listed file need no bump, since each load with a
// connection stores the new copy.
const CACHE = "baseline-shell-v5";

// Every file the app needs to open, relative to this worker. npm test checks
// that each file in baseline/dist/ is listed here or deliberately left out.
const SHELL = [
  "./",
  "index.html",
  "health-data-privacy.html",
  "styles.css",
  "app.mjs",
  "model.mjs",
  "chart.mjs",
  "account.mjs",
  "export.mjs",
  "importers.mjs",
  "import-worker.mjs",
  "auth.mjs",
  "config.mjs",
  "icons.svg",
  "mark.svg",
  "fonts/funnel-sans-latin.woff2",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

// How long the network has before the copy is used, in ms. A weak signal often
// answers slowly rather than not at all.
const NETWORK_TIMEOUT = 3000;

const FALLBACK = { title: "Weigh-in reminder", body: "You haven’t logged a weigh-in today." };

const shellUrls = new Set(SHELL.map(path => new URL(path, self.location).href));
const pageUrls = ["./", "index.html"].map(path => new URL(path, self.location).href);

// Pages that opened from the copy, by client id. Their files come from the copy
// too, so an older page never runs with newer modules from a deploy that
// arrived while it loaded.
const pagesFromCache = new Set();

// Fills the cache file by file, so one that fails doesn't stop the rest; the
// next load with a connection fills any gap. A new version takes over at once.
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(SHELL.map(path => cache.add(new Request(path, { cache: "no-cache" }))))));
});

// Deletes the caches of earlier versions, and starts handling open pages.
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

// The cache keys to try for a request, first the one an answer is stored
// under, or null to leave the request to the browser. A navigation to the page
// counts whatever its query string, and falls back to either copy of it.
function keysFor(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return null;
  url.hash = "";
  if (request.mode === "navigate") {
    url.search = "";
    if (pageUrls.includes(url.href)) return [url.href, ...pageUrls.filter(page => page !== url.href)];
  }
  return shellUrls.has(url.href) ? [url.href] : null;
}

async function fromCache(keys) {
  const cache = await caches.open(CACHE);
  for (const key of keys) {
    const copy = await cache.match(key, { ignoreVary: true });
    if (copy) return copy;
  }
  return null;
}

// Stores a whole, direct answer. It's copied before the page reads it.
async function store(key, response) {
  if (response.status !== 200 || response.redirected || response.type !== "basic") return;
  const copy = response.clone();
  const cache = await caches.open(CACHE);
  await cache.put(key, copy);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

self.addEventListener("fetch", event => {
  const request = event.request;
  const keys = keysFor(request);
  if (!keys) return;
  const navigation = request.mode === "navigate";
  const network = fetch(request);
  // Every answer replaces the copy, even one that arrives after the copy was used.
  event.waitUntil(network.then(response => store(keys[0], response)).catch(() => {}));
  const useCopy = async () => {
    const copy = await fromCache(keys);
    if (copy && navigation && event.resultingClientId) pagesFromCache.add(event.resultingClientId);
    return copy;
  };
  event.respondWith((async () => {
    if (!navigation && pagesFromCache.has(event.clientId)) {
      const copy = await fromCache(keys);
      if (copy) return copy;
    }
    let answer;
    try { answer = await Promise.race([network, delay(NETWORK_TIMEOUT)]); } catch { /* Offline: use the copy. */ }
    // A slow network, a failure or an error page, such as a Wi-Fi sign-in
    // page's redirect, all fall back to the copy.
    if (answer?.ok) return answer;
    const copy = await useCopy();
    if (copy) return copy;
    if (answer) return answer;
    try { return await network; } catch { return Response.error(); }
  })());
});

// Browsers expect every push to show a notification. One tag, so a reminder
// replaces an earlier one instead of stacking up. A reminder is sent only on a
// day without a weigh-in, so it also marks the app's icon with a badge, where
// the platform has them: installed on an iPhone or iPad (iOS 16.4 and later)
// and on desktop Chrome and Edge, but not Chrome on Android. The app clears it
// once the server has a weigh-in for today (see clearBadge in app.mjs).
self.addEventListener("push", event => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* Not JSON: show the usual text. */ }
  event.waitUntil(self.registration.showNotification(message.title || FALLBACK.title, {
    body: message.body || FALLBACK.body,
    tag: "weigh-in",
    icon: "icons/icon-192.png"
  }).then(setBadge));
});

// A platform without badges, or one that turns this one down, leaves the
// reminder as it is.
async function setBadge() {
  try { await self.navigator?.setAppBadge?.(1); } catch { /* No badge, and nothing else changes. */ }
}

// The page a window shows, without its query string or hash.
function pageOf(href) {
  const url = new URL(href);
  url.search = url.hash = "";
  return url.href;
}

// A tapped reminder opens today's weigh-in: the log sheet on a phone, or the
// log form on a wider screen. A window already showing Baseline is asked to
// open it (see the "open-log" message in app.mjs) and brought forward.
// Otherwise a new window opens at ./#log, which app.mjs follows once the log
// is on the page. A window on the privacy policy has no app to ask, so it's
// left as it is.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(client => pageUrls.includes(pageOf(client.url)));
    if (open) {
      open.postMessage({ type: "open-log" });
      return open.focus();
    }
    return self.clients.openWindow(new URL("./#log", self.registration.scope).href);
  })());
});
