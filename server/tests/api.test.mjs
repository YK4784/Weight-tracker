import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../api.mjs";
import { MAX_IMPORT_ENTRIES, latestDate, parseOp } from "../ops.mjs";

const NOW = new Date("2026-11-22T23:30:00Z");

function setup({ store } = {}) {
  const calls = [];
  const handle = createHandler({
    verifyUser: async request => request.headers.get("authorization") === "Bearer good" ? "user_1" : null,
    getStore: () => store ?? { run: async (userId, change) => { calls.push([userId, change]); return { log: { started: true, height: null, entries: [] } }; } },
    now: () => NOW
  });
  const send = (method, body, token = "good") => handle(new Request("https://baseline.test/api/log", {
    method,
    headers: { ...(token && { Authorization: "Bearer " + token }), "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  }));
  return { calls, send };
}

test("requests without a valid session token are refused before touching the database", async () => {
  const { calls, send } = setup();
  assert.equal((await send("GET", undefined, null)).status, 401);
  assert.equal((await send("POST", { op: "start" }, "forged")).status, 401);
  assert.equal(calls.length, 0);
});

test("GET reads the signed-in user's log and POST applies a cleaned change", async () => {
  const { calls, send } = setup();
  const read = await send("GET");
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "no-store");
  assert.deepEqual(await read.json(), { log: { started: true, height: null, entries: [] } });
  assert.equal((await send("POST", { op: "save-weight", date: "2026-11-22", weight: 80.044, extra: "ignored" })).status, 200);
  assert.deepEqual(calls, [["user_1", null], ["user_1", { op: "save-weight", date: "2026-11-22", weight: 80.04 }]]);
});

test("bad methods, bodies and changes are rejected", async () => {
  const { calls, send } = setup();
  assert.equal((await send("DELETE")).status, 405);
  assert.equal((await send("POST", "{not json")).status, 400);
  assert.equal((await send("POST", { op: "drop-table" })).status, 400);
  assert.equal((await send("POST", { op: "save-weight", date: "2026-11-22", weight: "80" })).status, 400);
  assert.equal(calls.length, 0);
});

test("database failures become a 500 without leaking details", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { send } = setup({ store: { run: async () => { throw new Error("password authentication failed for user neondb_owner"); } } });
    const response = await send("GET");
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /password|neondb/);
  } finally {
    console.error = original;
  }
});

test("weights and heights must be in range, and weights are kept to 0.01 kg and heights to 0.1 cm", () => {
  assert.deepEqual(parseOp({ op: "save-weight", date: "2026-11-01", weight: 0.1 }, NOW), { op: "save-weight", date: "2026-11-01", weight: 0.1 });
  assert.deepEqual(parseOp({ op: "update-weight", date: "2026-11-01", weight: 2000 }, NOW), { op: "update-weight", date: "2026-11-01", weight: 2000 });
  assert.equal(parseOp({ op: "save-weight", date: "2026-11-01", weight: 150 * 0.45359237 }, NOW).weight, 68.04, "150.0 lb");
  for (const weight of [0, 0.09, -1, 2000.1, NaN, Infinity, null, "80"]) {
    assert.equal(parseOp({ op: "save-weight", date: "2026-11-01", weight }, NOW), null, String(weight));
  }
  assert.deepEqual(parseOp({ op: "set-height", height: 178.26 }, NOW), { op: "set-height", height: 178.3 });
  assert.equal(parseOp({ op: "set-height", height: 400.1 }, NOW), null);
  assert.equal(parseOp({ op: "set-height" }, NOW), null);
});

test("dates must be real calendar dates no later than tomorrow in UTC", () => {
  assert.equal(latestDate(NOW), "2026-11-23");
  assert.ok(parseOp({ op: "save-weight", date: "2026-11-23", weight: 80 }, NOW), "a UTC+14 user's today");
  assert.equal(parseOp({ op: "save-weight", date: "2026-11-24", weight: 80 }, NOW), null);
  for (const date of ["2026-02-30", "2026-1-01", "", undefined, "2026-11-01T00:00"]) {
    assert.equal(parseOp({ op: "save-weight", date, weight: 80 }, NOW), null, String(date));
  }
  assert.deepEqual(parseOp({ op: "delete-weight", date: "2026-11-01" }, NOW), { op: "delete-weight", date: "2026-11-01" });
  assert.equal(parseOp({ op: "delete-weight", date: "nope" }, NOW), null);
});

test("imports are normalized like the app's own log", () => {
  const change = parseOp({ op: "import", log: { started: false, height: 180, entries: [
    { date: "2026-11-02", weight: 80.04 }, { date: "2026-11-01", weight: 81 }, { date: "2026-11-02", weight: 79.964 },
    { date: "2026-11-30", weight: 80 }, { date: "bad", weight: 80 }, { date: "2026-11-03", weight: -5 }
  ] } }, NOW);
  assert.deepEqual(change, { op: "import", height: 180, entries: [{ date: "2026-11-01", weight: 81, note: null }, { date: "2026-11-02", weight: 79.96, note: null }] });
  assert.deepEqual(parseOp({ op: "import", log: { started: true } }, NOW), { op: "import", height: null, entries: [] });
  assert.equal(parseOp({ op: "import" }, NOW), null);
  assert.equal(parseOp({ op: "import", log: { entries: "lots" } }, NOW), null);
  assert.equal(parseOp({ op: "import", log: { entries: new Array(MAX_IMPORT_ENTRIES + 1).fill({ date: "2026-11-01", weight: 80 }) } }, NOW), null);
});

test("a weigh-in's note is kept when left out, removed when empty and cleaned when given", () => {
  const weighIn = { date: "2026-11-01", weight: 80 };
  for (const op of ["save-weight", "update-weight"]) {
    assert.equal("note" in parseOp({ op, ...weighIn }, NOW), false, op + " without a note");
    assert.equal(parseOp({ op, ...weighIn, note: null }, NOW).note, null);
    assert.equal(parseOp({ op, ...weighIn, note: " \n " }, NOW).note, null);
    assert.equal(parseOp({ op, ...weighIn, note: "  after\n\ntravel " }, NOW).note, "after travel");
    assert.equal(parseOp({ op, ...weighIn, note: "🙂".repeat(100) }, NOW).note, "🙂".repeat(100), "100 characters, each emoji counted once");
    assert.equal(parseOp({ op, ...weighIn, note: "a".repeat(101) }, NOW), null, "too long");
    assert.equal(parseOp({ op, ...weighIn, note: "a".repeat(100) + "   " }, NOW).note.length, 100, "trimmed before counting");
    for (const note of [5, true, {}, ["a"]]) assert.equal(parseOp({ op, ...weighIn, note }, NOW), null, JSON.stringify(note));
  }
});

test("imports carry notes", () => {
  const change = parseOp({ op: "import", log: { entries: [{ date: "2026-11-01", weight: 81, note: " after travel " }] } }, NOW);
  assert.deepEqual(change.entries, [{ date: "2026-11-01", weight: 81, note: "after travel" }]);
});

test("units must be one of the known weight and height units", () => {
  assert.deepEqual(parseOp({ op: "set-units", units: { weight: "st", height: "ft", extra: 1 } }, NOW), { op: "set-units", units: { weight: "st", height: "ft" } });
  for (const weight of ["kg", "lb", "st"]) assert.equal(parseOp({ op: "set-units", units: { weight, height: "cm" } }, NOW).units.weight, weight);
  for (const units of [{ weight: "stone", height: "cm" }, { weight: "lb", height: "in" }, { weight: "lb" }, { height: "cm" }, "lb", null, undefined]) {
    assert.equal(parseOp({ op: "set-units", units }, NOW), null, JSON.stringify(units));
  }
});

const GOAL = { weight: 60, startDate: "2026-09-13", startWeight: 66, rate: 0.5, milestones: 10 };

test("goals are checked and rounded like weights, with the rate to 0.001 kg a week", () => {
  assert.deepEqual(parseOp({ op: "set-goal", goal: { weight: 60.044, startDate: "2026-11-23", startWeight: 66.056, rate: 0.4536, milestones: 20, extra: 1 } }, NOW),
    { op: "set-goal", goal: { weight: 60.04, startDate: "2026-11-23", startWeight: 66.06, rate: 0.454, milestones: 20 } });
  assert.equal(parseOp({ op: "set-goal", goal: { ...GOAL, rate: 0.001 } }, NOW).goal.rate, 0.001);
  assert.deepEqual(parseOp({ op: "set-goal", goal: { ...GOAL, rate: null } }, NOW).goal.rate, null);
  assert.deepEqual(parseOp({ op: "set-goal", goal: { ...GOAL, rate: undefined } }, NOW).goal.rate, null);
  assert.deepEqual(parseOp({ op: "set-goal", goal: { ...GOAL, milestones: 1, rate: 5 } }, NOW).goal, { ...GOAL, milestones: 1, rate: 5 });
  assert.deepEqual(parseOp({ op: "clear-goal", goal: GOAL }, NOW), { op: "clear-goal" });
});

test("goals with a bad field are rejected", () => {
  const bad = [
    { weight: 0 }, { weight: "60" }, { startWeight: 2000.1 }, { startWeight: null },
    { startDate: "2026-11-24" }, { startDate: "2026-02-30" }, { startDate: undefined },
    { rate: 0 }, { rate: 0.0009 }, { rate: 5.01 }, { rate: "0.5" }, { rate: -0.5 },
    { milestones: 0 }, { milestones: 21 }, { milestones: 2.5 }, { milestones: "10" }, { milestones: undefined }
  ];
  for (const change of bad) assert.equal(parseOp({ op: "set-goal", goal: { ...GOAL, ...change } }, NOW), null, JSON.stringify(change));
  assert.equal(parseOp({ op: "set-goal" }, NOW), null);
  assert.equal(parseOp({ op: "set-goal", goal: "60" }, NOW), null);
});

const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  expirationTime: null,
  keys: { p256dh: Buffer.from([4, ...new Array(64).fill(7)]).toString("base64url"), auth: Buffer.alloc(16, 9).toString("base64url") }
};

test("a reminder is a whole hour in a real time zone, and can bring this device's subscription", () => {
  assert.deepEqual(parseOp({ op: "set-reminder", hour: 8, timeZone: "Europe/London", extra: 1 }, NOW), { op: "set-reminder", hour: 8, timeZone: "Europe/London" });
  assert.deepEqual(parseOp({ op: "set-reminder", hour: 0, timeZone: "UTC", subscription: SUBSCRIPTION }, NOW), {
    op: "set-reminder", hour: 0, timeZone: "UTC",
    subscription: { endpoint: SUBSCRIPTION.endpoint, p256dh: SUBSCRIPTION.keys.p256dh, auth: SUBSCRIPTION.keys.auth }
  });
  for (const change of [{ hour: 24 }, { hour: -1 }, { hour: 8.5 }, { hour: "8" }, { hour: undefined }, { timeZone: "Mars/Olympus" }, { timeZone: "" }, { timeZone: 0 }]) {
    assert.equal(parseOp({ op: "set-reminder", hour: 8, timeZone: "Europe/London", ...change }, NOW), null, JSON.stringify(change));
  }
  for (const subscription of [{ ...SUBSCRIPTION, endpoint: "https://example.com/collect" }, { ...SUBSCRIPTION, keys: {} }, null, "sub"]) {
    assert.equal(parseOp({ op: "set-reminder", hour: 8, timeZone: "UTC", subscription }, NOW), null, JSON.stringify(subscription)?.slice(0, 60));
  }
  assert.deepEqual(parseOp({ op: "clear-reminder", hour: 8 }, NOW), { op: "clear-reminder" });
});

test("a waist is a date, a waist in cm kept to 0.01 cm, and the sex whose formula applies", () => {
  assert.deepEqual(parseOp({ op: "save-waist", date: "2026-11-22", waist: 34.1 * 2.54, sex: "female", extra: 1 }, NOW), { op: "save-waist", date: "2026-11-22", waist: 86.61, sex: "female" });
  assert.equal(parseOp({ op: "save-waist", date: "2026-11-23", waist: 10, sex: "male" }, NOW).waist, 10, "a UTC+14 user's today, and the smallest waist");
  assert.equal(parseOp({ op: "save-waist", date: "2026-11-01", waist: 400, sex: "male" }, NOW).waist, 400);
  const bad = [{ waist: 9.99 }, { waist: 400.01 }, { waist: "86" }, { waist: null }, { waist: NaN }, { sex: "other" }, { sex: undefined },
    { date: "2026-11-24" }, { date: "2026-02-30" }, { date: undefined }];
  for (const change of bad) {
    assert.equal(parseOp({ op: "save-waist", date: "2026-11-01", waist: 86, sex: "male", ...change }, NOW), null, JSON.stringify(change));
  }
  assert.deepEqual(parseOp({ op: "delete-waist", date: "2026-11-01", waist: 86 }, NOW), { op: "delete-waist", date: "2026-11-01" });
  assert.equal(parseOp({ op: "delete-waist", date: "nope" }, NOW), null);
});
