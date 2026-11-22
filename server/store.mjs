import { neon } from "@neondatabase/serverless";
import { schema } from "./schema.mjs";

// Reads and writes logs in Postgres. Each call is one HTTP round trip: the
// change and a fresh read of the log run together in a single transaction.
export function createStore(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set. Connect the Neon database to this project.");
  const sql = neon(url);
  let ready;
  const ensureSchema = () => ready ??= sql.transaction(schema.map(text => sql.query(text))).catch(error => {
    ready = undefined;
    throw error;
  });

  function writes(userId, change) {
    switch (change?.op) {
      case undefined:
        return [];
      case "save-weight":
        return [
          sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)
              ON CONFLICT (user_id) DO UPDATE SET started = true, updated_at = now()`,
          sql`INSERT INTO weigh_ins (user_id, date, weight_kg) VALUES (${userId}, ${change.date}::date, ${change.weight})
              ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg, updated_at = now()`
        ];
      case "update-weight":
        return [sql`UPDATE weigh_ins SET weight_kg = ${change.weight}, updated_at = now()
                    WHERE user_id = ${userId} AND date = ${change.date}::date RETURNING 1`];
      case "delete-weight":
        return [sql`DELETE FROM weigh_ins WHERE user_id = ${userId} AND date = ${change.date}::date`];
      case "set-height":
        return [sql`INSERT INTO profiles (user_id, started, height_cm) VALUES (${userId}, true, ${change.height})
                    ON CONFLICT (user_id) DO UPDATE SET started = true, height_cm = excluded.height_cm, updated_at = now()`];
      case "set-goal": {
        const { weight, startDate, startWeight, rate, milestones } = change.goal;
        return [sql`
          INSERT INTO profiles (user_id, started, goal_kg, goal_start_date, goal_start_kg, goal_rate_kg_week, goal_milestones)
          VALUES (${userId}, true, ${weight}, ${startDate}::date, ${startWeight}, ${rate}, ${milestones})
          ON CONFLICT (user_id) DO UPDATE SET started = true, goal_kg = excluded.goal_kg, goal_start_date = excluded.goal_start_date,
            goal_start_kg = excluded.goal_start_kg, goal_rate_kg_week = excluded.goal_rate_kg_week,
            goal_milestones = excluded.goal_milestones, updated_at = now()`];
      }
      case "clear-goal":
        return [sql`UPDATE profiles SET goal_kg = NULL, goal_start_date = NULL, goal_start_kg = NULL, goal_rate_kg_week = NULL,
                      goal_milestones = NULL, updated_at = now()
                    WHERE user_id = ${userId}`];
      case "start":
        return [sql`INSERT INTO profiles (user_id, started) VALUES (${userId}, true)
                    ON CONFLICT (user_id) DO UPDATE SET started = true, updated_at = now()`];
      case "import":
        // Only into an account with nothing saved yet, so a stale copy never overwrites newer data.
        return [sql`
          WITH empty AS (
            SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = ${userId})
                       AND NOT EXISTS (SELECT 1 FROM weigh_ins WHERE user_id = ${userId})
          ), profile AS (
            INSERT INTO profiles (user_id, started, height_cm)
            SELECT ${userId}, true, ${change.height}::numeric FROM empty
            ON CONFLICT (user_id) DO NOTHING
            RETURNING 1
          ), entries AS (
            INSERT INTO weigh_ins (user_id, date, weight_kg)
            SELECT ${userId}, t.date, t.weight
            FROM empty, unnest(${change.entries.map(entry => entry.date)}::date[], ${change.entries.map(entry => entry.weight)}::numeric[]) AS t(date, weight)
            ON CONFLICT (user_id, date) DO NOTHING
            RETURNING 1
          )
          SELECT count(*)::int AS imported FROM profile`];
      default:
        throw new Error("Unknown change: " + change.op);
    }
  }

  return {
    // Applies `change` (or nothing, for a plain read) and returns the user's log.
    async run(userId, change = null) {
      await ensureSchema();
      const queries = writes(userId, change);
      const results = await sql.transaction([
        ...queries,
        sql`SELECT started, height_cm::float8 AS height, goal_kg::float8 AS goal_weight,
                   to_char(goal_start_date, 'YYYY-MM-DD') AS goal_start_date, goal_start_kg::float8 AS goal_start_weight,
                   goal_rate_kg_week::float8 AS goal_rate, goal_milestones
            FROM profiles WHERE user_id = ${userId}`,
        sql`SELECT to_char(date, 'YYYY-MM-DD') AS date, weight_kg::float8 AS weight
            FROM weigh_ins WHERE user_id = ${userId} ORDER BY date`
      ]);
      const [profile] = results.at(-2);
      const goal = profile?.goal_weight == null ? null : {
        weight: profile.goal_weight, startDate: profile.goal_start_date, startWeight: profile.goal_start_weight,
        rate: profile.goal_rate, milestones: profile.goal_milestones
      };
      const result = { log: { started: Boolean(profile?.started), height: profile?.height ?? null, goal, entries: results.at(-1) } };
      if (change?.op === "update-weight") result.found = results[0].length > 0;
      if (change?.op === "import") result.imported = results[0][0]?.imported > 0;
      return result;
    }
  };
}
