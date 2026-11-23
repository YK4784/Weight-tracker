import assert from "node:assert/strict";
import test from "node:test";
import { nearestIndex, rangeStart, separateLabel, stoneTick, yDomain } from "../dist/chart.mjs";
import { dateOf, dayOf } from "../dist/model.mjs";

const points = [{ average: 70, weight: 70.5 }, { average: 69.8, weight: null }, { average: 69.6, weight: 69.2 }];

test("the y-axis range takes in the goal so its line stays on screen", () => {
  const plain = yDomain(points);
  assert.ok(plain.bottom > 65 && plain.top < 75);
  const below = yDomain(points, 65);
  assert.ok(below.bottom < 65 && below.top > 70.5);
  const above = yDomain(points, 75);
  assert.ok(above.bottom < 69.2 && above.top > 75);
  assert.deepEqual(yDomain(points, 70), plain, "a goal inside the data's range changes nothing");
  assert.deepEqual(yDomain(points, null), plain);
});

test("the goal label keeps clear of the average's label", () => {
  assert.equal(separateLabel(100, 140, 17, 0, 300), 100, "already clear");
  assert.equal(separateLabel(130, 140, 17, 0, 300), 123, "stays above");
  assert.equal(separateLabel(145, 140, 17, 0, 300), 157, "stays below");
  assert.equal(separateLabel(140, 140, 17, 0, 300), 157, "level goes below");
  assert.equal(separateLabel(292, 290, 17, 0, 300), 273, "no room below");
  assert.equal(separateLabel(8, 10, 17, 0, 300), 27, "no room above");
});

test("stones use grid steps of whole pounds or stones, labelled in stones and pounds", () => {
  const pounds = [{ average: 136, weight: 137.3 }, { average: 135.2, weight: 134.1 }];
  assert.equal(yDomain(pounds, null, [0.5, 1, 2, 7, 14]).step, 1);
  assert.equal(yDomain(pounds, 120, [0.5, 1, 2, 7, 14]).step, 7, "a goal two stones away widens the range");
  assert.equal(stoneTick(136), "9 st 10");
  assert.equal(stoneTick(140), "10 st");
  assert.equal(stoneTick(139.5), "9 st 13.5");
  assert.equal(stoneTick(140 - 1e-12), "10 st", "float error at a whole stone");
});

test("a minimum pad keeps a nearly flat series from filling the chart", () => {
  const flat = [{ average: 24.3, weight: null }, { average: 24.1, weight: null }];
  const padded = yDomain(flat, null, null, 1);
  assert.ok(padded.bottom <= 23.1 && padded.top >= 25.3);
  assert.equal(padded.step, 0.5);
  assert.deepEqual(yDomain(points, null, null, 0.25), yDomain(points), "the default pad is unchanged");
});

test("a pointer picks the point on its day, or the nearest one across a gap", () => {
  // Days 10 to 12, then a gap until day 20.
  const days = [10, 11, 12, 20, 21].map(day => ({ day }));
  assert.equal(nearestIndex(days, 11), 1, "an exact day");
  assert.equal(nearestIndex(days, 20), 3);
  assert.equal(nearestIndex(days, 11.4), 1, "part way through a day");
  assert.equal(nearestIndex(days, 11.6), 2);
  assert.equal(nearestIndex(days, 14), 2, "in a gap, the closer side: before it");
  assert.equal(nearestIndex(days, 18), 3, "in a gap, the closer side: after it");
  assert.equal(nearestIndex(days, 16), 2, "halfway goes to the earlier point");
  assert.equal(nearestIndex(days, 3), 0, "before the first point");
  assert.equal(nearestIndex(days, 10), 0, "the first point");
  assert.equal(nearestIndex(days, 21), 4, "the last point");
  assert.equal(nearestIndex(days, 40), 4, "after the last point");
  assert.equal(nearestIndex([{ day: 5 }], 0), 0, "a single point");
  assert.equal(nearestIndex([{ day: 5 }], 9), 0);
  assert.equal(nearestIndex([], 5), -1, "no points");
});

test("the nearest point matches a search through every point", () => {
  const days = [1, 2, 3, 7, 8, 30, 31, 32, 33, 60].map(day => ({ day }));
  for (let day = -5; day <= 65; day += .25) {
    let best = 0;
    days.forEach((point, i) => { if (Math.abs(point.day - day) < Math.abs(days[best].day - day)) best = i; });
    assert.equal(nearestIndex(days, day), best, "day " + day);
  }
});

test("a range starts as far back as it goes, but not before the first average", () => {
  const today = "2026-11-24";
  const end = dayOf(today);
  const trend = { days: [{ day: end - 50 }, { day: end }] };
  assert.equal(rangeStart(trend, "14", today), end - 13);
  assert.equal(rangeStart(trend, "30", today), end - 29);
  assert.equal(rangeStart(trend, "90", today), end - 50, "the log is shorter than the range");
  assert.equal(rangeStart(trend, "all", today), end - 50);
  assert.equal(rangeStart({ days: [] }, "30", today), end, "an empty log");
  assert.equal(dateOf(rangeStart(trend, "14", today)), "2026-11-11");
});
