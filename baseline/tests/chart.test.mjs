import assert from "node:assert/strict";
import test from "node:test";
import { calendarTicks, lineParts, nearestIndex, rangeStart, roomForStems, separateLabel, stoneTick, weekdayOf, weekends, yDomain } from "../dist/chart.mjs";
import { THIN_COUNT, calculateTrend, dateOf, dayOf } from "../dist/model.mjs";

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

// The line's pieces for weigh-ins on `days` (counted from 1 Mar 2026), through `through`.
const partsFor = (days, through) => {
  const start = dayOf("2026-03-01");
  const entries = days.map(day => ({ date: dateOf(start + day), weight: 80, note: null }));
  return lineParts(calculateTrend(entries, dateOf(start + through)).days)
    .map(part => [part.thin, part.points[0].day - start, part.points.at(-1).day - start]);
};

test("the line is thin until its average rests on 4 weigh-ins", () => {
  assert.equal(THIN_COUNT, 4);
  // Daily weigh-ins: days 0–2 have 1–3 of them, so the line into day 3 is the last thin piece.
  assert.deepEqual(partsFor([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 9), [[true, 0, 3], [false, 3, 9]]);
  // Weekly weigh-ins never have more than 2 in 14 days.
  assert.deepEqual(partsFor([0, 7, 14, 21, 28], 28), [[true, 0, 28]]);
  // As older weigh-ins leave the window, a sparse log can thin out again: day
  // 16's average has days 3, 9 and 16. Days 10–15 hold day 9's, from 5.
  assert.deepEqual(partsFor([0, 1, 2, 3, 9, 16], 16), [[true, 0, 3], [false, 3, 15], [true, 15, 16]]);
});

test("after a run's last weigh-in, the line is thin and holds, and a gap of 14 days breaks it", () => {
  // Daily to day 9, then three days without one: thin from day 9.
  assert.deepEqual(partsFor([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 12), [[true, 0, 3], [false, 3, 9], [true, 9, 12]]);
  // Days 10–22 hold day 9's average, day 23 has none, and a new run starts on day 30.
  assert.deepEqual(partsFor([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 31, 32, 33, 34], 34), [[true, 0, 3], [false, 3, 9], [true, 9, 22], [true, 30, 33], [false, 33, 34]]);
  // Days without a weigh-in inside a run aren't after its last one.
  assert.deepEqual(partsFor([0, 1, 2, 3, 4, 5, 9, 10], 10), [[true, 0, 3], [false, 3, 10]]);
});

test("a range that shows only the days after a weigh-in draws them thin, and one day is a piece of its own", () => {
  const start = dayOf("2026-03-01");
  const entries = [0, 1, 2, 3, 4].map(day => ({ date: dateOf(start + day), weight: 80, note: null }));
  const held = calculateTrend(entries, dateOf(start + 10)).days.filter(point => point.day >= start + 6);
  assert.deepEqual(lineParts(held).map(part => [part.thin, part.points.length]), [[true, 5]]);
  assert.deepEqual(lineParts(held.slice(-1)).map(part => [part.thin, part.points.length]), [[true, 1]]);
  assert.deepEqual(partsFor([0], 0), [[true, 0, 0]], "a first weigh-in");
  assert.deepEqual(lineParts([]), []);
  // Neighbouring pieces share a point, so the line stays joined.
  const parts = lineParts(calculateTrend(entries, dateOf(start + 8)).days);
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].points[0], parts[i - 1].points.at(-1));
});

// Dates as days, and back, for the calendar tests.
const days = (...dates) => dates.map(dayOf);
const datesOf = ticks => ticks.map(tick => dateOf(tick.day));
const labelsOf = ticks => ticks.map(tick => tick.label);

test("days of the week count from 1970-01-01, a Thursday", () => {
  assert.equal(weekdayOf(0), 4);
  assert.equal(weekdayOf(dayOf("2026-11-22")), 0, "a Sunday");
  assert.equal(weekdayOf(dayOf("2026-11-24")), 2, "a Tuesday");
  assert.equal(weekdayOf(dayOf("2026-11-28")), 6, "a Saturday");
  assert.equal(weekdayOf(-1), 3, "before 1970 too");
});

test("weekends are each Saturday and Sunday, cut short at either end", () => {
  const pairs = (start, end) => weekends(dayOf(start), dayOf(end)).map(pair => pair.map(dateOf));
  // Wednesday to the Tuesday two weeks on.
  assert.deepEqual(pairs("2026-11-18", "2026-12-01"), [["2026-11-21", "2026-11-22"], ["2026-11-28", "2026-11-29"]]);
  assert.deepEqual(pairs("2026-11-22", "2026-11-28"), [["2026-11-22", "2026-11-22"], ["2026-11-28", "2026-11-28"]], "starts on a Sunday, ends on a Saturday");
  assert.deepEqual(pairs("2026-11-23", "2026-11-27"), [], "Monday to Friday");
  assert.deepEqual(pairs("2026-11-21", "2026-11-21"), [["2026-11-21", "2026-11-21"]], "one Saturday");
});

test("up to two months, the dates are Mondays", () => {
  const [start, end] = days("2026-10-26", "2026-11-24");
  const { by, ticks } = calendarTicks(start, end, 5);
  assert.equal(by, "weeks");
  assert.deepEqual(datesOf(ticks), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  assert.deepEqual(labelsOf(ticks), ["Oct 26", "Nov 2", "Nov 9", "Nov 16", "Nov 23"]);
  assert.ok(ticks.every(tick => weekdayOf(tick.day) === 1));
});

test("thinned Mondays keep to the calendar, so they stay put as the range moves", () => {
  for (let shift = 0; shift < 14; shift++) {
    const start = dayOf("2026-10-26") + shift;
    const { by, ticks } = calendarTicks(start, start + 43, 4);
    assert.equal(by, "weeks");
    assert.ok(ticks.length >= 2 && ticks.length <= 4, "shift " + shift);
    for (const tick of ticks) {
      assert.equal(weekdayOf(tick.day), 1);
      // Every other Monday, counted from 1970-01-05.
      assert.equal((tick.day - 4) / 7 % 2, 0, dateOf(tick.day));
    }
  }
  // Too many for every other Monday: every fourth.
  const [start, end] = days("2026-09-24", "2026-11-24");
  const thin = calendarTicks(start, end, 3).ticks;
  assert.ok(thin.length <= 3);
  assert.ok(thin.slice(1).every((tick, i) => tick.day - thin[i].day === 28));
});

test("a short span without a Monday is labelled at its ends", () => {
  const [tuesday, saturday] = days("2026-11-24", "2026-11-28");
  assert.deepEqual(calendarTicks(tuesday, saturday, 5), { by: "days", ticks: [{ day: tuesday, label: "Nov 24" }, { day: saturday, label: "Nov 28" }] });
  assert.deepEqual(calendarTicks(tuesday, tuesday, 5), { by: "days", ticks: [{ day: tuesday, label: "Nov 24" }] }, "one day");
});

test("longer spans are dated by month, with the year on each January", () => {
  const [start, end] = days("2026-08-27", "2026-11-24");
  const months = calendarTicks(start, end, 4);
  assert.equal(months.by, "months");
  assert.deepEqual(datesOf(months.ticks), ["2026-09-01", "2026-10-01", "2026-11-01"]);
  assert.deepEqual(labelsOf(months.ticks), ["Sep", "Oct", "Nov"]);
  const turn = calendarTicks(...days("2026-11-01", "2027-02-15"), 8);
  assert.deepEqual(labelsOf(turn.ticks), ["Nov", "Dec", "Jan 2027", "Feb"], "a year boundary");
  assert.equal(turn.ticks[0].day, dayOf("2026-11-01"), "a span that starts on the 1st includes it");
});

test("over years, months thin to every 2, 3 or 6, and then to years", () => {
  const [start, end] = days("2024-03-10", "2027-03-09");
  const every6 = calendarTicks(start, end, 8);
  assert.equal(every6.by, "months");
  assert.deepEqual(labelsOf(every6.ticks), ["Jul", "Jan 2025", "Jul", "Jan 2026", "Jul", "Jan 2027"]);
  const every3 = calendarTicks(...days("2025-11-25", "2026-11-24"), 4);
  assert.deepEqual(labelsOf(every3.ticks), ["Jan 2026", "Apr", "Jul", "Oct"]);
  const yearly = calendarTicks(start, end, 4);
  assert.equal(yearly.by, "years");
  assert.deepEqual(labelsOf(yearly.ticks), ["2025", "2026", "2027"]);
  assert.deepEqual(datesOf(yearly.ticks), ["2025-01-01", "2026-01-01", "2027-01-01"]);
  const decade = calendarTicks(...days("2005-06-01", "2026-11-24"), 6);
  assert.equal(decade.by, "years");
  assert.deepEqual(labelsOf(decade.ticks), ["2010", "2015", "2020", "2025"]);
});

test("lines from weigh-ins to the average need their weigh-ins 5 px apart, at the median", () => {
  const daily = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(roomForStems(daily, 8.6), true, "30 days on a phone");
  assert.equal(roomForStems(daily, 5), true);
  assert.equal(roomForStems(daily, 4.9), false, "too close");
  assert.equal(roomForStems(daily.map(day => day * 7), 1), true, "weekly weigh-ins on a long range");
  assert.equal(roomForStems([3], 0.5), true, "one weigh-in");
  assert.equal(roomForStems([], 0.5), true);
  // Mostly daily with a few long breaks: the breaks don't make room.
  assert.equal(roomForStems([0, 1, 2, 3, 4, 30, 31, 32, 60], 3), false);
});
