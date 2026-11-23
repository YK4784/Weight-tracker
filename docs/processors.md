# Processors

**Draft, 23 November 2026.** It needs a lawyer's review before Baseline relies on it. Facts about the vendors' agreements come from the privacy research of 23 November 2026 (`research_notes/`, "Processor agreements (DPAs) and sub-processors"). They weren't re-checked against the vendors' current pages.

These are the services that receive data about Baseline's users, what each one gets, where, and the agreement that covers it. The health data privacy policy (`baseline/dist/health-data-privacy.html`) names the same services in plain words. When a service is added, or what one receives changes, update this file, the policy's "Who handles it", and the Your data view in `index.html`.

## The list

| Service | Role | What it receives | Where | Agreement |
|---|---|---|---|---|
| **Vercel** | Hosting: serves `baseline/dist/` and runs `api/log.mjs`, `api/remind.mjs` and `api/csp-report.mjs` | Every request, with its IP address, user agent, path and status. The function logs, which hold no values, notes, user IDs or emails (see "Gaps" 3): each error's kind and code with a short request ID, the reminder run's counts, and the directive and host of each Content Security Policy report. Request bodies pass through the functions but aren't logged. | Functions in the default region, `iad1` (Washington, D.C., USA), since `vercel.json` sets no `regions`. Static files from Vercel's edge network worldwide. | [Vercel DPA](https://vercel.com/legal/dpa), with the 2021 SCCs, the UK IDTA and Swiss terms. It names the Pro and Enterprise plans only (see "Gaps" 1). Sub-processors are listed in Vercel's trust portal, security.vercel.com. |
| **Neon** (part of Databricks) | The Postgres database | Everything in the log, keyed by Clerk user ID: weigh-ins and notes, height, waist measurements and sex, the goal, units and preferences, the reminder hour, time zone and `reminded_on`, push subscriptions (endpoint, `p256dh`, `auth`), and the consent version and time. No email or name. | The region the setup command chose, `--meta region=iad1`, which is AWS `us-east-1` (N. Virginia, USA). Confirm it in the Neon console (see "Gaps" 4). Encrypted at rest. | [Neon's DPA schedule](https://neon.com/dpa), which amends the Databricks Master Cloud Services Agreement. Sub-processors: Grafana Labs plus [Databricks' list](https://www.databricks.com/legal/databricks-subprocessors), which has no Neon-specific section. |
| **Clerk** | Accounts and sign-in | The email address, a password hash if a password is set, and the name and picture from Google sign-in. Session records, including IP address and user agent. Its scripts (`@clerk/clerk-js` and `@clerk/ui`) run on Baseline's page, loaded from the Frontend API host in `config.mjs`. Its fraud protection loads a script from `cdn.protect.clerk.com`, which checks the browser and contacts `*.client.protect.clerk.com` on several ports. The sign-up form can load Cloudflare's Turnstile bot check, and avatars come from `img.clerk.com`. Clerk's telemetry is turned off (`telemetry: false` in `auth.mjs`). | United States. Clerk hosts "primarily in Google Cloud and Cloudflare data centers". | [Clerk DPA](https://clerk.com/legal/dpa). Clerk is self-certified under the EU-US Data Privacy Framework, with SCCs as a fallback. It acts as an independent controller for "Account Information". It forbids special-category data in Clerk (see "Gaps" 2). [Sub-processors](https://clerk.com/legal/subprocessors). |
| **Push services**: Google (FCM, for Chrome and most Chromium browsers), Microsoft (WNS, for Edge), Mozilla (autopush, for Firefox) and Apple (for Safari) | Deliver reminders, only to devices that turned them on | A message encrypted for the device (RFC 8291, `encrypt` in `server/push.mjs`), so the service can't read it. It sees the endpoint, the time, the TTL, the `Topic: weigh-in` header and the VAPID signature naming Baseline's site. The text is fixed (`MESSAGE` in `server/reminders.mjs`) and holds no weights. | Each vendor's own | None. These services belong to the browser, and the browser chooses which one is used. The policy names them as recipients. |
| **Google sign-in** | Identity provider, only for people who choose "Continue with Google" | That the person is signing in to Baseline's Clerk instance. Nothing from the log. | Google | None. Google acts as an independent controller under the person's own Google account terms. |

GitHub hosts the code, and none of the users' data. Nothing else receives users' data. `baseline/tests/page.test.mjs` checks the parts of this that the code decides:
- The app's only script is its own `app.mjs`.
- `auth.mjs` loads scripts only from the Frontend API host its publishable key names.
- The app fetches only `/api/log`, and the service worker fetches only what the page asked for.
- No code sets cookies, uses `sendBeacon`, `XMLHttpRequest`, WebSockets or `EventSource`.

## Gaps

1. **Vercel's DPA and the Hobby plan.** The DPA says it applies to customers on the Enterprise and Pro plans, and doesn't mention Hobby.
   - I couldn't check the project's plan: the Vercel CLI's saved login on this machine expired on 22 November 2026, and the API refused it. The README's "Set up reminders" section describes Hobby's limits for Vercel Schedules, which suggests Hobby.
   - **To do:** check the plan in the Vercel dashboard. If it's Hobby, ask Vercel in writing whether the DPA covers a Hobby team, or move the project to Pro.
   - Log retention depends on the plan too: runtime logs are kept 1 hour on Hobby and 1 day on Pro. The policy says "up to a day", which holds for both.
2. **Clerk and health data.** Clerk's DPA "prohibits Customer from using the Services to solicit, display, store, process, send or transmit special categories of data". So nothing from the log may go into Clerk.
   - That means no weight, measurement, note, goal or sex, in `publicMetadata`, `privateMetadata`, `unsafeMetadata` or anywhere else. Comments in `baseline/dist/auth.mjs` (above `startClerk`) and `baseline/dist/app.mjs` (above `connectClerk`) say so.
   - Today the code never writes to the Clerk user. It only reads `id`, `primaryEmailAddress`, `deleteSelfEnabled`, and calls `user.delete()`.
   - **Residual exposure:** Clerk's scripts run in the same page as the log, so they could read what the page shows. That is the trust any embedded auth SDK needs. The Content Security Policy in `vercel.json` lets in only Clerk's hosts and Cloudflare's bot check. It's report-only until it's switched on (README, "Security headers"), and from then no other script can run on the page.
3. **Vercel's logs.** A Postgres error such as a CHECK violation carries "Failing row contains (…)", with the user ID and the values being saved. So the server never logs an error's message, detail or parameters: `logError` in `server/log.mjs` writes only its kind, its code and a short request ID. The reminder run logs counts, and a failed reminder its status, never the device. `server/csp.mjs` logs a CSP report's directive and blocked host, never the page or the URL's path.
   - `server/tests/api.test.mjs` checks that a constraint error's detail never reaches the log.
   - Vercel's own request log still records each request's IP address and path, which the policy says.
   - Anything that adds a `console` call on the server must keep to this.
4. **Neon facts to confirm in the console.**
   - The project's region.
   - The history window, which the policy and README give as 6 hours, the Free plan's default and maximum.
   - That no manual snapshot exists, since the policy says Baseline makes no other backups.

   Neon's sub-processor link redirects to Databricks' list, which has no Neon-specific section.
5. **The development Clerk instance.** `config.mjs` holds a `pk_test_` key. The README's "Move to a Clerk production instance" has the checklist for the switch. Its users' accounts then live in a different Clerk instance, under the same DPA.
6. **Transfers.** Every service above stores data in the United States. For users in the EU or UK, the transfer rests on each vendor's mechanism: SCCs for Vercel, the DPF or SCCs for Clerk, and the Databricks agreement for Neon. A lawyer should confirm these, and whether Baseline needs an EU representative under GDPR Article 27.
7. **Sub-processor changes.** Subscribe to each vendor's notices:
   - Vercel: by email, with a 5-day objection window.
   - Clerk: at least 15 days' notice, with a 10-day objection window.
   - Databricks: its list's update notices.
