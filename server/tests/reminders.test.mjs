import assert from "node:assert/strict";
import test from "node:test";
import { CATCH_UP_HOURS, MESSAGE, dueReminders, isScheduleRun, localTime, sendReminders } from "../reminders.mjs";

const at = iso => new Date(iso);
const account = (hour, timeZone, remindedOn = null, userId = "user_1") => ({ userId, hour, timeZone, remindedOn });

test("local time follows each time zone, with daylight saving and half hours", () => {
  assert.deepEqual(localTime(at("2026-11-22T07:30:00Z"), "Europe/London"), { date: "2026-11-22", hour: 7, seconds: 7.5 * 3600 });
  assert.deepEqual(localTime(at("2026-07-01T07:30:00Z"), "Europe/London").hour, 8, "British Summer Time");
  assert.deepEqual(localTime(at("2026-11-22T03:10:00Z"), "America/New_York"), { date: "2026-11-21", hour: 22, seconds: 22 * 3600 + 600 });
  assert.deepEqual(localTime(at("2026-11-22T03:00:00Z"), "Asia/Kolkata"), { date: "2026-11-22", hour: 8, seconds: 8.5 * 3600 });
  assert.equal(localTime(at("2026-11-22T00:00:00Z"), "UTC").hour, 0, "midnight is hour 0, not 24");
});

test("an account is due at its reminder hour and for a while after, once a day", () => {
  const due = (hour, now, remindedOn) => dueReminders([account(hour, "Europe/London", remindedOn)], at(now));
  assert.deepEqual(due(8, "2026-11-22T08:05:00Z"), [{ userId: "user_1", day: "2026-11-22", ttl: 86_400 - (8 * 3600 + 300) }]);
  assert.equal(due(8, "2026-11-22T07:59:00Z").length, 0, "not before");
  assert.equal(due(8, "2026-11-22T10:10:00Z").length, 1, "a missed run is caught up");
  assert.equal(due(8, "2026-11-22T" + String(8 + CATCH_UP_HOURS).padStart(2, "0") + ":00:00Z").length, 0, "but not all day");
  assert.equal(due(8, "2026-11-22T08:05:00Z", "2026-11-22").length, 0, "already reminded today");
  assert.equal(due(8, "2026-11-22T08:05:00Z", "2026-11-21").length, 1, "reminded yesterday");
  assert.equal(due(23, "2026-11-23T00:30:00Z").length, 0, "a late reminder never spills into the next day");
});

test("each account is due by its own clock, and a bad time zone is skipped", () => {
  const now = at("2026-11-22T13:15:00Z");
  const accounts = [account(8, "America/New_York", null, "a"), account(13, "Europe/London", null, "b"), account(18, "Asia/Kolkata", null, "c"), account(8, "Not/AZone", null, "d")];
  assert.deepEqual(dueReminders(accounts, now).map(item => [item.userId, item.day]), [["a", "2026-11-22"], ["b", "2026-11-22"], ["c", "2026-11-22"]]);
  // 2 a.m. doesn't happen in New York on 8 March 2026; 3 a.m. still counts.
  assert.equal(dueReminders([account(2, "America/New_York")], at("2026-03-08T07:05:00Z")).length, 1);
});

test("only Vercel's schedule runs are accepted", () => {
  const request = headers => new Request("https://baseline.test/api/remind", { method: "POST", headers });
  const run = { "ce-specversion": "1.0", "ce-type": "com.vercel.schedule.v1beta", "ce-id": "run_1" };
  assert.equal(isScheduleRun(request(run)), true);
  assert.equal(isScheduleRun(request({ ...run, "ce-type": "com.example" })), false);
  assert.equal(isScheduleRun(request({ "ce-specversion": "1.0", "ce-type": "com.vercel.schedule.v1beta" })), false);
  assert.equal(isScheduleRun(request({})), false);
});

function fakeStore(accounts, devices) {
  const calls = { claimed: null, removed: null };
  return {
    calls,
    reminderAccounts: async () => accounts,
    claimReminders: async due => { calls.claimed = due; return devices.filter(device => due.some(item => item.userId === device.userId)); },
    removeDevices: async endpoints => { calls.removed = endpoints; }
  };
}

test("a run sends to each device of the accounts it claims, and forgets ended subscriptions", async () => {
  const devices = [
    { userId: "a", endpoint: "https://fcm.googleapis.com/1" }, { userId: "a", endpoint: "https://web.push.apple.com/2" },
    { userId: "b", endpoint: "https://fcm.googleapis.com/3" }, { userId: "b", endpoint: "https://fcm.googleapis.com/4" }
  ];
  const store = fakeStore([account(8, "UTC", null, "a"), account(8, "UTC", null, "b"), account(9, "UTC", null, "c")], devices);
  const sent = [];
  const replies = { 1: 201, 2: 410, 3: 404, 4: 500 };
  const original = console.error;
  console.error = () => {};
  let summary;
  try {
    summary = await sendReminders({ store, now: at("2026-11-22T08:10:00Z"), send: async (device, message, options) => {
      sent.push([device.endpoint, message, options]);
      return replies[device.endpoint.at(-1)];
    } });
  } finally {
    console.error = original;
  }
  assert.deepEqual(store.calls.claimed.map(item => item.userId), ["a", "b"], "c isn't due until 9");
  assert.deepEqual(sent[0], ["https://fcm.googleapis.com/1", MESSAGE, { ttl: 16 * 3600 - 600, topic: "weigh-in" }]);
  assert.deepEqual(summary, { due: 2, sent: 1, gone: 2, failed: 1 });
  assert.deepEqual(store.calls.removed, ["https://web.push.apple.com/2", "https://fcm.googleapis.com/3"]);
});

test("a run with nobody due claims nothing, and a send that throws counts as failed", async () => {
  const quiet = fakeStore([account(8, "UTC")], []);
  assert.deepEqual(await sendReminders({ store: quiet, now: at("2026-11-22T05:00:00Z"), send: async () => 201 }), { due: 0, sent: 0, gone: 0, failed: 0 });
  assert.equal(quiet.calls.claimed, null);
  const store = fakeStore([account(8, "UTC")], [{ userId: "user_1", endpoint: "https://fcm.googleapis.com/1" }]);
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await sendReminders({ store, now: at("2026-11-22T08:00:00Z"), send: async () => { throw new Error("timed out"); } }), { due: 1, sent: 0, gone: 0, failed: 1 });
  } finally {
    console.error = original;
  }
  assert.equal(store.calls.removed, null);
});
