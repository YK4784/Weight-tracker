# Breach runbook

**Draft, 23 November 2026.** The steps follow Baseline's code and setup as they are now. The notification deadlines in step 5 are candidates, each to be confirmed with a lawyer, and none of this is legal advice.

Use this when someone who shouldn't have it may have seen or taken users' data. That includes the database, the logs, a key, or the code that runs on users' pages. The person responsible is [name of the person or business responsible for Baseline], reached at [contact email address].

Keep a dated record from the first minute: what you noticed, when, and each step you take. GDPR Article 33(5) expects one for every breach, even one you don't report.

## 1. Notice it

Ways a breach can show up:
- A report to [contact email address].
- A vendor's notice. Vercel and Clerk promise to report a breach on their side "without undue delay" (see `docs/processors.md`).
- Errors or traffic you don't recognize in Vercel's function logs. On the Hobby plan Vercel keeps them for only 1 hour, so download what you need at once.
- Activity in the Neon console, or a role you didn't create.
- A commit, deployment or environment variable change you didn't make. Pushing to `main` deploys, so check the GitHub history and Vercel's deployment list.
- A GitHub secret-scanning alert.

## 2. Contain it

Do what applies, in this order. Each step lists what it breaks for users.

1. **Stop the API, if it's the API that leaks.**
   - Remove `DATABASE_URL` from the Production environment variables in Vercel and redeploy. `createStore` in `server/store.mjs` then throws, and every request gets a 500.
   - People whose device has a copy of their log still see it. Anyone without one gets "Couldn’t load your log".
   - A new change fails with Try again. Changes already waiting on a device stay there until the API is back (see the README's "Offline use").
   - Put it back once the database password is new (next step).
2. **Rotate the database password.**
   - In the Neon console, reset the password of every role on every branch, starting with the owner role in `DATABASE_URL`. Remove any role you don't recognize, and revoke Neon API keys you don't need.
   - Put the new connection string in Vercel as `DATABASE_URL` for Production, Preview and Development, and redeploy.
   - Run `vercel env pull .env.local` on your own machine. Never paste the value anywhere else.
   - After F4, do the same for `DATABASE_URL_APP` and the `baseline_app` role.
3. **Rotate the VAPID keys,** if the private key or the `push_subscriptions` table may be out. Anyone with both could send notifications that look like Baseline's.
   - Generate a new pair with the command in the README's "Set up reminders".
   - Put the public key in `baseline/dist/config.mjs` and the private key in Vercel's `VAPID_PRIVATE_KEY`, then push and redeploy.
   - Then run `DELETE FROM push_subscriptions` and `UPDATE profiles SET reminder_hour = NULL`. Old subscriptions can't receive messages signed with the new key.
   - Everyone has to turn reminders on again, so say so in the notice.
4. **Clerk.**
   - Baseline's code holds only the publishable key, which is public. If a secret key or a webhook signing secret has been created, roll it in the Clerk Dashboard → API keys, or Webhooks.
   - If sessions may be stolen, end them: revoke the affected users' sessions in the Dashboard. Ask Clerk support how to end every session at once, since the server accepts any token that Clerk's published keys verify (`server/auth.mjs`).
5. **Vercel and GitHub.**
   - Remove anyone who shouldn't be on the Vercel team. Revoke Vercel access tokens, including the CLI's (`vercel logout` on each machine).
   - Check every environment variable.
   - Revoke GitHub tokens and deploy keys that might be exposed. If a bad commit reached `main`, revert it and redeploy a known-good build.
6. **Restores.** If you restore the Neon database to an earlier moment, Neon keeps the old state in a branch named after the branch, `_old_` and the time.
   - The privacy policy promises that copy is deleted within 7 days. Delete it once you've checked the restore.
   - A restore also brings back rows that users deleted since that moment. Run each of their deletions again; Neon's own history won't show them, so use your record.

## 3. Keep the evidence

Download or screenshot these before they expire:
- Vercel's runtime logs: 1 hour on Hobby.
- Vercel's activity log and deployment list.
- Neon's operations log.
- Clerk's logs.
- GitHub's history.

Neon's restore history holds 6 hours on the Free plan. To keep the database as it was, make a branch from a moment before the breach. That branch holds users' data, so note it in your record, keep it only as long as the investigation needs, and then delete it.

## 4. Work out whose data and what

- **Which tables and when.** The data is in `profiles`, `weigh_ins`, `waist_measurements` and `push_subscriptions` (see `server/schema.mjs`), all keyed by Clerk `user_id`.
  - `profiles` holds height, sex, the goal, units, preferences, the reminder hour and time zone, and the consent version and time.
  - `weigh_ins` holds weights and notes.
  - `push_subscriptions` holds each device's endpoint and keys.
  - Work out which of these the attacker could read, and for which period.
- **Whose.** List the affected `user_id`s with a query on the tables in question, for example `SELECT DISTINCT user_id FROM weigh_ins`. Match them to email addresses in the Clerk Dashboard. The database holds no emails.
- **Where they live.** The deadlines below depend on where people live, which Baseline doesn't record. The `time_zone` of those with reminders gives a rough idea. Otherwise treat everyone as possibly in each place below.
- **How bad.** Weight over time, notes and sex are health data everywhere in this list. Notes are free text, so they can hold anything.

## 5. Decide who to tell, and by when

Each deadline below is a candidate. **Confirm each one with a lawyer** for the actual breach.

| Law | Who to tell | Deadline | Confirm with a lawyer |
|---|---|---|---|
| FTC Health Breach Notification Rule (as amended in 2024) | Each affected person. The FTC too: at the same time as the people if 500 or more are affected, or in a yearly report if fewer. The media too, if 500 or more live in one US state. | Without unreasonable delay, and within 60 calendar days of discovery. | Confirm with a lawyer: whether Baseline is a "vendor of personal health records", and what counts as discovery. |
| GDPR Article 33, and UK GDPR | The supervisory authority, unless the breach is unlikely to risk people's rights. | 72 hours after becoming aware of it. | Confirm with a lawyer: which authority leads, and whether Baseline needs an EU representative. |
| GDPR Article 34, and UK GDPR | Each affected person, if the risk to them is high. | Without undue delay. | Confirm with a lawyer: whether the risk is high. |
| Washington's breach law, RCW 19.255.010 | Each affected Washington resident. The Attorney General too, if 500 or more are affected. | 30 days after discovery. | Confirm with a lawyer: the current deadline, and whether health data and encryption change it. |
| Other US states | Residents of each state, and some regulators. | Varies by state, often 30 to 60 days. | Confirm with a lawyer: which states' laws apply. |

## 6. Tell people

- **Two channels.** Email each affected person, using the addresses from Clerk, and put a notice in the app. The FTC rule asks for email plus one more channel.
  - Baseline has no banner yet. Until it does, a message in the sign-in screen's notice (`authNotice` in `app.mjs`) or a short page linked from it are quick ways to add one.
- **What to say, in plain words:**
  - what happened, and when;
  - which data, for example "your weigh-ins and notes from 1 March to 4 March";
  - what Baseline has done, such as new keys, sessions ended or the hole fixed;
  - what the person can do, such as change their password, sign in again, turn reminders on again, download their data or delete it;
  - how to reach [contact email address].
- Send the regulator notices from step 5 with the same facts.

## 7. Afterwards

- Write down the cause, the fix and what will stop it happening again. Add the outcome to your record.
- Delete the evidence copies that hold users' data, such as branches and downloaded logs, once they're no longer needed.
- If the policy or the Your data view no longer match what happened or what changed, update them, and change `CONSENT_VERSION` if people must agree again.
- Check this runbook against what you actually did, and fix it.
