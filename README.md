# Baseline

A daily weight journal with a 14-day moving average and height-based BMI. Each gray dot on the chart is a weigh-in. The blue line shows the mean of the weights recorded on that calendar day and the preceding 13 days. The first entry produces an average immediately, and missing dates contribute no measurements.

Under the average, the weekly trend gives the slope of a straight line fitted through the last 21 days of weigh-ins, in kilograms a week. An average runs about a week behind a falling or rising weight, and the fitted line does not. The trend appears once there are 8 weigh-ins spread over at least 14 days. When the slope is too small to tell apart from normal day-to-day scale noise, it reads "No clear change".

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

## Run locally

With Node.js 20.12 or later, run the following commands from the repository root.

```sh
npm install
vercel env pull .env.local
npm start
```

Open [Baseline locally](http://127.0.0.1:4173/). `npm start` serves the page from `baseline/dist/` and runs the API from `api/log.mjs`, using the `DATABASE_URL` in `.env.local`. Run `npm test` to check the calculations and the API's input checks.

## Using the tracker

Save a weight in kilograms and a date in **Log a weigh-in**. The arrows beside the date move it back or forward one day and stop at today. Saving again on the same date updates that entry. Use **Add** or **Edit** next to **Height** to enter a height in centimeters. Baseline calculates BMI from the latest recorded weight.

Sign in to open your log. Use the avatar at the top right to manage your account or sign out. A new account starts with an empty log. The **Weight log** shows every entry and lets you edit or delete individual weigh-ins.

Entries and height are saved to your account, so the same log opens on any device you sign in on. A change shows right away and is saved in the background. If saving fails, the change is undone and a message says so. Switching back to the tab picks up changes made on another device.

Earlier versions kept logs only in the browser. The first time an account with an empty online log signs in on such a browser, that browser's log moves into the account and the browser copy is removed. An account that already has entries keeps them, and the browser copy is left untouched.
