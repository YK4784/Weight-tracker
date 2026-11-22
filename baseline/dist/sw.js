// Baseline's service worker. It only shows weigh-in reminders (see
// server/reminders.mjs). It has no fetch handler, so every page and file
// still comes straight from the network.
const FALLBACK = { title: "Weigh-in reminder", body: "You haven’t logged a weigh-in today." };

// A new version takes over at once; there is no cache to hand over.
self.addEventListener("install", () => self.skipWaiting());

// Browsers expect every push to show a notification. One tag, so a reminder
// replaces an earlier one instead of stacking up.
self.addEventListener("push", event => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* Not JSON: show the usual text. */ }
  event.waitUntil(self.registration.showNotification(message.title || FALLBACK.title, {
    body: message.body || FALLBACK.body,
    tag: "weigh-in",
    icon: "icons/icon-192.png"
  }));
});

// Brings an open Baseline window forward, or opens one at the weigh-in form.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(client => client.url.startsWith(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow(new URL("./#overview", self.registration.scope).href);
  })());
});
