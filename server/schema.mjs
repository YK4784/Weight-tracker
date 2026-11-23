// The database tables. The API applies these on each cold start, so every
// statement must be safe to run again against an existing database. Every
// table holds rows keyed by the Clerk user_id, and deleting an account or its
// data deletes them from each (see deleteRows in store.mjs).
export const schema = [
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id text PRIMARY KEY,
    started boolean NOT NULL DEFAULT false,
    height_cm numeric(4, 1) CHECK (height_cm > 0 AND height_cm <= 400),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Weights are kg to 0.01, so a weight entered in pounds reads back as entered
  // (see roundWeight in model.mjs).
  `CREATE TABLE IF NOT EXISTS weigh_ins (
    user_id text NOT NULL,
    date date NOT NULL,
    weight_kg numeric(6, 2) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 2000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, date)
  )`,
  // The goal (see normalizeGoal in model.mjs). The rate is optional. The other
  // columns are all set or all null. The rate's CHECK of 5 kg a week is the
  // storage bound (GOAL_STORED_MAX_RATE). The lower cap on a new goal depends on
  // its start weight and is checked in parseOp. A CHECK across both columns
  // would fail every later update to a profile that holds an older, faster
  // goal, including a change of units and the reminder run's reminded_on.
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS goal_kg numeric(6, 2) CHECK (goal_kg > 0 AND goal_kg <= 2000),
    ADD COLUMN IF NOT EXISTS goal_start_date date,
    ADD COLUMN IF NOT EXISTS goal_start_kg numeric(6, 2) CHECK (goal_start_kg > 0 AND goal_start_kg <= 2000),
    ADD COLUMN IF NOT EXISTS goal_rate_kg_week numeric(4, 3) CHECK (goal_rate_kg_week > 0 AND goal_rate_kg_week <= 5),
    ADD COLUMN IF NOT EXISTS goal_milestones smallint CHECK (goal_milestones BETWEEN 1 AND 20)`,
  // Databases made before weights were kept to 0.01 kg (and rates to 0.001 kg a
  // week) had one decimal fewer. Widening keeps every value. It only runs while
  // a column is still narrow, so later cold starts don't lock the tables.
  `DO $$
  DECLARE
    widen record;
  BEGIN
    FOR widen IN
      SELECT * FROM (VALUES ('weigh_ins', 'weight_kg', 'numeric(6, 2)', 2), ('profiles', 'goal_kg', 'numeric(6, 2)', 2),
                            ('profiles', 'goal_start_kg', 'numeric(6, 2)', 2), ('profiles', 'goal_rate_kg_week', 'numeric(4, 3)', 3)) AS t(tab, col, type, scale)
      WHERE EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = current_schema()
                      AND c.table_name = t.tab AND c.column_name = t.col AND c.numeric_scale < t.scale)
    LOOP
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s', widen.tab, widen.col, widen.type);
    END LOOP;
  END $$`,
  // An optional note on a weigh-in (see cleanNote in model.mjs). No note is
  // null, never "". char_length counts characters, as noteLength does.
  `ALTER TABLE weigh_ins
    ADD COLUMN IF NOT EXISTS note text CHECK (char_length(note) BETWEEN 1 AND 100)`,
  // The units the app shows (see normalizeUnits in model.mjs). "st" is stones
  // and pounds, and "ft" is feet and inches.
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb', 'st')),
    ADD COLUMN IF NOT EXISTS height_unit text NOT NULL DEFAULT 'cm' CHECK (height_unit IN ('cm', 'ft'))`,
  // The daily reminder (see normalizeReminder in model.mjs): an hour in the
  // account's time zone, null when off. reminded_on is the local date of the
  // last reminder sent, so a day never gets two.
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS reminder_hour smallint CHECK (reminder_hour BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS time_zone text CHECK (char_length(time_zone) BETWEEN 1 AND 64),
    ADD COLUMN IF NOT EXISTS reminded_on date`,
  // The devices that get reminders, one push subscription each (see
  // parseSubscription in push.mjs). A device belongs to the account that last
  // turned reminders on with it.
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint text PRIMARY KEY CHECK (char_length(endpoint) <= 2048),
    user_id text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS push_subscriptions_user_id ON push_subscriptions (user_id)`,
  // Waist measurements at the navel for the body fat estimate (see bodyFat in
  // model.mjs), one a day at most. Centimeters to 0.01, so a waist entered in
  // inches reads back as entered (see roundWaist).
  `CREATE TABLE IF NOT EXISTS waist_measurements (
    user_id text NOT NULL,
    date date NOT NULL,
    waist_cm numeric(5, 2) NOT NULL CHECK (waist_cm >= 10 AND waist_cm <= 400),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, date)
  )`,
  // Which body fat formula applies. Null until the first waist is logged.
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS sex text CHECK (sex IN ('male', 'female'))`,
  // Choices about what the app shows, such as hiding BMI, as one JSON object
  // (see PREFERENCE_KEYS in model.mjs). A key that isn't set takes its default,
  // so a new key needs no migration. Changes merge into it (see store.mjs).
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object')`,
  // The version of the health data policy the account agreed to (see
  // CONSENT_VERSION in model.mjs) and when the server received the agreement.
  // Both null until the account agrees. Deleting the data deletes them too.
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS consent_version text CHECK (char_length(consent_version) BETWEEN 1 AND 32),
    ADD COLUMN IF NOT EXISTS consented_at timestamptz`,
  // Runs first in the transaction of every change that saves data (see
  // needsConsent in ops.mjs), and fails it unless the account agreed to
  // `version`. FOR SHARE holds the profile row until the change commits, so a
  // deletion of the data, which also withdraws the agreement, can't slip in
  // between the check and the change. It is created once and never replaced:
  // a different check needs a new name. Two cold starts that create it at once
  // leave one copy, and the other's error is ignored.
  `DO $$
  BEGIN
    CREATE FUNCTION require_consent(account text, version text) RETURNS void LANGUAGE plpgsql AS $body$
    BEGIN
      PERFORM 1 FROM profiles WHERE user_id = account AND consent_version = version FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Agree to the health data policy first.' USING ERRCODE = 'BL403';
      END IF;
    END
    $body$;
  EXCEPTION WHEN duplicate_function OR unique_violation THEN NULL;
  END $$`
];
