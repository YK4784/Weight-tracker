import { neon } from "@neondatabase/serverless";
import { schema } from "./schema.mjs";
import { CONSENT_VERSION, normalizeConsent, normalizePreferences } from "../baseline/dist/model.mjs";
import { CONSENT_ERROR_CODE, ConsentRequired, needsConsent } from "./ops.mjs";

// The most devices an account can get reminders on.
export const MAX_DEVICES = 10;

// Reads and writes logs in Postgres. Each call is one HTTP round trip: the
// change and a fresh read of the log run together in a single transaction.
// `connect` makes the query function from the URL; tests pass a fake one.
export function createStore(url = process.env.DATABASE_URL, { connect = neon } = {}) {
  if (!url) throw new Error("DATABASE_URL is not set. Connect the Neon database to this project.");
  const sql = connect(url);
  let ready;
  const ensureSchema = () => ready ??= sql.transaction(schema.map(text => sql.query(text))).catch(error => {
    ready = undefined;
    throw error;
  });

  // Every row that belongs to a user, in every table. A new table keyed by
  // user_id must be added here too (npm test checks).
  const deleteRows = userId => [
    sql`DELETE FROM weigh_ins WHERE user_id = ${userId}`,
    sql`DELETE FROM waist_measurements WHERE user_id = ${userId}`,
    sql`DELETE FROM push_subscriptions WHERE user_id = ${userId}`,
    sql`DELETE FROM profiles WHERE user_id = ${userId}`
  ];

  function writes(userId, change) {
    switch (change?.op) {
      case undefined:
        return [];
      // A change without a note keeps the note already on that date (see parseOp).
      case "save-weight":
        return [
          sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)
              ON CONFLICT (user_id) DO UPDATE SET started = true, updated_at = now()`,
          sql`INSERT INTO weigh_ins (user_id, date, weight_kg, note) VALUES (${userId}, ${change.date}::date, ${change.weight}, ${change.note ?? null}::text)
              ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg,
                note = CASE WHEN ${change.note === undefined}::boolean THEN weigh_ins.note ELSE excluded.note END, updated_at = now()`
        ];
      case "update-weight":
        return [sql`UPDATE weigh_ins SET weight_kg = ${change.weight},
                      note = CASE WHEN ${change.note === undefined}::boolean THEN note ELSE ${change.note ?? null}::text END, updated_at = now()
                    WHERE user_id = ${userId} AND date = ${change.date}::date RETURNING 1`];
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
      const guard = needsConsent(change) ? [sql`SELECT require_consent(${userId}, ${CONSENT_VERSION})`] : [];
      const queries = writes(userId, change);
      let results;
      try {
        results = await sql.transaction([
          ...guard,
          ...queries,
          sql`SELECT started, height_cm::float8 AS height, goal_kg::float8 AS goal_weight,
                     to_char(goal_start_date, 'YYYY-MM-DD') AS goal_start_date, goal_start_kg::float8 AS goal_start_weight,
                     goal_rate_kg_week::float8 AS goal_rate, goal_milestones, weight_unit, height_unit, preferences, reminder_hour, time_zone, sex,
                     consent_version, to_char(consented_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS consented_at
              FROM profiles WHERE user_id = ${userId}`,
          sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, weight_kg::float8 AS weight, note
              FROM weigh_ins WHERE user_id = ${userId} ORDER BY date`,
          sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, waist_cm::float8 AS waist
              FROM waist_measurements WHERE user_id = ${userId} ORDER BY date`,
          sql`SELECT endpoint FROM push_subscriptions WHERE user_id = ${userId} ORDER BY created_at, endpoint`
        ]);
      } catch (error) {
        throw error?.code === CONSENT_ERROR_CODE ? new ConsentRequired() : error;
      }
      const [[profile], entries, waists, devices] = results.slice(-4);
      // What the change's own query returned, after the guard.
      const written = results[guard.length];
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
      const result = { log: { started: Boolean(profile?.started), consent, height: profile?.height ?? null, sex: profile?.sex ?? null, goal, units, preferences, reminder, entries, waists } };
      if (change?.op === "update-weight") result.found = written.length > 0;
      if (change?.op === "import") result.imported = written[0]?.imported > 0;
      return result;
    },

    // For the hourly reminder run (see server/reminders.mjs): every account
    // with reminders on and a device to send them to.
    async reminderAccounts() {
      await ensureSchema();
      const [rows] = await sql.transaction([sql`
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
      const [rows] = await sql.transaction([sql`
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
      await sql.transaction([
        sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${endpoints}::text[])`,
        sql`UPDATE profiles p SET reminder_hour = NULL, updated_at = now()
            WHERE reminder_hour IS NOT NULL AND NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)`
      ]);
    }
  };
}
