# Baseline

A daily weight journal with a 14-day moving average and height-based BMI. Each gray dot on the chart is a weigh-in. The blue line shows the mean of the weights recorded on that calendar day and the preceding 13 days. The first entry produces an average immediately, and missing dates contribute no measurements.

Weights show in kilograms, pounds, or stones and pounds, always to one decimal (0.1 kg or 0.1 lb). They are stored in kilograms to 0.01 kg, so a weight entered in pounds reads back exactly as entered, and every calculation runs in kilograms. Where a figure below uses a value "as shown", it is rounded to 0.1 of the unit you chose. With stones, changes and rates are in pounds.

Under the average, the weekly trend gives the slope of a straight line fitted through the last 21 days of weigh-ins, in kilograms or pounds a week. An average runs about a week behind a falling or rising weight, and the fitted line does not. The trend appears once there are 8 weigh-ins spread over at least 14 days. When the slope is too small to tell apart from normal day-to-day scale noise, it reads "No clear change". The log gives the same figure for each weigh-in, as it stood on that date.

Above the chart, the change figures compare today's 14-day average with the average 7, 30 and 90 days earlier. The all-time change compares it with your first weigh-in. Each uses the averages as shown. A figure appears only when there is an average on exactly that day. It waits until the log goes back that far, and it is left out while a gap of more than 14 days without weigh-ins leaves that day with no average. The all-time change appears once the log is more than a week old and goes back further than the longest figure shown, so it never repeats another figure. Next to them are the highest and lowest weigh-ins in the same 14 days as the average, with how many days ago each was. They need at least two weigh-ins in those days, and a tie shows the more recent day.

A goal has a goal weight, a start date and a start weight, which defaults to the 14-day average on the start date. Whether it is a loss, a gain or staying at a weight comes from those two weights. The distance is split into milestones, 10 by default, each at least 0.1 kg or 0.1 lb. Progress is measured with the 14-day average as shown, so a single light day doesn't count as reaching a milestone. The chart draws the goal weight as a dashed line and always keeps it in view.

A goal can also have a target rate, typed to 0.01 kg or 0.01 lb a week. Baseline saves a rate no faster than 1.5 kg a week or 1.5% of the start weight a week, whichever is lower, because above about 1.5 kg a week the risk of gallstones climbs steeply ([Weinsier 1995](https://pubmed.ncbi.nlm.nih.gov/7847427/)). The cap is rounded to 0.001 kg, and a rate up to 0.001 kg over it still counts, so a rate typed in pounds can be the nearest 0.01 lb to the cap. The cap applies to every goal, but only a loss goal gets the notes about gallstones. On a loss goal, a rate above 1% of the start weight a week shows a note under the rate. A goal saved before the cap keeps its rate, which still displays and forecasts, but saving any change to the goal needs a rate at or under the cap. Under the progress, a line says when the weight on a loss goal has come down faster than the cap for three weeks. That means the weekly trend was a clear loss faster than the cap, both as shown, on each of the last 21 days. The first of those days must be at least 14 days after the start date, so the latest trend uses only weigh-ins from after the first two weeks, when much of a quick loss is water. The line never changes the goal or the weigh-ins, and **Hide** removes it for that goal on that device.

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

So that sign-in loads sooner, `baseline/dist/index.html` opens a connection to the key's Frontend API host in a `preconnect` link before any script asks for it. When you replace the key, change that link to the new host too. `npm test` fails until they match.

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

## Offline use

The service worker in `baseline/dist/sw.js` keeps a copy of the app's own files: the page, its modules and styles, the font, the icons and the manifest. They're listed in `SHELL` at the top of the file. Each file comes from the network first, and the answer replaces the copy, so a deploy reaches the next load that has a connection. The copy is used when the network fails, returns an error or takes more than 3 seconds. A page that opened from the copy gets its modules from the copy too, so it never mixes versions. The worker never handles `/api/` requests, other sites such as Clerk, or anything but `GET`.

When you add a file to `baseline/dist/`, add it to `SHELL`, or to the list of files left out on purpose in `baseline/tests/worker.test.mjs`. `npm test` fails until you do. When `SHELL` changes, bump the version in the cache's name, now `baseline-shell-v2`, so the new worker starts a fresh cache and deletes the old one. Edits to a listed file need no bump.

Clerk's scripts load from its servers on every start, through a redirect that browsers can't cache, so sign-in can't load offline. Baseline shows the copy of the log kept on the device instead, and loads sign-in when the connection returns.

## Run locally

With Node.js 20.12 or later, run the following commands from the repository root.

```sh
npm install
vercel env pull .env.local
npm start
```

Open [Baseline locally](http://127.0.0.1:4173/). `npm start` serves the page from `baseline/dist/` and runs the API from `api/log.mjs`, using the `DATABASE_URL` in `.env.local`. Reminders can be turned on locally, but only Vercel sends them. Run `npm test` to check the calculations, including body fat against the Army's worked examples, the API's input checks, the reminder schedule, the push encryption, the copy of the log kept on the device, the changes that wait on the device and replay on top of it, the downloads, and the word a deletion needs. It also checks that deleting an account reaches every table in `server/schema.mjs`. And it checks that `index.html` preloads every module and connects early to the Frontend API in `config.mjs`, and that the service worker keeps every file in `baseline/dist/` that the app needs and leaves the API and Clerk alone.

## Using the tracker

Save a weight and a date in **Log a weigh-in**, with an optional note of up to 100 characters, such as "after travel". The arrows beside the date move it back or forward one day and stop at today. Saving again on the same date updates that entry. The form shows that day's weight and note, so a note stays unless you change or clear it. Notes appear under their weigh-ins in the tables and in the chart's tooltip. Choose **kg**, **lb** or **st** (stones and pounds) beside **Weight** to change the unit of every weight in Baseline. Baseline calculates BMI from your height and the latest recorded weight. Until you've entered a height, **Add height** next to **BMI** opens the height dialog. After that, the height is in **Settings**. Use **Set** or **Edit** next to **Goal** to set, change or remove a goal. Progress appears under the average, the goal shows as a dashed line on the chart, and the **Forecast** section gives the expected dates. The **Trend** section shows how much your average has changed over 7, 30 and 90 days and since your first weigh-in, and your highest and lowest weigh-ins of the last 14 days.

Use **Add** or **Update** next to **Body fat**, or **Log waist** in the **Body fat** section, to log a waist measurement whenever you take one. Measure around your bare waist at the navel, with the tape level and snug, after a normal breath out. Choose **Male** or **Female** for the formula the first time. After that it stays chosen. Saving again on the same date replaces that measurement. The **Body fat** section sits at the bottom of the overview, under the recent entries, so the weight trend stays the focus. It shows your latest estimate and waist, the change since your first estimate, a chart of every estimate and your latest five measurements, with **Show all** for the rest. Use the pencil on a measurement to edit or delete it. Choosing **cm** or **in** beside **Waist** also switches your height between centimeters and feet and inches, since the two share a unit.

Use **Set** under **Reminder** in **Settings** to get a notification at a chosen hour on days you haven't logged a weigh-in. Your browser asks to allow notifications the first time. Each device you turn reminders on from gets them, and **Turn off reminders** stops them on all of them. On iPhone and iPad, add Baseline to the Home Screen first: in Safari, tap **Share**, then **Add to Home Screen**. Open Baseline from the Home Screen and turn reminders on there. The reminder uses the time zone of the device you last saved it from. Signing out doesn't stop reminders on a device, so turn them off first on a device you share.

Sign in to open your log. A new account starts with an empty log. The **Weight log** shows every entry with its weekly trend and note, 15 to a page and grouped by month, and lets you edit a weigh-in's weight or note or delete it. A month that runs over onto the next page repeats its heading there. Choose **Monthly summary** at the top of the log to see each month's start and end averages, change, weekly trend and lowest weigh-in, along with any goal milestones reached that month.

**Settings**, the last link at the top of the page, gathers what you set once:

- **Units:** **kg**, **lb** or **st** for **Weight**, the same choice as beside the log form's weight. **cm** or **ft and in** for **Height and waist**, which share a unit: centimeters for both, or feet and inches for height and inches for waist. The height and waist dialogs switch the same unit.
- **Height:** the height BMI uses, with **Add** or **Edit**, which opens the height dialog and its **cm** or **ft** switch.
- **Reminder:** the reminder's time, or **Off**, with **Set** or **Edit**, which opens the reminder dialog. "Not this device" means reminders are on, but not for the device you're using. A city's name, such as "London time", means the reminder was saved from a device in another time zone.
- **Show on overview:** **BMI** and **Body fat estimate**, both on at first. Turning off **BMI** hides the BMI figure. Turning off **Body fat estimate** hides the body fat figure and the whole **Body fat** section, with its chart and waist measurements. Hiding one deletes nothing: your height and waist measurements stay saved, and turning it back on shows everything again. The choice is saved to your account, so it applies on every device you sign in on.
- **Your data:** downloads your log or deletes it, as [Your data](#your-data) describes.
- **Account:** the email you're signed in with. **Manage account** opens Clerk's account page, where you change your email, password or sign-in methods. **Sign out** signs you out on this device. It needs a connection. If changes are still waiting to sync, it says how many and asks first, since signing out deletes them. The avatar at the top right can also manage your account or sign out.

Entries and their notes, height, waist measurements and the body fat formula you chose, your goal, your units, what the overview shows and your reminder time are saved to your account, so the same log opens on any device you sign in on. A change shows right away and is saved in the background. Switching back to the tab picks up changes made on another device.

Once Baseline has loaded on a device, it opens there without a connection, and you can keep logging. A change made offline, or while the connection fails, shows right away and is kept on the device. A message says "Saved on this device. It’ll sync when you’re back online.", and the line "Saved on this device · syncing when you’re back online" stays under the heading until the change is sent. Waiting changes survive a reload. Baseline sends them in the order you made them, one at a time, without you doing anything: when it opens with a connection, when the device comes back online, when you return to the tab, and once a minute while the device reports a connection. iOS has no background sync, so on an iPhone they wait until Baseline is open. Once they've all been sent, a message says "Synced." If the server turns down a change that waited on the device, because it isn't valid, the change is dropped and a message names it. If the server can't be reached for another reason, the line reads "Saved on this device · not synced yet" and Baseline keeps trying.

Weigh-ins, their edits and deletions, waist measurements, height, the goal, units and what the overview shows can wait on the device. Reminders can't, because they change which devices get notifications, so offline the reminder dialog says they need a connection.

Each date has one weigh-in and one waist measurement, and the last change to reach the server wins, as it does for height, the goal, units and each choice of what the overview shows. A change made offline therefore replaces one made on another device in the meantime once it syncs, even if the other was made later. An edit to a weigh-in that another device deleted in the meantime changes nothing.

If saving fails while you wait for it, because the server turned the change down or couldn't save it, the change is undone on screen and a message at the bottom of the page says so. It stays until you choose **Dismiss** or the change is saved. **Try again** sends the same change again, exactly as you entered it, and the message confirms it once it's saved. The date, weight and note you typed in **Log a weigh-in** also stay in the form, so you can save them from there instead. Other messages fade after about 4 seconds, but not while the mouse is over them or focus is in them.

Baseline keeps a copy of your log on each device you use it on, so the next visit opens at once. It shows that copy straight away, with "Updating…" under the heading, while sign-in loads and the latest log is fetched. The latest log then replaces the copy and the line goes. If it can't be fetched, the line reads "Couldn't update. Showing your log as of" and the time the copy was saved, or "Offline · showing your log as of" and the time when the device is offline. Baseline tries again when the device comes back online and when you return to the tab. You can make changes in the meantime, and they wait on the device until sign-in has loaded and they can be sent. If by then nobody is signed in, the copy and any waiting changes are removed and the sign-in page shows instead. If a different account is, they're removed and that account's log opens. Without a copy, the page shows the outline of the overview while your log loads.

Baseline stores these in the browser on your device:

- **A copy of your log:** your entries and notes, height, waist measurements, the body fat formula you chose, your goal, your units, what the overview shows, and your reminder time and which devices get reminders, as the server last returned them, with the time they arrived. It's stored under `baseline.log-cache.v1:` followed by your account's user ID. Only one account's copy is kept on a device.
- **Your user ID,** under `baseline.last-user.v1`, so Baseline knows whose copy to show before sign-in has loaded. Your email address isn't stored.
- **Changes waiting to sync:** each change you made that the server doesn't have yet, in order, under `baseline.outbox.v1:` and your user ID. A change goes in as you make it and comes out once the server has it.
- **A hidden note:** the start date of the goal whose note about fast loss you hid, under `baseline.fast-loss-hidden:` and your user ID.
- **A log from before accounts,** on a browser that used an earlier version, until it moves into an account as described below.
- **Baseline's own files,** in the service worker's cache, so it opens offline. They hold none of your data.

Signing out removes the copy of your log, your user ID and any changes that haven't synced yet, so a shared computer keeps none of your weights. Deleting your data or your account also removes your weights and the changes waiting to sync from the device you delete it on, as [Your data](#your-data) describes. **Sign out** in **Settings** warns about changes that haven't synced and removes the copy before the session ends. The avatar menu doesn't warn, and it reloads the page as it signs out, so the copy goes once the page has loaded again. Before you sign out from the avatar menu, check that the "Saved on this device" line has gone. Clerk keeps its own sign-in data, and signing out ends that session.

Earlier versions kept logs only in the browser. The first time an account with an empty online log signs in on such a browser, that browser's log moves into the account and is removed from the browser. An account that already has entries keeps them, and the browser's log is left untouched. An account whose data was deleted never takes in a browser's log, as [Your data](#your-data) describes.

## Your data

**Your data**, in **Settings**, downloads your log or deletes it. Both downloads include changes still waiting on the device. On an iPhone or iPad with Baseline on the Home Screen, where a download does nothing useful, the share sheet opens instead, so you can save the file to Files.

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
  "entries": [{ "date": "2026-11-01", "weightKg": 85, "note": null }],
  "waists": [{ "date": "2026-11-02", "waistCm": 86.61 }]
}
```

`units` are the units Baseline shows, `preferences` says whether the overview shows BMI and body fat, and `sex` is the body fat formula you chose. `heightCm`, `sex`, `goal` and `reminder` are null when they aren't set, as is `rateKgPerWeek` for a goal without a target rate. The file holds no account ID, email address or push subscription.

**Delete my data** empties your log and keeps your account. **Delete my account** empties your log, then deletes your account and signs you out. Each opens a dialog that lists what goes and offers **Download a copy first**. It goes ahead only once you type "delete". Deleting needs a connection, and the log changes only once the server has deleted it. If that fails, the dialog says so and you can try again.

Either one deletes, from your account:

- every weigh-in and its note
- every waist measurement, and the body fat formula you chose
- your goal and your height
- your settings: units go back to kg and cm, and the overview shows BMI and body fat again
- your reminder time and time zone, and every device that gets reminders, so reminders stop on all of them

**Delete my data** leaves an empty profile in its place. It counts as started, so a log from before accounts, in any browser, never moves back into the account. **Delete my account** leaves no row for your user ID in any table: `profiles`, `weigh_ins`, `waist_measurements` and `push_subscriptions`. Then it deletes your Clerk user, which signs you out, and the sign-in page says "Your account and all your data have been deleted." If your data is deleted but Clerk can't delete the account, the dialog says so, and **Try again** deletes only the account.

On the device you delete on, Baseline also removes the copy of your log, changes waiting to sync, a log from before accounts and the hidden note about fast loss, and it unsubscribes the device from notifications. After **Delete my data**, the copy is replaced by the empty log. After **Delete my account**, your user ID goes too. Other devices show the empty log the next time they load it, and after an account is deleted they're signed out. A change still waiting on another device, because that device was offline, is saved into the emptied log when it syncs.

**Delete my account** needs the Clerk Dashboard setting that lets users delete their own accounts. Baseline reads it from the signed-in user's `deleteSelfEnabled`, and the button shows only when it's on. With it on, Clerk's own account page, from **Manage account** or the avatar menu, can delete the account too, but that removes only the Clerk user and leaves the log in the database. Use **Delete my account** in Baseline instead.

Neon keeps a history of every change so the database can be restored to an earlier moment, and deleted rows stay in that history until its window passes. On Neon's Free plan, which the setup command above chooses, the window is 6 hours, which is both the plan's default and its maximum. The window shows under **Settings → Postgres → History window** in the Neon console. Paid plans default to 1 day and allow up to 7 days on Launch or 30 on Scale. A restore keeps the data it replaced in a backup branch named after the branch, `_old_` and the time. That branch keeps deleted rows until you delete it, so delete it once you've checked the restore.
