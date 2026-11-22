# Baseline

A daily weight journal with a 14-day moving average and height-based BMI. Each gray dot on the chart is a weigh-in. The blue line shows the mean of the weights recorded on that calendar day and the preceding 13 days. The first entry produces an average immediately, and missing dates contribute no measurements.

Weights show in kilograms, pounds, or stones and pounds, always to one decimal (0.1 kg or 0.1 lb). They are stored in kilograms to 0.01 kg, so a weight entered in pounds reads back exactly as entered, and every calculation runs in kilograms. Where a figure below uses a value "as shown", it is rounded to 0.1 of the unit you chose. With stones, changes and rates are in pounds.

Under the average, the weekly trend gives the slope of a straight line fitted through the last 21 days of weigh-ins, in kilograms or pounds a week. An average runs about a week behind a falling or rising weight, and the fitted line does not. The trend appears once there are 8 weigh-ins spread over at least 14 days. When the slope is too small to tell apart from normal day-to-day scale noise, it reads "No clear change". The log gives the same figure for each weigh-in, as it stood on that date.

Above the chart, the change figures compare today's 14-day average with the average 7, 30 and 90 days earlier. The all-time change compares it with your first weigh-in. Each uses the averages as shown. A figure appears only when there is an average on exactly that day. It waits until the log goes back that far, and it is left out while a gap of more than 14 days without weigh-ins leaves that day with no average. The all-time change appears once the log is more than a week old and goes back further than the longest figure shown, so it never repeats another figure. Next to them are the highest and lowest weigh-ins in the same 14 days as the average, with how many days ago each was. They need at least two weigh-ins in those days, and a tie shows the more recent day.

A goal has a goal weight, a start date and a start weight, which defaults to the 14-day average on the start date. Whether it is a loss, a gain or staying at a weight comes from those two weights. The distance is split into milestones, 10 by default, each at least 0.1 kg or 0.1 lb. Progress is measured with the 14-day average as shown, so a single light day doesn't count as reaching a milestone. The chart draws the goal weight as a dashed line and always keeps it in view.

The forecast says when the 14-day average would reach each remaining milestone and the goal at a steady rate. You choose the rate:

- **Your target rate:** the optional rate saved with the goal.
- **Last 3 weeks:** the weekly trend. It is only used when it is a clear change toward the goal.
- **Since the start date:** the change in the 14-day average since the start, which appears 14 days after the start date.

When the chosen rate is flat or heads away from the goal, the forecast says so and gives no date.

The monthly summary covers each calendar month, newest first. A month starts with the 14-day average as it began, which is the average on the last day of the month before. It ends with the average on its own last day. Each month picks up where the one before ended, so the monthly changes add up to the change over the whole log. Without an average on that day, because the log started partway through the month or after a break of more than 14 days, the month starts at its first weigh-in instead. When a break leaves no average on the month's last day, it ends on the last day that had one. Either way, that day's date shows next to the figure. The change uses both averages as shown. The weekly trend is the one described above, as it stood on the month's last day. The lowest weigh-in is the month's lowest single reading, and a tie shows the more recent day. The current month is marked as partial and runs through today. With a goal, each month lists the milestones the average first reached that month, counting from the goal's start date. A milestone the average moves back past and then reaches again is listed only once. Months without weigh-ins share a single line.

Body fat is an estimate from the U.S. Army's one-site tape formula, from Army Directive 2023-11, with the equations in ALARACT 046/2023, table B-5. It uses your waist measured at the navel and your weight, with one formula for men and another for women:

- **Male:** −26.97 − 0.12 × weight in pounds + 1.99 × waist in inches
- **Female:** −9.15 − 0.015 × weight in pounds + 1.27 × waist in inches

The weight is the 14-day average on the day of the waist measurement, so one heavy or light day moves the estimate little. An estimate needs a weigh-in in the 14 days up to that day, and a weigh-in added later within those days updates it. Baseline shows the result to 0.1%. The Army rounds to a whole percent. No estimate shows for a result outside 0 to 100%, which a waist typed in the wrong unit gives. The change since your first estimate uses both as shown. Waists are stored in centimeters to 0.01 cm, so a waist entered in inches reads back as entered. They show to 0.1 cm, or to 0.1 in when your height shows in feet and inches.

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

A development instance (`pk_test_`) works on `localhost` and on Vercel preview URLs, and its Google sign-in runs on Clerk's shared credentials. A production instance (`pk_live_`) needs a domain you own, because Clerk does not issue production instances for `*.vercel.app`. It also needs your own Google OAuth client. Follow Clerk's [production deployment guide](https://clerk.com/docs/guides/development/deployment/production) and its [Google setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google), then replace the key in `config.mjs`.

## Set up the database

Logs are saved in Postgres from [Neon](https://vercel.com/marketplace/neon), which is the Postgres option in Vercel's **Storage** tab. Create one from the repository root with the [Vercel CLI](https://vercel.com/docs/cli), after `vercel link`:

```sh
vercel integration add neon --billing-plan free_v3 --meta region=iad1 --meta auth=false
```

This connects the database to the project and adds `DATABASE_URL` to its environment variables. The API creates its tables on its first request, so there is no migration to run.

The API lives in `api/log.mjs`, with its code in `server/`. It accepts only requests carrying a Clerk session token. It checks that token against the signing keys your Clerk app publishes, so it needs no Clerk secret key.

## Set up reminders

Reminders are web push notifications signed with a VAPID key pair. The public key is `PUSH_PUBLIC_KEY` in `baseline/dist/config.mjs`, and it is safe to commit. The private key must stay secret:

1. In the Vercel dashboard, open the project's **Settings → Environment Variables** and add `VAPID_PRIVATE_KEY` for Production, then redeploy.
2. Push services can contact the sender through a subject. It defaults to `https://` and the project's production domain, from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. That variable needs **Automatically expose System Environment Variables**, which is on by default. To use a different URL or a `mailto:` address, set `VAPID_SUBJECT`.

`vercel.json` runs `api/remind.mjs` every hour with [Vercel Schedules](https://vercel.com/docs/schedules), which is in beta. On the Hobby plan each run starts up to 15 minutes after the hour, and an hourly schedule uses about 730 of the plan's 5,000 runs a month. The schedule makes the function private, so it has no public URL and needs no secret. Schedules run on production deployments. The run's counts appear in the function's logs.

To replace the key pair, run the following command, then put the public key in `config.mjs` and the private key in `VAPID_PRIVATE_KEY`. Devices that turned reminders on with the old key need to turn them on again.

```sh
node -e 'const k = require("node:crypto").generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" }); console.log("PUSH_PUBLIC_KEY=" + Buffer.concat([Buffer.from([4]), Buffer.from(k.x, "base64url"), Buffer.from(k.y, "base64url")]).toString("base64url") + "\nVAPID_PRIVATE_KEY=" + k.d)'
```

## Run locally

With Node.js 20.12 or later, run the following commands from the repository root.

```sh
npm install
vercel env pull .env.local
npm start
```

Open [Baseline locally](http://127.0.0.1:4173/). `npm start` serves the page from `baseline/dist/` and runs the API from `api/log.mjs`, using the `DATABASE_URL` in `.env.local`. Reminders can be turned on locally, but only Vercel sends them. Run `npm test` to check the calculations, including body fat against the Army's worked examples, the API's input checks, the reminder schedule and the push encryption.

## Using the tracker

Save a weight and a date in **Log a weigh-in**, with an optional note of up to 100 characters, such as "after travel". The arrows beside the date move it back or forward one day and stop at today. Saving again on the same date updates that entry. The form shows that day's weight and note, so a note stays unless you change or clear it. Notes appear under their weigh-ins in the tables and in the chart's tooltip. Choose **kg**, **lb** or **st** (stones and pounds) beside **Weight** to change the unit of every weight in Baseline. Use **Add** or **Edit** next to **Height** to enter a height, choosing **cm** or **ft** (feet and inches) beside it. Baseline calculates BMI from the latest recorded weight. Use **Set** or **Edit** next to **Goal** to set, change or remove a goal. Progress appears under the average, the goal shows as a dashed line on the chart, and the **Forecast** section gives the expected dates. The **Trend** section shows how much your average has changed over 7, 30 and 90 days and since your first weigh-in, and your highest and lowest weigh-ins of the last 14 days.

Use **Add** or **Update** next to **Body fat**, or **Log waist** in the **Body fat** section, to log a waist measurement whenever you take one. Measure around your bare waist at the navel, with the tape level and snug, after a normal breath out. Choose **Male** or **Female** for the formula the first time. After that it stays chosen. Saving again on the same date replaces that measurement. The **Body fat** section sits at the bottom of the overview, under the recent entries, so the weight trend stays the focus. It shows your latest estimate and waist, the change since your first estimate, a chart of every estimate and your latest five measurements, with **Show all** for the rest. Use the pencil on a measurement to edit or delete it. Choosing **cm** or **in** beside **Waist** also switches your height between centimeters and feet and inches, since the two share a unit.

Use **Set** next to **Reminder** to get a notification at a chosen hour on days you haven't logged a weigh-in. Your browser asks to allow notifications the first time. Each device you turn reminders on from gets them, and **Turn off reminders** stops them on all of them. On iPhone and iPad, add Baseline to the Home Screen first: in Safari, tap **Share**, then **Add to Home Screen**. Open Baseline from the Home Screen and turn reminders on there. The reminder uses the time zone of the device you last saved it from. Signing out doesn't stop reminders on a device, so turn them off first on a device you share.

Sign in to open your log. Use the avatar at the top right to manage your account or sign out. A new account starts with an empty log. The **Weight log** shows every entry with its weekly trend and note, 15 to a page and grouped by month, and lets you edit a weigh-in's weight or note or delete it. A month that runs over onto the next page repeats its heading there. Choose **Monthly summary** at the top of the log to see each month's start and end averages, change, weekly trend and lowest weigh-in, along with any goal milestones reached that month.

Entries and their notes, height, waist measurements and the body fat formula you chose, your goal, your units and your reminder time are saved to your account, so the same log opens on any device you sign in on. A change shows right away and is saved in the background. If saving fails, the change is undone and a message says so. Switching back to the tab picks up changes made on another device.

Earlier versions kept logs only in the browser. The first time an account with an empty online log signs in on such a browser, that browser's log moves into the account and the browser copy is removed. An account that already has entries keeps them, and the browser copy is left untouched.
