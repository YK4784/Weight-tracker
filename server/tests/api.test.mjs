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
  assert.equal((await send("POST", { op: "save-weight", date: "2026-11-22", weight: 80.04, extra: "ignored" })).status, 200);
  assert.deepEqual(calls, [["user_1", null], ["user_1", { op: "save-weight", date: "2026-11-22", weight: 80 }]]);
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

test("weights and heights must be in range and are rounded to one decimal", () => {
  assert.deepEqual(parseOp({ op: "save-weight", date: "2026-11-01", weight: 0.1 }, NOW), { op: "save-weight", date: "2026-11-01", weight: 0.1 });
  assert.deepEqual(parseOp({ op: "update-weight", date: "2026-11-01", weight: 2000 }, NOW), { op: "update-weight", date: "2026-11-01", weight: 2000 });
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
    { date: "2026-11-02", weight: 80.04 }, { date: "2026-11-01", weight: 81 }, { date: "2026-11-02", weight: 79.96 },
    { date: "2026-11-30", weight: 80 }, { date: "bad", weight: 80 }, { date: "2026-11-03", weight: -5 }
  ] } }, NOW);
  assert.deepEqual(change, { op: "import", height: 180, entries: [{ date: "2026-11-01", weight: 81 }, { date: "2026-11-02", weight: 80 }] });
  assert.deepEqual(parseOp({ op: "import", log: { started: true } }, NOW), { op: "import", height: null, entries: [] });
  assert.equal(parseOp({ op: "import" }, NOW), null);
  assert.equal(parseOp({ op: "import", log: { entries: "lots" } }, NOW), null);
  assert.equal(parseOp({ op: "import", log: { entries: new Array(MAX_IMPORT_ENTRIES + 1).fill({ date: "2026-11-01", weight: 80 }) } }, NOW), null);
});
