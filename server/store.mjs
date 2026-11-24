import { neon } from "@neondatabase/serverless";
import { schema } from "./schema.mjs";
import { CONSENT_VERSION, IMPORTS_LISTED, normalizeConsent, normalizePreferences } from "../baseline/dist/model.mjs";
import { CONSENT_ERROR_CODE, ConsentRequired, needsConsent } from "./ops.mjs";
import { SetupError } from "./log.mjs";

// The most devices an account can get reminders on.
export const MAX_DEVICES = 10;
// The reads at the end of every request's transaction: the profile, the
// weigh-ins, the waist measurements, the devices and the recent imports.
const READS = 5;

// The Neon endpoint and database a connection string points at. The pooled
// host is the endpoint's host with "-pooler" added, so both count as one.
function databaseOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/-pooler(?=\.)/, "") + parsed.pathname;
  } catch {
    return null;
  }
}

// Reads and writes logs in Postgres. Each call is one HTTP round trip: the
// change and a fresh read of the log run together in a single transaction.
// `connect` makes the query function from the URL; tests pass a fake one.
//
// It uses two roles. `url`, DATABASE_URL, is the role that owns the tables. It
// creates and updates them (see schema.mjs) and runs the hourly reminder job,
// which reads every account's reminder. The owner isn't subject to row-level
// security, which the job needs. `appUrl`, DATABASE_URL_APP, is a role that
// owns nothing and may only read and write rows (see README.md, "Limit the
// app to each user's rows"). Every request from the app runs as that role,
// and each request's transaction first sets app.user_id to the signed-in
// user, so the policies in schema.mjs hide every other user's rows even from
// a query that forgets its WHERE clause. Without DATABASE_URL_APP, requests
// run as the owner, as they did before, and only the WHERE clauses keep users
// apart.
export function createStore(url = process.env.DATABASE_URL, { connect = neon, appUrl = process.env.DATABASE_URL_APP } = {}) {
  if (!url) throw new SetupError("DATABASE_URL is not set. Connect the Neon database to this project.", "NO_DATABASE_URL");
  // Both must reach the same database, or the schema and the reminders would
  // use one and the app another, as with a preview branch.
  if (appUrl && databaseOf(appUrl) !== databaseOf(url)) {
    throw new SetupError("DATABASE_URL_APP must point at the same database as DATABASE_URL.", "APP_DATABASE_MISMATCH");
  }
  const owner = connect(url);
  const sql = appUrl && appUrl !== url ? connect(appUrl) : owner;
  let ready;
  const ensureSchema = () => ready ??= owner.transaction(schema.map(text => owner.query(text))).catch(error => {
    ready = undefined;
    throw error;
  });

  // Every row that belongs to a user, in every table. A new table keyed by
  // user_id must be added here too (npm test checks).
  const deleteRows = userId => [
    sql`DELETE FROM weigh_ins WHERE user_id = ${userId}`,
    sql`DELETE FROM waist_measurements WHERE user_id = ${userId}`,
    sql`DELETE FROM push_subscriptions WHERE user_id = ${userId}`,
    sql`DELETE FROM import_batches WHERE user_id = ${userId}`,
    sql`DELETE FROM profiles WHERE user_id = ${userId}`
  ];

  function writes(userId, change) {
    switch (change?.op) {
      case undefined:
        return [];
      // A change without a note keeps the note already on that date (see parseOp).
      // Saving an imported weigh-in again takes it out of its import, so undoing
      // the import never removes a weigh-in saved since. It keeps its source
      // only if the weight stays the same; a new weight was typed in Baseline.
      case "save-weight":
        return [
          sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)
              ON CONFLICT (user_id) DO UPDATE SET started = true, updated_at = now()`,
          sql`INSERT INTO weigh_ins (user_id, date, weight_kg, note) VALUES (${userId}, ${change.date}::date, ${change.weight}, ${change.note ?? null}::text)
              ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg,
                note = CASE WHEN ${change.note === undefined}::boolean THEN weigh_ins.note ELSE excluded.note END,
                source = CASE WHEN weigh_ins.weight_kg = excluded.weight_kg THEN weigh_ins.source END, import_batch = NULL, updated_at = now()`
        ];
      case "update-weight":
        return [sql`UPDATE weigh_ins SET weight_kg = ${change.weight},
                      note = CASE WHEN ${change.note === undefined}::boolean THEN note ELSE ${change.note ?? null}::text END,
                      source = CASE WHEN weight_kg = ${change.weight} THEN source END, import_batch = NULL, updated_at = now()
                    WHERE user_id = ${userId} AND date = ${change.date}::date RETURNING 1`];
      // Adds the weigh-ins on dates the log doesn't have, and never changes one
      // it has. The import's row comes first, made by the first request of the
      // batch, and the weigh-ins go in only if it belongs to this account. The
      // last query counts what went in.
      case "merge-import":
        return [
          sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)
              ON CONFLICT (user_id) DO UPDATE SET started = true, updated_at = now()`,
          sql`INSERT INTO import_batches (id, user_id, source) VALUES (${change.batch}, ${userId}, ${change.source}) ON CONFLICT (id) DO NOTHING`,
          sql`
            WITH added AS (
              INSERT INTO weigh_ins (user_id, date, weight_kg, note, source, import_batch)
              SELECT ${userId}, t.date, t.weight, t.note, t.source, ${change.batch}
              FROM unnest(${change.entries.map(entry => entry.date)}::date[], ${change.entries.map(entry => entry.weight)}::numeric[],
                          ${change.entries.map(entry => entry.note)}::text[], ${change.entries.map(entry => entry.source)}::text[]) AS t(date, weight, note, source)
              WHERE EXISTS (SELECT 1 FROM import_batches WHERE id = ${change.batch} AND user_id = ${userId})
              ON CONFLICT (user_id, date) DO NOTHING
              RETURNING 1
            )
            SELECT count(*)::int AS added FROM added`
        ];
      // Removes the import's weigh-ins that haven't been saved since, and the
      // import itself. The last query counts what was removed.
      case "undo-import":
        return [
          sql`DELETE FROM import_batches WHERE user_id = ${userId} AND id = ${change.batch}`,
          sql`
            WITH removed AS (DELETE FROM weigh_ins WHERE user_id = ${userId} AND import_batch = ${change.batch} RETURNING 1)
            SELECT count(*)::int AS removed FROM removed`
        ];
      case "delete-weight":
        return [sql`DELETE FROM weigh_ins WHERE user_id = ${userId} AND date = ${change.date}::date`];
      case "set-height":
        return [sql`INSERT INTO profiles (user_id, started, height_cm) VALUES (${userId}, true, ${change.height})
                    ON CONFLICT (user_id) DO UPDATE SET started = true, height_cm = excluded.height_cm, updated_at = now()`];
      case "save-waist":
        return [
          sql`INSERT INTO profiles (user_id, started, sex) VALUES (${userId}, true, ${change.sex})
              ON CONFLICT (user_id) DO UPDATE SET started = true, sex = excluded.sex, updated_at = now()`,
          sql`INSERT INTO waist_measurements (user_id, date, waist_cm) VALUES (${userId}, ${change.date}::date, ${change.waist})
              ON CONFLICT (user_id, date) DO UPDATE SET waist_cm = excluded.waist_cm, updated_at = now()`
        ];
      case "delete-waist":
        return [sql`DELETE FROM waist_measurements WHERE user_id = ${userId} AND date = ${change.date}::date`];
      case "set-goal": {
        const { weight, startDate, startWeight, rate, milestones } = change.goal;
        return [sql`
          INSERT INTO profiles (user_id, started, goal_kg, goal_start_date, goal_start_kg, goal_rate_kg_week, goal_milestones)
          VALUES (${userId}, true, ${weight}, ${startDate}::date, ${startWeight}, ${rate}, ${milestones})
          ON CONFLICT (user_id) DO UPDATE SET started = true, goal_kg = excluded.goal_kg, goal_start_date = excluded.goal_start_date,
            goal_start_kg = excluded.goal_start_kg, goal_rate_kg_week = excluded.goal_rate_kg_week,
            goal_milestones = excluded.goal_milestones, updated_at = now()`];
      }
      case "set-units":
        return [sql`INSERT INTO profiles (user_id, started, weight_unit, height_unit) VALUES (${userId}, true, ${change.units.weight}, ${change.units.height})
                    ON CONFLICT (user_id) DO UPDATE SET started = true, weight_unit = excluded.weight_unit, height_unit = excluded.height_unit,
                      updated_at = now()`];
      // Merges the keys sent into the saved preferences, so a key this change
      // leaves out, including one only a newer app knows, keeps its value.
      case "set-preferences":
        return [sql`INSERT INTO profiles (user_id, started, preferences) VALUES (${userId}, true, ${JSON.stringify(change.preferences)}::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET started = true, preferences = profiles.preferences || excluded.preferences,
                      updated_at = now()`];
      // Sets the hour and time zone for every device, and adds this device if it
      // sent its subscription. A device moves to whichever account adds it last.
      case "set-reminder": {
        const queries = [sql`INSERT INTO profiles (user_id, reminder_hour, time_zone) VALUES (${userId}, ${change.hour}, ${change.timeZone})
                             ON CONFLICT (user_id) DO UPDATE SET reminder_hour = excluded.reminder_hour, time_zone = excluded.time_zone, updated_at = now()`];
        const device = change.subscription;
        if (device) {
          queries.push(
            // Another account's row for this device is hidden from this one,
            // so it can't be updated here. release_device (see schema.mjs)
            // deletes it, and the insert below then adds the device afresh.
            sql`SELECT release_device(${device.endpoint})`,
            sql`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (${device.endpoint}, ${userId}, ${device.p256dh}, ${device.auth})
                ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now()`,
            // Each run sends to every device, so an account keeps only its most recent few.
            sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND endpoint NOT IN (
                  SELECT endpoint FROM push_subscriptions WHERE user_id = ${userId} ORDER BY created_at DESC, endpoint LIMIT ${MAX_DEVICES})`
          );
        }
        return queries;
      }
      case "clear-reminder":
        return [
          sql`UPDATE profiles SET reminder_hour = NULL, updated_at = now() WHERE user_id = ${userId}`,
          sql`DELETE FROM push_subscriptions WHERE user_id = ${userId}`
        ];
      case "clear-goal":
        return [sql`UPDATE profiles SET goal_kg = NULL, goal_start_date = NULL, goal_start_kg = NULL, goal_rate_kg_week = NULL,
                      goal_milestones = NULL, updated_at = now()
                    WHERE user_id = ${userId}`];
      case "start":
        return [sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)
                    ON CONFLICT (user_id) DO UPDATE SET started = true, updated_at = now()`];
      // Records the agreement and when it arrived. It doesn't start the log, so
      // a log saved in this browser before accounts can still move in after it.
      // Agreeing again to the same version keeps the first time.
      case "consent":
        return [sql`INSERT INTO profiles (user_id, consent_version, consented_at) VALUES (${userId}, ${change.version}, now())
                    ON CONFLICT (user_id) DO UPDATE SET consent_version = excluded.consent_version,
                      consented_at = CASE WHEN profiles.consent_version = excluded.consent_version THEN profiles.consented_at ELSE excluded.consented_at END,
                      updated_at = now()`];
      case "import":
        // Only into an account with nothing saved yet, so a stale copy never
        // overwrites newer data. The profile may already hold the agreement to
        // the policy, or a reminder, but nothing that started the log.
        return [sql`
          WITH empty AS (
            SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = ${userId} AND started)
                       AND NOT EXISTS (SELECT 1 FROM weigh_ins WHERE user_id = ${userId})
          ), profile AS (
            INSERT INTO profiles (user_id, started, height_cm)
            SELECT ${userId}, true, ${change.height}::numeric FROM empty
            ON CONFLICT (user_id) DO UPDATE SET started = true, height_cm = excluded.height_cm, updated_at = now()
              WHERE NOT profiles.started
            RETURNING 1
          ), entries AS (
            INSERT INTO weigh_ins (user_id, date, weight_kg, note)
            SELECT ${userId}, t.date, t.weight, t.note
            FROM empty, unnest(${change.entries.map(entry => entry.date)}::date[], ${change.entries.map(entry => entry.weight)}::numeric[],
                               ${change.entries.map(entry => entry.note)}::text[]) AS t(date, weight, note)
            ON CONFLICT (user_id, date) DO NOTHING
            RETURNING 1
          )
          SELECT count(*)::int AS imported FROM profile`];
      // Empties the log and keeps the account. The profile goes back to a bare
      // one, which stays started, so the import op never pulls a log saved in
      // a browser before sign-in back into the emptied account.
      case "delete-data":
        return [...deleteRows(userId), sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)`];
      // Before the app deletes the Clerk user.
      case "delete-account":
        return deleteRows(userId);
      default:
        throw new Error("Unknown change: " + change.op);
    }
  }

  return {
    // Applies `change` (or nothing, for a plain read) and returns the user's log.
    // A change that saves data first checks, in the same transaction, that the
    // account agreed to the current health data policy, and throws
    // ConsentRequired without changing anything if it hasn't.
    async run(userId, change = null) {
      await ensureSchema();
      // The row-level security policies show and accept only rows with this
      // user_id. The `true` keeps the setting to this transaction, so it never
      // carries over to another request on the same connection.
      const account = [sql`SELECT set_config('app.user_id', ${userId}, true)`];
      const guard = needsConsent(change) ? [sql`SELECT require_consent(${userId}, ${CONSENT_VERSION})`] : [];
      const queries = writes(userId, change);
      let results;
      try {
        results = await sql.transaction([
          ...account,
          ...guard,
          ...queries,
          sql`SELECT started, height_cm::float8 AS height, goal_kg::float8 AS goal_weight,
                     to_char(goal_start_date, 'YYYY-MM-DD') AS goal_start_date, goal_start_kg::float8 AS goal_start_weight,
                     goal_rate_kg_week::float8 AS goal_rate, goal_milestones, weight_unit, height_unit, preferences, reminder_hour, time_zone, sex,
                     consent_version, to_char(consented_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS consented_at
              FROM profiles WHERE user_id = ${userId}`,
          sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, weight_kg::float8 AS weight, note, source
              FROM weigh_ins WHERE user_id = ${userId} ORDER BY date`,
          sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, waist_cm::float8 AS waist
              FROM waist_measurements WHERE user_id = ${userId} ORDER BY date`,
          sql`SELECT endpoint FROM push_subscriptions WHERE user_id = ${userId} ORDER BY created_at, endpoint`,
          // The recent imports with weigh-ins left to undo (see normalizeImports in model.mjs).
          sql`SELECT b.id, b.source, to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, count(*)::int AS count
              FROM import_batches b JOIN weigh_ins w ON w.user_id = b.user_id AND w.import_batch = b.id
              WHERE b.user_id = ${userId}
              GROUP BY b.id ORDER BY b.created_at DESC, b.id LIMIT ${IMPORTS_LISTED}`
        ]);
      } catch (error) {
        throw error?.code === CONSENT_ERROR_CODE ? new ConsentRequired() : error;
      }
      const [[profile], entries, waists, devices, imports] = results.slice(-READS);
      // What the change's own query returned, after the setting and the guard:
      // the last of its queries.
      const written = results[account.length + guard.length + queries.length - 1];
      const goal = profile?.goal_weight == null ? null : {
        weight: profile.goal_weight, startDate: profile.goal_start_date, startWeight: profile.goal_start_weight,
        rate: profile.goal_rate, milestones: profile.goal_milestones
      };
      const units = { weight: profile?.weight_unit ?? "kg", height: profile?.height_unit ?? "cm" };
      // Every preference this version knows, with defaults for those not set.
      const preferences = normalizePreferences(profile?.preferences);
      // Reminders are off without a device to send them to.
      const reminder = profile?.reminder_hour == null || !devices.length ? null
        : { hour: profile.reminder_hour, timeZone: profile.time_zone, devices: devices.map(device => device.endpoint) };
      const consent = normalizeConsent({ version: profile?.consent_version, at: profile?.consented_at });
      const result = { log: {
        started: Boolean(profile?.started), consent, height: profile?.height ?? null, sex: profile?.sex ?? null, goal, units, preferences, reminder,
        // A weigh-in typed in Baseline has no source, so the reply leaves it out.
        entries: entries.map(({ source, ...entry }) => source ? { ...entry, source } : entry),
        waists,
        imports: imports.map(row => ({ id: row.id, source: row.source, createdAt: row.created_at, count: row.count }))
      } };
      if (change?.op === "update-weight") result.found = written.length > 0;
      if (change?.op === "import") result.imported = written[0]?.imported > 0;
      if (change?.op === "merge-import") result.added = written[0]?.added ?? 0;
      if (change?.op === "undo-import") result.removed = written[0]?.removed ?? 0;
      return result;
    },

    // For the hourly reminder run (see server/reminders.mjs): every account
    // with reminders on and a device to send them to. This and the two below
    // run as the owner, since they work across every account.
    async reminderAccounts() {
      await ensureSchema();
      const [rows] = await owner.transaction([owner`
        SELECT user_id AS "userId", reminder_hour AS hour, time_zone AS "timeZone", to_char(reminded_on, 'YYYY-MM-DD') AS "remindedOn"
        FROM profiles p
        WHERE reminder_hour IS NOT NULL AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)`]);
      return rows;
    },

    // Marks each of `due` ({ userId, day }, the account's local date) as
    // reminded that day, skipping any already reminded that day or with a
    // weigh-in on it, and returns the devices of the accounts it marked. It is
    // one statement, so overlapping runs can't both claim an account.
    async claimReminders(due) {
      await ensureSchema();
      const [rows] = await owner.transaction([owner`
        WITH due AS (
          SELECT * FROM unnest(${due.map(item => item.userId)}::text[], ${due.map(item => item.day)}::date[]) AS t(user_id, day)
        ), claimed AS (
          UPDATE profiles p SET reminded_on = due.day
          FROM due
          WHERE p.user_id = due.user_id AND p.reminder_hour IS NOT NULL AND p.reminded_on IS DISTINCT FROM due.day
            AND NOT EXISTS (SELECT 1 FROM weigh_ins w WHERE w.user_id = due.user_id AND w.date = due.day)
          RETURNING p.user_id
        )
        SELECT s.user_id AS "userId", s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN claimed USING (user_id)`]);
      return rows;
    },

    // Forgets devices whose subscription has ended, and turns reminders off
    // for accounts left without a device.
    async removeDevices(endpoints) {
      await ensureSchema();
      await owner.transaction([
        owner`DELETE FROM push_subscriptions WHERE endpoint = ANY(${endpoints}::text[])`,
        owner`UPDATE profiles p SET reminder_hour = NULL, updated_at = now()
            WHERE reminder_hour IS NOT NULL AND NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)`
      ]);
    }
  };
}
