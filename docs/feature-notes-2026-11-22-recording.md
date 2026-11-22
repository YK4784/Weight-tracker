# Feature notes from the 22 Nov 2026 screen recording

**Source:** `ScreenRecording_11-22-2026 18-56-22_1.MP4`. It is an 88-second iPhone recording with no audio. It walks through Happy Scale, an iOS weight tracker, covering Summary, Weight Goals, Reports, Logbook and Settings. Timestamps in brackets are minutes:seconds into the recording.

Two later screenshots from 19:04 the same day show the same cards filled in once a valid goal is set. They are cited as **Shot A** (Weight Trends and Predictions) and **Shot B** (Weight Loss Progress).

The aim here is to borrow ideas, not the app itself. Baseline keeps its own look, name and wording.

## What Baseline already has

- A 14-day weighted moving average, which does the same job as the other app's "trend"
- Latest weight and BMI from height
- A trend chart with 14D, 30D, 90D and All ranges, daily dots, a tooltip and arrow-key inspection
- A log table showing weight, average and change from the previous weigh-in, with edit, delete and pagination
- Sample data before the first entry, stored locally in the browser

Everything below is missing from Baseline today.

## Summary

| # | Feature | Seen at | Priority | Effort |
|---|---------|---------|----------|--------|
| 1 | Goal weight, starting point and objective | 0:05–0:40 | High | M |
| 2 | Progress toward the goal: milestone gauge, % complete, amount to go | 0:04, 0:31, Shot B | High | M |
| 3 | Rate and goal-date prediction, with a forecast table | 0:19, 0:41, Shot A | High | S–M |
| 4 | Goal line on the chart | 0:47 | High | S |
| 5 | Weekly rate column in the log | 1:16 | High | S |
| 6 | Export and import (backup) | 1:23 (Settings) | High | S |
| 7 | Recent stats: high, low, latest, trend | 0:00 | Medium | S |
| 8 | Monthly and weekly reports | 1:01–1:11 | Medium | M |
| 9 | Notes on weigh-ins, log grouped by month | 1:16–1:20 | Medium | S–M |
| 10 | Weight units (lb, st) | 1:23 | Medium | M |
| 11 | Dark mode | whole recording | Medium | M |
| 12 | Weigh-in reminder | 1:23 | Medium | M |
| 13 | Show, hide and reorder dashboard cards | 0:02 | Medium | M |
| 14 | Trend forecast on the chart | 0:57 | Medium | S |
| 15 | Weight change over 7, 30 and 90 days and all time | 0:17, Shot A | Medium | S |
| 16 | Lines from each weigh-in to the trend | 0:47–0:56 | Low | S |
| 17 | Share chart or report as an image | 0:47, 1:01 | Low | M |
| 18 | Multiple user profiles | 1:23 | Low | M |

Effort: S is under a day, M is one to three days, given the current `model.mjs` / `app.mjs` split.

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

**For Baseline.** This is the biggest gap. Without a goal, the average is just a number with nothing to measure it against. A first version only needs a start date, a goal weight and an optional committed rate. The start weight should default to the 14-day average on the start date, not to one weigh-in.

**Lesson from the recording.** The user picked "Lose weight" and then set a goal (60 kg) above their starting weight (56 kg). Three cards then turned into error messages (0:15–0:22). Baseline should work out the direction from start vs. goal (gain, lose or maintain) and not ask for an objective that can contradict the numbers.

**Implementation note.** `normalizeState` in `model.mjs` rebuilds state from `entries` and `height` only, so it would currently strip any `goal` field. Extend it, bump `version`, and add tests in `tests/model.test.mjs`.

### 2. Progress toward the goal

**In the recording.** A "Weight Loss Progress" card, with an optional "overall percentage complete" toggle (0:31) and the goal split into 10 equal segments. There is also an "Animation" setting for a celebration when a segment is reached.

**Filled in (Shot B).** With a valid goal, the card becomes:
- A large arc gauge showing progress through the *current* milestone, labelled "MILESTONE 8"
- That milestone's target weight in big type (61.2)
- The reading used for tracking, with its date and age: "Nov 18, 2026 · 61.4 · 4 days ago". This is the 10-day low, not the trend.
- "67% complete" within this milestone and "0.2 to go" to reach it
- A row of 10 dots, one per milestone, with 7 filled
- A footer reading "7 of 10 milestones completed · 77.0% complete overall". The overall line only shows when the percentage toggle is on.

**For Baseline.** Build the same layout: current milestone target, progress within it, amount to go, a dot track and an overall percentage. Splitting the goal into milestones keeps the gauge moving even when the final goal is far away. Track progress with the 14-day average by default, not the latest weigh-in, because Baseline's point is that single weigh-ins are noisy. The other app's 10-day low moves faster and feels better, but one light day can make it jump. Offer the recent low as an option at most. A small celebration when a milestone is crossed is cheap and motivating.

**Implementation note.** Milestone *n* has target `start − n × (start − goal) / segments`. Progress within a milestone is `(previousTarget − current) / (previousTarget − target)`, clamped to 0–100%. Overall progress is `(start − current) / (start − goal)`. Use the same formulas with the signs flipped for weight gain.

### 3. Rate and goal-date prediction

**In the recording.** A "Predictions" card shows Commitment 0.50, Current Rate 0.12 and Overall Rate (0:41). Once a goal is set, it predicts when the goal will be reached.

**Filled in (Shot A).** The card has three rows: Commitment 0.50, Current Rate 0.12 and Overall Rate 0.72. The Commitment row is highlighted, so a row seems to choose which rate drives the forecast. Underneath it says "At your commitment rate of 0.50 kg per week, here's your predicted forecast", followed by a two-column Weight / Date table. The single row reads "61.2 kg · Next Milestone · November 22 · today?!". The Weight header has an up/down toggle. It probably switches between the next milestone and the final goal, but the screenshot doesn't confirm this.

**For Baseline.**
- Calculate the current rate as the change in the 14-day average over the last 7 or 14 days, in kg per week.
- Calculate the overall rate as the change in the average since the start date, divided by the number of weeks.
- Show the three rates side by side and let the user tap one to base the forecast on it.
- Below that, add a small forecast table: next milestone, later milestones and the goal, each with a predicted date.
- When the predicted date is today or already past, use friendly wording such as "today" or "any day now" instead of a date in the past.
- If the current rate is zero or moving away from the goal, say so plainly and don't show a date.

All of this can be pure functions in `model.mjs`.

### 4. Goal line on the chart

**In the recording.** A dashed "GOAL WEIGHT" line on the main chart and on each monthly report chart. The area between the starting level and the trend is shaded green for progress and red when the trend moves away from the goal.

**For Baseline.** Add a dashed horizontal goal line in `chart.mjs`, and include it when the y-axis scale is worked out so it stays on screen. The shading is optional polish.

### 5. Weekly rate in the log

**In the recording.** Logbook columns are Date (day number plus weekday), Recorded, Moving Average, Weekly Rate and Notes (1:16). Weekly rate is a coloured pill: green down arrow for progress, red up arrow for moving away from the goal.

**For Baseline.** The current "Change from previous" column compares two raw weigh-ins, which is exactly the noise Baseline tells people to ignore. Replace it with "Weekly rate", the change in the 14-day average over 7 days, or show both. Colour by direction relative to the goal once goals exist.

### 6. Export and import

**In the recording.** Settings has "Sync, Backup & Export" (1:23).

**For Baseline.** This matters more for Baseline than for the other app. The README says clearing site data deletes the log. A CSV export (date, weight, average) and a CSV or JSON import protect users and let them bring in history from other apps. It needs no server.

## Medium priority

### 7. Recent stats panel

**In the recording.** The first card shows the last 10 days. Daily weigh-ins are a dashed line and the trend is smooth, with a red line at the high and a green line at the low. Next to the chart are tiles for HIGH 63.8 ("6 days ago"), LATEST 61.7, TREND 62.3 and LOW 61.4 ("4 days ago") (0:00).

**For Baseline.** "Lowest in the last 14 days" and "highest in the last 14 days", each with how many days ago, fit next to the current metric cards. The relative "4 days ago" wording reads better than a full date.

### 8. Reports

**In the recording.** A Reports tab with a Weekly / Monthly / Yearly picker (1:09). Each month card shows:
- the low weigh-in and its date
- change vs. last month
- trend change per week and over the month ("↓ 0.8 kg in 19 days")
- a mini chart with the goal line

Each card has a share button and a gear. Weekly and yearly are behind a paywall.

**For Baseline.** A monthly summary view would sit well alongside the "Weight log" page. All of it can be computed from the existing trend readings.

### 9. Notes and a richer log

**In the recording.** Entries have a Notes column. The log is grouped by month with section headers. The very first entry is marked "You started!" (1:19). Two header buttons appear to sort/filter and to choose columns.

**For Baseline.** A short optional note per weigh-in (for example "after travel" or "new medication") explains spikes on the chart. The note could also appear in the chart tooltip. Grouping the log by month makes long histories easier to scan than page numbers.

### 10. Units

**In the recording.** "Weight Units" in Settings.

**For Baseline.** Baseline is kg-only. Store weights in kg and convert for display and input (lb, and st+lb for UK users). Height would need cm and ft/in too.

### 11. Dark mode

**In the recording.** The whole app is dark, and Settings has "Appearance".

**For Baseline.** `styles.css` has no `prefers-color-scheme` rules. Follow the system setting first, then add a manual toggle if needed.

### 12. Weigh-in reminder

**In the recording.** "Weigh-In Reminder" in Settings.

**For Baseline.** Reliable reminders on the web need a PWA (manifest plus service worker) and the Notifications API. That would also let people install Baseline on their home screen. It's worth doing, but it is a bigger step than the items above.

### 13. Customisable dashboard

**In the recording.** A "Card Configuration" sheet lists Visible cards (Recent Stats, Weight Loss Progress, Weight Trends, Predictions, Weight Chart) and Hidden cards (Body Mass Index). Each row has an eye toggle and a drag handle, and the Summary footer reads "1 card hidden" (0:02).

**For Baseline.** Some people don't want to see BMI. Letting users hide it, and later reorder sections, is a small change once there are more than three metric cards.

### 14. Trend forecast on the chart

**In the recording.** "Unlock chart forecasting" (0:57) shows a projection past today (paywalled).

**For Baseline.** Draw a dashed line from the latest average, extended at the current rate, up to the goal or 30 days ahead. It uses the same numbers as feature 3.

### 15. Weight change over 7, 30 and 90 days and all time

**In the recording.** A "Weight Trends" card. In the recording it only shows a teaser, "YOUR TRENDS IMPROVED · Tap to see the improvements!" (0:17). Filled in (Shot A), it is a row of four green tiles: 0.5 lost in 7 days, 1.8 lost in 30 days, 4.7 lost in 90 days and 4.7 lost all time.

**For Baseline.** This is one of the cheapest features on the list, and it answers "is it working?" at a glance. Calculate each figure from the 14-day average: today's average minus the average 7, 30 or 90 days ago, and minus the first average for all time. Label each tile "lost" or "gained" and colour it by direction relative to the goal. If there is no goal, use neutral colours. When the log is shorter than a window, hide that tile or mark it "not enough data" rather than repeating the all-time number.

## Low priority or later

- **Lines from each weigh-in to the trend** (0:47). Each weigh-in is drawn as a vertical line from the trend to the reading. This shows how far each day strays from the average and backs up Baseline's message. It would be an alternative chart style.
- **Share as image** (0:47, 1:01). Share, fullscreen and settings buttons on the chart and on each report.
- **User profiles** (1:23). Separate logs for several people on one device.
- **"How to Calculate"** (1:23). The other app lets users choose the trend method. Baseline already explains its method in the README and chart note. A setting for the window length (7, 10 or 14 days) is possible but adds complexity.

## UX patterns worth reusing

- **Empty states that say how to fix them.** Each card says why it's empty and what to tap. One example: "Your progress will not be shown because you have not set a goal weight. To fix this, tap the gear…" Baseline does this partly already and should keep doing it for goals and predictions.
- **Unit shown inside the input.** The input reads "Weight 60 kg" and "Rate 0.5 kg/wk" as the user types (0:10, 0:40).
- **Light, human wording for dates.** The forecast says "today?!" (Shot A), and readings say "4 days ago" instead of a full date.
- **A gear on each card.** Settings sit next to the thing they change, so there's no single big settings page.
- **A floating "+" button** for logging a weight from any tab. Baseline's "Log weight" button does this on desktop. On mobile, a fixed button near the bottom would be easier to reach.

## Not worth copying

- Paywall prompts placed over core views. Reports, the chart forecast and the Settings header all push upgrades.
- An objective setting that can contradict the goal numbers (see feature 1).
- Sounds and haptics, and passcode protection. They matter less in a browser, where the device lock already protects local data.

## Suggested order

1. Goals (start date, goal weight, optional rate), with the milestone progress card and the forecast on the overview
2. Goal line on the chart, a weekly rate column in the log, and the 7/30/90-day/all-time change tiles
3. CSV export and import
4. Recent high/low, notes, then units and dark mode
5. Reports, reminders as a PWA, then dashboard customisation
