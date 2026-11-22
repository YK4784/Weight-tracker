import assert from "node:assert/strict";
import test from "node:test";
import { bmi, calculateRate, calculateTrend, dateOf, dayOf, normalizeState, saveWeight, shiftDate, validDate } from "../dist/model.mjs";

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
  const { current, readings: points } = calculateTrend(readings, readings.at(-1).date);
  assert.equal(current.count, 14);
  assert.equal(current.average, 77.5);
  assert.equal(points.at(-1).change, 1);
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
  assert.equal(trend.readings.at(-1).change, -1.2);
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
