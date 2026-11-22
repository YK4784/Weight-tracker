# Baseline

A daily weight journal with a 14-day moving average and height-based BMI. Each gray dot on the chart is a weigh-in. The blue line shows the mean of the weights recorded on that calendar day and the preceding 13 days. The first entry produces an average immediately, and missing dates contribute no measurements.

## Set up sign-in

Baseline uses [Clerk](https://clerk.com) for accounts, with email and Google sign-in. The sign-in screen comes from Clerk's prebuilt components, loaded from your Clerk app's Frontend API, so there is still nothing to install or build.

1. Create an application in the [Clerk Dashboard](https://dashboard.clerk.com). Turn on **Email** and **Google** as sign-in options.
2. Open **API keys** and copy the **Publishable key**. It starts with `pk_test_`.
3. Paste it into `baseline/dist/config.mjs`:

   ```js
   export const CLERK_PUBLISHABLE_KEY = "pk_test_…";
   ```

The publishable key is meant for browser code and is safe to commit. Never put a secret key (`sk_…`) in this repository.

A development instance (`pk_test_`) works on `localhost` and on Vercel preview URLs, and its Google sign-in runs on Clerk's shared credentials. A production instance (`pk_live_`) needs a domain you own, because Clerk does not issue production instances for `*.vercel.app`. It also needs your own Google OAuth client. Follow Clerk's [production deployment guide](https://clerk.com/docs/guides/development/deployment/production) and its [Google setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google), then replace the key in `config.mjs`.

## Run locally

With Node.js 20 or later, run the following command from the repository root.

```sh
npm start
```

Open [Baseline locally](http://127.0.0.1:4173/). The static app lives in `baseline/dist/` and runs without a build or dependency installation. Run `npm test` to check the calculations.

## Using the tracker

Save a weight in kilograms and a date in **Log a weigh-in**. The arrows beside the date move it back or forward one day and stop at today. Saving again on the same date updates that entry. Use **Add** or **Edit** next to **Height** to enter a height in centimeters. Baseline calculates BMI from the latest recorded weight.

Sign in to open your log. Use the avatar at the top right to manage your account or sign out. A new account starts with labeled sample data. Your first saved weight or height starts your own log. The **Weight log** shows every entry and lets you edit or delete individual weigh-ins.

Entries and height are still saved only in the browser that recorded them. Signing in doesn't sync them to other devices, and clearing site data removes them. Each account on a browser has its own log. The first account to sign in on a browser takes over any log saved there before sign-in existed. Separate logs keep people's entries apart in the app, but they aren't encrypted. Anyone with access to the browser's storage can still read them.
