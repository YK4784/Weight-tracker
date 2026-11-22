// The database tables. The API applies these on each cold start, so every
// statement must be safe to run again against an existing database.
export const schema = [
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id text PRIMARY KEY,
    started boolean NOT NULL DEFAULT false,
    height_cm numeric(4, 1) CHECK (height_cm > 0 AND height_cm <= 400),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS weigh_ins (
    user_id text NOT NULL,
    date date NOT NULL,
    weight_kg numeric(5, 1) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 2000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, date)
  )`,
  // The goal (see normalizeGoal in model.mjs). The rate is optional. The other
  // columns are all set or all null.
  `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS goal_kg numeric(5, 1) CHECK (goal_kg > 0 AND goal_kg <= 2000),
    ADD COLUMN IF NOT EXISTS goal_start_date date,
    ADD COLUMN IF NOT EXISTS goal_start_kg numeric(5, 1) CHECK (goal_start_kg > 0 AND goal_start_kg <= 2000),
    ADD COLUMN IF NOT EXISTS goal_rate_kg_week numeric(3, 2) CHECK (goal_rate_kg_week > 0 AND goal_rate_kg_week <= 5),
    ADD COLUMN IF NOT EXISTS goal_milestones smallint CHECK (goal_milestones BETWEEN 1 AND 20)`
];
