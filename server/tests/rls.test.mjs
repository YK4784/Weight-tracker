import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";
import { CONSENT_VERSION, dateOf, dayOf } from "../../baseline/dist/model.mjs";
import { parseOp } from "../ops.mjs";
import { sendReminders } from "../reminders.mjs";
import { createStore } from "../store.mjs";

// Proves the row-level security in schema.mjs against a real Neon database.
// It runs only when TEST_DATABASE_URL is set to the owner's connection string
// for a Neon branch, best a schema-only one (see README.md, "Check row-level
// security on a branch"), and is skipped otherwise. Never point it at the
// production database: it creates a role, and adds and deletes rows.
//
// It makes its own login role, baseline_rls_test, with the same grants as
// baseline_app in README.md, and drops it afterwards. To test a role you made
// yourself instead, set TEST_DATABASE_URL_APP to its connection string.
const OWNER_URL = process.env.TEST_DATABASE_URL;
const GIVEN_APP_URL = process.env.TEST_DATABASE_URL_APP;
const skip = !OWNER_URL && "set TEST_DATABASE_URL to a Neon branch's connection string to run it (see README.md)";

const TABLES = ["profiles", "weigh_ins", "waist_measurements", "push_subscriptions"];
const ROLE = "baseline_rls_test";
const NOW = new Date();
const today = NOW.toISOString().slice(0, 10);
const daysAgo = days => dateOf(dayOf(today) - days);
const tag = randomBytes(4).toString("hex");
const A = "rls_test_a_" + tag;
const B = "rls_test_b_" + tag;
const C = "rls_test_c_" + tag;

// The endpoint's host without "-pooler": a Neon branch has hosts of its own.
const endpointOf = url => {
  try { return new URL(url).hostname.replace(/-pooler(?=\.)/, ""); } catch { return null; }
};

// The databases the app itself uses, from the environment and .env.local. The
// values are compared, never printed.
function appDatabases() {
  const env = { ...process.env };
  try { Object.assign(env, parseEnv(readFileSync(new URL("../../.env.local", import.meta.url), "utf8"))); } catch { /* No local env file. */ }
  return ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL_APP", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]
    .map(name => env[name]).filter(Boolean).map(endpointOf);
}

// A browser's push subscription, as the app sends it.
function subscription(name) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/fcm/send/" + name, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

let owner;
let app;
let store;
let createdRole = false;
const change = body => {
  const parsed = parseOp(body, NOW);
  assert.ok(parsed, body.op + " is valid");
  return parsed;
};
// Runs `queries` as the app's role, signed in as `userId` (or nobody).
const asUser = (userId, ...queries) => app.transaction([
  ...userId === null ? [] : [app`SELECT set_config('app.user_id', ${userId}, true)`],
  ...queries
]).then(results => results.slice(userId === null ? 0 : 1));
const quote = name => '"' + name.replaceAll('"', '""') + '"';

before(async () => {
  if (skip) return;
  if (appDatabases().includes(endpointOf(OWNER_URL))) {
    throw new Error("TEST_DATABASE_URL points at the database the app uses. Use a Neon branch.");
  }
  owner = neon(OWNER_URL);
  let appUrl = GIVEN_APP_URL;
  if (!appUrl) {
    // The tables must exist before the role gets its grants.
    await createStore(OWNER_URL, { appUrl: OWNER_URL }).reminderAccounts();
    const password = randomBytes(24).toString("base64url");
    const [[{ schema }], [existing]] = await owner.transaction([
      owner`SELECT current_schema() AS schema`,
      owner`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`
    ]);
    await owner.transaction([
      owner.query((existing ? "ALTER" : "CREATE") + " ROLE " + ROLE + " LOGIN PASSWORD '" + password + "'"),
      owner.query("GRANT USAGE ON SCHEMA " + quote(schema) + " TO " + ROLE),
      owner.query("GRANT SELECT, INSERT, UPDATE, DELETE ON " + TABLES.join(", ") + " TO " + ROLE)
    ]);
    createdRole = true;
    const url = new URL(OWNER_URL);
    url.username = ROLE;
    url.password = password;
    appUrl = url.href;
  }
  app = neon(appUrl);
  store = createStore(OWNER_URL, { appUrl });
});

after(async () => {
  if (skip || !owner) return;
  await owner.transaction([
    ...TABLES.map(table => owner.query("DELETE FROM " + table + " WHERE user_id = ANY($1)", [[A, B, C]]))
  ]);
  if (createdRole) {
    const [[{ schema }]] = await owner.transaction([owner`SELECT current_schema() AS schema`]);
    await owner.transaction([
      owner.query("REVOKE ALL ON " + TABLES.join(", ") + " FROM " + ROLE),
      owner.query("REVOKE ALL ON SCHEMA " + quote(schema) + " FROM " + ROLE),
      owner.query("DROP ROLE " + ROLE)
    ]);
  }
});

test("the app's role owns no table and can't bypass row-level security", { skip }, async () => {
  const [[role], owned] = await app.transaction([
    app`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    app`SELECT tablename FROM pg_tables WHERE tablename = ANY(${TABLES}) AND tableowner = current_user`
  ]);
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
  assert.deepEqual(owned, []);
});

test("every table has row-level security on, with the own_rows policy", { skip }, async () => {
  const [secured, policies] = await owner.transaction([
    owner`SELECT relname FROM pg_class WHERE oid = ANY(SELECT to_regclass(name) FROM unnest(${TABLES}::text[]) AS name) AND relrowsecurity`,
    owner`SELECT tablename FROM pg_policies WHERE schemaname = current_schema() AND policyname = 'own_rows'`
  ]);
  assert.deepEqual(secured.map(row => row.relname).sort(), [...TABLES].sort());
  assert.deepEqual(policies.map(row => row.tablename).sort(), [...TABLES].sort());
});

test("app.user_id lasts for every statement of one HTTP transaction, and ends with it", { skip }, async () => {
  const [first, , last] = await asUser(A,
    app`SELECT current_setting('app.user_id', true) AS id`,
    app`SELECT count(*) FROM profiles`,
    app`SELECT current_setting('app.user_id', true) AS id`
  );
  assert.equal(first[0].id, A);
  assert.equal(last[0].id, A);
  const [[next]] = await asUser(null, app`SELECT current_setting('app.user_id', true) AS id`);
  assert.ok(next.id === null || next.id === "", "the next transaction starts without it");
});

test("the store saves each kind of change as the app's role, and reads only that user's log", { skip }, async () => {
  for (const user of [A, B]) {
    await store.run(user, change({ op: "consent", version: CONSENT_VERSION }));
    await store.run(user, change({ op: "save-weight", date: daysAgo(3), weight: 80, note: "first" }));
    await store.run(user, change({ op: "save-weight", date: daysAgo(2), weight: 79.5 }));
    await store.run(user, change({ op: "save-waist", date: daysAgo(2), waist: 86, sex: "female" }));
    await store.run(user, change({ op: "set-height", height: 170 }));
  }
  assert.equal((await store.run(A, change({ op: "update-weight", date: daysAgo(2), weight: 79.4, note: "edited" }))).found, true);
  assert.equal((await store.run(A, change({ op: "update-weight", date: daysAgo(9), weight: 79 }))).found, false);
  await store.run(A, change({ op: "delete-weight", date: daysAgo(3) }));
  await store.run(A, change({ op: "save-waist", date: daysAgo(1), waist: 85, sex: "female" }));
  await store.run(A, change({ op: "delete-waist", date: daysAgo(1) }));
  await store.run(A, change({ op: "set-goal", goal: { weight: 75, startDate: daysAgo(3), startWeight: 80, rate: 0.5, milestones: 10 } }));
  await store.run(A, change({ op: "set-units", units: { weight: "lb", height: "ft" } }));
  await store.run(A, change({ op: "set-preferences", preferences: { showBmi: false } }));
  const { log } = await store.run(A);
  assert.deepEqual(log.entries, [{ date: daysAgo(2), weight: 79.4, note: "edited" }]);
  assert.deepEqual(log.waists, [{ date: daysAgo(2), waist: 86 }]);
  assert.equal(log.height, 170);
  assert.equal(log.goal.weight, 75);
  assert.deepEqual(log.units, { weight: "lb", height: "ft" });
  assert.equal(log.preferences.showBmi, false);
  assert.ok(log.consent);
  await store.run(A, change({ op: "clear-goal" }));
  assert.equal((await store.run(A)).log.goal, null);
  const other = (await store.run(B)).log;
  assert.equal(other.entries.length, 2, "B's log is as B saved it");
  assert.deepEqual(other.units, { weight: "kg", height: "cm" });
});

test("a query without a WHERE clause returns only the signed-in user's rows", { skip }, async () => {
  const rows = await asUser(A, ...TABLES.map(table => app.query("SELECT user_id FROM " + table)));
  for (const [index, table] of TABLES.entries()) {
    if (table === "push_subscriptions") continue; // A has no device yet.
    assert.ok(rows[index].length > 0, table + " has A's rows");
    assert.deepEqual([...new Set(rows[index].map(row => row.user_id))], [A], table);
  }
  const anonymous = await asUser(null, ...TABLES.map(table => app.query("SELECT user_id FROM " + table)));
  assert.deepEqual(anonymous, TABLES.map(() => []), "without app.user_id, no rows at all");
});

test("writes without a WHERE clause reach only the signed-in user's rows", { skip }, async () => {
  const [updated] = await asUser(A, app`UPDATE weigh_ins SET note = 'changed' RETURNING user_id`);
  assert.deepEqual([...new Set(updated.map(row => row.user_id))], [A]);
  await asUser(A, app`DELETE FROM waist_measurements`);
  const [notes, waists] = await owner.transaction([
    owner`SELECT note FROM weigh_ins WHERE user_id = ${B} ORDER BY date`,
    owner`SELECT user_id FROM waist_measurements WHERE user_id = ANY(${[A, B]})`
  ]);
  assert.deepEqual(notes.map(row => row.note), ["first", null], "B's notes are untouched");
  assert.deepEqual(waists.map(row => row.user_id), [B], "only A's waists went");
  await assert.rejects(asUser(A, app`INSERT INTO weigh_ins (user_id, date, weight_kg) VALUES (${B}, ${today}::date, 70)`),
    error => error.code === "42501", "A can't add a row for B");
  await assert.rejects(asUser(null, app`INSERT INTO profiles (user_id) VALUES (${C})`),
    error => error.code === "42501", "nobody can add a row without app.user_id");
});

test("a device moves to the account that turns reminders on with it last", { skip }, async () => {
  const device = subscription("rls-test-" + tag);
  const hour = NOW.getUTCHours();
  const first = await store.run(A, change({ op: "set-reminder", hour, timeZone: "UTC", subscription: device }));
  assert.deepEqual(first.log.reminder.devices, [device.endpoint]);
  const moved = await store.run(B, change({ op: "set-reminder", hour, timeZone: "UTC", subscription: device }));
  assert.deepEqual(moved.log.reminder.devices, [device.endpoint]);
  assert.equal((await store.run(A)).log.reminder, null, "A no longer has the device");
  const [rows] = await owner.transaction([owner`SELECT user_id FROM push_subscriptions WHERE endpoint = ${device.endpoint}`]);
  assert.deepEqual(rows, [{ user_id: B }]);
  // release_device does nothing without a signed-in user.
  await asUser(null, app`SELECT release_device(${device.endpoint})`);
  const [still] = await owner.transaction([owner`SELECT user_id FROM push_subscriptions WHERE endpoint = ${device.endpoint}`]);
  assert.deepEqual(still, [{ user_id: B }]);
});

test("reminders still send: the owner reads across accounts", { skip }, async () => {
  const device = subscription("rls-test-remind-" + tag);
  await store.run(A, change({ op: "set-reminder", hour: NOW.getUTCHours(), timeZone: "UTC", subscription: device }));
  const sent = [];
  const summary = await sendReminders({ store, now: NOW, send: async target => { sent.push(target.endpoint); return 201; } });
  assert.ok(sent.includes(device.endpoint), "A's device got its reminder");
  assert.ok(summary.sent >= 1);
  const [[profile]] = await owner.transaction([owner`SELECT to_char(reminded_on, 'YYYY-MM-DD') AS day FROM profiles WHERE user_id = ${A}`]);
  assert.equal(profile.day, today);
});

test("importing, deleting the data and deleting the account work as the app's role", { skip }, async () => {
  await store.run(C, change({ op: "consent", version: CONSENT_VERSION }));
  const imported = await store.run(C, change({ op: "import", log: { height: 180, entries: [{ date: daysAgo(5), weight: 90 }, { date: daysAgo(4), weight: 89.6, note: "moved in" }] } }));
  assert.equal(imported.imported, true);
  assert.equal(imported.log.entries.length, 2);
  const emptied = await store.run(C, change({ op: "delete-data", confirm: "delete" }));
  assert.deepEqual(emptied.log.entries, []);
  assert.equal(emptied.log.started, true);
  assert.equal(emptied.log.consent, null);
  await store.run(C, change({ op: "delete-account", confirm: "delete" }));
  const left = await owner.transaction(TABLES.map(table => owner.query("SELECT 1 FROM " + table + " WHERE user_id = $1", [C])));
  assert.deepEqual(left, TABLES.map(() => []), "no row for C in any table");
});
