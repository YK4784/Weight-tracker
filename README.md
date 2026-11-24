# Baseline

A daily weight journal with a 14-day moving average and height-based BMI. Each gray dot on the chart is a weigh-in. On a day with a weigh-in, the blue line shows the mean of the weights recorded that day and on the preceding 13 days. The first entry produces an average immediately. A day without a weigh-in keeps the average of the last weigh-in before it, for up to 13 days. So the line holds flat when weigh-ins stop, rather than drifting toward the last few readings as older ones leave the window. After that the day has no average, and the line breaks. The line is dashed and lighter after the last weigh-in, and where its average rests on fewer than 4 weigh-ins, as in a log's first days or with weekly weigh-ins. The dot and value at its end mark the last weigh-in, not the last day drawn. Every figure taken from the average follows the same rule. On a day without a weigh-in, it's as of the last weigh-in, and says "As of" with that date when it isn't today. So nothing changes until the next weigh-in.

Weights show in kilograms, pounds, or stones and pounds, always to one decimal (0.1 kg or 0.1 lb). They are stored in kilograms to 0.01 kg, so a weight entered in pounds reads back exactly as entered, and every calculation runs in kilograms. Where a figure below uses a value "as shown", it is rounded to 0.1 of the unit you chose. With stones, changes and rates are in pounds.

Under the average, the weekly trend gives the slope of a straight line fitted through the last 21 days of weigh-ins, in kilograms or pounds a week. An average runs about a week behind a falling or rising weight, and the fitted line does not. The trend appears once there are 8 weigh-ins spread over at least 14 days. Until then the line under the average says "Your weekly trend shows after 8 weigh-ins over 2 weeks.", or "returns after" in a log where it has shown before, such as after a break (`weeklyTrendShown` in `model.mjs`).

The trend comes with a likely range: the slope give or take two standard errors (`RATE_INTERVAL_ERRORS` in `model.mjs`). The standard error allows for one day's swing carrying into the next, with the same noise the chart's forecast assumes, as described below. For daily weigh-ins that makes it about 1.5 times the textbook one, which takes each day's noise as new and called a flat weight a change too often. From the range, the trend is in one of three states (`calculateRate`), and the line under the average says which (`weeklyTrendWords`):

- **Moving,** when the whole range is on one side of zero and the trend doesn't round to 0.0: "**Down about 0.3 kg a week** · likely 0.1 to 0.5".
- **Steady,** when the whole range is within 0.15 kg a week either way (`RATE_STEADY_BAND`): "**Steady** · within 0.1 kg a week either way", from the range's larger end. Three weeks of weigh-ins seldom pin a trend down that closely, so this rarely shows. It takes about four to six weeks of daily weigh-ins.
- **Not clear yet,** otherwise, when the weigh-ins so far can't tell the trend apart from day-to-day swings: "Down about 0.2 kg a week · a few more weigh-ins will tell", not in bold, and without the range, which would cross zero. When the trend rounds to 0.0, it says "Little change so far · a few more weigh-ins will tell".

The words say "Down" or "Up" rather than a sign, so they read naturally aloud. After any of them, the line adds the 30-day change from above the chart, when there is one: " · −1.4 kg in 30 days". In simulated logs losing 0.4 kg a week, with day-to-day swings of 0.6 kg, the line started with "Down" on 92% of days. The trend was moving on only 44% of them, since three weeks seldom show a loss that slow clearly. A flat weight read as moving in 6–8% of three-week logs.

Like the average, the trend is as of the last weigh-in (`rateAsOf` in `model.mjs`). On a day without one, it's the trend on the last weigh-in's date, and the 30-day change says so: "−1.4 kg in the 30 days to Nov 19". It doesn't change as the 21 days move past older weigh-ins. The log gives the trend for each weigh-in, as it stood on that date. A moving trend shows as a figure, such as "−0.4 kg/wk", and a steady one as "Steady". One that isn't clear yet is a quieter "~−0.2 kg/wk", and while a row shows one, a note under the table says "~ marks a weekly trend that isn't clear yet: the weigh-ins so far can't tell it apart from day-to-day swings."

Above the chart, the change figures compare the 14-day average on your last weigh-in with the average 7, 30 and 90 days before it. The all-time change compares it with your first weigh-in. Each uses the averages as shown. A figure appears only when there is an average on exactly that day. It waits until the log goes back that far, and it is left out while a gap of more than 14 days without weigh-ins leaves that day with no average. The all-time change appears once the log is more than a week old and goes back further than the longest figure shown, so it never repeats another figure. Next to them are the highest and lowest weigh-ins in the same 14 days as the average, with how many days ago each was. They need at least two weigh-ins in those days, and a tie shows the more recent day. When the last weigh-in isn't today, a line over the figures says "As of Nov 19, your last weigh-in.", and the highest and lowest show their dates instead of how many days ago.

A goal has a goal weight, a start date and a start weight, which defaults to the 14-day average on the start date. Whether it is a loss, a gain or staying at a weight comes from those two weights. The distance is split into milestones, 10 by default, each at least 0.1 kg or 0.1 lb. Progress is measured with the 14-day average as shown, so a single light day doesn't count as reaching a milestone. Like the average, it's as of the last weigh-in, and the line under the bar starts "As of Nov 19 · " when that isn't today. Since the average changes only on weigh-in days, a milestone is always reached on one. The chart draws the goal weight as a dashed line and always keeps it in view.

A goal can also have a target rate, typed to 0.01 kg or 0.01 lb a week. Baseline saves a rate no faster than 1.5 kg a week or 1.5% of the start weight a week, whichever is lower, because above about 1.5 kg a week the risk of gallstones climbs steeply ([Weinsier 1995](https://pubmed.ncbi.nlm.nih.gov/7847427/)). The cap is rounded to 0.001 kg, and a rate up to 0.001 kg over it still counts, so a rate typed in pounds can be the nearest 0.01 lb to the cap. The cap applies to every goal, but only a loss goal gets the notes about gallstones. On a loss goal, a rate above 1% of the start weight a week shows a note under the rate. A goal saved before the cap keeps its rate, which still displays and forecasts, but saving any change to the goal needs a rate at or under the cap. Under the progress, a line says when the weight on a loss goal has come down faster than the cap for three weeks. That means the weekly trend was moving down faster than the cap, both as shown, on each of the 21 days up to the last weigh-in, each day's trend being as of the last weigh-in by then. Like the trend, it doesn't change on days without a weigh-in, and goes once the last weigh-in is 14 days old. The first of those days must be at least 14 days after the start date, so the latest trend uses only weigh-ins from after the first two weeks, when much of a quick loss is water. The line never changes the goal or the weigh-ins, and **Hide** removes it for that goal on that device.

The forecast says when the 14-day average would reach each remaining milestone and the goal at a steady rate. It runs from the average on your last weigh-in, from that day, so its dates stay put on days without a weigh-in, and the time until each date counts from today. A milestone the line would already have reached since then is due any day now. You choose the rate:

- **Your target rate:** the optional rate saved with the goal.
- **Last 3 weeks:** the weekly trend. It's used only while it's moving toward the goal. Otherwise it shows "Not clear yet" or "Steady", and the forecast says "Your weekly trend isn't clear yet, so there's no date to forecast." or "Your weight is steady, so there's no date to forecast."
- **Since the start date:** the change in the 14-day average from the start to the last weigh-in, which appears once that's 14 days after the start date.

When the chosen rate is flat or heads away from the goal, the forecast says so and gives no date.

The chart can also show a trend forecast, hidden until you press **Show forecast** above it. A dotted line carries the 14-day average on from your last weigh-in, from that day, moving by the weekly trend as shown, the same figure as under the average. It looks half as far past today as the chart looks back, in whole weeks: 1 week on **14D**, 2 on **30D**, 6 on **90D**, and on **All** half the log, and at most 12 weeks past the last weigh-in. It stops there because over months a straight line overstates how fast weight keeps changing: loss slows as weight falls ([Hall et al., Lancet 2011](https://pubmed.ncbi.nlm.nih.gov/21872751/)). The shaded band around the line is the likely range: if the trend holds, the average lands inside it 8 times in 10. It treats the weigh-ins of the last 21 days as a straight line plus scale noise, and allows for two things. The slope is only an estimate, and an error in it grows with each day ahead. The days ahead also bring new weigh-ins, with noise of their own, into the average, and the forecast starts from the last weigh-in's average, which has noise too. So the band has no width on the day of the last weigh-in and widens from there. After a few days without a weigh-in, it's already wider by today. The noise is how far the weigh-ins sit from the fitted line, and never less than 0.1 kg, about a scale's own error. It isn't new each day, since water and food carry over and a heavy day tends to follow a heavy day. Baseline takes the noise on days *k* apart to be correlated by 0.4 to the power *k*, which fits the spread of day-to-day changes in a 26-year daily record, 0.53% of body weight a day apart and 0.69% a week apart ([Renal Failure, 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/)). So 21 daily weigh-ins count for less than 21 unrelated ones would, while weekly ones are nearly unrelated. In simulations of logs with noise like that, the band held the real average 79–83% of the time, for daily weigh-ins and for three a week, from 1 to 12 weeks ahead. A band that took each day's noise as new would have held it only about 6 times in 10. A line fitted through correlated noise follows some of it, so the noise is scaled up by the same correlations, and the band's width uses Student's *t* with the degrees of freedom that leaves, which widens it for a short log. The band can't allow for a change in what you eat or do.

Under the chart, the forecast is put in words. They follow the weekly trend's state, as the line under the average shows it, so the two always agree. For a moving trend they say, for example, "If your average keeps going down 0.5 kg a week, it would be about **81.3 kg on Dec 8**, likely 80.9–81.7 kg." When the trend isn't moving, the line still follows its slope, and the words give only the range: "Your weekly trend isn't clear yet, so on Dec 8 your average would likely be **84.1–86.0 kg**.", or "Your weight is steady, so on Dec 8 …" for a steady trend. In the first 4 weeks of a loss, counted from the first weigh-in, or from the start of a loss goal if that's later, they add "Early weeks often include water loss, so the pace may slow." Without a weekly trend there's no forecast, and the words say "The forecast follows your weekly trend, which shows after 8 weigh-ins over 2 weeks.", or "returns after" in a log where it has shown before. While the forecast shows, the legend adds **Forecast**, and a dashed hairline marks the last weigh-in, where the forecast begins. The forecast takes the place of the days after the last weigh-in, which otherwise hold its average, and its last value takes the place of the last weigh-in's beside the dot. The line still ends at the last weigh-in. **Hide forecast** hides it again. It starts hidden on every visit.

The monthly summary covers each calendar month, newest first. A month starts with the 14-day average as it began, which is the average on the last day of the month before. It ends with the average on its last weigh-in. That's the average on its last day too, since a day without a weigh-in keeps the last one's average. So a month's figures don't change on the days after its last weigh-in, even when a break leaves its last day without an average. Each month picks up where the one before ended, so the monthly changes add up to the change over the whole log. Without an average on the last day of the month before, because the log started partway through the month or after a break of more than 14 days, the month starts at its first weigh-in instead. When an average comes from a weigh-in on another day than the one it stands for, that weigh-in's date shows next to the figure. That happens when a month's last weigh-in came before its last day, when a month starts at its first weigh-in, and when a start is held over from a weigh-in before the month before ended. The change uses both averages as shown. The weekly trend is the one described above, as it stood on the month's last weigh-in. It shows as in the log, with "~" before one that isn't clear yet, which the note under the summary explains. The lowest weigh-in is the month's lowest single reading, and a tie shows the more recent day. The current month is marked as partial and runs through today. With a goal, each month lists the milestones the average first reached that month, counting from the goal's start date. A milestone the average moves back past and then reaches again is listed only once. Months without weigh-ins share a single line.

Body fat is an estimate from the U.S. Army's one-site tape formula, from Army Directive 2023-11, with the equations in ALARACT 046/2023, table B-5. It uses your waist measured at the navel and your weight, with one formula for men and another for women:

- **Male:** −26.97 − 0.12 × weight in pounds + 1.99 × waist in inches
- **Female:** −9.15 − 0.015 × weight in pounds + 1.27 × waist in inches

The weight is the 14-day average on the day of the waist measurement, so one heavy or light day moves the estimate little. On a day without a weigh-in, that's the average as of the last one. An estimate needs a weigh-in in the 14 days up to that day, and a weigh-in added later within those days updates it. Baseline shows the result to 0.1%. The Army rounds to a whole percent. No estimate shows for a result outside 0 to 100%, which a waist typed in the wrong unit gives. The change since your first estimate uses both as shown. Waists are stored in centimeters to 0.01 cm, so a waist entered in inches reads back as entered. They show to 0.1 cm, or to 0.1 in when your height shows in feet and inches.

Reminders are push notifications. Once an hour, a scheduled function checks each account with reminders on. It sends a reminder when the chosen hour has come in the account's time zone, or came up to two hours earlier that day in case a run was missed, and there is no weigh-in for that local date yet. Each device that turned reminders on gets one notification, at most once a day, and the push service drops it if it can't be delivered before local midnight. A device whose subscription has ended is forgotten. An account left with no devices has reminders turned off.

## Set up sign-in

Baseline uses [Clerk](https://clerk.com) for accounts, with email and Google sign-in. The sign-in screen comes from Clerk's prebuilt components, loaded from your Clerk app's Frontend API, so the page itself needs no build step.

1. Create an application in the [Clerk Dashboard](https://dashboard.clerk.com). Turn on **Email** and **Google** as sign-in options.
2. Open **API keys** and copy the **Publishable key**. It starts with `pk_test_`.
3. Paste it into `baseline/dist/config.mjs`:

   ```js
   export const CLERK_PUBLISHABLE_KEY = "pk_test_…";
   ```

The publishable key is meant for browser code and is safe to commit. Never put a secret key (`sk_…`) in this repository.

A development instance (`pk_test_`) works on `localhost` and on Vercel preview URLs, and its Google sign-in runs on Clerk's shared credentials. Baseline still uses one. A production instance (`pk_live_`) needs a domain you own, because Clerk does not issue production instances for `*.vercel.app`, and its own Google OAuth client. [Move to a Clerk production instance](#move-to-a-clerk-production-instance) has the steps.

The key names the Frontend API host that Clerk's scripts load from. Two other places name that host, and must change with the key:
- the `preconnect` link in `baseline/dist/index.html`, which opens a connection to the host before any script asks for it, so sign-in loads sooner;
- `script-src` and `connect-src` in the Content Security Policy in `vercel.json` (see [Security headers](#security-headers)).

`npm test` fails until all three match. Baseline turns Clerk's telemetry off (`telemetry: false` in `auth.mjs`). A development instance would otherwise report which of Clerk's components the page uses to `clerk-telemetry.com`.

## Move to a Clerk production instance

Do this before Baseline has users who'd mind signing up again. Clerk's own guides are the [production deployment guide](https://clerk.com/docs/guides/development/deployment/production) and the [Google setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google). Below, `baseline.example.com` stands for your domain.

1. **Add the domain to Vercel.** In the project's **Settings → Domains**, add `baseline.example.com` and follow Vercel's DNS instructions. Sign-in will work only on this domain, not on `*.vercel.app`.
2. **Create the production instance.** In the [Clerk Dashboard](https://dashboard.clerk.com), switch from **Development** to **Production** at the top and create the production instance. Clone the development instance's settings, which copies settings but no users. Give it `baseline.example.com` as the application domain.
3. **Add Clerk's DNS records.** The production instance's **Domains** page lists CNAME records: `clerk.baseline.example.com` for the Frontend API, `accounts.baseline.example.com` for the account portal, and the email records (`clkmail`, `clk._domainkey` and `clk2._domainkey`). Add each at your DNS provider. If that's Cloudflare, leave the records unproxied (DNS only). Wait until Clerk shows them verified and its certificates are issued.
4. **Make a Google OAuth client.** In the [Google Cloud Console](https://console.cloud.google.com), create a project for Baseline and open **Google Auth Platform**:
   - **Branding:** the app name Baseline, a support email (`[contact email address]`), the home page `https://baseline.example.com` and the privacy policy `https://baseline.example.com/health-data-privacy.html`.
   - **Audience:** External.
   - **Data access:** only `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. Baseline needs nothing more. These are Google's non-sensitive scopes, so the app shouldn't need Google's verification review.
   - **Clients:** create a **Web application** client. Add `https://baseline.example.com` under **Authorized JavaScript origins**. Under **Authorized redirect URIs**, add the redirect URI that Clerk shows in the production instance's **SSO connections → Google**, once you choose **Use custom credentials**. It looks like `https://clerk.baseline.example.com/v1/oauth_callback`.
   - Paste the client ID and client secret into that Clerk page. Never put the secret in this repository.
   - Back on **Audience**, publish the app, so that anyone can sign in rather than only test users.
5. **Check the production instance's settings.** Email and Google should be the sign-in options, as in development. Turn on the setting that lets users delete their own accounts, or **Delete my account** stays hidden (see [Your data](#your-data)).
6. **Swap the key.** Copy the production **Publishable key** (`pk_live_…`) from **API keys**, then:
   - replace `CLERK_PUBLISHABLE_KEY` in `baseline/dist/config.mjs`;
   - change the `preconnect` link in `baseline/dist/index.html` to `https://clerk.baseline.example.com`;
   - in `vercel.json`, replace `https://enabling-duck-7464.clerk.accounts.dev` in `script-src` and `connect-src` with `https://clerk.baseline.example.com`;
   - run `npm test`, which fails until all three agree and names the host it expects;
   - if `CLERK_PUBLISHABLE_KEY` is set in Vercel's environment variables, where it overrides the key on the server, change it to the new key or delete it.
7. **Make sure nothing is waiting on a device.** On every device that has used Baseline, check that the "Saved on this device" line has gone. After the switch nobody is signed in, and Baseline deletes a device's waiting changes when it finds nobody signed in.
8. **Push.** Pushing to `main` deploys the switch. Everyone is signed out, and signs up again on the production instance.
9. **Move each person's data** to their new account, as below.

After the switch, a production key signs in only on `baseline.example.com`. To sign in on `npm start`'s `127.0.0.1`, put the development key in `config.mjs` for the session and don't commit it. The server reads the same file.

### Move the development accounts' data

Each Clerk instance has its own user IDs, and every row in the database is keyed by one. After the switch, people's logs are still there, under their development IDs, and their new accounts start empty. Baseline doesn't move them by itself. The plan is to pair each development ID with the production ID that has the same email address, and then move the rows in one transaction:

1. **Before you push,** open the development instance's **Users** in the Clerk Dashboard and note each user's ID (`user_…`) and email address. This list holds email addresses, so keep it to yourself and out of the repository.
2. **Ask each person to sign up again** on the production instance with the same email address, or with the same Google account. They see the consent step and an empty log. Ask them not to log anything until their data has moved.
3. **Pair the IDs.** In the production instance's **Users**, find each person's new ID. Pair a development ID with a production ID only when the two have the same verified email address.
4. **Move the rows.** In the Neon console, open the **SQL Editor** on the production branch and database. Put the pairs in the `INSERT` and run the whole script as the owner role, the user in `DATABASE_URL`, which row-level security doesn't bind. `SELECT current_user;` shows which role the editor uses.

   ```sql
   BEGIN;

   CREATE TEMP TABLE moves (old_id text PRIMARY KEY, new_id text NOT NULL UNIQUE) ON COMMIT DROP;
   INSERT INTO moves (old_id, new_id) VALUES
     ('user_DEVELOPMENT_ID_1', 'user_PRODUCTION_ID_1'),
     ('user_DEVELOPMENT_ID_2', 'user_PRODUCTION_ID_2');

   -- Stops, and moves nothing, if a new account has already saved weigh-ins or waists.
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM moves m
                WHERE EXISTS (SELECT 1 FROM weigh_ins w WHERE w.user_id = m.new_id)
                   OR EXISTS (SELECT 1 FROM waist_measurements w WHERE w.user_id = m.new_id)) THEN
       RAISE EXCEPTION 'A new account already has weigh-ins or waists. Nothing was moved.';
     END IF;
   END $$;

   -- A new account that has only agreed to the policy, or turned reminders on,
   -- takes the old account's profile and devices instead.
   DELETE FROM profiles p USING moves m
     WHERE p.user_id = m.new_id AND EXISTS (SELECT 1 FROM profiles o WHERE o.user_id = m.old_id);
   DELETE FROM push_subscriptions s USING moves m WHERE s.user_id = m.new_id;

   UPDATE profiles p SET user_id = m.new_id FROM moves m WHERE p.user_id = m.old_id;
   UPDATE weigh_ins w SET user_id = m.new_id FROM moves m WHERE w.user_id = m.old_id;
   UPDATE waist_measurements w SET user_id = m.new_id FROM moves m WHERE w.user_id = m.old_id;
   UPDATE push_subscriptions s SET user_id = m.new_id FROM moves m WHERE s.user_id = m.old_id;

   -- Should be 0: no row left under a development ID.
   SELECT count(*) AS left_behind FROM (
     SELECT user_id FROM profiles UNION ALL SELECT user_id FROM weigh_ins
     UNION ALL SELECT user_id FROM waist_measurements UNION ALL SELECT user_id FROM push_subscriptions
   ) AS t WHERE user_id IN (SELECT old_id FROM moves);

   COMMIT;
   ```

5. **Tell each person to reload.** Their log, settings, agreement and reminder devices are back, under the new account.

If the script stops because a new account already has weigh-ins, decide with that person which entries to keep, delete the others in the app or in the database, and run it again for them. If something looks wrong afterwards, restore the database to a moment before the script in the Neon console, within the 6-hour history window, and delete the backup branch the restore leaves (see `docs/breach-runbook.md`). Then delete the development instance's users in the Clerk Dashboard, once everyone's data has moved, or keep the instance for local work.

## Set up the database

Logs are saved in Postgres from [Neon](https://vercel.com/marketplace/neon), which is the Postgres option in Vercel's **Storage** tab. Create one from the repository root with the [Vercel CLI](https://vercel.com/docs/cli), after `vercel link`:

```sh
vercel integration add neon --billing-plan free_v3 --meta region=iad1 --meta auth=false
```

This connects the database to the project and adds `DATABASE_URL` to its environment variables. The API creates its tables on its first request, so there is no migration to run.

The API lives in `api/log.mjs`, with its code in `server/`. It accepts only requests carrying a Clerk session token. It checks that token against the signing keys your Clerk app publishes, so it needs no Clerk secret key.

### Limit the app to each user's rows

Every query in `server/store.mjs` names the signed-in user in its `WHERE` clause. Row-level security is a second lock behind it, in the database itself:
- `server/schema.mjs` turns on row-level security on all four tables, with one policy each, `own_rows`. It shows and accepts only the rows whose `user_id` equals the setting `app.user_id`, and no rows without it.
- `run` in `store.mjs` makes `SELECT set_config('app.user_id', …, true)` the first statement of every request's transaction. `true` keeps it to that transaction.
- So a query that forgot its `WHERE` clause still reads and writes only the signed-in user's rows.

The policies bind every role except the one that owns the tables. So the app's requests need a role of their own, `baseline_app`, which owns nothing and can only read and write rows. The owner, in `DATABASE_URL`, still creates and updates the tables on a cold start and runs the hourly reminder job, which reads every account's reminder. Requests use the role in `DATABASE_URL_APP`. Until that's set, they run as the owner, as before, and only the `WHERE` clauses keep users apart.

Moving a device from one account to another, which turning reminders on does, needs the other account's row. `release_device`, a function in `schema.mjs` that runs as the owner, deletes that one row by its endpoint before the new account adds it.

To turn it on:

1. **Make a password** for the role, and keep it out of the repository:

   ```sh
   node -e 'console.log(require("node:crypto").randomBytes(24).toString("base64url"))'
   ```

   Neon wants about 60 bits of entropy. This has 192. If Neon turns it down, for example for a character repeated three times in a row, run it again.
2. **Create the role with SQL.** In the Neon console, open the **SQL Editor** on the production branch and the `neondb` database. Don't use the console's **Roles** page: roles made there join `neon_superuser`, which bypasses row-level security. First check that the editor runs as the owner, the user in `DATABASE_URL` (normally `neondb_owner`):

   ```sql
   SELECT current_user;
   ```

   Then run this, with your password in place of the placeholder:

   ```sql
   CREATE ROLE baseline_app LOGIN PASSWORD 'paste-the-password-here' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   GRANT CONNECT ON DATABASE neondb TO baseline_app;
   GRANT USAGE ON SCHEMA public TO baseline_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON profiles, weigh_ins, waist_measurements, push_subscriptions TO baseline_app;
   -- Tables the owner creates later get the same grants.
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baseline_app;
   ```

3. **Check the role.** This should return `false` in every column:

   ```sql
   SELECT rolsuper, rolbypassrls, rolcreaterole, pg_has_role('baseline_app', 'neon_superuser', 'MEMBER') AS neon_superuser
   FROM pg_roles WHERE rolname = 'baseline_app';
   ```

4. **Check it on a branch first,** as the next section says, if you'd like to see it work before production does.
5. **Add `DATABASE_URL_APP` in Vercel.** It's `DATABASE_URL` with the user and password swapped: `postgresql://baseline_app:<password>@<the same host as DATABASE_URL>/neondb?sslmode=require`. In the project's **Settings → Environment Variables**, add it for **Production** only and mark it **Sensitive**. Preview deployments can use a database branch of their own, and the app refuses to start with a `DATABASE_URL_APP` that points at a different database from `DATABASE_URL`. Then redeploy the latest production deployment.
6. **Check the app.** Log a weigh-in, edit and delete it, and turn reminders on. Then look at the function logs of `/api/log` in Vercel. `SetupError APP_DATABASE_MISMATCH` means the variable points at another database. `NeonDbError 42501` means a grant is missing.

To turn it off, delete `DATABASE_URL_APP` and redeploy. The policies stay, and the owner isn't bound by them. If the role's password may have leaked, set a new one with `ALTER ROLE baseline_app PASSWORD '…'`, update the variable and redeploy.

### Check row-level security on a branch

`server/tests/rls.test.mjs` proves the policies against a real Neon database. It runs as part of `npm test` when `TEST_DATABASE_URL` is set, and is skipped otherwise. It shows that `app.user_id` lasts for every statement of one HTTP transaction and no longer, that a query without a `WHERE` clause returns only the signed-in user's rows, that each kind of change works as a role that owns nothing, that a device moves between accounts, and that the reminder job still finds and claims an account. It makes its own role, `baseline_rls_test`, with the same grants as `baseline_app`, and drops it at the end.

Never point it at the production database: it adds and deletes rows. It refuses the database named in `.env.local` or the environment. Use a schema-only branch, which has the tables and none of the data:

1. In the Neon console, open **Branches → New branch**. Choose `main` as the parent, choose **Schema only**, and keep **Automatically delete branch after** at 1 hour.
2. Open **Connect** for the new branch, with the `neondb` database and the owner role, and copy the connection string.
3. Run:

   ```sh
   TEST_DATABASE_URL='postgresql://…' npm test
   ```

To test a role you made yourself on the branch, such as `baseline_app`, also set `TEST_DATABASE_URL_APP` to its connection string. The test then uses it and creates no role.

## Set up reminders

Reminders are web push notifications signed with a VAPID key pair. The public key is `PUSH_PUBLIC_KEY` in `baseline/dist/config.mjs`, and it is safe to commit. The private key must stay secret:

1. In the Vercel dashboard, open the project's **Settings → Environment Variables** and add `VAPID_PRIVATE_KEY` for Production, then redeploy.
2. Push services can contact the sender through a subject. It defaults to `https://` and the project's production domain, from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. That variable needs **Automatically expose System Environment Variables**, which is on by default. To use a different URL or a `mailto:` address, set `VAPID_SUBJECT`.

`vercel.json` runs `api/remind.mjs` every hour with [Vercel Schedules](https://vercel.com/docs/schedules), which is in beta. On the Hobby plan each run starts up to 15 minutes after the hour, and an hourly schedule uses about 730 of the plan's 5,000 runs a month. The schedule makes the function private, so it has no public URL and needs no secret. Schedules run on production deployments. The run's counts appear in the function's logs.

To replace the key pair, run the following command, then put the public key in `config.mjs` and the private key in `VAPID_PRIVATE_KEY`. Devices that turned reminders on with the old key need to turn them on again.

```sh
node -e 'const k = require("node:crypto").generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" }); console.log("PUSH_PUBLIC_KEY=" + Buffer.concat([Buffer.from([4]), Buffer.from(k.x, "base64url"), Buffer.from(k.y, "base64url")]).toString("base64url") + "\nVAPID_PRIVATE_KEY=" + k.d)'
```

## Security headers

`vercel.json` gives every response, pages and API alike, these headers:

- **`Content-Security-Policy-Report-Only`:** the Content Security Policy, which says where the page may load code and connect to. It's report-only for now: browsers allow everything and report what the policy would block.
- **`Strict-Transport-Security: max-age=63072000; includeSubDomains`:** browsers use only HTTPS for two years. Vercel already sends `max-age=63072000; includeSubDomains; preload` on `*.vercel.app`, and `max-age=63072000` without subdomains on a custom domain. This adds `includeSubDomains` on your domain, so every subdomain of it must serve HTTPS, as Clerk's do.
- **`X-Content-Type-Options: nosniff`:** files are used only as the type they're served as.
- **`Referrer-Policy: strict-origin-when-cross-origin`:** other sites see only Baseline's origin, never a page's path.
- **`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`:** no page can ask for these.
- **`X-Frame-Options: DENY`:** no other site can show Baseline in a frame, along with the policy's `frame-ancestors 'none'`.

The policy lets in Baseline's own files and Clerk, and nothing else, following [Clerk's CSP guide](https://clerk.com/docs/guides/secure/best-practices/csp-headers):

| Directive | Sources | Why |
|---|---|---|
| `default-src` | `'self'` | Anything not listed below: only Baseline's own files. |
| `script-src` | `'self'`, the Frontend API host, `https://challenges.cloudflare.com`, `https://*.protect.clerk.com` | Baseline's modules, Clerk's scripts, Cloudflare's bot check on sign-up, and Clerk's fraud protection, which loads a script from `cdn.protect.clerk.com`. No inline scripts and no `eval`. |
| `connect-src` | `'self'`, the Frontend API host, `https://*.protect.clerk.com:*` | `/api/log`, Clerk's API, and the fraud protection's checks, which use ports other than 443. |
| `img-src` | `'self'`, `https://img.clerk.com`, `data:` | Baseline's icons, and Clerk's logos and avatars. |
| `style-src` | `'self'`, `'unsafe-inline'` | Clerk's components add their styles as the page runs. |
| `frame-src` | `https://challenges.cloudflare.com`, `https://*.protect.clerk.com` | The bot check's frame. |
| `worker-src` | `'self'`, `blob:` | The service worker. |
| `font-src` | `'self'` | Funnel Sans. |
| `object-src`, `base-uri`, `frame-ancestors` | `'none'` | No plugins, no `<base>` tag, and no framing. |
| `form-action` | `'self'` | Forms post only to Baseline. |
| `report-uri` | `/api/csp-report` | Where browsers send reports. |

The Frontend API host comes from the publishable key, so it changes with the key (see [Set up sign-in](#set-up-sign-in)), and `npm test` checks that it matches.

**Reports.** `api/csp-report.mjs` logs each report as one line, such as `CSP violation: script-src-elem blocked cdn.example.com`: the directive and the host, never the page's address or the rest of the URL. Find them in the Vercel dashboard under **Logs**, filtered to `/api/csp-report`. Browser extensions that inject scripts or styles cause some reports that mean nothing about Baseline.

**Trying it locally.** `npm start` sends the same headers as `vercel.json`. `npm start -- --enforce-csp` sends the policy as `Content-Security-Policy`, so the browser blocks what it would report. Check the browser's console for "Content Security Policy" while you sign in, sign up, sign in with Google, open the avatar menu and **Manage account**, turn reminders on, and sign out.

**When to enforce it.** Switch the policy on once:
1. Baseline runs on the Clerk production instance, with the policy naming its host. The host changes in the switch, so enforce after it, not before.
2. A week or so of reports on the production domain shows nothing but extensions.
3. The local check above passes with `--enforce-csp`.

To switch it on, rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `vercel.json` and push. `npm test` accepts either. To go back, rename it back.

## Rate limit

`/api/log` has no rate limit of its own. A counter in the function wouldn't work, because Vercel runs many copies of a function that share no memory, and each would count only its own requests. Vercel's firewall counts at its edge instead. WAF rate limiting is on every plan: Hobby allows one rate-limit rule per project, and Pro allows 40. To add the rule:

1. In the Vercel dashboard, open the project and choose **Firewall**, then **Configure** at the top right, then **+ New Rule**.
2. Name it, for example, "API rate limit".
3. Under **If**, choose **Request Path**, **Equals**, `/api/log`.
4. Under **Then**, choose **Rate Limit**, and continue past the pricing note. Hobby includes 1,000,000 allowed requests.
5. Choose **Fixed Window**, a window of 60 seconds, a limit of 120 requests and the **IP Address** key.
6. Choose **Log** as the action at first, then **Save Rule**, **Review Changes** and **Publish**.
7. After a week of logs without real users being caught, edit the rule's action to **Too Many Requests (429)** and publish again.

One person uses a few requests a minute, so 120 leaves room for several people behind one address and for a device sending a backlog of changes. Keep the rule on `/api/log` alone. On Hobby it's the only rate-limit rule, and covering `/api/csp-report` too would let a page full of reports hold back the same address's saves. Counters are kept per region.

The app treats a 429 as a failure that may pass, never as a refusal. A change waiting on the device stays there and is sent again a minute later. A change you're waiting on is undone, with **Try again**, as for any other failed save. Clerk limits sign-in attempts on its side.

## Logs

The server's log lines in Vercel never hold a weight, a note, an email address, a user ID or a push endpoint:
- An error is logged by `logError` in `server/log.mjs` as `[a1b2c3d4] POST /api/log save-weight failed: NeonDbError 23514`: a short request ID, what failed, the error's kind and its code. That's a Postgres SQLSTATE or a Node.js code, never the message, which for a database error can include the row being saved. A problem with the setup, such as a missing environment variable, is a `SetupError` with a code that says which, such as `NO_DATABASE_URL` or `NO_VAPID_PRIVATE_KEY`.
- The hourly reminder run logs its counts, and a reminder that couldn't be sent logs the push service's status or the error's kind.
- `/api/csp-report` logs a report's directive and blocked host.

`npm test` checks that a constraint error's detail never reaches the log. Vercel's own request log, which the server doesn't write, records each request's path, status and IP address.

## Offline use

The service worker in `baseline/dist/sw.js` keeps a copy of the app's own files: the page, its modules and styles, the font, the icons and the manifest. They're listed in `SHELL` at the top of the file. Each file comes from the network first, and the answer replaces the copy, so a deploy reaches the next load that has a connection. The copy is used when the network fails, returns an error or takes more than 3 seconds. A page that opened from the copy gets its modules from the copy too, so it never mixes versions. The worker never handles `/api/` requests, other sites such as Clerk, or anything but `GET`.

When you add a file to `baseline/dist/`, add it to `SHELL`, or to the list of files left out on purpose in `baseline/tests/worker.test.mjs`. `npm test` fails until you do. When `SHELL` changes, bump the version in the cache's name, now `baseline-shell-v3`, so the new worker starts a fresh cache and deletes the old one. Edits to a listed file need no bump.

Clerk's scripts load from its servers on every start, through a redirect that browsers can't cache, so sign-in can't load offline. Baseline shows the copy of the log kept on the device instead, and loads sign-in when the connection returns.

## Run locally

With Node.js 20.12 or later, run the following commands from the repository root.

```sh
npm install
vercel env pull .env.local
npm start
```

Open [Baseline locally](http://127.0.0.1:4173/). `npm start` serves the page from `baseline/dist/` and runs the API from `api/log.mjs` and `api/csp-report.mjs`, using the `DATABASE_URL` in `.env.local`, and `DATABASE_URL_APP` if it's there. It sends the headers in `vercel.json`, as [Security headers](#security-headers) describes. Reminders can be turned on locally, but only Vercel sends them. Run `npm test` to check the calculations, including body fat against the Army's worked examples, the API's input checks, the units a new account starts with, the check before saving a weigh-in that looks mistyped and the question it asks, the reminder schedule, the push encryption, the copy of the log kept on the device, the old browser log the first-run screen waits for, the changes that wait on the device and replay on top of it, the downloads, the word a deletion needs, and the change that undoes deleting a weigh-in, a waist measurement or the goal, which the server takes as it is. It also checks that deleting an account reaches every table in `server/schema.mjs`. And it checks that `index.html` preloads every module and connects early to the Frontend API in `config.mjs`, and that the service worker keeps every file in `baseline/dist/` that the app needs and leaves the API and Clerk alone. It checks the state the overview shows (an empty log, a weigh-in in the last 14 days, or a break, with the last weigh-in's date and average), that on days without a weigh-in the average and every figure from it (the changes, the weekly trend, goal progress and its forecast, the months, milestones, body fat, the fast loss line and the chart's forecast) stay as of the last weigh-in instead of drifting, which parts of the chart's line are drawn dashed, whether the weekly trend has shown before, the weekly trend's likely range, its three states and their words, how often a flat weight reads as moving and a slow, noisy loss reads as down, how the charts pick the nearest day, that a vertical swipe on a chart scrolls the page, the key for note marks, the label of the log bar on phones, that every weight field has the inputs a change of unit needs, the first-run screen's included, that each form that saves a weigh-in has room under the weight for that question, in a live region, and that a tapped reminder and the home-screen shortcut open today's weigh-in. It checks that every `:hover` style sits in `@media (hover: hover)`, that small controls get a 44-pixel hit area, that each button's name for screen readers starts with what it shows, and that **Remove goal** asks first. It checks the agreement to the health data policy too, as [Privacy](#privacy) describes. And it checks the security headers in `vercel.json` and that `npm start` sends them, that the Content Security Policy names the Frontend API in `config.mjs`, that every request's transaction sets the user for row-level security first, that every table has a policy, that the server's log lines carry no values, and what a CSP report logs. `server/tests/rls.test.mjs` runs only against a Neon branch, as [Check row-level security on a branch](#check-row-level-security-on-a-branch) describes.

## Using the tracker

Save a weight and a date in **Log a weigh-in**. The arrows beside the date move it back or forward one day and stop at today. Saving again on the same date updates that entry. A line under **Save entry** says "You have a weigh-in on this date." when the date has one. "Choose an earlier date to add a past weigh-in." shows in a log's first 14 days, or once a date other than today is picked, and otherwise there's no line. An empty log's says "Your first weigh-in starts your log." The form shows that day's weight, and saving from it keeps any note the day has. A note of up to 100 characters, such as "after travel", is added or changed by opening the weigh-in from the **Weight log** or **Recent entries**, or with **Add a note** in the log sheet on a phone. Notes appear under their weigh-ins in the tables and in the chart's tooltip, and each day with a note has a short mark under the chart. Choose **kg**, **lb** or **st** (stones and pounds) beside **Weight** to change the unit of every weight in Baseline. Baseline calculates BMI from your height and the latest recorded weight, and shows that weigh-in's date beside it. Until you've entered a height, **Add height** next to **BMI** opens the height dialog. After that, the height is in **Settings**. Use **Set** or **Edit** next to **Goal** to set, change or remove a goal. **Remove goal** asks first, in the dialog: "Remove your goal? Your weigh-ins stay.", with **Keep goal** and **Remove goal**. For the first two weeks of a log without a goal, a quiet line under the average, **Set a goal when you’re ready**, opens the same dialog. It goes once there's a goal, or once the first weigh-in is 14 days old. Progress appears under the average, the goal shows as a dashed line on the chart, and the **Forecast** section gives the expected dates. The **Trend** section shows how much your average has changed over 7, 30 and 90 days and since your first weigh-in, and your highest and lowest weigh-ins of the last 14 days.

To read a day from the chart, point at it, or tap it on a touch screen. A box beside the line gives the date, the 14-day average, that day's weigh-in and its note. On a day without a weigh-in, it says "No weigh-in · average as of Nov 19", with the date of the weigh-in whose average the day keeps. A pointer picks the nearest day with a point on the chart, within 8 pixels for a mouse or 20 for a finger or pen, or half a day's width if that's more, so it skips the days a long break leaves without an average. After a tap, the box stays when you lift your finger, and tapping anywhere off the chart, or on the chart away from its points, closes it. Drag sideways along the chart to move through the days, past any gap in the line. A vertical swipe that starts on the chart scrolls the page and leaves the box as it was. Under the chart, a short mark shows each day with a note, and the legend adds **Note** while one is in view. A tap on or near a mark opens that day, even when other days are closer, which matters on **All**, where a day can be narrower than a pixel. With the forecast showing, the forecast's days can be read the same way, after the last weigh-in's, and the box gives the forecast average and its likely range. The body fat chart works the same way, picking the nearest measurement however far it is. With the mouse, the box goes when the pointer leaves the chart. From the keyboard, focus a chart and use the left and right arrow keys to step through the days, **Home** and **End** for the first and last, and **Escape** to close the box. The arrow keys start on today, even with the forecast's days after it. A screen reader reads each day as you move to it. On a phone, the box moves up to stay clear of the log bar when the chart runs under it.

On a phone, or any screen up to 600 pixels wide, a bar fixed at the bottom of the overview and the log reads **Log today’s weight**. It takes the place of the log's **Log a weigh-in** button, and it isn't on Settings or Your data. Tapping it opens a sheet from the bottom of the screen, headed with today's date, such as "Today, Mon Nov 23". The weight field already has focus, with your unit beside it, and a second field for pounds with stones. The sheet's bottom follows the top of the on-screen keyboard, so **Save entry** sits just above it. Enter saves where the keyboard has one. **Add a note** opens a note field. **Another day** closes the sheet and goes to **Log a weigh-in**, set to yesterday, with the weight you typed. The form has no note field, so a note typed in the sheet isn't carried over. Once today has a weigh-in, the bar shows it in your unit, such as "Today 84.9 kg · Edit", as an outlined button instead of a blue one. It opens the sheet with that weigh-in and its note, to change, and the button reads **Update entry**. A note left behind **Add a note** changes nothing. The sheet saves as the form does, with the same messages, and a failed save offers **Try again**. What you typed stays in the sheet until it's saved, so after a failure it opens with the same weight and note. The bar goes while a dialog is open or a field has the keyboard, and messages show above it. On wider screens there's no bar or sheet, and the form is the way in. Until a new account has used the first-run screen, the bar on the log goes to that screen instead.

Before it saves a weigh-in that looks mistyped, Baseline asks. **Log a weigh-in**, the log sheet and the edit dialog check each weigh-in against a reference: the average of the weigh-ins in the 13 days before its date or, with fewer than two of those, the nearest weigh-in before it. The date's own weigh-in, which a save replaces, and later ones don't count. A weigh-in more than 5% from the reference is asked about. Each week the reference's latest weigh-in is older than one adds a point, so it's 6% after 8 to 14 days and 30% at 180 days. Past 180 days, and for a first weigh-in, nothing is asked. A note under the weight field gives the likely cause, checked in this order:

- **A unit mix-up:** the number typed, read in another of kg, lb and st, comes within 3% of the reference. For example, 190 typed in kg after 85 kg reads as 190 lb: "That’s 124% above your last weigh-in (85.0 kg on Nov 22). Did you mean 190.0 lb?", with **Save as 190.0 lb**, which saves 86.18 kg, and **Save 190.0 kg**. It works the other way too, for kilograms or stones typed in pounds.
- **A slipped decimal point:** the number divided or multiplied by 10 comes within 3%. "Did you mean 84.9 kg?", with **Save 84.9 kg** and **Save 849.0 kg**.
- **Anything else:** "That’s 7% below your last weigh-in (84.9 kg on Nov 22). Save it anyway?", with **Save 79.0 kg**, and **Change it**, which goes back to the weight.

When the reference is an average, the note says "your 14-day average (84.9 kg)", with its date when that isn't today. For a date with weigh-ins after it, it says "your previous weigh-in". Screen readers hear the note, and focus moves to its first button. Nothing is saved, and the weight typed isn't changed, until a button is tapped, so the sheet and the dialog stay open until then. Typing a weight, picking another date or closing the form takes the note away. Saving a weigh-in again at the weight it has, as when changing its note, asks nothing. After **Save as** in another unit, the message that the weigh-in is saved offers **Show weights in lb from now on**, or kg, or stones and pounds, for 10 seconds. The server still takes any weight from 0.1 to 2,000 kg. `checkWeighIn` and `weighInQuestion` in `model.mjs` do the checking and the wording.

Next to **Body fat**, the overview shows your latest estimate and its date. A later measurement without an estimate doesn't hide it. With no estimate at all, a dash shows with the reason instead of a date: "No weigh-in near its date", "No formula chosen" or "Outside the formula’s range". Use **Add** or **Update** next to **Body fat**, or **Log waist** in the **Body fat** section, to log a waist measurement whenever you take one. Measure around your bare waist at the navel, with the tape level and snug, after a normal breath out. Choose **Male** or **Female** for the formula the first time. After that it stays chosen. Saving again on the same date replaces that measurement. The **Body fat** section sits at the bottom of the overview, under the recent entries, so the weight trend stays the focus. It shows your latest estimate and waist, the change since your first estimate, a chart of every estimate and your latest five measurements, with **Show all** for the rest. Tap a measurement's row, or its pencil, to edit or delete it. Choosing **cm** or **in** beside **Waist** also switches your height between centimeters and feet and inches, since the two share a unit.

Use **Set** under **Reminder** in **Settings** to get a notification at a chosen hour on days you haven't logged a weigh-in. Your browser asks to allow notifications the first time. Each device you turn reminders on from gets them, and **Turn off reminders** stops them on all of them. On iPhone and iPad, add Baseline to the Home Screen first: in Safari, tap **Share**, then **Add to Home Screen**. Open Baseline from the Home Screen and turn reminders on there. The reminder uses the time zone of the device you last saved it from. Signing out doesn't stop reminders on a device, so turn them off first on a device you share.

Tapping a reminder opens today's weigh-in: the sheet on a phone, or the form, with focus in the weight, on a wider screen. If Baseline is open, that window comes forward and opens it. Otherwise Baseline opens at `#log`. On Android, pressing and holding the installed app's icon offers the same as a shortcut, **Log today’s weight**. iPhones and iPads don't offer shortcuts for web apps. Any link to `#log` does the same: the overview shows, and once your log is on screen, the address goes back to `#overview` and today's weigh-in opens. While the consent step shows, it waits until you agree. On a new account's first-run screen, it focuses that screen's weight field. Signed out, the sign-in page takes over the address, so after signing in the overview shows. Browsers may raise the keyboard only for a tap in the page, so after a reminder or the shortcut you may need to tap the weight field.

Sign in to open your log. The first time, Baseline asks you to agree to its health data policy before it saves anything, as [Privacy](#privacy) describes. A new account starts with an empty log, and its overview is the first-run screen until anything is saved.

The first-run screen is headed "Your first weigh-in". It says "Your weight swings by a kilo or more from day to day, so Baseline shows the average of your last 14 days.", with "two pounds" in place of "a kilo" for pounds or stones. Under it are three large buttons for **kg**, **lb** and **st**, then today's weight, already focused, and **Save**. There's no tour, and no goal, height or sex is asked for.
- **The unit** starts from the region of the browser's first language, `navigator.languages[0]` (`defaultUnits` in `model.mjs`). It's pounds in the United States, and kilograms everywhere else, the UK and Ireland included, with stones beside them. A language without a region, such as `en`, gets kilograms. Height and waist get feet and inches in the United States and centimeters elsewhere. The language is read on the device and never sent; only the units saved leave it.
- **Picking another unit** keeps the number typed, since it says what that number is in.
- **Save** saves the units, unless they're the kg and cm already saved, then today's weigh-in. The overview takes the screen's place.
- **Skip for now** saves the units the same way, then starts the log (the `start` op), so the screen doesn't come back on any device.
- **Who sees it:** an account that has agreed to the policy and saved nothing. An account with data, or whose data was deleted, never does. Nor does one about to take in a log from before accounts kept in this browser: the screen waits while that log is there, and the log moves in once the agreement reaches the server.
- **Meanwhile**, the Log, Settings and Your data open as usual. The log bar, **Log a weigh-in**, a reminder and a `#log` link lead to the screen's weight field.

The overview takes one of three states, from the weigh-ins up to today (`logStatus` in `model.mjs`). Weigh-ins dated after today, which a device in a time zone ahead can save, count once their day comes.

- **An empty log,** with no weigh-ins, as after **Skip for now**, after **Delete my data** and agreeing again, or once every weigh-in has been deleted. In place of the average, the overview says "Log your first weigh-in", at the size of a page heading, with one line under it: "Baseline averages your last 14 days, so day-to-day swings don’t hide where you are." The facts, the weekly trend line, the forecast, the **Trend** section and **Recent entries** are left out, rather than shown as rows of dashes and an empty chart. A goal that's already set still shows its line under the heading. **Body fat** becomes one line, "You can track your waist too.", with **Log waist**, unless there are waist measurements to show, or it's hidden in Settings. The log form, or the log bar on a phone, is where it always is. **Log** still says "Your entries will appear here after your first weigh-in."
- **Back after a break,** when there are weigh-ins but none in the 14 days through today, so there's no 14-day average today. The heading over the average reads "Last 14-day average", and the average on the last weigh-in's date shows in grey. Under it: "Your last weigh-in was Oct 31, 23 days ago. Your average then was 86.2 kg. Log today to pick up where you left off.", with the real date, days and average in your unit. The weekly trend line says it returns after 8 weigh-ins over 2 weeks. With a goal, the progress bar stays, in grey, where that last average left it, and its line starts "As of Oct 31". The goal's forecast stays hidden, and the chart has no trend forecast, since both need an average in the last 14 days. Nothing on the screen mentions missed days or streaks.
- **Active,** with a weigh-in in the last 14 days: the overview as described above. When the last weigh-in isn't today, the figures are as of it, and say so: "As of Nov 19 · from 12 weigh-ins in 14 days" under the average, "in the 30 days to Nov 19" in the 30-day change after the weekly trend, "As of Nov 19 · " before the goal's progress, and "As of Nov 19, your last weigh-in." over the changes. They're the same figures the break above shows. That state only greys them and adds its line, once the last weigh-in is 14 days old and there's no average today.

The first weigh-in in an empty log, or after a break, shows the active overview at once, before it reaches the server. A weigh-in after a break isn't counted as reaching milestones, since there was no average just before it.

The **Weight log** shows every entry with its weekly trend and note, 15 to a page and grouped by month, and lets you edit a weigh-in's weight or note or delete it. Tap anywhere on a weigh-in's row, its note included, to open it, here and in **Recent entries**. The pencil at the end of each row does the same and is the way in from the keyboard. Selecting a note's text, to copy it, doesn't open it. A month that runs over onto the next page repeats its heading there. Choose **Monthly summary** at the top of the log to see each month's start and end averages, change, weekly trend and lowest weigh-in, along with any goal milestones reached that month.

**Settings**, the last link at the top of the page, gathers what you set once:

- **Units:** **kg**, **lb** or **st** for **Weight**, the same choice as beside the log form's weight. **cm** or **ft and in** for **Height and waist**, which share a unit: centimeters for both, or feet and inches for height and inches for waist. The height and waist dialogs switch the same unit.
- **Height:** the height BMI uses, with **Add** or **Edit**, which opens the height dialog and its **cm** or **ft** switch.
- **Reminder:** the reminder's time, or **Off**, with **Set** or **Edit**, which opens the reminder dialog. "Reminders go to another device" means reminders are on, but not for the device you're using. A city's name, such as "London time", means the reminder was saved from a device in another time zone.
- **Show on overview:** **BMI** and **Body fat estimate**, both on at first. Turning off **BMI** hides the BMI figure. Turning off **Body fat estimate** hides the body fat figure and the whole **Body fat** section, with its chart and waist measurements. Hiding one deletes nothing: your height and waist measurements stay saved, and turning it back on shows everything again. The choice is saved to your account, so it applies on every device you sign in on.
- **Your data:** **Open Your data** goes to the Your data page, which [Your data](#your-data) describes.
- **Account:** the email you're signed in with. **Manage account** opens Clerk's account page, where you change your email, password or sign-in methods. **Sign out** signs you out on this device. It needs a connection. If changes are still waiting to sync, it says how many and asks first, since signing out deletes them. The avatar at the top right can also manage your account or sign out.

Entries and their notes, height, waist measurements and the body fat formula you chose, your goal, your units, what the overview shows, your reminder time and your agreement to the health data policy are saved to your account, so the same log opens on any device you sign in on. A change shows right away and is saved in the background. Switching back to the tab picks up changes made on another device.

Once Baseline has loaded on a device, it opens there without a connection, and you can keep logging. A change made offline, or while the connection fails, shows right away and is kept on the device. A message says "Saved on this device. It’ll sync when you’re back online.", and the line "Saved on this device · syncing when you’re back online" stays under the heading until the change is sent. Waiting changes survive a reload. Baseline sends them in the order you made them, one at a time, without you doing anything: when it opens with a connection, when the device comes back online, when you return to the tab, and once a minute while the device reports a connection. iOS has no background sync, so on an iPhone they wait until Baseline is open. Once they've all been sent, a message says "Synced." If the server turns down a change that waited on the device, because it isn't valid, the change is dropped and a message names it. If the server can't be reached for another reason, the line reads "Saved on this device · not synced yet" and Baseline keeps trying.

Weigh-ins, their edits and deletions, waist measurements, height, the goal, units, what the overview shows, skipping the first-run screen and your agreement to the health data policy can wait on the device, as can **Undo** after a deletion, which then rides on the "Saved on this device" message. The agreement goes ahead of everything else waiting, since the server saves nothing without it. Reminders can't, because they change which devices get notifications, so offline the reminder dialog says they need a connection.

Each date has one weigh-in and one waist measurement, and the last change to reach the server wins, as it does for height, the goal, units and each choice of what the overview shows. A change made offline therefore replaces one made on another device in the meantime once it syncs, even if the other was made later. An edit to a weigh-in that another device deleted in the meantime changes nothing.

If saving fails while you wait for it, because the server turned the change down or couldn't save it, the change is undone on screen and a message at the bottom of the page says so. It stays until you choose **Dismiss** or the change is saved. **Try again** sends the same change again, exactly as you entered it, and the message confirms it once it's saved. The date and weight you typed in **Log a weigh-in** also stay in the form, so you can save them from there instead. Other messages fade after about 4 seconds, but not while the mouse is over them or focus is in them. While a message about a failure shows, other messages are left out rather than replace it.

Deleting a weigh-in or a waist measurement, and removing the goal, each ask first in their dialog. Once confirmed, the change is made at once, like any other, and the message "Weigh-in deleted.", "Waist measurement deleted." or "Goal removed." offers **Undo** for about 8 seconds. **Undo** saves back exactly what was there: the weigh-in's weight as stored, to 0.01 kg, so a weight entered in stones comes back to the hundredth of a kilogram, and its note; the waist measurement and the formula; or the goal with its goal weight, start date, start weight, target rate and milestones. It's sent as a change of its own (`inverseOf` in `model.mjs` builds it), so it doesn't depend on the deletion still being on its way, and offline both wait on the device and sync in order. The message then says "Weigh-in restored.", "Waist measurement restored." or "Goal restored.", and if saving fails, it offers **Try again**. A goal saved before the cap on the target rate can't be saved again with its old rate, so its question says removing it can't be undone, and its message has no **Undo**. **Delete my data**, **Delete my account** and **Turn off reminders** have no **Undo**. While a message about a failure still shows, with its **Try again**, the message with **Undo** is left out like any other, so a deletion made then has no **Undo**. The question before it still applies.

A tap or click outside a dialog closes it only while nothing has been typed or chosen in it since it opened, so a stray tap never throws away a half-filled form. **Escape**, the close button and **Cancel** always close it, except while **Delete my data** or **Delete my account** is on its way.

The small controls, such as **Edit**, the chart's ranges, the pencils and **Show all**, respond to a tap anywhere in an area at least 44 pixels square, without taking more room on the page or overlapping their neighbours. The unit buttons, which sit side by side, are 44 pixels tall and as wide as their label. On a touch screen, controls don't keep their hover colour after a tap: hover styles apply only where the pointer can hover. Buttons that show a short label, such as **30D**, are named for screen readers and voice control starting with what they show: "30D (last 30 days)". Weights in stones are read out in full after the label as shown: "Today 13 st 5.2 lb · Edit (13 stone 5.2 pounds)".

Baseline keeps a copy of your log on each device you use it on, so the next visit opens at once. It shows that copy straight away, with "Updating…" under the heading, while sign-in loads and the latest log is fetched. The latest log then replaces the copy and the line goes. If it can't be fetched, the line reads "Couldn't update. Showing your log as of" and the time the copy was saved, or "Offline · showing your log as of" and the time when the device is offline. Baseline tries again when the device comes back online and when you return to the tab. You can make changes in the meantime, and they wait on the device until sign-in has loaded and they can be sent. If by then nobody is signed in, the copy and any waiting changes are removed and the sign-in page shows instead. If a different account is, they're removed and that account's log opens. Without a copy, the page shows the outline of the overview while your log loads.

Baseline stores these in the browser on your device:

- **A copy of your log:** your entries and notes, height, waist measurements, the body fat formula you chose, your goal, your units, what the overview shows, and your reminder time and which devices get reminders, as the server last returned them, with the time they arrived. It's stored under `baseline.log-cache.v1:` followed by your account's user ID. Only one account's copy is kept on a device.
- **Your user ID,** under `baseline.last-user.v1`, so Baseline knows whose copy to show before sign-in has loaded. Your email address isn't stored.
- **Changes waiting to sync:** each change you made that the server doesn't have yet, in order, under `baseline.outbox.v1:` and your user ID. A change goes in as you make it and comes out once the server has it.
- **A hidden note:** the start date of the goal whose note about fast loss you hid, under `baseline.fast-loss-hidden:` and your user ID.
- **A log from before accounts,** on a browser that used an earlier version, until it moves into an account as described below.
- **Baseline's own files,** in the service worker's cache, so it opens offline. They hold none of your data.

Signing out removes the copy of your log, your user ID and any changes that haven't synced yet, so a shared computer keeps none of your weights. Deleting your data or your account also removes your weights and the changes waiting to sync from the device you delete it on, as [Your data](#your-data) describes. **Sign out** in **Settings** warns about changes that haven't synced and removes the copy before the session ends. The avatar menu doesn't warn, and it reloads the page as it signs out, so the copy goes once the page has loaded again. Before you sign out from the avatar menu, check that the "Saved on this device" line has gone. Clerk keeps its own sign-in data, and signing out ends that session.

Earlier versions kept logs only in the browser. The first time an account with an empty online log signs in on such a browser, and once it has agreed to the health data policy, that browser's log moves into the account and is removed from the browser. An account that already has entries keeps them, and the browser's log is left untouched. An account whose data was deleted never takes in a browser's log, as [Your data](#your-data) describes.

## Your data

**Your data** is a page of its own, linked from **Settings** and from the bottom of every page of the app. It says what Baseline stores and where, what it never does and who handles your data, as the health data policy does in full (see [Privacy](#privacy)). It shows when you agreed to the policy, with **Withdraw**. And it downloads your log or deletes it. Both downloads include changes still waiting on the device. On an iPhone or iPad with Baseline on the Home Screen, where a download does nothing useful, the share sheet opens instead, so you can save the file to Files.

**Download weigh-ins (CSV)** saves `baseline-weigh-ins-` and today's date, such as `baseline-weigh-ins-2026-11-23.csv`, for a spreadsheet. It has a row for each weigh-in, oldest first, with these columns:

- `date`: the date, as YYYY-MM-DD.
- `weight_kg`: the weight in kilograms as stored, to 0.01 kg.
- `weight`: the weight as Baseline shows it in your unit, such as "187.2 lb" or "13 st 5.2 lb".
- `note`: the note, if there is one. A spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` as a formula, so a note that starts with one of them gets an apostrophe in front, which shows it as text.
- `average_14d_kg`: the 14-day average on that date in kilograms, to 0.01 kg.

The file is UTF-8 with a byte order mark and CRLF line ends, and a field with a comma, quote or line break is quoted as RFC 4180 describes, so that Excel reads commas, quotes, accents and emoji in notes as they were typed.

**Download everything (JSON)** saves `baseline-export-` and today's date, such as `baseline-export-2026-11-23.json`. It has everything in your log, in metric units, in a format a later version can import:

```json
{
  "format": "baseline-export",
  "version": 1,
  "exportedAt": "2026-11-23T09:41:00.000Z",
  "units": { "weight": "lb", "height": "ft" },
  "preferences": { "showBmi": true, "showBodyFat": false },
  "heightCm": 178.5,
  "sex": "female",
  "goal": { "weightKg": 75, "startDate": "2026-11-01", "startWeightKg": 84.91, "rateKgPerWeek": 0.5, "milestones": 10 },
  "reminder": { "hour": 8, "timeZone": "Europe/London" },
  "consent": { "version": "2026-11-23", "agreedAt": "2026-11-23T09:40:12Z" },
  "entries": [{ "date": "2026-11-01", "weightKg": 85, "note": null }],
  "waists": [{ "date": "2026-11-02", "waistCm": 86.61 }]
}
```

`units` are the units Baseline shows, `preferences` says whether the overview shows BMI and body fat, and `sex` is the body fat formula you chose. `consent` is the version of the health data policy you agreed to and when the server recorded it; `agreedAt` is null while an agreement made offline hasn't synced. `heightCm`, `sex`, `goal`, `reminder` and `consent` are null when they aren't set, as is `rateKgPerWeek` for a goal without a target rate. The file holds no account ID, email address or push subscription.

**Delete my data** empties your log and keeps your account. **Delete my account** empties your log, then deletes your account and signs you out. Each opens a dialog that lists what goes and offers **Download a copy first**. It goes ahead only once you type "delete". Deleting needs a connection, and the log changes only once the server has deleted it. If that fails, the dialog says so and you can try again.

Either one deletes, from your account:

- every weigh-in and its note
- every waist measurement, and the body fat formula you chose
- your goal and your height
- your settings: units go back to kg and cm, and the overview shows BMI and body fat again
- your reminder time and time zone, and every device that gets reminders, so reminders stop on all of them
- your agreement to the health data policy, so Baseline asks for it again before it saves anything new

**Withdraw**, next to your agreement, is **Delete my data** under another name: the dialog asks "Withdraw your agreement?", and its button reads **Withdraw and delete**. Withdrawing the agreement deletes the data it allowed Baseline to keep.

**Delete my data** leaves an empty profile in its place, without the agreement, and the app shows the consent step until you agree again. The profile counts as started, so a log from before accounts, in any browser, never moves back into the account. **Delete my account** leaves no row for your user ID in any table: `profiles`, `weigh_ins`, `waist_measurements` and `push_subscriptions`. Then it deletes your Clerk user, which signs you out, and the sign-in page says "Your account and all your data have been deleted." If your data is deleted but Clerk can't delete the account, the dialog says so, and **Try again** deletes only the account.

On the device you delete on, Baseline also removes the copy of your log, changes waiting to sync, a log from before accounts and the hidden note about fast loss, and it unsubscribes the device from notifications. After **Delete my data**, the copy is replaced by the empty log. After **Delete my account**, your user ID goes too. Other devices show the consent step the next time they load the log, and after an account is deleted they're signed out. A change still waiting on another device, because that device was offline, stays there when it tries to sync: the server turns it down for want of an agreement, and that device shows the consent step. Agreeing again saves it into the emptied log, and deleting the data there drops it.

**Delete my account** needs the Clerk Dashboard setting that lets users delete their own accounts. Baseline reads it from the signed-in user's `deleteSelfEnabled`, and the button shows only when it's on. With it on, Clerk's own account page, from **Manage account** or the avatar menu, can delete the account too, but that removes only the Clerk user and leaves the log in the database. Use **Delete my account** in Baseline instead.

Neon keeps a history of every change so the database can be restored to an earlier moment, and deleted rows stay in that history until its window passes. On Neon's Free plan, which the setup command above chooses, the window is 6 hours, which is both the plan's default and its maximum. The window shows under **Settings → Postgres → History window** in the Neon console. Paid plans default to 1 day and allow up to 7 days on Launch or 30 on Scale. A restore keeps the data it replaced in a backup branch named after the branch, `_old_` and the time. That branch keeps deleted rows until you delete it, and the health data policy promises it's gone within 7 days, so delete it once you've checked the restore. `docs/breach-runbook.md` has the steps.

## Privacy

Baseline's privacy pages and documents:

- **The health data privacy policy,** `baseline/dist/health-data-privacy.html`, served at `/health-data-privacy.html`. It's Baseline's consumer health data privacy policy, on a page of its own. It's linked from the sign-in screen, under the note about the log, and from the consent step, Your data and the bottom of every page of the app. The service worker keeps it, so it opens offline too.
- **Your data,** at `#your-data` in the app. It's a one-page summary of the policy, as [Your data](#your-data) describes.
- **[docs/processors.md](docs/processors.md):** each service that receives users' data, what it gets, where, and its data processing agreement, with the known gaps.
- **[docs/breach-runbook.md](docs/breach-runbook.md):** what to do if data may have leaked. It covers rotating the keys, working out whose data was exposed, and the deadlines for telling people.

All three are drafts and need a lawyer's review before Baseline relies on them. They name no person or business: `[name of the person or business responsible for Baseline]` and `[contact email address]` are placeholders to fill in. The policy shows a "Draft" notice at the top until it has been reviewed.

### Agreeing to the policy

After sign-in, before anything is saved, Baseline shows a consent step in place of the log. It says what Baseline stores and links the policy. It has an unticked box, "I agree to Baseline storing my health data as described", and **Continue**, which works only once the box is ticked.
- Agreeing sends the `consent` op with the policy's version, `CONSENT_VERSION` in `model.mjs`, which is the policy's date.
- The server stores the version in `profiles.consent_version`, and the time it received the agreement in `profiles.consented_at`.
- Agreeing again to the same version keeps the first time.
- An agreement made offline waits on the device ahead of other changes, and the log shows at once.

Accounts made before this, existing logs included, see the same step on their next visit. Their log stays as it is, and nothing new is saved until they agree. Someone who doesn't agree can still sign out, delete their account, or download or delete their log, all from the step.

The server enforces the agreement too:
- Every change except agreeing and the ones that only remove data needs it. The exceptions are `delete-weight`, `delete-waist`, `clear-goal`, `clear-reminder`, `delete-data` and `delete-account` (`OPS_WITHOUT_CONSENT` in `server/ops.mjs`). An op added later needs the agreement unless it's added to that list.
- The check runs first in the same transaction as the change: `require_consent`, a Postgres function in `server/schema.mjs`. It holds the profile row, so a deletion on another device can't slip in between.
- Without the current version, the change is turned down with a 403, "Agree to the health data policy first.", and nothing changes.
- Reading the log never needs the agreement.

The app keeps a change the server turned down that way on the device, and shows the consent step until the user agrees. A log saved in the browser before accounts moves in only after the agreement.

Deleting the data withdraws the agreement, since the profile is deleted with everything else. **Withdraw**, in Your data, opens that same deletion.

**To change the policy:**
1. Edit `health-data-privacy.html`.
2. If the change is one people must agree to again, set `CONSENT_VERSION` and the date in the page's `<time id="policy-version">` to the new date. `npm test` fails until they match.
3. Deploy. Everyone then sees the consent step again, which says the policy has changed since they agreed.

Baseline sets no cookies of its own and no tracking cookies, so it has no cookie banner. The cookies Clerk sets keep people signed in.

### What each promise rests on

The policy and Your data make these promises. Each line says what makes it true. Where something outside the code makes it true, the line says so, and it needs checking when that changes.

| Promise | What makes it true |
|---|---|
| Nothing is saved before you agree | `showState` in `app.mjs` shows the consent step until `hasConsent`, and the server's `require_consent` turns down every change in `needsConsent` (`server/ops.mjs`, `server/store.mjs`). Tests: `server/tests/api.test.mjs`. |
| No analytics, ads or trackers, and the only outside code is Clerk's sign-in | `index.html` loads only `app.mjs`. `auth.mjs` loads scripts only from the Frontend API host in `config.mjs`, with Clerk's telemetry off. The app fetches only `/api/log`. Tests: `baseline/tests/page.test.mjs`. Clerk's sign-up can add Cloudflare's bot check, which the texts mention, and Clerk's fraud protection loads from `*.protect.clerk.com`. The Content Security Policy in `vercel.json` allows no other host (`baseline/tests/headers.test.mjs`), but it only reports until it's switched on (see [Security headers](#security-headers)). |
| Never sold or used for ads, and shared only with the services named | No code sends data anywhere but `/api/log`, as above. The server sends only the fixed reminder text to push services. The rest is a promise about conduct. |
| No cookies of its own | No code sets `document.cookie` (`page.test.mjs`). Clerk's cookies are Clerk's. |
| No location | No code uses `geolocation` (`page.test.mjs`). The time zone comes from `Intl` and is sent only with a reminder (`set-reminder`). The first-run screen reads the browser's language, such as `en-US`, on the device to pick a unit, and only the units chosen are saved (`defaultUnits` in `model.mjs`). IP addresses at Vercel and Clerk are mentioned. |
| What's collected | The columns in `server/schema.mjs`, and Clerk's account data. |
| Averages, BMI, body fat and forecasts aren't stored | They're calculated in `model.mjs` on each render, and `schema.mjs` has no column for them. |
| The formula's sex is asked for only when logging a waist | The Formula choice is in the waist dialog. `save-waist` is the only op that sets `profiles.sex`. |
| None of the log goes to Clerk | `app.mjs` and `auth.mjs` never write to the Clerk user. Comments in both say they never must. See `docs/processors.md`. |
| Push services can't read a reminder | `encrypt` in `server/push.mjs` (RFC 8291), and the fixed `MESSAGE` in `server/reminders.mjs`. Tests: `server/tests/push.test.mjs`. |
| The server logs only the kind of an error, never your data | `logError` in `server/log.mjs`, used by `server/api.mjs` and `api/remind.mjs`; `sendReminders` in `server/reminders.mjs`; `server/csp.mjs`. See [Logs](#logs). Tests: `server/tests/api.test.mjs`, `server/tests/reminders.test.mjs`, `server/tests/csp.test.mjs`. Any new `console` call on the server must keep to it. |
| Vercel keeps logs for up to a day | The Vercel plan: 1 hour on Hobby, 1 day on Pro. It isn't code; check the plan. |
| The server is in the United States | `vercel.json` sets no regions, so functions run in Vercel's default, `iad1`. Check the project's settings. |
| The database is in the United States, encrypted on disk | The setup command's `region=iad1`, and Neon's DPA. Check the Neon console. |
| Deleted data stays in Neon's restore history for up to 6 hours | The Neon Free plan's history window. Check it in the Neon console, and change the texts if the plan changes. |
| Baseline makes no other backups | No backup code exists. Check that the Neon project has no manual snapshot. |
| A restore's backup branch goes within 7 days | A promise to keep by hand (`docs/breach-runbook.md`). |
| Download has everything but the account and push addresses | `exportJson` in `export.mjs`. Tests: `baseline/tests/export.test.mjs`. |
| Deleting takes effect on the server at once | `delete-data` and `delete-account` in `server/store.mjs` run in one transaction, and the app waits for the answer. |
| Withdrawing deletes the log, and nothing new is saved until you agree again | **Withdraw** opens the `delete-data` dialog. `deleteRows` removes the profile and its agreement, and `require_consent` refuses changes until a new one. |
| The device's copy goes when you sign out or delete | `clearLogCache` and `clearDeviceData` in `account.mjs`. Tests: `baseline/tests/account.test.mjs`. |
| The server reads and writes only your own log | Every query in `server/store.mjs` is limited to the `user_id` from the session token that `server/auth.mjs` verifies. Once `DATABASE_URL_APP` is set, row-level security in `server/schema.mjs` holds each request to that user's rows too (see [Limit the app to each user's rows](#limit-the-app-to-each-users-rows)). Until then it rests on the queries alone. Tests: `server/tests/api.test.mjs`, and `server/tests/rls.test.mjs` on a branch. |
| Encrypted connections | Vercel serves only HTTPS, and `Strict-Transport-Security` in `vercel.json` keeps browsers on it. |
| Reminder devices are kept until reminders are turned off | `clear-reminder` and `removeDevices` in `server/store.mjs`. |
| Unused accounts aren't deleted | No code deletes them. |
| Changes to the policy ask again | `CONSENT_VERSION` and `hasConsent`. `page.test.mjs` checks that the policy's date matches. |
| Answers to requests within one month, and appeals | A promise to keep by hand, at the contact address. |
