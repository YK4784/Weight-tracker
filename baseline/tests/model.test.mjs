import assert from "node:assert/strict";
import test from "node:test";
import { FORECAST_MAX_DAYS, averageChanges, bmi, calculateRate, calculateTrend, dateOf, dayOf, forecastGoal, goalProgress, normalizeGoal, normalizeState, overallRate, recentRange, saveWeight, shiftDate, validDate } from "../dist/model.mjs";

const first = dayOf("2026-03-01");
const entry = (index, weight) => ({ date: dateOf(first + index), weight });

test("the first 14 days use only the weights posted so far", () => {
  const readings = Array.from({ length: 14 }, (_, i) => entry(i, 70 + i));
  const result = calculateTrend(readings, readings.at(-1).date);
  result.readings.forEach((point, index) => {
    assert.equal(point.average, 70 + index / 2);
    assert.equal(point.count, index + 1);
  });
});

test("day 15 excludes day one, including across a daylight-saving boundary", () => {
  const readings = Array.from({ length: 15 }, (_, i) => entry(i, 70 + i));
  const { current } = calculateTrend(readings, readings.at(-1).date);
  assert.equal(current.count, 14);
  assert.equal(current.average, 77.5);
});

test("skipped days contribute zero entries and expired windows create a line break", () => {
  const dates = [entry(0, 82), entry(4, 78), entry(20, 75)];
  const { days, current } = calculateTrend(dates, dates.at(-1).date);
  assert.deepEqual(days.slice(0, 4).map(d => d.average), [82, 82, 82, 82]);
  assert.equal(days.find(d => d.day === first + 13).average, 80);
  assert.equal(days.find(d => d.day === first + 14).average, 78);
  assert.equal(days.find(d => d.day === first + 18), undefined);
  assert.equal(current.average, 75);
  assert.equal(current.count, 1);
  assert.equal(calculateTrend(dates, dateOf(first + 34)).current, null);
});

test("backdating and correcting a weight recalculate later averages without duplicate dates", () => {
  let state = normalizeState(null);
  state = saveWeight(state, dateOf(first + 3), 75.5);
  state = saveWeight(state, dateOf(first), 76.3);
  state = saveWeight(state, dateOf(first + 3), 75.1);
  const trend = calculateTrend(state.entries, dateOf(first + 4));
  assert.equal(state.entries.length, 2);
  assert.equal(trend.current.average, 75.7);
  assert.equal(trend.current.count, 2);
  assert.equal(trend.readings.at(-1).weight, 75.1);
  assert.equal(trend.days.at(-1).weight, null);
});

test("the daily average matches a direct calendar-window calculation over a sparse log", () => {
  const readings = Array.from({ length: 96 }, (_, i) => entry(i, 70 + (i * 7 % 31) / 10)).filter((_, i) => i % 4 !== 0 && (i < 30 || i > 55));
  const { days } = calculateTrend(readings, dateOf(first + 104));
  const byDay = new Map(days.map(p => [p.day, p]));
  for (let day = first; day <= first + 104; day++) {
    const inWindow = readings.filter(e => dayOf(e.date) >= day - 13 && dayOf(e.date) <= day);
    if (!inWindow.length) assert.equal(byDay.get(day), undefined);
    else {
      const expected = inWindow.reduce((sum, item) => sum + Math.round(item.weight * 10), 0) / (10 * inWindow.length);
      assert.equal(byDay.get(day).average, expected);
      assert.equal(byDay.get(day).count, inWindow.length);
    }
  }
});

test("BMI uses centimeters and stays empty until both measurements exist", () => {
  assert.equal(bmi(81, 180), 25);
  assert.equal(bmi(81, null), null);
  assert.equal(bmi(null, 180), null);
  assert.equal(bmi(70, 0), null);
});

test("date arrows step one calendar day and never pass today", () => {
  const today = "2026-11-21";
  assert.equal(shiftDate("2026-11-21", -1, today), "2026-11-20");
  assert.equal(shiftDate("2026-11-20", 1, today), "2026-11-21");
  assert.equal(shiftDate("2026-11-21", 1, today), "2026-11-21");
  assert.equal(shiftDate("2026-11-30", -1, today), "2026-11-21");
  assert.equal(shiftDate("2026-03-01", -1, today), "2026-02-28");
  assert.equal(shiftDate("2024-03-01", -1, today), "2024-02-29");
  assert.equal(shiftDate("2026-01-01", -1, today), "2025-12-31");
  assert.equal(shiftDate("2026-03-08", 1, today), "2026-03-09");
  assert.equal(shiftDate("", -1, today), "2026-11-20");
  assert.equal(shiftDate("", 1, today), "2026-11-21");
});

test("empty and future-only logs have no current average", () => {
  const empty = { days: [], readings: [], current: null };
  assert.deepEqual(calculateTrend([], dateOf(first)), empty);
  assert.deepEqual(calculateTrend([entry(1, 70)], dateOf(first)), empty);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2028-02-29"), true);
});

const daily = (days, weightOf) => Array.from({ length: days }, (_, i) => entry(i, weightOf(i)));

test("the weekly rate is the slope of the last 21 days of weigh-ins", () => {
  const log = daily(21, i => 80 - i / 10);
  assert.deepEqual(calculateRate(log, log.at(-1).date), { perWeek: -0.7, clear: true, count: 21 });
  const gaining = daily(21, i => 60 + i / 20);
  assert.deepEqual(calculateRate(gaining, gaining.at(-1).date), { perWeek: 0.4, clear: true, count: 21 });
});

test("the weekly rate ignores weigh-ins older than 21 days or after today", () => {
  const log = [entry(0, 95), ...daily(30, i => 80 - i / 10).slice(9), entry(31, 50)];
  const rate = calculateRate(log, dateOf(first + 29));
  assert.equal(rate.count, 21);
  assert.equal(rate.perWeek, -0.7);
});

test("the weekly rate uses real dates when weigh-ins are spread out", () => {
  const log = daily(21, i => 80 - i / 7).filter((_, i) => i % 3 === 0 || i === 20);
  assert.equal(log.length, 8);
  assert.deepEqual(calculateRate(log, log.at(-1).date), { perWeek: -1, clear: true, count: 8 });
});

test("the weekly rate waits for 8 weigh-ins over at least 2 weeks", () => {
  const sparse = daily(21, i => 80 - i / 10).filter((_, i) => i % 3 === 0);
  assert.equal(sparse.length, 7);
  assert.equal(calculateRate(sparse, dateOf(first + 20)), null);
  const short = daily(13, i => 80 - i / 10);
  assert.equal(calculateRate(short, short.at(-1).date), null);
  const twoWeeks = daily(14, i => 80 - i / 10);
  assert.equal(calculateRate(twoWeeks, twoWeeks.at(-1).date).perWeek, -0.7);
  assert.equal(calculateRate(twoWeeks, dateOf(first + 21)), null);
  assert.equal(calculateRate([], dateOf(first)), null);
});

test("scale noise around a flat weight is not a clear change", () => {
  const noisy = daily(21, i => 75 + (i % 2 ? .6 : -.6));
  assert.equal(calculateRate(noisy, noisy.at(-1).date).clear, false);
  const flat = daily(21, () => 75);
  assert.deepEqual(calculateRate(flat, flat.at(-1).date), { perWeek: 0, clear: false, count: 21 });
  const tiny = daily(21, i => 75 - i / 500);
  assert.deepEqual(calculateRate(tiny, tiny.at(-1).date), { perWeek: 0, clear: false, count: 21 });
});

const goalOf = (startWeight, weight, milestones = 10, rate = null) => ({ weight, startDate: "2026-11-01", startWeight, rate, milestones });

test("a goal survives normalizing, rounded like weights, and starts the log", () => {
  const state = normalizeState({ goal: { weight: 60.04, startDate: "2026-09-13", startWeight: 66.06, rate: 0.504, milestones: 8 } });
  assert.deepEqual(state.goal, { weight: 60, startDate: "2026-09-13", startWeight: 66.1, rate: 0.5, milestones: 8 });
  assert.equal(state.started, true);
  assert.equal(normalizeState({}).goal, null);
  assert.equal(normalizeState({ started: false }).started, false);
});

test("an invalid goal is dropped, while a bad rate or milestone count falls back", () => {
  for (const goal of [null, {}, { ...goalOf(66, 60), weight: 0 }, { ...goalOf(66, 60), startWeight: 2001 }, { ...goalOf(66, 60), startDate: "2026-02-30" }]) {
    assert.equal(normalizeGoal(goal), null, JSON.stringify(goal));
  }
  for (const rate of [0, -0.5, 5.01, "0.5", NaN]) assert.equal(normalizeGoal(goalOf(66, 60, 10, rate)).rate, null, String(rate));
  for (const milestones of [0, 21, 2.5, "4", undefined]) assert.equal(normalizeGoal(goalOf(66, 60, milestones)).milestones, 10, String(milestones));
});

test("milestones split the distance evenly and end at the goal", () => {
  assert.deepEqual(goalProgress(goalOf(66, 60, 4), 66).milestones.map(m => m.weight), [64.5, 63, 61.5, 60]);
  assert.deepEqual(goalProgress(goalOf(56, 60, 3), 56).milestones.map(m => m.weight), [57.3, 58.7, 60]);
  assert.deepEqual(goalProgress(goalOf(66, 60, 7), 66).milestones.map(m => m.weight), [65.1, 64.3, 63.4, 62.6, 61.7, 60.9, 60]);
  // Never smaller than 0.1 kg, so 0.3 kg to go makes 3 milestones, not 10.
  assert.deepEqual(goalProgress(goalOf(60.3, 60), 60.3).milestones.map(m => m.weight), [60.2, 60.1, 60]);
});

test("progress uses the average as shown, to 0.1 kg", () => {
  const goal = goalOf(66, 60, 10);
  const progress = goalProgress(goal, 61.44);
  assert.equal(progress.direction, "lose");
  assert.equal(progress.current, 61.4);
  assert.equal(progress.completed, 7);
  assert.deepEqual(progress.next, { index: 8, weight: 61.2, toGo: 0.2 });
  assert.equal(progress.toGo, 1.4);
  assert.ok(Math.abs(progress.overall - 4.6 / 6) < 1e-12);
  assert.equal(progress.reached, false);
  assert.equal(progress.behindStart, 0);
  assert.equal(goalProgress(goal, 61.15).completed, 8, "61.15 shows as 61.2, so milestone 8 counts");
});

test("weight gain counts progress upward", () => {
  const progress = goalProgress(goalOf(56, 60, 4), 58.2);
  assert.equal(progress.direction, "gain");
  assert.equal(progress.completed, 2);
  assert.deepEqual(progress.next, { index: 3, weight: 59, toGo: 0.8 });
  assert.equal(progress.toGo, 1.8);
  assert.ok(Math.abs(progress.overall - .55) < 1e-12);
});

test("reaching the goal, passing it and going the wrong way", () => {
  const reached = goalProgress(goalOf(66, 60, 10), 59.7);
  assert.equal(reached.reached, true);
  assert.equal(reached.completed, 10);
  assert.equal(reached.next, null);
  assert.equal(reached.toGo, 0);
  assert.equal(reached.overall, 1);
  assert.equal(reached.difference, -0.3);
  const exactly = goalProgress(goalOf(66, 60, 10), 60);
  assert.equal(exactly.reached, true);
  assert.equal(exactly.difference, 0);
  const behind = goalProgress(goalOf(66, 60, 10), 66.4);
  assert.equal(behind.behindStart, 0.4);
  assert.equal(behind.overall, 0);
  assert.equal(behind.completed, 0);
  assert.equal(behind.toGo, 6.4);
  assert.equal(behind.next.index, 1);
});

test("a goal equal to the start weight is about staying there", () => {
  const progress = goalProgress(goalOf(60, 60), 60.4);
  assert.equal(progress.direction, "maintain");
  assert.deepEqual(progress.milestones, []);
  assert.equal(progress.difference, 0.4);
  assert.equal(progress.next, null);
  assert.equal(progress.reached, false);
});

test("progress waits for an average, and needs a goal", () => {
  const progress = goalProgress(goalOf(66, 60), undefined);
  assert.equal(progress.current, null);
  assert.equal(progress.next, null);
  assert.equal(progress.milestones.length, 10);
  assert.equal(goalProgress(null, 61), null);
});

test("the overall rate is the change since the start, two weeks in", () => {
  const goal = goalOf(66, 60);
  assert.equal(overallRate(goal, 65, "2026-11-14"), null);
  assert.equal(overallRate(goal, 64.6, "2026-11-15"), -0.7);
  assert.equal(overallRate(goal, 66.02, "2026-11-29"), 0);
  assert.equal(overallRate(goal, undefined, "2026-11-29"), null);
  assert.equal(overallRate(null, 64, "2026-11-29"), null);
});

test("the forecast dates each milestone still ahead at a steady rate", () => {
  const progress = goalProgress(goalOf(66, 60, 4), 63.5);
  assert.deepEqual(forecastGoal(progress, -0.5, "2026-11-22"), [
    { index: 2, weight: 63, days: 7, date: "2026-11-29" },
    { index: 3, weight: 61.5, days: 28, date: "2026-12-20" },
    { index: 4, weight: 60, days: 49, date: "2027-01-10" }
  ]);
  const gaining = goalProgress(goalOf(56, 60, 2), 56.5);
  assert.deepEqual(forecastGoal(gaining, 0.25, "2026-11-22").map(row => row.days), [42, 98]);
});

test("there is no forecast when the rate is flat or heads away from the goal", () => {
  const progress = goalProgress(goalOf(66, 60), 63);
  for (const rate of [0.3, 0, null, NaN]) assert.equal(forecastGoal(progress, rate, "2026-11-22"), null, String(rate));
  assert.equal(forecastGoal(goalProgress(goalOf(66, 60), 59), -0.5, "2026-11-22"), null, "already reached");
  assert.equal(forecastGoal(goalProgress(goalOf(60, 60), 60), -0.5, "2026-11-22"), null, "maintaining");
  assert.equal(forecastGoal(goalProgress(goalOf(66, 60), undefined), -0.5, "2026-11-22"), null, "no average");
});

test("very near and very far forecasts", () => {
  const near = forecastGoal(goalProgress(goalOf(66, 60, 1), 60.1), -2, "2026-11-22");
  assert.deepEqual(near, [{ index: 1, weight: 60, days: 0, date: "2026-11-22" }]);
  const far = forecastGoal(goalProgress(goalOf(120, 60, 2), 100), -0.1, "2026-11-22");
  assert.deepEqual(far[0], { index: 1, weight: 90, days: 700, date: "2028-10-22" });
  assert.ok(far[1].days > FORECAST_MAX_DAYS);
  assert.equal(far[1].date, null);
});

const changesOf = (log, through = log.at(-1).date) => averageChanges(calculateTrend(log, through));

test("the average's change over 7, 30 and 90 days and since the first weigh-in", () => {
  // Down 0.2 kg a day, so the average falls 1.4 kg a week once the window is full.
  assert.deepEqual(changesOf(daily(120, i => 90 - i / 5)), [
    { days: 7, change: -1.4 },
    { days: 30, change: -6 },
    { days: 90, change: -18 },
    { days: null, change: -22.5 }
  ]);
  assert.deepEqual(changesOf(daily(40, i => 60 + i / 10)).map(item => item.days), [7, 30, null]);
});

test("a change waits until the log reaches back that far, and all time never repeats one", () => {
  const days = log => changesOf(log).map(item => item.days);
  assert.deepEqual(days(daily(7, () => 70)), []);
  assert.deepEqual(days(daily(8, () => 70)), [7]);
  assert.deepEqual(days(daily(10, () => 70)), [7, null]);
  assert.deepEqual(days(daily(31, () => 70)), [7, 30]);
  assert.deepEqual(days(daily(91, () => 70)), [7, 30, 90]);
  assert.deepEqual(changesOf(daily(91, () => 70)), [{ days: 7, change: 0 }, { days: 30, change: 0 }, { days: 90, change: 0 }]);
});

test("a gap of more than 14 days hides a change that would start inside it", () => {
  // Weigh-ins on days 0–19 and 45–70: days 33–44 have no average, so 30 days before day 70 has none.
  const log = daily(71, i => 80 - i / 10).filter((_, i) => i < 20 || i >= 45);
  assert.deepEqual(changesOf(log).map(item => item.days), [7, null]);
  // When no window is left, all time still shows once the log is over a week old.
  const short = [entry(0, 80), entry(1, 80), entry(2, 80), ...daily(25, () => 79).slice(20)];
  assert.deepEqual(changesOf(short), [{ days: null, change: -1 }]);
});

test("changes use the averages as shown, and need an average today", () => {
  // 70.04 and 69.96 both show as 70.0, so the change shows as none.
  const trend = { days: [{ day: 0, average: 69.96 }, { day: 7, average: 70.04 }], current: { day: 7, average: 70.04 } };
  assert.deepEqual(averageChanges(trend), [{ days: 7, change: 0 }]);
  const log = daily(30, () => 70);
  assert.deepEqual(changesOf(log, dateOf(first + 43)), []);
  assert.deepEqual(changesOf([], dateOf(first)), []);
});

test("the recent high and low come from the same 14 days as the average", () => {
  // Day 19 is today, so the window runs from day 6. Days 0, 4 and 20 fall outside it.
  const weights = [80, 75, 75, 75, 79, 75, 70, 74, 76, 75, 75, 75, 75, 77, 75, 73, 75, 75, 75, 74, 90];
  assert.deepEqual(recentRange(weights.map((weight, i) => entry(i, weight)), dateOf(first + 19)), {
    high: { date: dateOf(first + 13), weight: 77, daysAgo: 6 },
    low: { date: dateOf(first + 6), weight: 70, daysAgo: 13 }
  });
});

test("a tie goes to the most recent weigh-in, and the range needs two weigh-ins", () => {
  assert.deepEqual(recentRange([entry(0, 72), entry(3, 74), entry(5, 72), entry(8, 74)], dateOf(first + 8)), {
    high: { date: dateOf(first + 8), weight: 74, daysAgo: 0 },
    low: { date: dateOf(first + 5), weight: 72, daysAgo: 3 }
  });
  const flat = recentRange([entry(0, 72), entry(1, 72)], dateOf(first + 1));
  assert.deepEqual([flat.high.daysAgo, flat.low.daysAgo], [0, 0]);
  assert.equal(recentRange([entry(0, 72)], dateOf(first)), null);
  assert.equal(recentRange([entry(0, 72), entry(1, 73)], dateOf(first + 14)), null);
  assert.equal(recentRange([], dateOf(first)), null);
});

test("the weekly trend for an earlier row uses only the weigh-ins up to that date", () => {
  const log = [...daily(21, i => 80 - i / 10), ...daily(31, i => 70 + i).slice(21)];
  assert.deepEqual(calculateRate(log, dateOf(first + 20)), { perWeek: -0.7, clear: true, count: 21 });
  assert.equal(calculateRate(log, dateOf(first + 12)), null);
});
