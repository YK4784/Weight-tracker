import assert from "node:assert/strict";
import test from "node:test";
import { CM_PER_IN, FORECAST_MAX_DAYS, KG_PER_LB, NOTE_MAX_LENGTH, averageChanges, bodyFat, bodyFatChange, bodyFatHistory, changeTarget, formatWaist, roundWaist, saveWaist, spokenWaist, validWaist, waistParts, formatAmount, formatWeight, fromTenths, heightParts, normalizeUnits, toTenths, weightParts, bmi, calculateRate, calculateTrend, cleanNote, dateOf, dayOf, fastGoalRate, fastLossCaution, forecastGoal, goalProgress, goalRateAllowed, goalRateLimit, groupByMonth, maxGoalRate, monthlyReports, normalizeGoal, normalizeReminder, validTimeZone, normalizeState, noteLength, overallRate, recentRange, saveWeight, shiftDate, validDate } from "../dist/model.mjs";
import { PREFERENCE_KEYS, QUEUEABLE_OPS, applyOp, applyOps, normalizePreferences, preferencesChange, validPreference } from "../dist/model.mjs";
import { CONSENT_VERSION, hasConsent, normalizeConsent, roundWeight } from "../dist/model.mjs";
import { FORECAST_CHART_MAX_DAYS, NOISE_CORRELATION, RATE_INTERVAL_ERRORS, RATE_STEADY_BAND, weeklyTrendWords, forecastReach, forecastTrend, formatRange, spokenRange, tQuantile } from "../dist/model.mjs";
import { asOfDate, rateAsOf } from "../dist/model.mjs";

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

test("a day without a weigh-in keeps the last weigh-in's average, and expired windows create a line break", () => {
  const dates = [entry(0, 82), entry(4, 78), entry(20, 75)];
  const { days, current } = calculateTrend(dates, dates.at(-1).date);
  assert.deepEqual(days.slice(0, 4).map(d => d.average), [82, 82, 82, 82]);
  assert.equal(days.find(d => d.day === first + 13).average, 80);
  // Day 0 has left day 14's window, but day 14 has no weigh-in, so it keeps day 4's average.
  assert.deepEqual(days.find(d => d.day === first + 14), { day: first + 14, date: dateOf(first + 14), weight: null, note: null, average: 80, count: 2, asOf: dateOf(first + 4) });
  assert.equal(days.find(d => d.day === first + 17).average, 80, "13 days after the weigh-in");
  assert.equal(days.find(d => d.day === first + 18), undefined, "14 days after it, the window no longer reaches it");
  assert.equal(current.average, 75);
  assert.equal(current.count, 1);
  assert.equal(current.asOf, current.date);
  assert.equal(calculateTrend(dates, dateOf(first + 34)).current, null);
});

test("after the weigh-ins stop, the average holds at the last one's instead of drifting", () => {
  // Down 0.1 kg a day for 30 days, then nothing. The mean of the weigh-ins left
  // in each later day's window would fall toward the last few readings with no
  // new data: 0.65 kg lower by day 42, when only day 29's reading is left.
  const log = daily(30, i => 90 - i / 10);
  const windowMean = day => {
    const inWindow = log.filter(e => dayOf(e.date) > day - 14 && dayOf(e.date) <= day);
    return inWindow.reduce((sum, e) => sum + e.weight, 0) / inWindow.length;
  };
  const last = calculateTrend(log, dateOf(first + 29)).current;
  assert.ok(Math.abs(last.average - 87.75) < 1e-9);
  assert.ok(Math.abs(windowMean(first + 42) - (last.average - 0.65)) < 1e-9, "the window's own mean drifts");
  for (let day = first + 30; day <= first + 42; day++) {
    const { current } = calculateTrend(log, dateOf(day));
    assert.equal(current.average, last.average, dateOf(day));
    assert.equal(current.count, last.count);
    assert.equal(current.asOf, last.date);
    assert.equal(current.weight, null);
  }
  assert.equal(calculateTrend(log, dateOf(first + 43)).current, null);
  // The same with noisy weigh-ins on random days.
  const random = seeded(3);
  for (let trial = 0; trial < 20; trial++) {
    const noisy = noisyLog(random, { days: 40, weighs: () => random() < .6 });
    const stop = noisy.at(-1);
    const held = calculateTrend(noisy, stop.date).current;
    for (let after = 1; after < 14; after++) {
      assert.deepEqual(calculateTrend(noisy, dateOf(dayOf(stop.date) + after)).current, { ...held, day: held.day + after, date: dateOf(held.day + after), weight: null, note: null });
    }
  }
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

test("the daily average matches a direct calendar-window calculation on the last weigh-in, over a sparse log", () => {
  const readings = Array.from({ length: 96 }, (_, i) => entry(i, 70 + (i * 7 % 31) / 10)).filter((_, i) => i % 4 !== 0 && (i < 30 || i > 55));
  const { days } = calculateTrend(readings, dateOf(first + 104));
  const byDay = new Map(days.map(p => [p.day, p]));
  for (let day = first; day <= first + 104; day++) {
    const inWindow = readings.filter(e => dayOf(e.date) >= day - 13 && dayOf(e.date) <= day);
    if (!inWindow.length) assert.equal(byDay.get(day), undefined);
    else {
      // The window of the last weigh-in up to the day, which may be the day itself.
      const asOf = dayOf(inWindow.at(-1).date);
      const used = readings.filter(e => dayOf(e.date) >= asOf - 13 && dayOf(e.date) <= asOf);
      const expected = used.reduce((sum, item) => sum + Math.round(item.weight * 10), 0) / (10 * used.length);
      assert.equal(byDay.get(day).average, expected);
      assert.equal(byDay.get(day).count, used.length);
      assert.equal(byDay.get(day).asOf, dateOf(asOf));
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

// A weekly trend that's moving, with its likely range, from calculateRate.
const moving = (perWeek, low, high, count = 21) => ({ perWeek, low, high, state: "moving", clear: true, count });

test("the weekly rate is the slope of the last 21 days of weigh-ins", () => {
  const log = daily(21, i => 80 - i / 10);
  // On an exact line, the range comes from the least noise assumed.
  assert.deepEqual(calculateRate(log, log.at(-1).date), moving(-0.7, -0.8, -0.6));
  // 0.35 kg a week shows as 0.4, and its range as 0.3 to 0.4.
  const gaining = daily(21, i => 60 + i / 20);
  assert.deepEqual(calculateRate(gaining, gaining.at(-1).date), moving(0.4, 0.3, 0.4));
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
  assert.deepEqual(calculateRate(log, log.at(-1).date), moving(-1, -1.1, -0.9, 8));
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

test("scale noise around a flat weight is not moving", () => {
  const noisy = daily(21, i => 75 + (i % 2 ? .6 : -.6));
  assert.deepEqual(calculateRate(noisy, noisy.at(-1).date), { perWeek: 0, low: -0.5, high: 0.5, state: "unclear", clear: false, count: 21 });
  // A weight that hardly moves, typed exactly, is steady.
  const steady = { perWeek: 0, low: -0.1, high: 0.1, state: "steady", clear: false, count: 21 };
  const flat = daily(21, () => 75);
  assert.deepEqual(calculateRate(flat, flat.at(-1).date), steady);
  const tiny = daily(21, i => 75 - i / 500);
  assert.deepEqual(calculateRate(tiny, tiny.at(-1).date), steady);
});

const goalOf = (startWeight, weight, milestones = 10, rate = null) => ({ weight, startDate: "2026-11-01", startWeight, rate, milestones });

test("a goal survives normalizing, rounded like weights, and starts the log", () => {
  const state = normalizeState({ goal: { weight: 60.044, startDate: "2026-09-13", startWeight: 66.056, rate: 0.5004, milestones: 8 } });
  assert.deepEqual(state.goal, { weight: 60.04, startDate: "2026-09-13", startWeight: 66.06, rate: 0.5, milestones: 8 });
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

test("the fastest target rate is 1.5 kg a week or 1.5% of the start weight, whichever is lower", () => {
  assert.equal(maxGoalRate(60), 0.9);
  assert.equal(maxGoalRate(66), 0.99);
  assert.equal(maxGoalRate(73.27), 1.099, "rounded like a stored rate");
  assert.equal(maxGoalRate(100), 1.5);
  assert.equal(maxGoalRate(150), 1.5);
});

test("a goal saved above the cap keeps its rate when it is read back", () => {
  assert.equal(normalizeGoal(goalOf(66, 60, 10, 3)).rate, 3);
  assert.equal(normalizeState({ goal: goalOf(80, 70, 10, 3) }).goal.rate, 3);
  assert.equal(normalizeGoal(goalOf(66, 60, 10, 5)).rate, 5, "the storage bound");
});

test("a new goal's rate may round to 0.001 kg past the cap, and no further", () => {
  assert.equal(goalRateAllowed(0.9, 60), true);
  assert.equal(goalRateAllowed(0.901, 60), true);
  assert.equal(goalRateAllowed(0.9014, 60), true, "rounds to 0.901");
  assert.equal(goalRateAllowed(0.902, 60), false);
  assert.equal(goalRateAllowed(1.5, 150), true);
  assert.equal(goalRateAllowed(3.31 * KG_PER_LB, 100), true, "3.31 lb is 1.5014 kg");
  assert.equal(goalRateAllowed(3.32 * KG_PER_LB, 100), false);
  assert.equal(goalRateAllowed(3, 80), false);
});

test("the rate field's limit is the fastest rate allowed, to 0.01 kg or lb", () => {
  assert.equal(goalRateLimit(80), 1.2);
  assert.equal(goalRateLimit(73.27), 1.1, "1.100 kg is 0.001 kg past the cap of 1.099 kg");
  assert.equal(goalRateLimit(80, "lb"), 2.64, "2.65 lb is 1.202 kg");
  assert.equal(goalRateLimit(100, "lb"), 3.31);
  assert.equal(goalRateLimit(100, "st"), 3.31, "stones take the rate in pounds");
  assert.equal(goalRateLimit(NaN), null);
  assert.equal(goalRateLimit(undefined, "lb"), null);
  for (let hundredths = 1000; hundredths <= 20000; hundredths += 7) {
    const start = hundredths / 100;
    for (const [unit, perUnit] of [["kg", 1], ["lb", KG_PER_LB]]) {
      const limit = Math.round(goalRateLimit(start, unit) * 100);
      assert.equal(goalRateAllowed(limit / 100 * perUnit, start), true, start + " " + unit);
      assert.equal(goalRateAllowed((limit + 1) / 100 * perUnit, start), false, start + " " + unit);
    }
  }
});

test("a rate is fast when it is more than 1% of the start weight a week", () => {
  assert.equal(fastGoalRate(0.8, 80), false);
  assert.equal(fastGoalRate(0.81, 80), true);
  assert.equal(fastGoalRate(1.76 * KG_PER_LB, 80), false, "1.76 lb is 0.798 kg");
  assert.equal(fastGoalRate(1.77 * KG_PER_LB, 80), true);
});

// A loss goal from 2026-03-01 and a log that falls by `perWeek` kg a week from
// that day, kept to 0.01 kg as stored.
const fastGoal = (startWeight, weight = startWeight - 20, startDate = dateOf(first)) => ({ weight, startDate, startWeight, rate: null, milestones: 10 });
const falling = (days, start, perWeek) => daily(days, i => Math.round((start - i * perWeek / 7) * 100) / 100);

test("the fast loss caution needs three weeks of clearly faster loss than the cap", () => {
  const log = falling(35, 100, 2.1);
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 34)), true);
  assert.equal(fastLossCaution(falling(35, 100, 1.6), fastGoal(100), dateOf(first + 34)), true);
  assert.equal(fastLossCaution(falling(35, 100, 1.5), fastGoal(100), dateOf(first + 34)), false, "at the cap is not faster");
  assert.equal(fastLossCaution(falling(35, 100, 1.4), fastGoal(100), dateOf(first + 34)), false);
  assert.equal(fastLossCaution(falling(35, 60, 1.0), fastGoal(60), dateOf(first + 34)), true, "the cap for 60 kg is 0.9 kg");
  assert.equal(fastLossCaution(falling(35, 60, 0.9), fastGoal(60), dateOf(first + 34)), false);
  assert.equal(fastLossCaution(log, null, dateOf(first + 34)), false);
  // As fast on the whole, but with swings too large to tell it apart from them.
  const swinging = log.map((item, i) => ({ ...item, weight: roundWeight(item.weight + (i % 2 ? 3 : -3)) }));
  assert.deepEqual([calculateRate(swinging, dateOf(first + 34)).perWeek, calculateRate(swinging, dateOf(first + 34)).state], [-2.1, "unclear"]);
  assert.equal(fastLossCaution(swinging, fastGoal(100), dateOf(first + 34)), false, "a trend that isn't clear yet");
});

test("the fast loss caution ignores the goal's first two weeks", () => {
  const log = falling(40, 100, 2.1);
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 33)), false, "the 21 days start on day 13");
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 34)), true, "the 21 days start on day 14");
  assert.equal(fastLossCaution(log, fastGoal(100, 80, dateOf(first + 1)), dateOf(first + 34)), false);
  assert.equal(fastLossCaution(log, fastGoal(100, 80, dateOf(first + 1)), dateOf(first + 35)), true);
});

test("the fast loss caution needs every one of the 21 days, and a loss goal", () => {
  const paused = falling(35, 100, 2.1).map((item, i) => i >= 24 && i <= 30 ? { ...item, weight: 95 } : item);
  assert.equal(fastLossCaution(paused, fastGoal(100), dateOf(first + 34)), false, "a week without loss slows the trend");
  const sparse = falling(35, 100, 2.1).filter((_, i) => i < 14 || i > 22);
  assert.equal(fastLossCaution(sparse, fastGoal(100), dateOf(first + 34)), false, "a day without a weekly trend");
  assert.equal(fastLossCaution(falling(35, 100, 2.1), fastGoal(100, 120), dateOf(first + 34)), false, "a gain goal");
  assert.equal(fastLossCaution(falling(35, 100, -2.1), fastGoal(100, 120), dateOf(first + 34)), false, "fast gain");
  assert.equal(fastLossCaution(falling(35, 100, 2.1), fastGoal(100, 100), dateOf(first + 34)), false, "staying at a weight");
});

test("the fast loss caution is as of the last weigh-in, so a break doesn't change it until 14 days", () => {
  const log = falling(41, 100, 2.1);
  // Ten days after the last weigh-in, the trend through today would have run out.
  assert.equal(calculateRate(log, dateOf(first + 50)), null);
  for (let day = 40; day <= 53; day++) assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + day)), true, "day " + day);
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 54)), false, "14 days after it");
  // A week's break inside the 21 days: on day 37 the trend through that day
  // would have run out, but the trend as of day 29's weigh-in still stood.
  const paused = falling(46, 100, 2.1).filter((_, i) => i < 30 || i >= 38);
  assert.equal(calculateRate(paused, dateOf(first + 37)), null);
  assert.equal(fastLossCaution(paused, fastGoal(100), dateOf(first + 45)), true);
  // The 21 days end on the last weigh-in, and must start 14 days after the goal does.
  const short = falling(34, 100, 2.1);
  assert.equal(fastLossCaution(short, fastGoal(100), dateOf(first + 40)), false, "the 21 days start on day 13");
});

test("the fast loss caution compares the trend and the cap as shown", () => {
  // 1.54 kg a week shows as 1.5 kg, which is the cap, and as 3.4 lb, which is past 3.3 lb.
  const log = falling(35, 100, 1.54);
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 34)), false);
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 34), "lb"), true);
  assert.equal(fastLossCaution(log, fastGoal(100), dateOf(first + 34), "st"), true);
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

test("the goal forecast runs from the last weigh-in, and counts its days from today", () => {
  // The average is as of Nov 19, three days before today.
  const progress = goalProgress(goalOf(66, 60, 4), 63.5);
  const later = forecastGoal(progress, -0.5, "2026-11-19", "2026-11-22");
  assert.deepEqual(later, [
    { index: 2, weight: 63, days: 4, date: "2026-11-26" },
    { index: 3, weight: 61.5, days: 25, date: "2026-12-17" },
    { index: 4, weight: 60, days: 46, date: "2027-01-07" }
  ]);
  assert.deepEqual(later.map(row => row.date), forecastGoal(progress, -0.5, "2026-11-19").map(row => row.date), "the same dates on any day before the next weigh-in");
  // A milestone the line would have reached since the last weigh-in is due any day now.
  assert.deepEqual(forecastGoal(progress, -0.5, "2026-11-12", "2026-11-22")[0], { index: 2, weight: 63, days: 0, date: "2026-11-22" });
});

test("very near and very far forecasts", () => {
  const near = forecastGoal(goalProgress(goalOf(66, 60, 1), 60.1), -2, "2026-11-22");
  assert.deepEqual(near, [{ index: 1, weight: 60, days: 0, date: "2026-11-22" }]);
  const far = forecastGoal(goalProgress(goalOf(120, 60, 2), 100), -0.1, "2026-11-22");
  assert.deepEqual(far[0], { index: 1, weight: 90, days: 700, date: "2028-10-22" });
  assert.ok(far[1].days > FORECAST_MAX_DAYS);
  assert.equal(far[1].date, null);
});

test("the trend forecast waits for the weekly trend", () => {
  const sparse = daily(21, i => 80 - i / 10).filter((_, i) => i % 3 === 0);
  assert.equal(forecastTrend(sparse, dateOf(first + 20), 14), null);
  assert.equal(forecastTrend([], dateOf(first), 14), null);
  const short = daily(13, i => 80 - i / 10);
  assert.equal(forecastTrend(short, short.at(-1).date, 14), null);
});

test("the trend forecast carries the weekly trend on from today's average", () => {
  const log = daily(30, i => 80 - i / 10);
  const today = log.at(-1).date;
  const forecast = forecastTrend(log, today, 14);
  const { from, average, points, ...rate } = forecast;
  assert.deepEqual(rate, calculateRate(log, today), "the same weekly trend, in the same state, as the overview");
  assert.equal(forecast.average, calculateTrend(log, today).current.average);
  assert.equal(forecast.points.length, 14);
  forecast.points.forEach((point, i) => {
    assert.equal(point.day, dayOf(today) + i + 1);
    assert.equal(point.date, dateOf(point.day));
    assert.ok(Math.abs(point.average - (forecast.average - 0.1 * (i + 1))) < 1e-9, "a straight line at 0.7 kg a week");
    assert.ok(point.low < point.average && point.average < point.high);
  });
  // Weigh-ins on an exact line still get a band, from the least noise assumed.
  assert.ok(forecast.points[0].high - forecast.points[0].low > 0.01);
});

test("the trend forecast uses the weekly trend as shown in the unit", () => {
  const log = daily(21, i => 80 - i * .061);
  const kg = forecastTrend(log, log.at(-1).date, 7, "kg");
  const lb = forecastTrend(log, log.at(-1).date, 7, "lb");
  assert.equal(kg.perWeek, -0.4);
  assert.equal(lb.perWeek, calculateRate(log, log.at(-1).date, "lb").perWeek);
  assert.ok(Math.abs(lb.perWeek / KG_PER_LB + 0.9) < 1e-9, "0.9 lb a week");
  assert.ok(Math.abs(kg.points[6].average - (kg.average - 0.4)) < 1e-9);
  assert.ok(Math.abs(lb.points[6].average - (lb.average + lb.perWeek)) < 1e-9);
});

test("the trend forecast starts from the last weigh-in, on its day", () => {
  const log = daily(30, i => 80 - i / 10);
  const last = log.at(-1).date;
  const onTheDay = forecastTrend(log, last, 14);
  // Five days later, without a weigh-in: the same start, slope and band, run on five days further.
  const later = forecastTrend(log, dateOf(first + 34), 14);
  assert.equal(later.from, last);
  assert.equal(later.average, calculateTrend(log, last).current.average);
  assert.deepEqual([later.perWeek, later.state], [onTheDay.perWeek, onTheDay.state]);
  assert.equal(later.points.length, 19, "from the day after the weigh-in through 14 days after today");
  assert.equal(later.points[0].day, dayOf(last) + 1);
  assert.equal(later.points.at(-1).date, dateOf(first + 48));
  assert.deepEqual(later.points.slice(0, 14), onTheDay.points);
  // Today's point is already 5 days out, so the band has width.
  assert.ok(later.points[4].high - later.points[4].low > later.points[0].high - later.points[0].low);
  // At most 12 weeks after the weigh-in, and none once it's 14 days old.
  assert.equal(forecastTrend(log, dateOf(first + 40), 84).points.length, FORECAST_CHART_MAX_DAYS);
  assert.equal(forecastTrend(log, dateOf(first + 42), 14).from, last);
  assert.equal(forecastTrend(log, dateOf(first + 43), 14), null);
});

test("the trend forecast ignores weigh-ins after today", () => {
  const log = daily(21, i => 80 - i / 10);
  const later = [...log, entry(21, 50), entry(22, 50)];
  assert.deepEqual(forecastTrend(later, log.at(-1).date, 7), forecastTrend(log, log.at(-1).date, 7));
});

// A seeded random number generator (mulberry32), and normal noise from it.
function seeded(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const normal = random => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
// Weigh-ins on the days `weighs` picks, losing `perWeek` kg a week, with noise
// of SD `sd` kg that's correlated by `correlation` from one day to the next.
function noisyLog(random, { days, perWeek = -0.5, sd = 0.45, correlation = NOISE_CORRELATION, weighs = () => true }) {
  const log = [];
  let noise = normal(random) * sd;
  for (let i = 0; i < days; i++) {
    if (i) noise = correlation * noise + Math.sqrt(1 - correlation ** 2) * sd * normal(random);
    if (weighs(i)) log.push(entry(i, roundWeight(85 + perWeek / 7 * i + noise)));
  }
  return log;
}

test("the trend forecast's band widens with each day, and with noisier or fewer weigh-ins", () => {
  const random = seeded(7);
  const width = (log, ahead = 14) => {
    const point = forecastTrend(log, dateOf(first + 20), ahead).points[ahead - 1];
    return point.high - point.low;
  };
  const log = noisyLog(random, { days: 21 });
  const widths = forecastTrend(log, dateOf(first + 20), 42).points.map(point => point.high - point.low);
  widths.slice(1).forEach((value, i) => assert.ok(value > widths[i], "day " + (i + 2)));
  const steady = daily(21, i => roundWeight(80 - i / 10 + Math.sin(i * 2.3) * .3));
  const swinging = daily(21, i => roundWeight(80 - i / 10 + Math.sin(i * 2.3) * .9));
  assert.ok(width(swinging) > 2.5 * width(steady));
  // On an exact line every log assumes the same least noise, so only how many
  // weigh-ins there are, and how far apart, makes a difference.
  const exact = daily(21, i => 80 - i / 10);
  const everyOther = exact.filter((_, i) => i % 2 === 0);
  const everyThird = exact.filter((_, i) => i % 3 === 0 || i === 20);
  assert.ok(width(everyThird) > width(everyOther) && width(everyOther) > width(exact));
});

test("the trend forecast's band holds the average 8 times in 10 when the trend holds", () => {
  // Daily weigh-ins and three a week, with noise as correlated as assumed.
  // The real 14-day average 14 and 42 days after the last weigh-in lands
  // inside the band about 80% of the time. With three a week, day 20 is a
  // Sunday, so the forecast starts from Friday's weigh-in, on day 18.
  for (const weighs of [() => true, i => i % 7 % 2 === 0 && i % 7 < 5]) {
    const random = seeded(11);
    const inside = { 14: 0, 42: 0 };
    const trials = 300;
    for (let trial = 0; trial < trials; trial++) {
      const log = noisyLog(random, { days: 21 + 42, weighs });
      const forecast = forecastTrend(log.filter(item => item.date <= dateOf(first + 20)), dateOf(first + 20), 42);
      for (const ahead of [14, 42]) {
        const { date, low, high } = forecast.points[ahead - 1];
        const actual = calculateTrend(log, date).current.average;
        if (actual >= low && actual <= high) inside[ahead]++;
      }
    }
    for (const ahead of [14, 42]) {
      const share = inside[ahead] / trials;
      assert.ok(share > .72 && share < .88, ahead + " days ahead: " + share);
    }
  }
});

// The textbook standard error of a weekly trend's slope, in kg a day, which
// takes each day's noise as new.
function textbookError(log, throughDate) {
  const end = dayOf(throughDate);
  const points = log.map(item => [dayOf(item.date) - end, item.weight]).filter(([x]) => x > -21 && x <= 0);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanX = mean(points.map(([x]) => x));
  const meanY = mean(points.map(([, y]) => y));
  const sxx = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const slope = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / sxx;
  const residuals = points.reduce((sum, [x, y]) => sum + (y - meanY - slope * (x - meanX)) ** 2, 0);
  return Math.sqrt(residuals / (points.length - 2) / sxx);
}

// Daily weigh-ins with about 1 day in 8 skipped, losing `perWeek` kg a week,
// with noise of SD 0.6 kg that's correlated by 0.45 from one day to the next.
const skippingLog = (random, days, perWeek) => noisyLog(random, { days, perWeek, sd: .6, correlation: .45, weighs: () => random() >= 1 / 8 });

test("the weekly trend's likely range holds its estimate, rounded like it, in every unit", () => {
  const random = seeded(5);
  const states = new Set();
  for (let trial = 0; trial < 100; trial++) {
    const log = skippingLog(random, 21, (random() - .5) * 2);
    for (const unit of ["kg", "lb", "st"]) {
      const rate = calculateRate(log, dateOf(first + 20), unit);
      states.add(rate.state);
      assert.ok(rate.low <= rate.perWeek && rate.perWeek <= rate.high, JSON.stringify(rate));
      for (const value of [rate.perWeek, rate.low, rate.high]) assert.equal(fromTenths(toTenths(value, unit), unit), value, "0.1 of " + unit);
      assert.equal(rate.clear, rate.state === "moving");
      // A moving trend's range is all on its side of zero, and an unclear
      // one's reaches over it, both before rounding: an end can show as 0.0.
      if (rate.state === "moving") assert.ok(rate.perWeek < 0 ? rate.high <= 0 : rate.low >= 0, JSON.stringify(rate));
      else assert.ok(rate.state === "unclear" && rate.low <= 0 && rate.high >= 0, JSON.stringify(rate));
    }
  }
  assert.deepEqual([...states].sort(), ["moving", "unclear"]);
});

test("the weekly trend is steady only when its whole range is within 0.15 kg a week", () => {
  assert.equal(RATE_STEADY_BAND, .15);
  // On exact lines, the range is the slope give or take about 0.07 kg a week.
  const state = perWeek => calculateRate(daily(21, i => 80 + perWeek / 7 * i), dateOf(first + 20)).state;
  assert.deepEqual([0, -0.05, 0.05, -0.07, 0.07].map(state), Array(5).fill("steady"));
  assert.equal(state(-0.1), "moving", "a range from about 0.03 to 0.17 kg a week down is moving");
  // A range that's within 0.15 either way but not all on one side of zero.
  const swings = daily(21, i => 75 + (i % 2 ? .05 : -.05));
  assert.deepEqual(calculateRate(swings, dateOf(first + 20)), { perWeek: 0, low: -0.1, high: 0.1, state: "steady", clear: false, count: 21 });
  // Wider swings leave it unclear.
  assert.equal(calculateRate(daily(21, i => 75 + (i % 2 ? .3 : -.3)), dateOf(first + 20)).state, "unclear");
});

test("the weekly trend's range allows for one day's swing carrying into the next", () => {
  // With noise as correlated as Baseline assumes, the range is about 1.5
  // times as wide as the textbook one for daily weigh-ins, and near it for
  // weigh-ins 3 days apart, which are nearly unrelated. Large noise keeps the
  // rounding to 0.1 kg small beside the range.
  assert.equal(RATE_INTERVAL_ERRORS, 2);
  const random = seeded(13);
  const ratios = weighs => Array.from({ length: 50 }, () => {
    const log = noisyLog(random, { days: 21, perWeek: 0, sd: 3, weighs });
    const rate = calculateRate(log, dateOf(first + 20));
    return (rate.high - rate.low) / 2 / (RATE_INTERVAL_ERRORS * 7 * textbookError(log, dateOf(first + 20)));
  });
  // Measured: 1.48 to 1.55 daily, and 1.03 to 1.13 three days apart.
  for (const ratio of ratios(() => true)) assert.ok(ratio > 1.4 && ratio < 1.65, "daily: " + ratio);
  for (const ratio of ratios(i => i % 3 === 0 || i === 20)) assert.ok(ratio > .95 && ratio < 1.2, "every third day: " + ratio);
});

test("a flat weight with noise seldom reads as moving", () => {
  // 400 three-week logs. Measured: moving in 7.75% of flat logs, and in 45%
  // of logs losing 0.4 kg a week and 90% losing 0.75. The textbook standard
  // error with 2.5 of them, before H1, read 14%, 57% and 94% as clear.
  const random = seeded(21);
  const share = perWeek => Array.from({ length: 400 }, () => calculateRate(skippingLog(random, 21, perWeek), dateOf(first + 20)))
    .filter(rate => rate.state === "moving").length / 400;
  assert.ok(share(0) < .1, "flat: " + share(0));
  assert.ok(share(-0.75) > .85);
  // Never steady, since 21 days of noise like this can't pin a trend down to 0.15 kg a week.
  assert.ok(Array.from({ length: 100 }, () => calculateRate(skippingLog(random, 21, 0), dateOf(first + 20))).every(rate => rate.state !== "steady"));
});

test("a slow, noisy loss reads as down on nearly every day", () => {
  // 40 logs of 100 days losing 0.4 kg a week. Measured on the 3,466 days
  // with a weekly trend: 92.4% read "Down", moving or not clear yet, none
  // steady, and 3 moving up. Only 44% are moving: a 0.4 kg loss needs more
  // than three weeks to show clearly. The rule before H1 read 46% of these
  // days as "No clear change".
  const random = seeded(2026);
  let days = 0;
  let down = 0;
  let wrong = 0;
  for (let trial = 0; trial < 40; trial++) {
    const log = skippingLog(random, 100, -0.4);
    for (let day = 0; day < 100; day++) {
      const rate = calculateRate(log, dateOf(first + day));
      if (!rate) continue;
      days++;
      const { lead, rest } = weeklyTrendWords(rate);
      if (rate.perWeek < 0 && rate.state !== "steady" && (lead ?? rest).startsWith("Down")) down++;
      if (rate.state === "steady" || rate.state === "moving" && rate.perWeek > 0) wrong++;
    }
  }
  assert.ok(days > 3000);
  assert.ok(down / days >= .9, "down: " + down / days);
  assert.ok(wrong / days < .01, "steady or moving up: " + wrong / days);
});

test("the weekly trend in words, in its three states", () => {
  const rate = (perWeek, low, high, state, unit = "kg") => ({ perWeek: fromTenths(perWeek, unit), low: fromTenths(low, unit), high: fromTenths(high, unit), state });
  const words = (unit, ...args) => weeklyTrendWords(rate(...args, unit), unit);
  assert.deepEqual(words("kg", -3, -5, -1, "moving"), { lead: "Down about 0.3 kg a week", rest: " · likely 0.1 to 0.5" });
  assert.deepEqual(words("kg", 4, 2, 7, "moving"), { lead: "Up about 0.4 kg a week", rest: " · likely 0.2 to 0.7" });
  assert.deepEqual(words("kg", -3, -5, 0, "moving"), { lead: "Down about 0.3 kg a week", rest: " · likely 0.0 to 0.5" }, "a near end that rounds to zero");
  assert.deepEqual(words("kg", 0, -1, 1, "steady"), { lead: "Steady", rest: " · within 0.1 kg a week either way" });
  assert.deepEqual(words("kg", 0, -1, 2, "steady"), { lead: "Steady", rest: " · within 0.2 kg a week either way" }, "the larger end");
  assert.deepEqual(words("kg", -2, -6, 2, "unclear"), { lead: null, rest: "Down about 0.2 kg a week · a few more weigh-ins will tell" });
  assert.deepEqual(words("kg", 1, -3, 5, "unclear"), { lead: null, rest: "Up about 0.1 kg a week · a few more weigh-ins will tell" });
  assert.deepEqual(words("kg", 0, -4, 4, "unclear"), { lead: null, rest: "Little change so far · a few more weigh-ins will tell" });
  // Pounds for stones too.
  for (const unit of ["lb", "st"]) {
    assert.deepEqual(words(unit, -7, -11, -2, "moving"), { lead: "Down about 0.7 lb a week", rest: " · likely 0.2 to 1.1" });
    assert.deepEqual(words(unit, 0, -2, 3, "steady"), { lead: "Steady", rest: " · within 0.3 lb a week either way" });
    assert.deepEqual(words(unit, -4, -12, 4, "unclear"), { lead: null, rest: "Down about 0.4 lb a week · a few more weigh-ins will tell" });
  }
});

test("the chart forecasts half as far ahead as it shows, in whole weeks, up to 12", () => {
  assert.equal(forecastReach(1), 7);
  assert.equal(forecastReach(14), 7);
  assert.equal(forecastReach(20), 7);
  assert.equal(forecastReach(21), 14);
  assert.equal(forecastReach(30), 14);
  assert.equal(forecastReach(90), 42);
  assert.equal(forecastReach(200), FORECAST_CHART_MAX_DAYS);
  assert.equal(forecastReach(2000), 84);
});

test("Student's t quantiles for the band", () => {
  const z = 1.2815515655446004;
  // Exact 90th percentiles of t.
  for (const [df, exact] of [[3, 1.638], [4, 1.533], [6, 1.440], [10, 1.372], [19, 1.328], [60, 1.296]]) {
    assert.ok(Math.abs(tQuantile(z, df) - exact) < 0.012, df + ": " + tQuantile(z, df));
  }
  assert.ok(Math.abs(tQuantile(z, 1e9) - z) < 1e-6);
});

test("weight ranges read as shown", () => {
  assert.equal(formatRange(78.14, 79.94), "78.1–79.9 kg");
  assert.equal(formatRange(78.14, 79.94, "lb"), "172.3–176.2 lb");
  assert.equal(formatRange(79.13, 80.1, "st"), "12 st 6.5 lb – 12 st 8.6 lb");
  assert.equal(formatRange(80.01, 80.04), "80.0 kg", "a range that shows as one weight");
  assert.equal(spokenRange(78.14, 79.94), "78.1 to 79.9 kilograms");
  assert.equal(spokenRange(79.13, 80.1, "st"), "12 stone 6.5 pounds to 12 stone 8.6 pounds");
  assert.equal(spokenRange(80.01, 80.04), "80.0 kilograms");
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
  const trend = { days: [{ day: 0, average: 69.96 }, { day: 7, average: 70.04 }], current: { day: 7, average: 70.04, asOf: dateOf(7) } };
  assert.deepEqual(averageChanges(trend), [{ days: 7, change: 0 }]);
  const log = daily(30, () => 70);
  assert.deepEqual(changesOf(log, dateOf(first + 43)), []);
  assert.deepEqual(changesOf([], dateOf(first)), []);
});

test("on days without a weigh-in, every figure is as of the last weigh-in", () => {
  // Daily weigh-ins on days 0–59 (Mar 1 – Apr 29), losing about 0.7 kg a week
  // with some noise, then a break of up to 13 days.
  const log = daily(60, i => roundWeight(95 - i / 10 + Math.sin(i * 2.3) * .4));
  const last = dateOf(first + 59);
  const goal = { weight: 85, startDate: dateOf(first), startWeight: 95, rate: null, milestones: 10 };
  const waists = [{ date: dateOf(first + 50), waist: 100 }, { date: dateOf(first + 64), waist: 99 }];
  const figures = today => {
    const trend = calculateTrend(log, today);
    const range = recentRange(log, trend.current.asOf);
    return {
      average: trend.current.average,
      count: trend.current.count,
      asOf: trend.current.asOf,
      changes: averageChanges(trend),
      rate: rateAsOf(log, today),
      progress: goalProgress(goal, trend.current.average),
      overall: overallRate(goal, trend.current.average, trend.current.asOf),
      // The month in progress becomes a past one, so leave out where it runs to.
      months: monthlyReports(log, today, "kg", goal).filter(report => report.count).map(({ partial, through, ...report }) => report),
      // The same 14 days as the average.
      range,
      forecast: forecastTrend(log, today, 7).points.slice(0, 7),
      // From May 4 the second waist's estimate uses the average as of Apr 29.
      fat: bodyFatHistory(log, waists, "male", today).map(point => point.weight)
    };
  };
  const onTheDay = figures(last);
  assert.equal(onTheDay.asOf, last);
  assert.deepEqual(onTheDay.changes.map(change => change.days), [7, 30, null]);
  assert.ok(onTheDay.rate.clear && onTheDay.progress.completed > 0 && onTheDay.months.some(month => month.milestones.length));
  for (let after = 1; after <= 13; after++) {
    const today = dateOf(first + 59 + after);
    const later = figures(today);
    if (after < 5) assert.deepEqual(later, onTheDay, today);
    else assert.deepEqual({ ...later, fat: later.fat.slice(0, 1) }, { ...onTheDay, fat: onTheDay.fat.slice(0, 1) }, today);
    if (after >= 5) assert.equal(later.fat[1], onTheDay.average, "the waist on May 4 uses the average as of Apr 29");
  }
  // The weekly trend through today would have run out as its 21 days passed the weigh-ins.
  assert.equal(calculateRate(log, dateOf(first + 72)), null);
  // 14 days after the last weigh-in, there's no average, trend or forecast.
  const lapsed = dateOf(first + 73);
  assert.equal(calculateTrend(log, lapsed).current, null);
  assert.equal(rateAsOf(log, lapsed), null);
  assert.equal(forecastTrend(log, lapsed, 7), null);
  assert.equal(asOfDate(log, lapsed), null);
  assert.equal(asOfDate(log, dateOf(first + 72)), last);
  assert.equal(asOfDate([], last), null);
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
  assert.deepEqual(calculateRate(log, dateOf(first + 20)), moving(-0.7, -0.8, -0.6));
  assert.equal(calculateRate(log, dateOf(first + 12)), null);
});

test("a note is one trimmed line of text, and anything else is no note", () => {
  assert.equal(cleanNote("  after   travel \n\t(home)\r\n"), "after travel (home)");
  assert.equal(cleanNote("a\u0000b\u007fc\u2028d"), "a b c d");
  assert.equal(cleanNote("bad \ud800 half"), "bad half");
  for (const value of ["", "   \n ", null, undefined, 5, {}, ["note"]]) assert.equal(cleanNote(value), null, JSON.stringify(value));
  assert.equal(noteLength("🙂 ok"), 4);
});

test("notes survive normalizing, and a note that is too long is cut", () => {
  const state = normalizeState({ entries: [
    { date: "2026-11-02", weight: 80, note: " after  travel " }, { date: "2026-11-01", weight: 81 },
    { date: "2026-11-03", weight: 79, note: "🙂".repeat(NOTE_MAX_LENGTH + 5) }, { date: "2026-11-04", weight: 79, note: 12 }
  ] });
  assert.deepEqual(state.entries.map(entry => entry.note), [null, "after travel", "🙂".repeat(NOTE_MAX_LENGTH), null]);
  assert.deepEqual(normalizeState(state), state);
});

test("saving a weight keeps the date's note unless a note is given", () => {
  let state = saveWeight(normalizeState(null), "2026-11-01", 80, "after travel");
  state = saveWeight(state, "2026-11-01", 79.8);
  assert.deepEqual(state.entries, [{ date: "2026-11-01", weight: 79.8, note: "after travel" }]);
  assert.equal(saveWeight(state, "2026-11-01", 79.8, "new scale").entries[0].note, "new scale");
  assert.equal(saveWeight(state, "2026-11-01", 79.8, null).entries[0].note, null);
  assert.equal(saveWeight(state, "2026-11-01", 79.8, "").entries[0].note, null);
  assert.equal(saveWeight(state, "2026-11-02", 79.6).entries[1].note, null, "a new date starts without a note");
});

test("trend points carry the weigh-in's note", () => {
  const { days } = calculateTrend([{ date: "2026-11-01", weight: 80, note: "after travel" }, { date: "2026-11-03", weight: 79, note: null }], "2026-11-03");
  assert.deepEqual(days.map(point => point.note), ["after travel", null, null]);
});

test("rows are grouped by calendar month in the order given", () => {
  const rows = ["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-01", "2025-10-31"].map(date => ({ date }));
  assert.deepEqual(groupByMonth(rows).map(group => [group.month, group.rows.length]), [["2026-11", 2], ["2026-10", 2], ["2025-10", 1]]);
  assert.deepEqual(groupByMonth([]), []);
});

const lb = pounds => Math.round(pounds * KG_PER_LB * 100) / 100; // As stored.

test("weights show one decimal of kg, pounds, or stones and pounds", () => {
  assert.equal(formatWeight(61.55), "61.6 kg");
  assert.equal(formatWeight(68.04, "lb"), "150.0 lb");
  assert.equal(formatWeight(lb(135.8), "st"), "9 st 9.8 lb");
  assert.equal(formatWeight(139.96 * KG_PER_LB, "st"), "10 st 0.0 lb", "rounds before splitting off stones");
  assert.equal(formatWeight(lb(4409.2), "lb"), "4,409.2 lb");
  assert.equal(formatWeight(null, "lb"), "—");
  assert.deepEqual(weightParts(lb(135.8), "st"), [["9", "st"], ["9.8", "lb"]]);
  assert.equal(formatAmount(-0.23), "0.2 kg");
  assert.equal(formatAmount(-lb(2.4), "st"), "2.4 lb", "changes in stones mode are in pounds");
});

test("every weight entered to 0.1 lb reads back the same", () => {
  for (let tenths = 1; tenths <= 44092; tenths++) assert.equal(toTenths(lb(tenths / 10), "lb"), tenths, String(tenths / 10));
});

test("a weight in kg with one decimal and the same weight in tenths of kg agree", () => {
  for (const kg of [0.1, 61.25, 61.35, 99.95, 2000]) {
    assert.equal(toTenths(kg), Math.round(kg * 10));
    assert.equal(fromTenths(toTenths(kg)), Math.round(kg * 10) / 10);
  }
});

test("heights show centimeters, or feet and inches to 0.1 in, and survive storing to 0.1 cm", () => {
  assert.deepEqual(heightParts(172), [["172", "cm"]]);
  assert.deepEqual(heightParts(172.5), [["172.5", "cm"]]);
  assert.deepEqual(heightParts(177.8, "ft"), [["5", "ft"], ["10", "in"]]);
  assert.deepEqual(heightParts(172, "ft"), [["5", "ft"], ["7.7", "in"]]);
  assert.deepEqual(heightParts(182.9, "ft"), [["6", "ft"], ["0", "in"]]);
  for (let tenths = 120; tenths <= 1570; tenths++) {
    const cm = Math.round(tenths / 10 * CM_PER_IN * 10) / 10;
    assert.equal(Math.round(cm / CM_PER_IN * 10), tenths, String(tenths / 10));
  }
});

test("units default to kg and cm", () => {
  assert.deepEqual(normalizeUnits(undefined), { weight: "kg", height: "cm" });
  assert.deepEqual(normalizeUnits({ weight: "st", height: "ft" }), { weight: "st", height: "ft" });
  assert.deepEqual(normalizeUnits({ weight: "stone", height: 5 }), { weight: "kg", height: "cm" });
  assert.deepEqual(normalizeState({ units: { weight: "lb" } }).units, { weight: "lb", height: "cm" });
  assert.equal(normalizeState({ units: { weight: "lb" } }).started, false, "units alone don't start a log");
});

test("weights are kept to 0.01 kg and averaged exactly", () => {
  const state = normalizeState({ entries: [{ date: "2026-11-01", weight: 150 * KG_PER_LB }, { date: "2026-11-02", weight: 151 * KG_PER_LB }] });
  assert.deepEqual(state.entries.map(entry => entry.weight), [68.04, 68.49]);
  const { current } = calculateTrend(state.entries, "2026-11-02");
  assert.equal(current.average, 68.265);
  assert.equal(formatWeight(current.average, "lb"), "150.5 lb");
});

test("progress in pounds works in tenths of a pound", () => {
  const goal = { weight: lb(150), startDate: "2026-11-01", startWeight: lb(160), rate: null, milestones: 4 };
  const progress = goalProgress(goal, lb(155.04), "lb");
  assert.deepEqual(progress.milestones.map(m => formatWeight(m.weight, "lb")), ["157.5 lb", "155.0 lb", "152.5 lb", "150.0 lb"]);
  assert.equal(formatWeight(progress.current, "lb"), "155.0 lb");
  assert.equal(progress.completed, 2, "155.0 lb as shown reaches milestone 2");
  assert.equal(progress.overall, 0.5);
  assert.equal(formatAmount(progress.toGo, "lb"), "5.0 lb");
  assert.equal(formatAmount(progress.next.toGo, "lb"), "2.5 lb");
  // In kg the same average reads 70.3 against a 70.3 milestone, so it counts too; in pounds a hair short does not.
  assert.equal(goalProgress(goal, lb(155.06), "lb").completed, 1);
  // A milestone is never smaller than 0.1 lb.
  assert.equal(goalProgress({ ...goal, weight: lb(159.8), milestones: 10 }, lb(160), "lb").milestones.length, 2);
});

test("rates and changes round to 0.1 of the unit shown", () => {
  // Losing half a pound a week, every day for three weeks.
  const entries = Array.from({ length: 21 }, (_, i) => entry(i, lb(160 - i / 14)));
  const end = entries.at(-1).date;
  const rate = calculateRate(entries, end, "lb");
  assert.equal(formatAmount(rate.perWeek, "lb"), "0.5 lb");
  assert.equal(calculateRate(entries, end).perWeek, -0.2, "the same log reads 0.2 kg in kg");
  const changes = averageChanges(calculateTrend(entries, end), "st");
  assert.equal(formatAmount(changes[0].change, "st"), "0.5 lb");
  const goal = { weight: lb(150), startDate: entries[0].date, startWeight: lb(160), rate: null, milestones: 10 };
  const trend = calculateTrend(entries, end);
  assert.equal(formatAmount(overallRate(goal, trend.current.average, end, "lb"), "lb"), "0.3 lb", "the average trails the weight");
});

// Daily weigh-ins from 1 Sep 2026, down 0.2 kg a day. Once the window is full
// the average on day d is 80 − d / 5 + 1.3.
const autumn = Array.from({ length: 83 }, (_, i) => ({ date: dateOf(dayOf("2026-09-01") + i), weight: 80 - i / 5 }));

test("each month runs from the average as it began to the average on its last day", () => {
  const reports = monthlyReports(autumn, "2026-11-22");
  assert.deepEqual(reports.map(report => [report.month, report.partial, report.count, report.through]), [
    ["2026-11", true, 22, "2026-11-22"],
    ["2026-10", false, 31, "2026-10-31"],
    ["2026-09", false, 30, "2026-09-30"]
  ]);
  const [november, october, september] = reports;
  assert.deepEqual(september.start, { date: "2026-09-01", average: 80 }, "the first month starts at its first weigh-in");
  assert.deepEqual(october.start, { date: "2026-09-30", average: 75.5 }, "later months start where the one before ended");
  assert.equal(october.start.average, september.end.average);
  assert.deepEqual(november.end, { date: "2026-11-22", average: 64.9 });
  assert.deepEqual(reports.map(report => report.change), [-4.4, -6.2, -4.5]);
  assert.equal(reports.reduce((sum, report) => sum + report.change, 0).toFixed(1), (64.9 - 80).toFixed(1), "the changes add up");
  assert.deepEqual(reports.map(report => report.rate), Array(3).fill(moving(-1.4, -1.5, -1.3)));
  assert.deepEqual(september.low, { date: "2026-09-30", weight: 74.2 });
  assert.deepEqual(reports.map(report => report.milestones), [[], [], []], "no goal, no milestones");
});

test("a month without weigh-ins has no figures, and gaps change where months start and end", () => {
  // 1–10 Sep, then nothing until 5 Nov.
  const log = [...autumn.slice(0, 10), ...autumn.slice(65)];
  const [november, october, september] = monthlyReports(log, "2026-11-22");
  assert.deepEqual(september.end, { date: "2026-09-10", average: 79.1 }, "the average on the last weigh-in, not the 78.2 it would drift to as the others left its window");
  assert.deepEqual(october, {
    month: "2026-10", first: "2026-10-01", through: "2026-10-31", partial: false, count: 0,
    start: null, end: null, change: null, rate: null, low: null, milestones: []
  });
  assert.equal(november.start.date, "2026-11-05", "no average on 31 Oct, so November starts at its first weigh-in");
  assert.equal(november.rate.perWeek, -1.4);
});

test("the month in progress runs through today, even before its first weigh-in", () => {
  const log = autumn.slice(0, 61); // Through 31 Oct.
  const [november, october] = monthlyReports([...log, { date: "2026-11-04", weight: 50 }], "2026-11-03");
  assert.deepEqual([november.partial, november.count, november.through, november.start], [true, 0, "2026-11-03", null], "weigh-ins after today are left out");
  assert.equal(october.partial, false);
  assert.deepEqual(monthlyReports([], "2026-11-03"), []);
  assert.deepEqual(monthlyReports([{ date: "2026-11-04", weight: 50 }], "2026-11-03"), []);
});

test("a month needs two days with an average for a change, and 8 weigh-ins for a trend", () => {
  const [only] = monthlyReports([{ date: "2026-11-30", weight: 70 }], "2026-11-30");
  assert.deepEqual([only.start, only.end, only.change, only.rate], [{ date: "2026-11-30", average: 70 }, { date: "2026-11-30", average: 70 }, null, null]);
  assert.deepEqual(only.low, { date: "2026-11-30", weight: 70 });
  // The trend is as it stood on the month's last day, not today.
  const [, october] = monthlyReports([...autumn.slice(55, 61), ...autumn.slice(61, 80)], "2026-11-19");
  assert.equal(october.rate, null, "6 weigh-ins by 31 Oct");
});

test("a month ends with its last weigh-in's average, which the days after it don't change", () => {
  // Daily to 25 Oct, then nothing until 3 Nov.
  const log = autumn.filter(item => item.date <= "2026-10-25" || item.date >= "2026-11-03");
  const [november, october] = monthlyReports(log, "2026-11-22");
  assert.deepEqual(october.end, { date: "2026-10-25", average: calculateTrend(log, "2026-10-25").current.average });
  assert.deepEqual(november.start, october.end, "the average on 31 Oct is the one as of 25 Oct");
  assert.deepEqual(october.rate, calculateRate(log, "2026-10-25"));
  for (const today of ["2026-10-26", "2026-10-31", "2026-11-01", "2026-11-02"]) {
    const month = monthlyReports(log, today).find(report => report.month === "2026-10");
    assert.deepEqual([month.end, month.change, month.rate], [october.end, october.change, october.rate], today);
  }
  const reports = monthlyReports(log, "2026-11-22");
  assert.equal(reports.reduce((sum, report) => sum + report.change, 0).toFixed(1), (november.end.average - reports.at(-1).start.average).toFixed(1), "the changes still add up");
});

test("monthly changes use the averages as shown, and the low goes to the most recent tie", () => {
  // 70.04 and 69.96 both show as 70.0 kg, but 154.4 and 154.2 lb.
  const log = [{ date: "2026-10-31", weight: 70.04 }, { date: "2026-11-01", weight: 69.88 }, { date: "2026-11-02", weight: 69.88 }, { date: "2026-11-03", weight: 70.13 }];
  const [kg] = monthlyReports(log.slice(0, 2), "2026-11-01");
  assert.equal(kg.change, 0);
  const [lb] = monthlyReports(log.slice(0, 2), "2026-11-01", "lb");
  assert.equal(formatAmount(lb.change, "lb"), "0.2 lb");
  assert.deepEqual(monthlyReports(log, "2026-11-03")[0].low, { date: "2026-11-02", weight: 69.88 });
});

test("with a goal, each month lists the milestones its average first reached", () => {
  // 80 to 64 kg in milestones of 2 kg: 78, 76 … 64.
  const goal = { weight: 64, startDate: "2026-09-01", startWeight: 80, rate: null, milestones: 8 };
  assert.deepEqual(monthlyReports(autumn, "2026-11-22", "kg", goal).map(report => report.milestones), [[6, 7], [3, 4, 5], [1, 2]]);
  // Counting starts on the start date, so October takes the milestones its first day was already past.
  const later = { ...goal, startDate: "2026-10-01" };
  assert.deepEqual(monthlyReports(autumn, "2026-11-22", "kg", later).map(report => report.milestones), [[6, 7], [1, 2, 3, 4, 5], []]);
  // Down past milestone 1 in September, back above it in October, past it again in November.
  const log = [77, 79, 77.5].flatMap((weight, month) => Array.from({ length: 14 }, (_, i) => ({ date: "2026-" + String(month + 9).padStart(2, "0") + "-" + String(i + 1).padStart(2, "0"), weight })));
  assert.deepEqual(monthlyReports(log, "2026-11-22", "kg", goal).map(report => report.milestones), [[], [], [1]]);
  assert.deepEqual(monthlyReports(autumn, "2026-11-22", "kg", { ...goal, weight: 80 }).map(report => report.milestones), [[], [], []], "staying at a weight has no milestones");
});

test("a reminder needs an hour, a real time zone and a device, and survives normalizing", () => {
  const reminder = { hour: 8, timeZone: "Europe/London", devices: ["https://fcm.googleapis.com/1", "https://fcm.googleapis.com/1", "", 5, "https://web.push.apple.com/2"] };
  assert.deepEqual(normalizeReminder(reminder), { hour: 8, timeZone: "Europe/London", devices: ["https://fcm.googleapis.com/1", "https://web.push.apple.com/2"] });
  assert.deepEqual(normalizeState({ reminder }).reminder.devices.length, 2);
  assert.equal(normalizeState({ reminder }).started, false, "a reminder alone doesn't start a log");
  for (const change of [{ hour: 24 }, { hour: 7.5 }, { timeZone: "Nowhere/Town" }, { timeZone: "../etc" }, { devices: [] }, { devices: "x" }]) {
    assert.equal(normalizeReminder({ ...reminder, ...change }), null, JSON.stringify(change));
  }
  assert.equal(normalizeState(null).reminder, null);
  assert.equal(validTimeZone("America/Argentina/Buenos_Aires"), true);
  assert.equal(validTimeZone("Etc/GMT-14"), true);
  assert.equal(validTimeZone("x".repeat(65)), false);
});

// The Army's worked examples (ALARACT 046/2023, table B-5), in pounds and inches.
const pounds = lb => lb * KG_PER_LB;
const inches = value => value * CM_PER_IN;

test("body fat follows the Army's one-site formula for men and for women", () => {
  assert.ok(Math.abs(bodyFat(pounds(210), inches(35), "male") - 17.48) < 1e-9, "man, 210 lb and a 35 in waist");
  assert.ok(Math.abs(bodyFat(pounds(165), inches(30), "female") - 26.475) < 1e-9, "woman, 165 lb and a 30 in waist");
  assert.ok(bodyFat(pounds(200), inches(36), "male") < bodyFat(pounds(190), inches(36), "male"), "more weight on the same waist is less fat");
});

test("body fat needs a weight, a waist and a sex, and stays empty outside 0 to 100%", () => {
  for (const [weight, waist, sex] of [[null, 90, "male"], [80, null, "male"], [80, 90, null], [80, 90, "other"], [0, 90, "female"]]) {
    assert.equal(bodyFat(weight, waist, sex), null, JSON.stringify([weight, waist, sex]));
  }
  assert.equal(bodyFat(80, 34, "male"), null, "a 34 in waist typed as centimeters");
  assert.equal(bodyFat(80, inches(90), "male"), null, "a 90 cm waist typed as inches");
});

test("waists are kept to 0.01 cm, one a day, and read back in inches as entered", () => {
  const state = normalizeState({ sex: "female", waists: [
    { date: "2026-11-02", waist: 80.004 }, { date: "2026-11-01", waist: 82 }, { date: "2026-11-02", waist: 79.996 },
    { date: "2026-11-03", waist: 9.99 }, { date: "2026-11-04", waist: 400.1 }, { date: "bad", waist: 80 }, { date: "2026-11-05", waist: "80" }
  ] });
  assert.deepEqual(state.waists, [{ date: "2026-11-01", waist: 82 }, { date: "2026-11-02", waist: 80 }]);
  assert.equal(state.sex, "female");
  assert.equal(state.started, true, "a waist starts a log");
  assert.deepEqual(normalizeState(state), state);
  assert.equal(normalizeState({ sex: "x" }).sex, null);
  assert.equal(normalizeState({ sex: "male" }).started, false, "a sex alone doesn't start a log");
  assert.deepEqual(normalizeState(null).waists, []);
  for (const value of [34.1, 32.5, 40.7]) assert.equal(formatWaist(roundWaist(inches(value)), "ft"), value.toFixed(1) + " in", value + " in");
  assert.deepEqual(waistParts(86.55), [["86.6", "cm"]]);
  assert.equal(formatWaist(86, "cm"), "86.0 cm");
  assert.equal(formatWaist(null), "—");
  assert.equal(spokenWaist(inches(34), "ft"), "34.0 inches");
  assert.equal(validWaist(10) && validWaist(400), true);
  assert.equal(validWaist(9.99) || validWaist(400.01) || validWaist(NaN), false);
});

test("saving a waist replaces that date's measurement and sets the formula", () => {
  let state = saveWaist(normalizeState(null), "2026-11-01", 90, "male");
  state = saveWaist(state, "2026-11-08", 89, "male");
  state = saveWaist(state, "2026-11-01", 91.5, "female");
  assert.deepEqual(state.waists, [{ date: "2026-11-01", waist: 91.5 }, { date: "2026-11-08", waist: 89 }]);
  assert.equal(state.sex, "female");
  assert.throws(() => saveWaist(state, "2026-11-02", 90, null));
  assert.throws(() => saveWaist(state, "2026-11-02", 5, "male"));
});

test("each waist's estimate uses the 14-day average on its date", () => {
  const entries = [entry(0, 90), entry(1, 92), entry(10, 88), entry(30, 85)];
  const waists = [{ date: dateOf(first + 1), waist: 100 }, { date: dateOf(first + 10), waist: 98 }, { date: dateOf(first + 27), waist: 97 }, { date: dateOf(first + 40), waist: 96 }];
  const history = bodyFatHistory(entries, waists, "male", dateOf(first + 35));
  assert.equal(history.length, 3, "a measurement after today is left out");
  assert.equal(history[0].weight, 91, "the average of days 0 and 1");
  assert.equal(history[0].bodyFat, bodyFat(91, 100, "male"));
  assert.equal(history[1].weight, 90, "days 0, 1 and 10");
  assert.equal(history[2].weight, null, "no weigh-ins in the 14 days up to day 27");
  // Day 15 has no weigh-in, so it uses the average as of day 10, though day 0 has left its window.
  assert.equal(bodyFatHistory(entries, [{ date: dateOf(first + 15), waist: 100 }], "male", dateOf(first + 35))[0].weight, 90);
  assert.equal(history[2].bodyFat, null);
  assert.equal(bodyFatHistory(entries, waists, null, dateOf(first + 35))[0].bodyFat, null, "no estimate without a sex");
  assert.deepEqual(bodyFatHistory(entries, [], "male", dateOf(first + 35)), []);
  assert.equal(bodyFatHistory([], waists, "male", dateOf(first + 35))[0].weight, null, "no weigh-ins at all");
});

test("the body fat change compares the first and latest estimates as shown", () => {
  const point = (day, value) => ({ date: dateOf(first + day), day: first + day, waist: 90, weight: 80, bodyFat: value });
  assert.equal(bodyFatChange([point(0, 24.26), { ...point(5, null) }]), null, "one estimate");
  const change = bodyFatChange([point(0, 24.26), point(5, null), point(9, 23.04), point(20, 22.15)]);
  assert.equal(change.from.day, first);
  assert.equal(change.to.day, first + 20);
  assert.equal(change.change, -2.1, "22.2 − 24.3, not 22.15 − 24.26");
  assert.equal(bodyFatChange([point(0, 22), point(1, 22.04)]).change, 0);
});

test("a change's target is what it replaces", () => {
  const weighIn = changeTarget({ op: "save-weight", date: "2026-11-23", weight: 84.9, note: "after travel" });
  assert.equal(weighIn, "weigh-in 2026-11-23");
  // A corrected weight, an edit or a deletion on the same date replaces it; another date doesn't.
  assert.equal(changeTarget({ op: "save-weight", date: "2026-11-23", weight: 84.6, note: null }), weighIn);
  assert.equal(changeTarget({ op: "update-weight", date: "2026-11-23", weight: 85 }), weighIn);
  assert.equal(changeTarget({ op: "delete-weight", date: "2026-11-23" }), weighIn);
  assert.notEqual(changeTarget({ op: "save-weight", date: "2026-11-22", weight: 84.9 }), weighIn);
  // A waist on the same date is a different thing from the weigh-in.
  assert.equal(changeTarget({ op: "save-waist", date: "2026-11-23", waist: 86, sex: "male" }), "waist 2026-11-23");
  assert.equal(changeTarget({ op: "delete-waist", date: "2026-11-23" }), "waist 2026-11-23");
  assert.equal(changeTarget({ op: "set-goal", goal: {} }), changeTarget({ op: "clear-goal" }));
  assert.equal(changeTarget({ op: "set-reminder", hour: 8 }), changeTarget({ op: "clear-reminder" }));
  assert.equal(changeTarget({ op: "set-height", height: 178 }), "height");
  assert.equal(changeTarget({ op: "set-units", units: {} }), "units");
  // Preferences merge, so a change replaces another only when it sets the same keys.
  assert.equal(changeTarget({ op: "set-preferences", preferences: { showBmi: false } }), changeTarget({ op: "set-preferences", preferences: { showBmi: true } }));
  assert.notEqual(changeTarget({ op: "set-preferences", preferences: { showBmi: false } }), changeTarget({ op: "set-preferences", preferences: { showBodyFat: false } }));
  assert.equal(changeTarget({ op: "set-preferences", preferences: { showBodyFat: true, showBmi: true } }), "preferences showBmi showBodyFat");
  assert.equal(changeTarget({ op: "set-preferences", preferences: { showBmi: "no" } }), null);
  for (const change of [null, {}, { op: "import" }, { op: "start" }, { op: "save-weight" }, { op: "delete-waist", date: "2026-02-30" }]) {
    assert.equal(changeTarget(change), null, JSON.stringify(change));
  }
});

// A log as the server returns it, normalized as the app keeps it.
const serverLog = () => normalizeState({
  started: true, height: 178, sex: null, units: { weight: "kg", height: "cm" }, reminder: null,
  goal: { weight: 80, startDate: "2026-11-01", startWeight: 85, rate: .5, milestones: 10 },
  entries: [{ date: "2026-11-20", weight: 84.6, note: "after travel" }, { date: "2026-11-21", weight: 84.4, note: null }],
  waists: [{ date: "2026-11-20", waist: 90 }]
});

test("each change that can wait applies as the server applies it", () => {
  const log = serverLog();
  // A new weigh-in, and a correction that leaves out the note keeps it.
  assert.deepEqual(applyOp(log, { op: "save-weight", date: "2026-11-22", weight: 84.21, note: "new scale" }).entries.at(-1), { date: "2026-11-22", weight: 84.21, note: "new scale" });
  assert.deepEqual(applyOp(log, { op: "save-weight", date: "2026-11-20", weight: 84.5 }).entries[0], { date: "2026-11-20", weight: 84.5, note: "after travel" });
  assert.equal(applyOp(log, { op: "save-weight", date: "2026-11-20", weight: 84.5, note: null }).entries[0].note, null);
  // An edit changes a weigh-in that's there and never adds one.
  assert.deepEqual(applyOp(log, { op: "update-weight", date: "2026-11-21", weight: 84, note: "late" }).entries[1], { date: "2026-11-21", weight: 84, note: "late" });
  assert.deepEqual(applyOp(log, { op: "update-weight", date: "2026-11-19", weight: 84, note: null }), log);
  assert.deepEqual(applyOp(log, { op: "delete-weight", date: "2026-11-20" }).entries.map(entry => entry.date), ["2026-11-21"]);
  assert.deepEqual(applyOp(log, { op: "delete-weight", date: "2026-11-19" }), log);
  assert.equal(applyOp(log, { op: "set-height", height: 180.5 }).height, 180.5);
  // A waist sets the body fat formula, and a deletion leaves the formula alone.
  const waisted = applyOp(log, { op: "save-waist", date: "2026-11-21", waist: 88.5, sex: "female" });
  assert.deepEqual(waisted.waists, [{ date: "2026-11-20", waist: 90 }, { date: "2026-11-21", waist: 88.5 }]);
  assert.equal(waisted.sex, "female");
  assert.deepEqual(applyOp(waisted, { op: "delete-waist", date: "2026-11-20" }).waists, [{ date: "2026-11-21", waist: 88.5 }]);
  assert.equal(applyOp(waisted, { op: "delete-waist", date: "2026-11-20" }).sex, "female");
  const goal = { weight: 78, startDate: "2026-11-21", startWeight: 84.4, rate: null, milestones: 5 };
  assert.deepEqual(applyOp(log, { op: "set-goal", goal }).goal, goal);
  assert.equal(applyOp(log, { op: "clear-goal" }).goal, null);
  assert.deepEqual(applyOp(log, { op: "set-units", units: { weight: "st", height: "ft" } }).units, { weight: "st", height: "ft" });
  // Preferences merge: the keys sent change and the rest stay.
  const hidden = applyOp(log, { op: "set-preferences", preferences: { showBodyFat: false } });
  assert.deepEqual(hidden.preferences, { showBmi: true, showBodyFat: false });
  assert.deepEqual(applyOp(hidden, { op: "set-preferences", preferences: { showBmi: false } }).preferences, { showBmi: false, showBodyFat: false });
  assert.deepEqual(applyOp(hidden, { op: "set-preferences", preferences: { showBodyFat: true } }).preferences, { showBmi: true, showBodyFat: true });
  // Hiding them deletes nothing.
  assert.deepEqual({ ...hidden, preferences: log.preferences }, log);
  // Each change leaves the log it was given untouched.
  assert.deepEqual(log, serverLog());
});

test("every change that can wait is one the app sends, and reminders aren't among them", () => {
  assert.deepEqual([...QUEUEABLE_OPS].sort(), ["clear-goal", "consent", "delete-waist", "delete-weight", "save-waist", "save-weight", "set-goal", "set-height", "set-preferences", "set-units", "start", "update-weight"]);
  assert.ok(!QUEUEABLE_OPS.includes("set-reminder") && !QUEUEABLE_OPS.includes("clear-reminder") && !QUEUEABLE_OPS.includes("import"));
});

test("an empty log starts with its first change, as on the server", () => {
  const empty = normalizeState({});
  assert.equal(empty.started, false);
  for (const change of [{ op: "set-height", height: 170 }, { op: "set-units", units: { weight: "lb", height: "cm" } }, { op: "set-preferences", preferences: { showBmi: false } }, { op: "save-waist", date: "2026-11-21", waist: 80, sex: "male" },
    { op: "set-goal", goal: { weight: 60, startDate: "2026-11-21", startWeight: 65, rate: null, milestones: 10 } }, { op: "save-weight", date: "2026-11-21", weight: 65 }, { op: "start" }]) {
    assert.equal(applyOp(empty, change).started, true, change.op);
  }
});

test("reminders apply too, so the screen shows them while they're sent", () => {
  const log = serverLog();
  // A device that sends its subscription turns reminders on; without any device they stay off.
  const on = applyOp(log, { op: "set-reminder", hour: 7, timeZone: "Europe/London", subscription: { endpoint: "https://push.example/a", keys: {} } });
  assert.deepEqual(on.reminder, { hour: 7, timeZone: "Europe/London", devices: ["https://push.example/a"] });
  assert.equal(applyOp(log, { op: "set-reminder", hour: 7, timeZone: "Europe/London" }).reminder, null);
  // A new time keeps the devices, and another device joins them once.
  assert.deepEqual(applyOp(on, { op: "set-reminder", hour: 9, timeZone: "Europe/Paris" }).reminder, { hour: 9, timeZone: "Europe/Paris", devices: ["https://push.example/a"] });
  assert.deepEqual(applyOp(on, { op: "set-reminder", hour: 9, timeZone: "Europe/Paris", subscription: { endpoint: "https://push.example/a" } }).reminder.devices, ["https://push.example/a"]);
  assert.equal(applyOp(on, { op: "clear-reminder" }).reminder, null);
});

test("a change that isn't valid, or that the app never sends, throws", () => {
  const log = serverLog();
  for (const change of [null, {}, { op: "import", log: {} }, { op: "drop-table" }, { op: "save-weight", date: "2026-11-31", weight: 80 },
    { op: "save-weight", date: "2026-11-22", weight: 0 }, { op: "set-height", height: 0 }, { op: "set-height", height: 401 }, { op: "set-height", height: "180" },
    { op: "save-waist", date: "2026-11-22", waist: 80, sex: "other" }, { op: "set-goal", goal: { weight: 80 } }, { op: "set-units", units: { weight: "g", height: "cm" } },
    { op: "set-preferences" }, { op: "set-preferences", preferences: {} }, { op: "set-preferences", preferences: { showBmi: 0 } }, { op: "set-preferences", preferences: { showWeight: false } }]) {
    assert.throws(() => applyOp(log, change), JSON.stringify(change));
  }
});

test("changes replay in order, so a save then a delete leaves nothing, and a delete then a save leaves the weigh-in", () => {
  const log = serverLog();
  const save = { op: "save-weight", date: "2026-11-22", weight: 84.1, note: null };
  const remove = { op: "delete-weight", date: "2026-11-22" };
  assert.deepEqual(applyOps(log, [save, remove]).entries.map(entry => entry.date), ["2026-11-20", "2026-11-21"]);
  assert.deepEqual(applyOps(log, [remove, save]).entries.at(-1), { date: "2026-11-22", weight: 84.1, note: null });
  // The last write to a date wins, and an edit after a delete finds nothing to change.
  assert.equal(applyOps(log, [save, { ...save, weight: 83.9 }]).entries.at(-1).weight, 83.9);
  assert.deepEqual(applyOps(log, [remove, { op: "update-weight", date: "2026-11-22", weight: 83.9, note: null }]).entries.map(entry => entry.date), ["2026-11-20", "2026-11-21"]);
  // A goal set then cleared, and units changed twice, end at the last change.
  const goal = { weight: 78, startDate: "2026-11-21", startWeight: 84.4, rate: null, milestones: 10 };
  assert.equal(applyOps(log, [{ op: "set-goal", goal }, { op: "clear-goal" }]).goal, null);
  assert.equal(applyOps(log, [{ op: "set-units", units: { weight: "lb", height: "cm" } }, { op: "set-units", units: { weight: "st", height: "cm" } }]).units.weight, "st");
});

test("a change that can't apply is skipped, and the rest still show", () => {
  const log = serverLog();
  const result = applyOps(log, [{ op: "save-weight", date: "2026-11-22", weight: 84 }, { op: "save-weight", date: "not a date", weight: 84 }, { op: "nonsense" }, { op: "set-height", height: 181 }]);
  assert.equal(result.entries.at(-1).date, "2026-11-22");
  assert.equal(result.height, 181);
  assert.deepEqual(applyOps(log, []), log);
});

test("preferences default to showing BMI and body fat, and keep each valid value", () => {
  assert.deepEqual(Object.keys(PREFERENCE_KEYS), ["showBmi", "showBodyFat"]);
  assert.deepEqual(normalizePreferences(undefined), { showBmi: true, showBodyFat: true });
  assert.deepEqual(normalizePreferences({}), { showBmi: true, showBodyFat: true });
  // A partial set fills the rest with defaults, and a bad value falls back on its own.
  assert.deepEqual(normalizePreferences({ showBmi: false }), { showBmi: false, showBodyFat: true });
  assert.deepEqual(normalizePreferences({ showBodyFat: false }), { showBmi: true, showBodyFat: false });
  assert.deepEqual(normalizePreferences({ showBmi: "false", showBodyFat: false }), { showBmi: true, showBodyFat: false });
  assert.deepEqual(normalizePreferences({ showBmi: 0, showBodyFat: null }), { showBmi: true, showBodyFat: true });
  // Keys this version doesn't know are left out, and so is anything inherited.
  assert.deepEqual(normalizePreferences({ showBmi: false, hideNumbers: true }), { showBmi: false, showBodyFat: true });
  assert.deepEqual(normalizePreferences(Object.create({ showBmi: false })), { showBmi: true, showBodyFat: true });
  for (const value of [null, "showBmi", 5, true, [false, false]]) assert.deepEqual(normalizePreferences(value), { showBmi: true, showBodyFat: true }, JSON.stringify(value));
});

test("preferences survive normalizing, and alone don't start a log", () => {
  const state = normalizeState({ preferences: { showBmi: false, showBodyFat: true } });
  assert.deepEqual(state.preferences, { showBmi: false, showBodyFat: true });
  assert.deepEqual(normalizeState(state), state);
  assert.equal(state.started, false);
  assert.deepEqual(normalizeState(null).preferences, { showBmi: true, showBodyFat: true });
});

test("a change to preferences needs at least one key, each known and of the right type", () => {
  assert.equal(validPreference("showBmi", false), true);
  assert.equal(validPreference("showBmi", "false"), false);
  assert.equal(validPreference("toString", true), false);
  assert.deepEqual(preferencesChange({ showBodyFat: false }), { showBodyFat: false });
  assert.deepEqual(preferencesChange({ showBmi: true, showBodyFat: false }), { showBmi: true, showBodyFat: false });
  for (const value of [undefined, null, {}, [], "showBmi", { showBmi: 1 }, { showBmi: null }, { showBmi: false, extra: true }, { hideNumbers: true }, JSON.parse('{"__proto__": {"showBmi": false}}')]) {
    assert.equal(preferencesChange(value), null, JSON.stringify(value));
  }
});

test("the agreement to the health data policy is a version and the time the server received it", () => {
  assert.match(CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}$/, "the policy's date");
  assert.deepEqual(normalizeConsent({ version: CONSENT_VERSION, at: "2026-11-23T09:41:00Z", extra: 1 }), { version: CONSENT_VERSION, at: "2026-11-23T09:41:00Z" });
  assert.deepEqual(normalizeConsent({ version: CONSENT_VERSION }), { version: CONSENT_VERSION, at: null }, "made on this device, not synced yet");
  assert.deepEqual(normalizeConsent({ version: "2025-01-01", at: "not a time" }), { version: "2025-01-01", at: null });
  for (const value of [null, undefined, {}, { version: "" }, { version: 20261123 }, { version: "a b" }, { version: "x".repeat(33) }, "2026-11-23"]) {
    assert.equal(normalizeConsent(value), null, JSON.stringify(value));
  }
});

test("a log has consent only for the current version, and agreeing doesn't start it", () => {
  const empty = normalizeState({});
  assert.equal(empty.consent, null);
  assert.equal(hasConsent(empty), false);
  assert.equal(hasConsent(null), false);
  assert.equal(hasConsent(normalizeState({ consent: { version: "2025-01-01", at: "2025-01-01T00:00:00Z" } })), false, "an older policy");
  const agreed = applyOp(empty, { op: "consent", version: CONSENT_VERSION });
  assert.deepEqual(agreed.consent, { version: CONSENT_VERSION, at: null });
  assert.equal(hasConsent(agreed), true);
  assert.equal(agreed.started, false, "so a browser's old log can still move in");
  assert.deepEqual({ ...agreed, consent: null }, empty, "it changes nothing else");
  // Agreeing again keeps the time the server recorded, as the server does.
  const recorded = normalizeState({ consent: { version: CONSENT_VERSION, at: "2026-11-23T09:41:00Z" } });
  assert.equal(applyOp(recorded, { op: "consent", version: CONSENT_VERSION }), recorded);
  // An agreement to a version this app doesn't show is turned down, and skipped among others.
  assert.throws(() => applyOp(empty, { op: "consent", version: "2025-01-01" }));
  assert.throws(() => applyOp(empty, { op: "consent" }));
  assert.equal(applyOps(empty, [{ op: "consent", version: "old" }, { op: "save-weight", date: "2026-11-21", weight: 65 }]).consent, null);
});

test("an agreement replaces an earlier one that failed, and nothing else", () => {
  assert.equal(changeTarget({ op: "consent", version: CONSENT_VERSION }), "consent");
  assert.notEqual(changeTarget({ op: "consent", version: CONSENT_VERSION }), changeTarget({ op: "set-units", units: {} }));
});

test("the log bar offers today's weigh-in, then shows it in the chosen unit", async () => {
  const { todayLabel } = await import("../dist/model.mjs");
  const entries = [{ date: "2026-11-22", weight: 85.2, note: null }, { date: "2026-11-23", weight: 84.94, note: "after travel" }];
  assert.deepEqual(todayLabel([], "2026-11-23"), { text: "Log today’s weight", spoken: "Log today’s weight" });
  // Yesterday's weigh-in doesn't count, nor does one dated after today.
  assert.equal(todayLabel(entries.slice(0, 1), "2026-11-23", "kg").text, "Log today’s weight");
  assert.equal(todayLabel(entries, "2026-11-21", "kg").text, "Log today’s weight");
  // Screen readers get the label as shown, so voice control finds it by what it
  // says, with stones read out in full after it.
  assert.deepEqual(todayLabel(entries, "2026-11-23", "kg"), { text: "Today 84.9 kg · Edit", spoken: "Today 84.9 kg · Edit" });
  assert.deepEqual(todayLabel(entries, "2026-11-23", "lb"), { text: "Today 187.3 lb · Edit", spoken: "Today 187.3 lb · Edit" });
  assert.deepEqual(todayLabel(entries, "2026-11-23", "st"), { text: "Today 13 st 5.3 lb · Edit", spoken: "Today 13 st 5.3 lb · Edit (13 stone 5.3 pounds)" });
  // The weight reads as it does everywhere else, rounded to 0.1 of the unit.
  assert.equal(todayLabel([{ date: "2026-11-23", weight: 84.95 }], "2026-11-23", "kg").text, "Today " + formatWeight(84.95, "kg") + " · Edit");
  assert.equal(todayLabel([{ date: "2026-11-23", weight: 1234.5 }], "2026-11-23", "lb").text, "Today 2,721.6 lb · Edit");
});

test("the log sheet's heading names today with its weekday", async () => {
  const { todayHeading } = await import("../dist/model.mjs");
  assert.equal(todayHeading("2026-11-23"), "Today, Mon Nov 23");
  assert.equal(todayHeading("2027-01-01"), "Today, Fri Jan 1");
  // Calendar dates, whatever the time zone the tests run in.
  assert.equal(todayHeading("2026-03-08"), "Today, Sun Mar 8");
});

test("a new account's units come from the browser's region: pounds in the US, kilograms elsewhere", async () => {
  const { defaultUnits } = await import("../dist/model.mjs");
  assert.deepEqual(defaultUnits("en-US"), { weight: "lb", height: "ft" });
  assert.deepEqual(defaultUnits("es-US"), { weight: "lb", height: "ft" }, "the region decides, not the language");
  assert.deepEqual(defaultUnits("en_US"), { weight: "lb", height: "ft" }, "some browsers report an underscore");
  // The UK and Ireland get kilograms, with stones beside them on the first-run screen.
  assert.deepEqual(defaultUnits("en-GB"), { weight: "kg", height: "cm" });
  assert.deepEqual(defaultUnits("en-IE"), { weight: "kg", height: "cm" });
  assert.deepEqual(defaultUnits("de-DE"), { weight: "kg", height: "cm" });
  assert.deepEqual(defaultUnits("zh-Hant-TW"), { weight: "kg", height: "cm" });
  // A locale without a region doesn't say where, and junk falls back to the default.
  assert.deepEqual(defaultUnits("en"), { weight: "kg", height: "cm" });
  for (const junk of ["", "not a locale!", "en-", "e", undefined, null, 42, {}]) {
    assert.deepEqual(defaultUnits(junk), { weight: "kg", height: "cm" }, String(junk));
  }
  // Each call gives a fresh object, so changing one never changes the default.
  const units = defaultUnits("fr-FR");
  units.weight = "st";
  assert.deepEqual(normalizeUnits(null), { weight: "kg", height: "cm" });
});

const checkLog = (...items) => items.map(([date, weight]) => ({ date, weight, note: null }));

test("a weigh-in that reads right in another unit is a likely unit mix-up, in either direction", async () => {
  const { checkWeighIn } = await import("../dist/model.mjs");
  const yesterday = checkLog(["2026-11-22", 85]);
  const ask = (weight, unit, entries = yesterday) => checkWeighIn({ weight, date: "2026-11-23", entries, unit });
  // 190 typed into a kg field, from someone who weighs 190 lb.
  const pounds = ask(190, "kg");
  assert.equal(pounds.reason, "unit");
  assert.deepEqual(pounds.suggestion, { unit: "lb", weight: 86.18 });
  assert.deepEqual(pounds.reference, { kind: "weigh-in", weight: 85, date: "2026-11-22", age: 1, last: true });
  assert.ok(Math.abs(pounds.change - (190 / 85 - 1)) < 1e-12);
  // 13 typed into a kg field, from someone who weighs 13 stone.
  assert.deepEqual(ask(13, "kg").suggestion, { unit: "st", weight: 82.55 });
  // The other way: 85 typed into a pounds field, which saves 38.56 kg.
  const kilos = ask(roundWeight(85 * KG_PER_LB), "lb");
  assert.equal(kilos.reason, "unit");
  assert.deepEqual(kilos.suggestion, { unit: "kg", weight: 85 });
  assert.deepEqual(ask(roundWeight(13.4 * KG_PER_LB), "lb").suggestion, { unit: "st", weight: 85.09 }, "13.4 lb read as 13.4 stone");
  // Into a stones field: 85 st, from someone who weighs 85 kg, and 187 st from someone who weighs 187 lb.
  assert.deepEqual(ask(roundWeight(85 * 14 * KG_PER_LB), "st").suggestion, { unit: "kg", weight: 85 });
  assert.deepEqual(ask(roundWeight(187 * 14 * KG_PER_LB), "st").suggestion, { unit: "lb", weight: 84.82 });
});

test("a weigh-in that reads right with the decimal point moved is a likely slip", async () => {
  const { checkWeighIn } = await import("../dist/model.mjs");
  const entries = checkLog(["2026-11-22", 84.9]);
  const ask = (weight, unit) => checkWeighIn({ weight, date: "2026-11-23", entries, unit });
  const tenTimes = ask(849, "kg");
  assert.equal(tenTimes.reason, "decimal");
  assert.deepEqual(tenTimes.suggestion, { unit: "kg", weight: 84.9 });
  assert.deepEqual(ask(8.5, "kg").suggestion, { unit: "kg", weight: 85 });
  // In pounds: 1872 for 187.2 lb, saved as 187.2 lb would be.
  const pounds = ask(roundWeight(1872 * KG_PER_LB), "lb");
  assert.equal(pounds.reason, "decimal");
  assert.deepEqual(pounds.suggestion, { unit: "lb", weight: roundWeight(187.2 * KG_PER_LB) });
  assert.equal(ask(roundWeight(1872 * KG_PER_LB), "lb").suggestion.weight, 84.91);
  // A unit mix-up is tried first, so 190 is pounds before it's anything else.
  assert.equal(ask(190, "kg").reason, "unit");
});

test("anything else far from the reference is a jump, and nearer is no question", async () => {
  const { checkWeighIn } = await import("../dist/model.mjs");
  const entries = checkLog(["2026-11-22", 84.9]);
  const ask = (weight, unit = "kg") => checkWeighIn({ weight, date: "2026-11-23", entries, unit });
  const jump = ask(79);
  assert.equal(jump.reason, "jump");
  assert.equal(jump.suggestion, null);
  assert.equal(Math.round(jump.change * 100), -7);
  assert.equal(ask(120).reason, "jump");
  assert.equal(ask(82), null, "3.4% below");
  assert.equal(ask(87.5), null, "3.1% above");
  // Exactly 5% is allowed, and a hair over isn't.
  const hundred = checkLog(["2026-11-22", 100]);
  for (const [weight, asked] of [[105, false], [95, false], [105.01, true], [94.99, true]]) {
    assert.equal(checkWeighIn({ weight, date: "2026-11-23", entries: hundred, unit: "kg" }) !== null, asked, String(weight));
  }
  // The same for lb and st users, whose weights are saved in kg.
  assert.equal(ask(roundWeight(171 * KG_PER_LB), "lb").reason, "jump");
  assert.equal(ask(roundWeight(185 * KG_PER_LB), "lb"), null);
  assert.equal(ask(roundWeight(12 * 14 * KG_PER_LB), "st").reason, "jump");
  assert.equal(ask(roundWeight((13 * 14 + 5) * KG_PER_LB), "st"), null);
});

test("a gap widens the check by a point a week, and after 180 days there's no check", async () => {
  const { checkWeighIn } = await import("../dist/model.mjs");
  const entries = checkLog(["2026-01-01", 100]);
  const ask = (days, weight) => checkWeighIn({ weight, date: dateOf(dayOf("2026-01-01") + days), entries, unit: "kg" });
  // Within a week, 5%.
  assert.equal(ask(7, 105), null);
  assert.equal(ask(7, 105.5).reason, "jump");
  // Into the second week, 6%, and the third, 7%.
  assert.equal(ask(8, 105.5), null);
  assert.equal(ask(14, 106), null);
  assert.equal(ask(14, 106.5).reason, "jump");
  assert.equal(ask(15, 106.5), null);
  assert.equal(ask(15, 93), null);
  assert.equal(ask(15, 92.9).reason, "jump");
  // At 180 days, 30%. A unit mix-up still shows, since it's further off than that.
  assert.equal(ask(180, 129), null);
  assert.equal(ask(180, 131).reason, "jump");
  assert.equal(ask(180, 220).reason, "unit");
  // Past 180 days the last weigh-in says too little.
  assert.equal(ask(181, 220), null);
});

test("the reference is the 14-day average before the date, or the nearest weigh-in before it", async () => {
  const { checkWeighIn, weighInReference } = await import("../dist/model.mjs");
  // A first weigh-in has nothing to check against, nor one dated before every other.
  assert.equal(checkWeighIn({ weight: 190, date: "2026-11-23", entries: [], unit: "kg" }), null);
  assert.equal(checkWeighIn({ weight: 190, date: "2026-11-01", entries: checkLog(["2026-11-22", 85]), unit: "kg" }), null);
  // Two or more weigh-ins in the 13 days before: their average. Older ones don't count.
  const entries = checkLog(["2026-11-01", 60], ["2026-11-10", 84], ["2026-11-20", 86], ["2026-11-22", 85]);
  assert.deepEqual(weighInReference(entries, "2026-11-23"), { kind: "average", weight: 85, date: "2026-11-23", age: 1, last: true });
  // The date's own weigh-in, which a save replaces, doesn't count, nor do later ones.
  const editing = [...entries, { date: "2026-11-23", weight: 190, note: null }, { date: "2026-11-25", weight: 70, note: null }];
  assert.deepEqual(weighInReference(editing, "2026-11-23"), { kind: "average", weight: 85, date: "2026-11-23", age: 1, last: false });
  assert.equal(checkWeighIn({ weight: 190, date: "2026-11-23", entries: editing, unit: "kg" }).reason, "unit");
  // With only one weigh-in in those days, it's that weigh-in.
  assert.deepEqual(weighInReference(entries, "2026-11-16"), { kind: "weigh-in", weight: 84, date: "2026-11-10", age: 6, last: false });
  // With none, the nearest before, however old, and its age widens the check.
  assert.deepEqual(weighInReference(checkLog(["2026-09-01", 90], ["2026-11-23", 80]), "2026-11-20"), { kind: "weigh-in", weight: 90, date: "2026-09-01", age: 80, last: false });
  // Nothing to check without a weight or a date.
  for (const weight of [0, -1, NaN, null, "85"]) assert.equal(checkWeighIn({ weight, date: "2026-11-23", entries, unit: "kg" }), null, String(weight));
  assert.equal(checkWeighIn({ weight: 190, date: "2026-11-31", entries, unit: "kg" }), null);
  assert.equal(checkWeighIn({ weight: 190, date: "2026-11-23", entries, unit: "g" }), null);
});

test("the question under the weight field names the reference and what each button saves", async () => {
  const { checkWeighIn, weighInQuestion } = await import("../dist/model.mjs");
  const today = "2026-11-23";
  const ask = (weight, unit, entries, date = today) => weighInQuestion(checkWeighIn({ weight, date, entries, unit }), weight, unit, today);
  const yesterday = checkLog(["2026-11-22", 84.9]);
  const unit = ask(190, "kg", yesterday);
  assert.equal(unit.text, "That’s 124% above your last weigh-in (84.9 kg on Nov 22). Did you mean 190.0 lb?");
  assert.deepEqual(unit.choices, [
    { label: "Save as 190.0 lb", spoken: "Save as 190.0 lb", weight: 86.18, unit: "lb" },
    { label: "Save 190.0 kg", spoken: "Save 190.0 kg", weight: 190, unit: null }
  ]);
  const decimal = ask(849, "kg", yesterday);
  assert.equal(decimal.text, "Did you mean 84.9 kg?");
  assert.deepEqual(decimal.choices.map(choice => [choice.label, choice.weight, choice.unit]), [["Save 84.9 kg", 84.9, null], ["Save 849.0 kg", 849, null]]);
  const jump = ask(79, "kg", yesterday);
  assert.equal(jump.text, "That’s 7% below your last weigh-in (84.9 kg on Nov 22). Save it anyway?");
  assert.deepEqual(jump.choices.map(choice => [choice.label, choice.weight]), [["Save 79.0 kg", 79], ["Change it", null]]);
  // In the user's unit, and read out in full for stones.
  const stones = ask(roundWeight(12 * 14 * KG_PER_LB), "st", yesterday);
  assert.equal(stones.text, "That’s 10% below your last weigh-in (13 st 5.2 lb on Nov 22). Save it anyway?");
  assert.deepEqual([stones.choices[0].label, stones.choices[0].spoken], ["Save 12 st 0.0 lb", "Save 12 st 0.0 lb (12 stone 0.0 pounds)"]);
  // A stones user asked about pounds hears the pounds as shown.
  const pounds = ask(roundWeight(190 * 14 * KG_PER_LB), "st", yesterday);
  assert.deepEqual(pounds.choices.map(choice => [choice.label, choice.spoken]), [["Save as 190.0 lb", "Save as 190.0 lb"], ["Save 190 st 0.0 lb", "Save 190 st 0.0 lb (190 stone 0.0 pounds)"]]);
  const kilos = ask(roundWeight(85 * KG_PER_LB), "lb", yesterday);
  assert.equal(kilos.text, "That’s 55% below your last weigh-in (187.2 lb on Nov 22). Did you mean 85.0 kg?");
  assert.deepEqual(kilos.choices.map(choice => [choice.label, choice.unit]), [["Save as 85.0 kg", "kg"], ["Save 85.0 lb", null]]);
  // An average, today or on an earlier date, and a weigh-in before a later one.
  const daily = checkLog(["2026-11-20", 85], ["2026-11-22", 84.8]);
  assert.equal(ask(79, "kg", daily).text, "That’s 7% below your 14-day average (84.9 kg). Save it anyway?");
  assert.equal(ask(79, "kg", [...daily, ...checkLog(["2026-11-23", 85])], "2026-11-23").text, "That’s 7% below your 14-day average (84.9 kg). Save it anyway?");
  const backdated = checkLog(["2026-11-01", 85], ["2026-11-03", 85], ["2026-11-23", 84]);
  assert.equal(ask(79, "kg", backdated, "2026-11-05").text, "That’s 7% below your 14-day average on Nov 5 (85.0 kg). Save it anyway?");
  assert.equal(ask(79, "kg", checkLog(["2026-11-01", 85], ["2026-11-23", 84]), "2026-11-05").text, "That’s 7% below your previous weigh-in (85.0 kg on Nov 1). Save it anyway?");
  // A date in another year shows its year.
  assert.equal(ask(79, "kg", checkLog(["2025-12-30", 85]), "2026-01-02").text.includes("(85.0 kg on Dec 30, 2025)"), true);
});

test("the overview's state: an empty log, one with a weigh-in in the last 14 days, and one back after a break", async () => {
  const { logStatus } = await import("../dist/model.mjs");
  const today = "2026-11-23";
  const log = (...items) => items.map(([date, weight]) => ({ date, weight, note: null }));
  assert.deepEqual(logStatus([], today), { kind: "empty", lastDate: null, daysAgo: null, lastAverage: null });
  // A weigh-in today, or 13 days ago, keeps the log active.
  assert.deepEqual(logStatus(log(["2026-11-20", 85], ["2026-11-23", 84]), today), { kind: "active", lastDate: "2026-11-23", daysAgo: 0, lastAverage: 84.5 });
  assert.deepEqual(logStatus(log(["2026-11-10", 85]), today), { kind: "active", lastDate: "2026-11-10", daysAgo: 13, lastAverage: 85 });
  // Exactly 14 days ago is outside the 14 days through today, which have no average.
  const fortnight = log(["2026-11-01", 86], ["2026-11-09", 85]);
  assert.deepEqual(logStatus(fortnight, today), { kind: "lapsed", lastDate: "2026-11-09", daysAgo: 14, lastAverage: 85.5 });
  assert.equal(calculateTrend(fortnight, today).current, null);
  // 23 days: the average is the one on the last weigh-in's date, from the 14 days up to it.
  const lapsed = log(["2026-10-10", 90], ["2026-10-20", 87], ["2026-10-25", 86.4], ["2026-10-31", 86]);
  assert.deepEqual(logStatus(lapsed, today), { kind: "lapsed", lastDate: "2026-10-31", daysAgo: 23, lastAverage: (8700 + 8640 + 8600) / 300 });
  // Weigh-ins dated after today don't count until their day comes.
  assert.deepEqual(logStatus(log(["2026-11-24", 85]), today), { kind: "empty", lastDate: null, daysAgo: null, lastAverage: null });
  assert.equal(logStatus(log(["2026-11-24", 85]), "2026-11-24").kind, "active");
  assert.deepEqual(logStatus([...lapsed, ...log(["2026-11-24", 85])], today), logStatus(lapsed, today));
  // The first weigh-in after a break ends it.
  assert.equal(logStatus([...lapsed, ...log([today, 85.5])], today).kind, "active");
});

test("the weekly trend has shown once 8 weigh-ins fit in 3 weeks and span 2", async () => {
  const { weeklyTrendShown } = await import("../dist/model.mjs");
  const daily = (from, count) => Array.from({ length: count }, (_, i) => entry(from + i, 80));
  // 8 weigh-ins over 13 days, then and later; over 12 days isn't enough.
  const spread = [0, 2, 4, 6, 8, 10, 12, 13].map(day => entry(day, 80));
  assert.equal(weeklyTrendShown(spread, dateOf(first + 13)), true);
  assert.equal(weeklyTrendShown(spread, dateOf(first + 300)), true);
  assert.equal(weeklyTrendShown(spread, dateOf(first + 12)), false);
  assert.equal(weeklyTrendShown(daily(0, 13), dateOf(first + 300)), false);
  // 8 weigh-ins over 21 days don't fit in the 3 weeks.
  assert.equal(weeklyTrendShown([0, 3, 6, 9, 12, 15, 18, 21].map(day => entry(day, 80)), dateOf(first + 21)), false);
  assert.equal(weeklyTrendShown([], dateOf(first)), false);
  // The same answer as asking calculateRate on every day, for logs with gaps.
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 60; trial++) {
    const chance = 0.15 + random() * 0.5;
    const entries = Array.from({ length: 80 }, (_, i) => i).filter(() => random() < chance).map(day => entry(day, 80 + random()));
    for (const end of [10, 25, 40, 79]) {
      const throughDate = dateOf(first + end);
      let shown = false;
      for (let day = 0; day <= end; day++) shown ||= calculateRate(entries, dateOf(first + day)) !== null;
      assert.equal(weeklyTrendShown(entries, throughDate), shown, "trial " + trial + " through day " + end);
    }
  }
});

test("undoing a deletion saves again exactly what was deleted", async () => {
  const { applyOp, inverseOf } = await import("../dist/model.mjs");
  // 13 st 5.2 lb, stored to the hundredth of a kilogram.
  const stones = roundWeight((13 * 14 + 5.2) * KG_PER_LB);
  assert.equal(stones, 84.91);
  const before = normalizeState({
    started: true, sex: "female", height: 165,
    goal: { weight: 70.5, startDate: "2026-09-01", startWeight: 84.37, rate: 0.47, milestones: 7 },
    entries: [{ date: "2026-11-21", weight: 85.12, note: null }, { date: "2026-11-22", weight: stones, note: "after travel" }, { date: "2026-11-23", weight: 84.6, note: null }],
    waists: [{ date: "2026-11-01", waist: 86.61 }, { date: "2026-11-15", waist: 85.09 }]
  });
  const undo = change => {
    const inverse = inverseOf(change, before);
    return { inverse, restored: applyOp(applyOp(before, change), inverse) };
  };

  // A weigh-in comes back with its weight in kg as stored and its note.
  const weighIn = undo({ op: "delete-weight", date: "2026-11-22" });
  assert.deepEqual(weighIn.inverse, { op: "save-weight", date: "2026-11-22", weight: 84.91, note: "after travel" });
  assert.deepEqual(weighIn.restored, before);
  // Without a note, the inverse says so, rather than leaving the date's note as it is.
  assert.deepEqual(inverseOf({ op: "delete-weight", date: "2026-11-21" }, before), { op: "save-weight", date: "2026-11-21", weight: 85.12, note: null });

  // A waist comes back as stored, with the formula's sex.
  const waist = undo({ op: "delete-waist", date: "2026-11-01" });
  assert.deepEqual(waist.inverse, { op: "save-waist", date: "2026-11-01", waist: 86.61, sex: "female" });
  assert.deepEqual(waist.restored, before);

  // A goal comes back whole: weight, start date, start weight, rate and milestones.
  const goal = undo({ op: "clear-goal" });
  assert.deepEqual(goal.inverse, { op: "set-goal", goal: { weight: 70.5, startDate: "2026-09-01", startWeight: 84.37, rate: 0.47, milestones: 7 } });
  assert.deepEqual(goal.restored, before);
  // A goal without a target rate keeps none.
  const noRate = normalizeState({ ...before, goal: { ...before.goal, rate: null } });
  assert.deepEqual(inverseOf({ op: "clear-goal" }, noRate).goal, { ...noRate.goal, rate: null });
  // The inverse is a copy, so changing it doesn't change the log it came from.
  goal.inverse.goal.weight = 1;
  assert.equal(before.goal.weight, 70.5);
});

test("only deletions of a weigh-in, a waist or the goal can be undone, and only when there was something to delete", async () => {
  const { inverseOf } = await import("../dist/model.mjs");
  const before = normalizeState({
    started: true, sex: "male",
    goal: { weight: 80, startDate: "2026-09-01", startWeight: 90, rate: 0.5, milestones: 10 },
    entries: [{ date: "2026-11-22", weight: 85, note: null }], waists: [{ date: "2026-11-01", waist: 90 }]
  });
  // Nothing on that date, or no goal.
  assert.equal(inverseOf({ op: "delete-weight", date: "2026-11-21" }, before), null);
  assert.equal(inverseOf({ op: "delete-waist", date: "2026-11-02" }, before), null);
  assert.equal(inverseOf({ op: "clear-goal" }, { ...before, goal: null }), null);
  // A waist without a formula can't be saved again.
  assert.equal(inverseOf({ op: "delete-waist", date: "2026-11-01" }, { ...before, sex: null }), null);
  // Reminders and deleting the whole log or account have no undo, nor do saves and edits.
  for (const change of [{ op: "clear-reminder" }, { op: "delete-data", confirm: "delete" }, { op: "delete-account", confirm: "delete" },
    { op: "save-weight", date: "2026-11-22", weight: 84 }, { op: "update-weight", date: "2026-11-22", weight: 84 }, { op: "set-goal", goal: before.goal }, { op: "set-height", height: 180 }]) {
    assert.equal(inverseOf(change, before), null, change.op);
  }
  assert.equal(inverseOf(null, before), null);
  assert.equal(inverseOf({ op: "delete-weight", date: "2026-11-22" }, null), null);
});

test("a goal saved before the cap on the target rate can't be set again as it was, so its removal has no undo", async () => {
  const { inverseOf } = await import("../dist/model.mjs");
  // 1.5% of 90 kg is 1.35 kg a week.
  const goal = rate => normalizeState({ started: true, goal: { weight: 80, startDate: "2026-09-01", startWeight: 90, rate, milestones: 10 } });
  assert.equal(maxGoalRate(90), 1.35);
  assert.equal(inverseOf({ op: "clear-goal" }, goal(2)), null);
  assert.equal(inverseOf({ op: "clear-goal" }, goal(1.352)), null);
  // At the cap, or within the slack a rate typed in pounds can need, it's fine.
  assert.equal(inverseOf({ op: "clear-goal" }, goal(1.35)).goal.rate, 1.35);
  assert.equal(inverseOf({ op: "clear-goal" }, goal(1.351)).goal.rate, 1.351);
});
