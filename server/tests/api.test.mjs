import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../api.mjs";
import { readFile } from "node:fs/promises";
import { CONSENT_ERROR_CODE, ConsentRequired, DELETE_WORD, MAX_IMPORT_ENTRIES, OPS_WITHOUT_CONSENT, latestDate, needsConsent, parseOp } from "../ops.mjs";
import { schema } from "../schema.mjs";
import { createStore } from "../store.mjs";
import { SetupError, describeError, logError, requestId } from "../log.mjs";
import { CONSENT_VERSION } from "../../baseline/dist/model.mjs";

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

test("preferences accept only known keys with the right types", () => {
  assert.deepEqual(parseOp({ op: "set-preferences", preferences: { showBmi: false } }, NOW), { op: "set-preferences", preferences: { showBmi: false } });
  assert.deepEqual(parseOp({ op: "set-preferences", preferences: { showBmi: true, showBodyFat: false }, extra: 1 }, NOW),
    { op: "set-preferences", preferences: { showBmi: true, showBodyFat: false } });
  // An unknown key turns down the whole change, rather than saving the rest.
  for (const preferences of [{ showBmi: false, showWeight: false }, { hideNumbers: true }, { constructor: true }, JSON.parse('{"__proto__": {"showBmi": false}}')]) {
    assert.equal(parseOp({ op: "set-preferences", preferences }, NOW), null, JSON.stringify(preferences));
  }
  // So does a value of the wrong type.
  for (const value of ["false", 0, 1, null, [], {}]) {
    assert.equal(parseOp({ op: "set-preferences", preferences: { showBmi: value } }, NOW), null, JSON.stringify(value));
  }
  // And a change with nothing in it.
  for (const preferences of [undefined, null, {}, [], [["showBmi", false]], "showBmi", true]) {
    assert.equal(parseOp({ op: "set-preferences", preferences }, NOW), null, JSON.stringify(preferences));
  }
});

test("the API passes cleaned preferences to the store as the signed-in user", async () => {
  const { calls, send } = setup();
  assert.equal((await send("POST", { op: "set-preferences", preferences: { showBodyFat: false }, userId: "user_2" })).status, 200);
  assert.equal((await send("POST", { op: "set-preferences", preferences: { showBodyFat: "no" } })).status, 400);
  assert.equal((await send("POST", { op: "set-preferences", preferences: { showBmi: false, theme: "dark" } })).status, 400);
  assert.equal((await send("POST", { op: "set-preferences", preferences: { showBmi: false } }, null)).status, 401);
  assert.deepEqual(calls, [["user_1", { op: "set-preferences", preferences: { showBodyFat: false } }]]);
});

test("the preferences column is added to existing databases with an empty object", () => {
  const statement = schema.find(text => /preferences/.test(text));
  assert.match(statement, /ALTER TABLE profiles\s+ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
});

const GOAL = { weight: 60, startDate: "2026-09-13", startWeight: 66, rate: 0.5, milestones: 10 };

test("goals are checked and rounded like weights, with the rate to 0.001 kg a week", () => {
  assert.deepEqual(parseOp({ op: "set-goal", goal: { weight: 60.044, startDate: "2026-11-23", startWeight: 66.056, rate: 0.4536, milestones: 20, extra: 1 } }, NOW),
    { op: "set-goal", goal: { weight: 60.04, startDate: "2026-11-23", startWeight: 66.06, rate: 0.454, milestones: 20 } });
  assert.equal(parseOp({ op: "set-goal", goal: { ...GOAL, rate: 0.001 } }, NOW).goal.rate, 0.001);
  assert.deepEqual(parseOp({ op: "set-goal", goal: { ...GOAL, rate: null } }, NOW).goal.rate, null);
  assert.deepEqual(parseOp({ op: "set-goal", goal: { ...GOAL, rate: undefined } }, NOW).goal.rate, null);
  assert.deepEqual(parseOp({ op: "set-goal", goal: { ...GOAL, milestones: 1, rate: 0.99 } }, NOW).goal, { ...GOAL, milestones: 1, rate: 0.99 });
  assert.deepEqual(parseOp({ op: "clear-goal", goal: GOAL }, NOW), { op: "clear-goal" });
});

test("goals with a bad field are rejected", () => {
  const bad = [
    { weight: 0 }, { weight: "60" }, { startWeight: 2000.1 }, { startWeight: null },
    { startDate: "2026-11-24" }, { startDate: "2026-02-30" }, { startDate: undefined },
    { rate: 0 }, { rate: 0.0009 }, { rate: 5 }, { rate: 5.01 }, { rate: "0.5" }, { rate: -0.5 },
    { milestones: 0 }, { milestones: 21 }, { milestones: 2.5 }, { milestones: "10" }, { milestones: undefined }
  ];
  for (const change of bad) assert.equal(parseOp({ op: "set-goal", goal: { ...GOAL, ...change } }, NOW), null, JSON.stringify(change));
  assert.equal(parseOp({ op: "set-goal" }, NOW), null);
  assert.equal(parseOp({ op: "set-goal", goal: "60" }, NOW), null);
});

test("a goal's target rate is no faster than 1.5 kg a week or 1.5% of the start weight", () => {
  const rateFor = (startWeight, rate) => parseOp({ op: "set-goal", goal: { ...GOAL, weight: startWeight - 10, startWeight, rate } }, NOW)?.goal.rate ?? null;
  assert.equal(rateFor(60, 0.9), 0.9, "the cap for 60 kg");
  assert.equal(rateFor(60, 0.901), 0.901, "0.001 kg of slack");
  assert.equal(rateFor(60, 0.902), null);
  assert.equal(rateFor(60, 1), null);
  assert.equal(rateFor(100, 1.5), 1.5);
  assert.equal(rateFor(100, 1.502), null);
  assert.equal(rateFor(150, 1.5), 1.5, "never more than 1.5 kg");
  assert.equal(rateFor(150, 1.51), null);
  assert.equal(rateFor(150, 3), null, "a rate saved before the cap can't be saved again");
});

test("a target rate typed in pounds next to the cap counts as the cap", () => {
  const rateFor = (startWeight, pounds) => parseOp({ op: "set-goal", goal: { ...GOAL, weight: startWeight - 10, startWeight, rate: pounds * 0.45359237 } }, NOW)?.goal.rate ?? null;
  assert.equal(rateFor(100, 3.31), 1.501, "3.31 lb is the nearest 0.01 lb to 1.5 kg");
  assert.equal(rateFor(100, 3.32), null);
  assert.equal(rateFor(80, 2.64), 1.197);
  assert.equal(rateFor(80, 2.65), null, "2.65 lb is 1.202 kg, past the cap of 1.2 kg");
  // The cap uses the start weight as stored. 66.0349 kg would allow 0.991 kg a
  // week, but it is stored as 66.03 kg, which allows 0.990 kg.
  assert.equal(parseOp({ op: "set-goal", goal: { ...GOAL, startWeight: 66.0349, rate: 0.991 } }, NOW).goal.rate, 0.991, "0.990 kg and its slack");
  assert.equal(parseOp({ op: "set-goal", goal: { ...GOAL, startWeight: 66.0349, rate: 0.992 } }, NOW), null);
});

test("the API answers a goal past the cap with a 400 and saves one at the cap", async () => {
  const { calls, send } = setup();
  assert.equal((await send("POST", { op: "set-goal", goal: { ...GOAL, rate: 1.2 } })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send("POST", { op: "set-goal", goal: { ...GOAL, rate: 0.99 } })).status, 200);
  assert.deepEqual(calls, [["user_1", { op: "set-goal", goal: { ...GOAL, rate: 0.99 } }]]);
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

test("deleting data or the account needs the confirm word, and nothing else", () => {
  assert.equal(DELETE_WORD, "delete");
  for (const op of ["delete-data", "delete-account"]) {
    assert.deepEqual(parseOp({ op, confirm: "delete" }, NOW), { op }, op);
    assert.deepEqual(parseOp({ op, confirm: "delete", userId: "user_2", extra: 1 }, NOW), { op }, "extra fields are dropped");
    for (const confirm of [undefined, null, "", "Delete", "DELETE", " delete", "delete ", "yes", true, 1, ["delete"], { delete: true }]) {
      assert.equal(parseOp({ op, confirm }, NOW), null, op + " " + JSON.stringify(confirm));
    }
    assert.equal(parseOp({ op }, NOW), null, op + " without confirm");
  }
});

test("the API passes a confirmed deletion to the store as the signed-in user, and refuses an unconfirmed one", async () => {
  const { calls, send } = setup();
  assert.equal((await send("POST", { op: "delete-data" })).status, 400);
  assert.equal((await send("POST", { op: "delete-account", confirm: "yes" })).status, 400);
  assert.equal((await send("POST", { op: "delete-data", confirm: "delete" }, null)).status, 401);
  assert.equal(calls.length, 0);
  const reply = await send("POST", { op: "delete-data", confirm: "delete", userId: "user_2" });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("cache-control"), "no-store");
  assert.equal((await send("POST", { op: "delete-account", confirm: "delete" })).status, 200);
  assert.deepEqual(calls, [["user_1", { op: "delete-data" }], ["user_1", { op: "delete-account" }]]);
});

test("deleting an account reaches every table", async () => {
  const store = await readFile(new URL("../store.mjs", import.meta.url), "utf8");
  const tables = schema.flatMap(text => [.../CREATE TABLE IF NOT EXISTS (\w+)/g.exec(text)?.slice(1) ?? []]);
  assert.deepEqual(tables.sort(), ["profiles", "push_subscriptions", "waist_measurements", "weigh_ins"]);
  const deleteRows = /const deleteRows = userId => \[([^\]]*)\]/.exec(store)[1];
  for (const table of tables) assert.match(deleteRows, new RegExp("DELETE FROM " + table + " WHERE user_id = \\$\\{userId\\}`"), table);
});

test("agreeing to the health data policy accepts only the current version", () => {
  assert.deepEqual(parseOp({ op: "consent", version: CONSENT_VERSION, at: "2020-01-01", userId: "user_2" }, NOW), { op: "consent", version: CONSENT_VERSION });
  for (const version of [undefined, null, "", "2025-01-01", CONSENT_VERSION + " ", 20261123, [CONSENT_VERSION]]) {
    assert.equal(parseOp({ op: "consent", version }, NOW), null, JSON.stringify(version));
  }
});

// Every op parseOp accepts, in a valid form.
const VALID_OPS = {
  "save-weight": { date: "2026-11-22", weight: 80 },
  "update-weight": { date: "2026-11-22", weight: 80 },
  "delete-weight": { date: "2026-11-22" },
  "set-height": { height: 178 },
  "save-waist": { date: "2026-11-22", waist: 86, sex: "male" },
  "delete-waist": { date: "2026-11-22" },
  "set-goal": { goal: { weight: 60, startDate: "2026-09-13", startWeight: 66, rate: 0.5, milestones: 10 } },
  "set-units": { units: { weight: "lb", height: "ft" } },
  "set-preferences": { preferences: { showBmi: false } },
  "set-reminder": { hour: 8, timeZone: "UTC" },
  "clear-reminder": {},
  "clear-goal": {},
  "start": {},
  "consent": { version: CONSENT_VERSION },
  "delete-data": { confirm: "delete" },
  "delete-account": { confirm: "delete" },
  "import": { log: { entries: [] } }
};

test("every change that saves data needs the agreement, and only removing data or agreeing doesn't", () => {
  const ops = Object.keys(VALID_OPS);
  for (const op of ops) assert.ok(parseOp({ op, ...VALID_OPS[op] }, NOW), op + " is valid");
  assert.deepEqual(ops.filter(op => !needsConsent({ op })).sort(), [...OPS_WITHOUT_CONSENT].sort());
  assert.deepEqual(ops.filter(op => needsConsent({ op })).sort(),
    ["import", "save-waist", "save-weight", "set-goal", "set-height", "set-preferences", "set-reminder", "set-units", "start", "update-weight"]);
  // Reading the log, and any op added later, follow the safe default.
  assert.equal(needsConsent(null), false);
  assert.equal(needsConsent({ op: "something-new" }), true);
});

test("the API answers a change refused for want of agreement with a 403 and the reason", async () => {
  const runs = [];
  const { send } = setup({ store: { run: async (userId, change) => { runs.push(change.op); throw new ConsentRequired(); } } });
  const response = await send("POST", { op: "save-weight", date: "2026-11-22", weight: 80 });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Agree to the health data policy first." });
  assert.deepEqual(runs, ["save-weight"]);
});

// A store over a fake Neon driver: it records each transaction's queries and
// answers them with `answer`, which can throw as Postgres would.
function fakeStore(answer) {
  const transactions = [];
  const sql = (strings, ...params) => ({ text: strings.join("$"), params });
  sql.query = (text, params = []) => ({ text, params });
  sql.transaction = async queries => {
    // The schema runs first, once.
    if (queries.length === schema.length && queries[0].text === schema[0]) return [];
    transactions.push(queries);
    return answer(queries);
  };
  return { store: createStore("postgres://fake", { connect: () => sql }), transactions };
}

// The read at the end of every transaction: a profile, weigh-ins, waists and devices.
const READS = [[{ started: true, consent_version: CONSENT_VERSION, consented_at: "2026-11-23T09:41:00Z", weight_unit: "kg", height_unit: "cm", preferences: {} }], [], [], []];

// The first statement of every request: row-level security reads the user from it.
const SETTING = /^SELECT set_config\('app\.user_id', \$\d*, true\)$/;

test("the store sets the user for row-level security first, then checks the agreement, in the same transaction as the change", async () => {
  const { store, transactions } = fakeStore(queries => [...queries.slice(0, -4).map(() => [{ "?column?": 1 }]), ...READS]);
  await store.run("user_1", parseOp({ op: "save-weight", date: "2026-11-22", weight: 80 }, NOW));
  const [setting, guard, ...rest] = transactions[0];
  assert.match(setting.text, SETTING);
  assert.deepEqual(setting.params, ["user_1"]);
  assert.match(guard.text, /^SELECT require_consent\(\$/);
  assert.deepEqual(guard.params, ["user_1", CONSENT_VERSION]);
  assert.equal(rest.length, 2 + 4, "the weigh-in's two writes, then the four reads");
  for (const op of ["delete-weight", "consent", "delete-data", "clear-goal"]) {
    await store.run("user_1", parseOp({ op, ...VALID_OPS[op] }, NOW));
    assert.match(transactions.at(-1)[0].text, SETTING, op);
    assert.doesNotMatch(transactions.at(-1)[1].text, /require_consent/, op);
  }
  await store.run("user_1");
  assert.equal(transactions.at(-1).length, 1 + 4, "a read is the setting and the reads");
});

test("every request's transaction starts by setting the signed-in user, whatever the change", async () => {
  const { store, transactions } = fakeStore(queries => [...queries.slice(0, -4).map(() => [{ imported: 0 }]), ...READS]);
  for (const op of [null, ...Object.keys(VALID_OPS)]) {
    await store.run("user_" + op, op && parseOp({ op, ...VALID_OPS[op] }, NOW));
    const [first, ...others] = transactions.at(-1);
    assert.match(first.text, SETTING, String(op));
    assert.deepEqual(first.params, ["user_" + op], String(op));
    assert.ok(!others.some(query => /set_config/.test(query.text)), "set only once");
  }
});

test("the store reads the change's own result after the setting and the guard", async () => {
  const { store } = fakeStore(queries => [[], [], ...queries.slice(2, -4).map(() => []), ...READS]);
  assert.equal((await store.run("user_1", parseOp({ op: "update-weight", date: "2026-11-22", weight: 80 }, NOW))).found, false);
  const found = fakeStore(queries => [[], [], [{ "?column?": 1 }], ...READS]).store;
  assert.equal((await found.run("user_1", parseOp({ op: "update-weight", date: "2026-11-22", weight: 80 }, NOW))).found, true);
  const imported = fakeStore(queries => [[], [], [{ imported: 1 }], ...READS]).store;
  assert.equal((await imported.run("user_1", parseOp({ op: "import", log: { entries: [] } }, NOW))).imported, true);
});

// Two fake connections, one per role, each recording what ran on it.
function twoRoles(appUrl) {
  const ran = [];
  const connect = url => {
    const role = new URL(url).username;
    const sql = (strings, ...params) => ({ text: strings.join("$"), params });
    sql.query = (text, params = []) => ({ text, params });
    sql.transaction = async queries => {
      const schemaRun = queries.length === schema.length && queries[0].text === schema[0];
      ran.push([role, schemaRun ? "schema" : queries.map(query => query.text.trim().split(/\s+/).slice(0, 2).join(" ")).join("; ")]);
      return schemaRun ? [] : queries.length > 4 || /set_config/.test(queries[0].text) ? [...queries.slice(0, -4).map(() => []), ...READS] : [[]];
    };
    return sql;
  };
  const store = createStore("postgres://owner:secret@ep-one-pooler.example.aws.neon.tech/neondb", { connect, appUrl });
  return { store, ran };
}

test("requests run as the app's role, and the schema and the reminder job as the owner", async () => {
  const { store, ran } = twoRoles("postgres://baseline_app:other@ep-one.example.aws.neon.tech/neondb");
  await store.run("user_1", parseOp({ op: "save-weight", date: "2026-11-22", weight: 80 }, NOW));
  await store.reminderAccounts();
  await store.claimReminders([{ userId: "user_1", day: "2026-11-22" }]);
  await store.removeDevices(["https://fcm.googleapis.com/1"]);
  assert.deepEqual(ran.map(([role, what]) => [role, what.split(";")[0]]), [
    ["owner", "schema"], ["baseline_app", "SELECT set_config('app.user_id',"], ["owner", "SELECT user_id"], ["owner", "WITH due"], ["owner", "DELETE FROM"]
  ]);
});

test("without DATABASE_URL_APP, requests run as the owner, as before", async () => {
  const { store, ran } = twoRoles(undefined);
  await store.run("user_1");
  assert.deepEqual(ran.map(([role]) => role), ["owner", "owner"]);
});

test("DATABASE_URL_APP must reach the same database as DATABASE_URL", () => {
  const connect = () => { throw new Error("not reached"); };
  const owner = "postgres://owner:secret@ep-one-pooler.example.aws.neon.tech/neondb";
  for (const appUrl of ["postgres://baseline_app:x@ep-two-pooler.example.aws.neon.tech/neondb", "postgres://baseline_app:x@ep-one-pooler.example.aws.neon.tech/other", "not a url"]) {
    assert.throws(() => createStore(owner, { connect, appUrl }), error => error.name === "SetupError" && error.code === "APP_DATABASE_MISMATCH", appUrl);
  }
  assert.throws(() => createStore("", { connect }), error => error.code === "NO_DATABASE_URL");
});

test("turning reminders on releases the device from another account before adding it", async () => {
  const { store, transactions } = fakeStore(queries => [...queries.slice(0, -4).map(() => []), ...READS]);
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } };
  await store.run("user_1", parseOp({ op: "set-reminder", hour: 8, timeZone: "UTC", subscription }, NOW));
  const texts = transactions[0].map(query => query.text);
  const release = texts.findIndex(text => /^SELECT release_device\(\$\d*\)$/.test(text));
  assert.ok(release > 0, "it releases the device");
  assert.deepEqual(transactions[0][release].params, [subscription.endpoint]);
  assert.ok(release < texts.findIndex(text => /INSERT INTO push_subscriptions/.test(text)), "before adding it");
  await store.run("user_1", parseOp({ op: "set-reminder", hour: 8, timeZone: "UTC" }, NOW));
  assert.ok(!transactions[1].some(query => /release_device/.test(query.text)), "not without a device");
});

test("row-level security covers every table, and binds every role but the owner", () => {
  const tables = schema.flatMap(text => [.../CREATE TABLE IF NOT EXISTS (\w+)/g.exec(text)?.slice(1) ?? []]).sort();
  const rls = schema.find(text => /ENABLE ROW LEVEL SECURITY/.test(text));
  assert.match(rls, /^DO \$\$/, "in a block that can run again");
  const listed = /FOREACH tab IN ARRAY ARRAY\[([^\]]*)\]/.exec(rls)[1].split(",").map(name => name.trim().replace(/'/g, "")).sort();
  assert.deepEqual(listed, tables, "every table keyed by user_id");
  assert.match(rls, /IF NOT EXISTS \(SELECT 1 FROM pg_policies WHERE schemaname = current_schema\(\) AND tablename = tab AND policyname = 'own_rows'\)/);
  assert.match(rls, /USING \(user_id = current_setting\('app\.user_id', true\)\)\s+WITH CHECK \(user_id = current_setting\('app\.user_id', true\)\)/);
  assert.doesNotMatch(schema.join("\n"), /FORCE ROW LEVEL SECURITY/, "the owner's schema changes and reminder job pass");
  const release = schema.find(text => /release_device/.test(text));
  assert.match(release, /SECURITY DEFINER SET search_path = %I, pg_temp/);
  assert.match(release, /WHERE endpoint = device AND current_setting\('app\.user_id', true\) <> '' AND user_id <> current_setting\('app\.user_id', true\)/);
  assert.match(release, /EXCEPTION WHEN duplicate_function OR unique_violation THEN NULL/);
  // The DO blocks quote with $$, so nothing inside may contain it.
  for (const text of schema.filter(text => text.startsWith("DO $$"))) assert.equal(text.split("$$").length, 3, text.slice(0, 40));
});

test("a database error's message and detail never reach the log, nor the user or the values", async () => {
  // As the Neon driver reports a CHECK violation.
  const error = Object.assign(new Error('new row for relation "weigh_ins" violates check constraint "weigh_ins_weight_kg_check"'), {
    name: "NeonDbError", code: "23514", severity: "ERROR", table: "weigh_ins", constraint: "weigh_ins_weight_kg_check",
    detail: "Failing row contains (user_1, 2026-11-22, 2001.00, 2026-11-22 09:41:00+00, after the holidays)."
  });
  const { send } = setup({ store: { run: async () => { throw error; } } });
  const lines = [];
  const saved = { error: console.error, log: console.log, warn: console.warn, info: console.info };
  for (const name of Object.keys(saved)) console[name] = (...args) => lines.push(args.map(String).join(" "));
  let response;
  try {
    response = await send("POST", { op: "save-weight", date: "2026-11-22", weight: 80, note: "after the holidays" });
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(response.status, 500);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[[0-9a-f]{8}\] POST \/api\/log save-weight failed: NeonDbError 23514$/);
  assert.doesNotMatch(lines[0], /Failing|weigh_ins|user_1|2001|80|holidays|constraint/);
  assert.doesNotMatch(await response.text(), /Failing|user_1|holidays|23514/);
});

test("an error is logged only by its kind and code, whatever they hold", () => {
  assert.equal(describeError(Object.assign(new Error("x"), { code: "ECONNRESET" })), "Error ECONNRESET");
  assert.equal(describeError(new TypeError("Cannot read user_1's weight")), "TypeError");
  assert.equal(describeError(Object.assign(new Error("x"), { name: "Weight 80 kg", code: "note: after the holidays" })), "Error");
  assert.equal(describeError(Object.assign(new Error("x"), { code: 500 })), "Error 500");
  assert.equal(describeError(null), "Error");
  assert.equal(describeError("user_1 80"), "Error");
  assert.equal(describeError(new SetupError("DATABASE_URL is not set.", "NO_DATABASE_URL")), "SetupError NO_DATABASE_URL");
  const lines = [];
  const original = console.error;
  console.error = line => lines.push(line);
  try {
    assert.equal(logError("GET /api/log", new Error("user_1"), "0a1b2c3d"), "[0a1b2c3d] GET /api/log failed: Error");
  } finally {
    console.error = original;
  }
  assert.deepEqual(lines, ["[0a1b2c3d] GET /api/log failed: Error"]);
  assert.match(requestId(), /^[0-9a-f]{8}$/);
});

test("the store turns the guard's error into ConsentRequired, and passes other errors on", async () => {
  const refused = Object.assign(new Error("Agree to the health data policy first."), { code: CONSENT_ERROR_CODE });
  const { store } = fakeStore(() => { throw refused; });
  await assert.rejects(store.run("user_1", parseOp({ op: "save-weight", date: "2026-11-22", weight: 80 }, NOW)), ConsentRequired);
  const broken = Object.assign(new Error("connection reset"), { code: "08006" });
  await assert.rejects(fakeStore(() => { throw broken; }).store.run("user_1"), error => error === broken);
});

test("the log carries the agreement as the server recorded it", async () => {
  const { store } = fakeStore(() => READS);
  assert.deepEqual((await store.run("user_1")).log.consent, { version: CONSENT_VERSION, at: "2026-11-23T09:41:00Z" });
  const none = fakeStore(() => [[], [], [], []]).store;
  assert.equal((await none.run("user_2")).log.consent, null);
});

test("the agreement's columns and the guard are added to existing databases", () => {
  const columns = schema.find(text => /consent_version/.test(text));
  assert.match(columns, /ALTER TABLE profiles\s+ADD COLUMN IF NOT EXISTS consent_version text[^,]*,\s+ADD COLUMN IF NOT EXISTS consented_at timestamptz/);
  const guard = schema.find(text => /require_consent/.test(text));
  assert.match(guard, /^DO \$\$/, "made once, in a block that can run again");
  assert.match(guard, /EXCEPTION WHEN duplicate_function OR unique_violation THEN NULL/);
  assert.match(guard, new RegExp("ERRCODE = '" + CONSENT_ERROR_CODE + "'"));
  assert.match(guard, /FOR SHARE/);
});
