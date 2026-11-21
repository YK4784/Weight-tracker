import assert from "node:assert/strict";
import test from "node:test";
import { bmi, calculateTrend, dateOf, dayOf, normalizeState, saveWeight, validDate } from "../dist/model.mjs";

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

test("empty and future-only logs have no current average", () => {
  const empty = { days: [], readings: [], current: null };
  assert.deepEqual(calculateTrend([], dateOf(first)), empty);
  assert.deepEqual(calculateTrend([entry(1, 70)], dateOf(first)), empty);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2028-02-29"), true);
});
