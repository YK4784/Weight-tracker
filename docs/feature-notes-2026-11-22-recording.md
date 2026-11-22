# Feature notes from the 22 Nov 2026 screen recording

**Source:** `ScreenRecording_11-22-2026 18-56-22_1.MP4`. It is an 88-second iPhone recording with no audio. It walks through Happy Scale, an iOS weight tracker, covering Summary, Weight Goals, Reports, Logbook and Settings. Timestamps in brackets are minutes:seconds into the recording.

Two later screenshots from 19:04 the same day show the same cards filled in once a valid goal is set. They are cited as **Shot A** (Weight Trends and Predictions) and **Shot B** (Weight Loss Progress).

The aim here is to borrow ideas, not the app itself. Baseline keeps its own look, name and wording.

**Checked against:** `main` at `f1328e0` ("Show a weekly weight trend under the 14-day average"), 22 Nov 2026. The first draft was written against an older local copy, before accounts, the database and the redesign.

## What Baseline already has

- **Accounts:** Clerk sign-in with email or Google. Logs and height are stored in Postgres behind `/api/log`, so the same log opens on any device. Changes show at once and roll back if saving fails.
- **Overview:** the 14-day average (a plain mean of the weigh-ins in that window) as the main number.
- **Weekly trend under the average:** the slope of a line fitted through the last 21 days of weigh-ins, in kg a week. It needs 8 weigh-ins over at least 14 days, and reads "No clear change" when the slope is within the scale's day-to-day noise (`calculateRate` in `model.mjs`).
- **Facts:** latest weigh-in, height (with Add or Edit next to it) and BMI.
- **Log a weigh-in:** a form with previous and next day arrows that stop at today.
- **Trend chart:** 14D, 30D, 90D and All ranges, the average line over gray daily dots, an end-of-line value label, a tooltip and arrow-key inspection.
- **Log table:** date, weight, 14-day average and change from the previous weigh-in, with edit, delete and pagination on the Log page.
- **Dark mode:** follows the system setting.
- **Import of an old browser log:** a log saved before accounts existed moves into an empty account.

**Design direction set by the redesign (`fe83a97`):**
- Hairline rules instead of cards
- One cobalt accent on an off-white page
- No decorative icons
- A neutral change column with no coloured arrows

The recording's app uses coloured tiles, gauges and pills. Below, each feature takes the information it shows and fits it to Baseline's quieter style.

## Summary

| # | Feature | Seen at | Baseline today | Priority | Effort |
|---|---------|---------|----------------|----------|--------|
| 1 | Goal weight, starting point and objective | 0:05–0:40 | Missing | High | M |
| 2 | Progress toward the goal: milestones, % complete, amount to go | 0:04, 0:31, Shot B | Missing | High | M |
| 3 | Goal-date prediction and forecast table | 0:19, 0:41, Shot A | Partly: current rate exists | High | S |
| 4 | Goal line on the chart | 0:47 | Missing | High | S |
| 5 | Weekly rate per row in the log | 1:16 | Partly: rate shows in the summary only | Medium | S |
| 6 | Export and import | 1:23 | Partly: one-time browser import only | Medium | S–M |
| 7 | Recent high and low | 0:00 | Missing | Medium | S |
| 8 | Monthly and weekly reports | 1:01–1:11 | Missing | Medium | M |
| 9 | Notes on weigh-ins, log grouped by month | 1:16–1:20 | Missing | Medium | M |
| 10 | Weight units (lb, st) | 1:23 | Missing (kg only) | Medium | M |
| 11 | Dark mode | whole recording | Done: follows system | Low (manual toggle) | S |
| 12 | Weigh-in reminder | 1:23 | Missing | Medium | M |
| 13 | Show or hide sections (e.g. BMI) | 0:02 | Missing | Low | S |
| 14 | Trend forecast on the chart | 0:57 | Missing | Medium | S |
| 15 | Weight change over 7, 30 and 90 days and all time | 0:17, Shot A | Missing | Medium | S |
| 16 | Lines from each weigh-in to the trend | 0:47–0:56 | Missing | Low | S |
| 17 | Share chart or report as an image | 0:47, 1:01 | Missing | Low | M |
| 18 | Multiple user profiles | 1:23 | Covered by accounts | — | — |

**Effort scale:** S is under a day and M is one to three days.

**Features that store new data** (goals, notes, units, the BMI preference) cost more than they did in the browser-only version. Each needs:
- a schema change in `server/schema.mjs`
- a new op in `server/ops.mjs` with input checks
- a write and a read in `server/store.mjs`
- tests in `server/tests/api.test.mjs`
- a matching change to `normalizeState` in `model.mjs`

Features computed from the existing log (prediction, change over periods, high and low, chart additions) stay client-only.

## High priority

### 1. Goals: starting point, goal weight and objective

**In the recording.** A "Weight Goals" sheet sets:
- Objective (lose weight)
- Starting point as a weight plus a date (56.0 kg, 13 Sep 2022)
- Goal weight
- What to do once the goal is reached: "Stay at", "Stay around" or "Stay below" that weight
- Committed rate in kg per week
- How many segments to split the goal into (10)
- Whether progress is measured with the trend or the 10-day low

**For Baseline.** This is still the biggest gap. Without a goal, the average and the weekly trend have nothing to measure against. A first version only needs a start date, a goal weight and an optional committed rate. The start weight should default to the 14-day average on the start date, not to one weigh-in.

**Lesson from the recording.** The user picked "Lose weight" and then set a goal (60 kg) above their starting weight (56 kg). Three cards then turned into error messages (0:15–0:22). Baseline should work out the direction from start vs. goal (gain, lose or maintain) and not ask for an objective that can contradict the numbers.

**Implementation note.** The goal belongs on the `profiles` table. Every statement in `schema` runs again on each cold start, so add the columns as `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS …` statements, for example:
- `goal_kg`
- `goal_start_date`
- `goal_rate_kg_week`
- `goal_segments`

Then:
- Add a `set-goal` op (and a way to clear the goal) in `server/ops.mjs`.
- Return the goal from `store.run`.
- Extend `normalizeState`. It currently keeps only `started`, `height` and `entries`, so it would drop the goal.

### 2. Progress toward the goal

**In the recording.** A "Weight Loss Progress" card, with an optional "overall percentage complete" toggle (0:31) and the goal split into 10 equal segments. There is also an "Animation" setting for a celebration when a segment is reached.

**Filled in (Shot B).** With a valid goal, the card becomes:
- A large arc gauge showing progress through the *current* milestone, labelled "MILESTONE 8"
- That milestone's target weight in big type (61.2)
- The reading used for tracking, with its date and age: "Nov 18, 2026 · 61.4 · 4 days ago". This is the 10-day low, not the trend.
- "67% complete" within this milestone and "0.2 to go" to reach it
- A row of 10 dots, one per milestone, with 7 filled
- A footer reading "7 of 10 milestones completed · 77.0% complete overall". The overall line only shows when the percentage toggle is on.

**For Baseline.** Keep the information:
- the current milestone's target
- progress within the milestone
- the amount to go
- milestones completed
- the overall percentage

Drop the large purple gauge, which doesn't fit the redesign. A thin cobalt progress rule under the 14-day average, with a tick for each milestone, does the same job. The numbers can go into the existing facts list: "Goal 60.0 kg · 1.2 kg to go · milestone 8 of 10". Splitting the goal into milestones keeps progress visibly moving even when the final goal is far away.

Track progress with the 14-day average, not the latest weigh-in or the recent low. That is what Baseline already leads with. The other app's 10-day low moves faster and feels better, but one light day can make it jump. A small celebration when a milestone is crossed is cheap and motivating.

**Implementation note.** Milestone *n* has target `start − n × (start − goal) / segments`. Progress within a milestone is `(previousTarget − current) / (previousTarget − target)`, clamped to 0–100%. Overall progress is `(start − current) / (start − goal)`. Use the same formulas with the signs flipped for weight gain.

### 3. Goal-date prediction and forecast

**In the recording.** A "Predictions" card shows Commitment 0.50, Current Rate 0.12 and Overall Rate (0:41). Once a goal is set, it predicts when the goal will be reached.

**Filled in (Shot A).** The card has three rows: Commitment 0.50, Current Rate 0.12 and Overall Rate 0.72. The Commitment row is highlighted, so a row seems to choose which rate drives the forecast. Underneath it says "At your commitment rate of 0.50 kg per week, here's your predicted forecast", followed by a two-column Weight / Date table. The single row reads "61.2 kg · Next Milestone · November 22 · today?!". The Weight header has an up/down toggle. It probably switches between the next milestone and the final goal, but the screenshot doesn't confirm this.

**Baseline today.** The current rate already exists. `calculateRate` fits a line through the last 21 days and reports `perWeek` and whether the change is `clear` of scale noise. That is more careful than the other app's rate.

**Still to add:**
- **Overall rate:** the change in the 14-day average since the goal's start date, divided by the number of weeks.
- **Rates side by side:** show the committed, current and overall rates together, and let the user pick which one the forecast uses.
- **Forecast table:** the next milestone, later milestones and the goal, each with a predicted date.
- **Only forecast from the current rate when it is `clear`.** If the trend reads "No clear change", or is moving away from the goal, say so plainly and show no date. The other app happily forecasts from a 0.12 kg/week rate that may be noise.
- **Friendly wording:** when the predicted date is today or already past, say "today" or "any day now" instead of showing a date in the past.

This is all client-side, in `model.mjs`, once goals exist.

### 4. Goal line on the chart

**In the recording.** A dashed "GOAL WEIGHT" line on the main chart and on each monthly report chart. The area between the starting level and the trend is shaded green for progress and red when the trend moves away from the goal.

**For Baseline.**
- Add a dashed hairline at the goal weight in `chart.mjs`.
- Take its colour from CSS like the other chart colours, so it follows dark mode.
- Label it at the right edge, the same way the average line now ends with its value.
- Include the goal when the y-axis range is worked out, so the line stays on screen.

Skip the green and red shading; it goes against the single-accent style.

## Medium priority

### 5. Weekly rate per row in the log

**In the recording.** Logbook columns are Date (day number plus weekday), Recorded, Moving Average, Weekly Rate and Notes (1:16). Weekly rate is a coloured pill: green down arrow for progress, red up arrow for moving away from the goal.

**Baseline today.** The weekly trend now shows in the summary, which answers the main question. The log table still has "Change from previous", which compares two raw weigh-ins. That is the noise Baseline tells people to ignore.

**For Baseline.** Replace that column with "Weekly trend" by running `calculateRate(entries, row.date)` for each row. Show "—" where there isn't enough data, and use the same "No clear change" wording. Keep the text neutral, with no coloured pills, to match the redesign.

### 6. Export and import

**In the recording.** Settings has "Sync, Backup & Export" (1:23).

**Baseline today.** Logs now live in Postgres and sync across devices, so this is no longer about losing data when site data is cleared. The only import is the one-time move of an old browser log, and it works only into an empty account.

**For Baseline.** Two reasons remain:
- **Export:** people who keep their health data on a server expect a "Download my log" CSV (date, weight, 14-day average).
- **Import:** a CSV import lets people bring history from another app. It needs its own op, because the existing `import` op refuses accounts that already have entries. Decide whether imported rows skip or overwrite dates that already exist, and show a preview before saving.

**Related, not in the recording:** Baseline itself has no way to remove a whole log. Clerk's account menu can delete the account if that is turned on in the Clerk dashboard. But nothing in `api/` or `server/` listens for that, so the rows in `profiles` and `weigh_ins` would stay behind. A "Delete my data" action, or a Clerk `user.deleted` webhook, belongs alongside export.

### 7. Recent high and low

**In the recording.** The first card shows the last 10 days. Daily weigh-ins are a dashed line and the trend is smooth, with a red line at the high and a green line at the low. Next to the chart are tiles for HIGH 63.8 ("6 days ago"), LATEST 61.7, TREND 62.3 and LOW 61.4 ("4 days ago") (0:00).

**For Baseline.** Add "Lowest in 14 days" and "Highest in 14 days" to the facts list, each with how many days ago. Seeing the spread helps people understand why one weigh-in doesn't matter. The relative "4 days ago" wording reads better than a full date.

### 8. Reports

**In the recording.** A Reports tab with a Weekly / Monthly / Yearly picker (1:09). Each month card shows:
- the low weigh-in and its date
- change vs. last month
- trend change per week and over the month ("↓ 0.8 kg in 19 days")
- a mini chart with the goal line

Each card has a share button and a gear. Weekly and yearly are behind a paywall.

**For Baseline.** A monthly summary view would sit well alongside the Log page. For each month, show:
- the start and end averages
- the change
- the weekly trend at month end
- the low

All of it can be computed from the existing log, with no new data stored.

### 9. Notes and a richer log

**In the recording.** Entries have a Notes column. The log is grouped by month with section headers. The very first entry is marked "You started!" (1:19). Two header buttons appear to sort/filter and to choose columns.

**For Baseline.** A short optional note per weigh-in (for example "after travel" or "new medication") explains spikes on the chart. It could also appear in the chart tooltip. It needs a `note text` column on `weigh_ins`, plus changes to the save and update ops. Grouping the log by month makes long histories easier to scan than page numbers, and it is client-only.

### 10. Units

**In the recording.** "Weight Units" in Settings.

**For Baseline.**
- Baseline is kg-only.
- Keep storing kg (`weight_kg numeric(5, 1)`) and convert for display and input: lb, and st+lb for UK users.
- Save the preference on `profiles` so it follows the account across devices.
- Height would need ft/in too.
- **Watch rounding:** a weight entered in lb and stored in kg to one decimal can come back 0.1–0.2 lb off. Either store more precision or keep the user's entered value.

### 12. Weigh-in reminder

**In the recording.** "Weigh-In Reminder" in Settings.

**For Baseline.** Accounts open two routes:
- **Email reminder:** a scheduled Vercel function emails people who haven't logged by a chosen time. It's simpler and works on every device.
- **Web push:** needs a PWA (manifest plus service worker). It would also let people install Baseline on their home screen.

Either way it needs a stored preference and a time zone per user.

### 14. Trend forecast on the chart

**In the recording.** "Unlock chart forecasting" (0:57) shows a projection past today (paywalled).

**For Baseline.** Draw a dashed continuation of the line at the `calculateRate` slope, up to the goal or 30 days ahead. Draw it only when the rate is `clear`. It uses the same numbers as feature 3.

### 15. Weight change over 7, 30 and 90 days and all time

**In the recording.** A "Weight Trends" card. In the recording it only shows a teaser, "YOUR TRENDS IMPROVED · Tap to see the improvements!" (0:17). Filled in (Shot A), it is a row of four green tiles: 0.5 lost in 7 days, 1.8 lost in 30 days, 4.7 lost in 90 days and 4.7 lost all time.

**For Baseline.** This is one of the cheapest features on the list, and it gives longer-range context than the 21-day weekly trend.
- **Calculation:** take each figure from the 14-day average. Use today's average minus the average 7, 30 or 90 days ago, and minus the first average for all time.
- **Display:** show them as a plain row of figures ("−0.5 kg · 7 days") rather than coloured tiles.
- **Short logs:** when the log is shorter than a window, hide that figure rather than repeat the all-time number, as the screenshot does with 4.7 twice.

## Low priority or later

- **Manual theme toggle** (#11). Dark mode already follows the system. A Light / Dark / System choice is only worth adding if people ask.
- **Show or hide sections** (#13, 0:02). The recording has a "Card Configuration" sheet with eye toggles and drag handles, and BMI is hidden there. Baseline has no cards to rearrange, but a "Hide BMI" option is worth keeping in mind; some people don't want to see it.
- **Lines from each weigh-in to the trend** (#16, 0:47). Each weigh-in is drawn as a vertical line from the trend to the reading. It shows how far each day strays from the average, but would crowd the redesigned chart's quiet gray dots. Try it as an option at most.
- **Share as image** (#17, 0:47, 1:01). Share, fullscreen and settings buttons on the chart and on each report.
- **"How to Calculate"** (1:23). The other app lets users choose the trend method. Baseline explains its method on the page and in the README. A choice of window length is possible but adds complexity.

## Already covered

- **Dark mode** (#11). `styles.css` follows `prefers-color-scheme`.
- **Multiple user profiles** (#18). Each person signs in to their own account, which does the job of the other app's profiles on one device.
- **A current rate** (part of #3). `calculateRate`, with a noise check the other app lacks.

## UX patterns worth reusing

- **Empty states that say how to fix them.** Each card says why it's empty and what to tap. One example: "Your progress will not be shown because you have not set a goal weight. To fix this, tap the gear…" Baseline does this already, for example with "No clear change", and should do the same for goals and forecasts.
- **Unit shown inside the input.** The input reads "Weight 60 kg" and "Rate 0.5 kg/wk" as the user types (0:10, 0:40). Baseline's inputs already show a unit, and the goal and rate fields should too.
- **Light, human wording for dates.** The forecast says "today?!" (Shot A), and readings say "4 days ago" instead of a full date.
- **Settings next to what they change.** Each card has its own gear. Baseline already does this with the Edit button next to Height, and should do the same for the goal rather than add a separate settings page.
- **A "+" button within thumb reach on mobile.** Baseline's "Log a weigh-in" button sits in the page heading. On a phone, a fixed button near the bottom would be easier to reach.

## Not worth copying

- **Paywall prompts placed over core views.** Reports, the chart forecast and the Settings header all push upgrades.
- **An objective setting that can contradict the goal numbers** (see feature 1).
- **Coloured tiles, gauges and red/green pills.** Take the information, not the styling, which the redesign moved away from.
- **Sounds, haptics and passcode protection.** Sign-in already protects the log, and sounds and haptics matter little in a browser.

## Suggested order

1. **Goals**, stored on `profiles` with a `set-goal` op, together with milestone progress and the forecast (built on `calculateRate`).
2. **Client-only additions:** the goal line on the chart, change over 7, 30 and 90 days, recent high and low, and the weekly trend per log row.
3. **Data handling:** CSV export, "Delete my data", then CSV import.
4. **Notes and units:** notes on weigh-ins, then units. Both are schema changes.
5. **Later:** monthly reports, then reminders.
