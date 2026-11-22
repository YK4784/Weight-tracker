// Weigh-in reminders. Vercel runs api/remind.mjs once an hour, a few minutes
// after the hour. Each run finds the accounts whose reminder hour has come in
// their own time zone and sends a push message to each of their devices,
// unless they have already logged a weigh-in that day.

// Vercel Schedules calls the function with these CloudEvent headers, as the
// @vercel/schedules package's handleSchedule checks them. The schedule trigger
// already makes the function private, so this only turns away anything else.
export function isScheduleRun(request) {
  const headers = request.headers;
  return headers.get("ce-specversion") === "1.0" && headers.get("ce-type") === "com.vercel.schedule.v1beta" && Boolean(headers.get("ce-id"));
}

// A run can be missed, so an account stays due for this many hours after its
// reminder hour, within the same day.
export const CATCH_UP_HOURS = 3;

export const MESSAGE = { title: "Weigh-in reminder", body: "You haven’t logged a weigh-in today." };

// The calendar date, hour and seconds since midnight at `now` in `timeZone`.
export function localTime(now, timeZone) {
  const parts = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  for (const part of format.formatToParts(now)) parts[part.type] = part.value;
  const hour = Number(parts.hour);
  return { date: parts.year + "-" + parts.month + "-" + parts.day, hour, seconds: hour * 3600 + Number(parts.minute) * 60 + Number(parts.second) };
}

// Which of `accounts` ({ userId, hour, timeZone, remindedOn }) are due a
// reminder at `now`: it is their hour or up to CATCH_UP_HOURS − 1 later, on a
// local day they haven't had one. `day` is that local date, and `ttl` is the
// seconds left until local midnight, after which the message is out of date.
export function dueReminders(accounts, now) {
  const due = [];
  for (const account of accounts) {
    let local;
    try { local = localTime(now, account.timeZone); } catch { continue; }
    const late = local.hour - account.hour;
    if (late < 0 || late >= CATCH_UP_HOURS || account.remindedOn === local.date) continue;
    due.push({ userId: account.userId, day: local.date, ttl: 86_400 - local.seconds });
  }
  return due;
}

// One run: claims the accounts that are due (see store.claimReminders), sends
// to their devices with `send` (see createPusher in push.mjs) and forgets
// devices whose subscription has ended. Returns counts for the log, without
// any account or device details.
export async function sendReminders({ store, send, now = new Date() }) {
  const due = dueReminders(await store.reminderAccounts(), now);
  const summary = { due: due.length, sent: 0, gone: 0, failed: 0 };
  if (!due.length) return summary;
  const devices = await store.claimReminders(due);
  const ttl = new Map(due.map(item => [item.userId, item.ttl]));
  // One topic, so a push service holding an undelivered reminder replaces it.
  const results = await Promise.allSettled(devices.map(device => send(device, MESSAGE, { ttl: ttl.get(device.userId), topic: "weigh-in" })));
  const gone = [];
  results.forEach((result, index) => {
    const status = result.status === "fulfilled" ? result.value : null;
    if (status >= 200 && status < 300) summary.sent++;
    else if (status === 404 || status === 410) gone.push(devices[index].endpoint);
    else {
      summary.failed++;
      console.error("A reminder couldn't be sent:", status ?? result.reason?.message);
    }
  });
  summary.gone = gone.length;
  if (gone.length) await store.removeDevices(gone);
  return summary;
}
