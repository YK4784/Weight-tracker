export const WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const decimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFormats = new Map();

export function localToday(date = new Date()) {
  return [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

// Calendar-day arithmetic in UTC keeps the window stable across daylight-saving changes.
export function dayOf(date) {
  return Date.parse(date + "T00:00:00Z") / DAY_MS;
}

export function dateOf(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = dayOf(value);
  return Number.isInteger(day) && dateOf(day) === value;
}

// Step a date by whole days, never past `latest`. A blank or invalid date steps from `latest`.
export function shiftDate(date, delta, latest) {
  const from = validDate(date) ? dayOf(date) : dayOf(latest);
  return dateOf(Math.min(dayOf(latest), from + delta));
}

export function prettyDate(date, kind = "short") {
  if (!dateFormats.has(kind)) {
    const choices = {
      short: { month: "short", day: "numeric" },
      full: { year: "numeric", month: "short", day: "numeric" },
      weekday: { weekday: "short", month: "short", day: "numeric" },
      day: { weekday: "long", month: "long", day: "numeric" },
      monthYear: { year: "numeric", month: "short" },
      long: { weekday: "long", year: "numeric", month: "long", day: "numeric" }
    };
    dateFormats.set(kind, new Intl.DateTimeFormat("en-US", { ...choices[kind], timeZone: "UTC" }));
  }
  return dateFormats.get(kind).format(dayOf(date) * DAY_MS);
}

export function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validWeight(value) {
  return positive(value) && value >= .1 && value <= 2000;
}

export function oneDecimal(value) {
  return Number.isFinite(value) ? decimal.format(value) : "—";
}

export function bmi(weight, heightCm) {
  if (!positive(weight) || !positive(heightCm)) return null;
  return weight / (heightCm / 100) ** 2;
}

export const GOAL_MILESTONES = 10;
export const GOAL_MAX_MILESTONES = 20;
export const GOAL_MAX_RATE = 5;

// A goal is a target weight, where and when the user started, an optional
// planned rate in kg a week (a size; the direction comes from start and target)
// and how many milestones to split the distance into. Returns null if invalid.
export function normalizeGoal(value) {
  if (!validWeight(value?.weight) || !validWeight(value.startWeight) || !validDate(value.startDate)) return null;
  const rate = positive(value.rate) && value.rate >= .01 && value.rate <= GOAL_MAX_RATE ? Math.round(value.rate * 100) / 100 : null;
  const milestones = Number.isInteger(value.milestones) && value.milestones >= 1 && value.milestones <= GOAL_MAX_MILESTONES ? value.milestones : GOAL_MILESTONES;
  return { weight: Math.round(value.weight * 10) / 10, startDate: value.startDate, startWeight: Math.round(value.startWeight * 10) / 10, rate, milestones };
}

export function normalizeState(value) {
  const byDate = new Map();
  for (const item of Array.isArray(value?.entries) ? value.entries : []) {
    if (validDate(item?.date) && validWeight(item.weight)) {
      byDate.set(item.date, { date: item.date, weight: Math.round(item.weight * 10) / 10 });
    }
  }
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const height = positive(value?.height) && value.height >= .1 && value.height <= 400 ? value.height : null;
  const goal = normalizeGoal(value?.goal);
  return { version: 1, started: Boolean(value?.started || entries.length || height || goal), height, goal, entries };
}

export function saveWeight(state, date, weight) {
  if (!validDate(date) || !validWeight(weight)) throw new Error("Enter a valid date and weight.");
  return normalizeState({ ...state, started: true, entries: [...state.entries, { date, weight }] });
}

// The input is a normalized log (one entry per date, ascending). Emit averages
// for unlogged days too, while there is still a measurement inside the window.
export function calculateTrend(entries, throughDate) {
  const days = [];
  const readings = [];
  const end = dayOf(throughDate);
  const source = entries.map(entry => ({ ...entry, day: dayOf(entry.date), tenths: Math.round(entry.weight * 10) }));
  let day = source[0]?.day;
  let left = 0;
  let next = 0;
  let sum = 0;
  while (day <= end && (next < source.length || left < next)) {
    while (left < next && source[left].day < day - WINDOW_DAYS + 1) {
      sum -= source[left++].tenths;
    }
    if (left === next && next < source.length) day = Math.max(day, source[next].day);
    if (day > end) break;
    let entry = null;
    if (source[next]?.day === day) {
      entry = source[next++];
      sum += entry.tenths;
    }
    const count = next - left;
    if (count) {
      const point = { day, date: dateOf(day), weight: entry?.weight ?? null, average: sum / (count * 10), count };
      days.push(point);
      if (entry) readings.push(point);
    }
    day++;
  }
  const last = days.at(-1);
  return { days, readings, current: last?.day === end ? last : null };
}

export const CHANGE_WINDOWS = [7, 30, 90];

// How much the 14-day average has changed over each of CHANGE_WINDOWS days, and
// since the first weigh-in (`days` null), using averages rounded to the 0.1 kg
// shown on screen. `trend` comes from calculateTrend through today. A window is
// left out when there is no average exactly that many days ago: the log is
// shorter than the window, or a gap of more than 14 days leaves that day without
// one. The change since the first weigh-in needs the log to go back further than
// the longest window shown, and further than a week, so it never repeats another
// figure. Empty without an average today.
export function averageChanges(trend) {
  const now = trend.current;
  if (!now) return [];
  const byDay = new Map(trend.days.map(point => [point.day, point]));
  const since = point => (Math.round(now.average * 10) - Math.round(point.average * 10)) / 10;
  const changes = [];
  for (const days of CHANGE_WINDOWS) {
    const then = byDay.get(now.day - days);
    if (then) changes.push({ days, change: since(then) });
  }
  const first = trend.days[0];
  if (first.day < now.day - (changes.at(-1)?.days ?? CHANGE_WINDOWS[0])) changes.push({ days: null, change: since(first) });
  return changes;
}

// The highest and lowest weigh-ins in the WINDOW_DAYS days through `throughDate`
// (the same days as the 14-day average), with how many days ago each was. A tie
// goes to the most recent. Null with fewer than two weigh-ins in those days.
export function recentRange(entries, throughDate) {
  const end = dayOf(throughDate);
  const recent = entries.filter(entry => dayOf(entry.date) > end - WINDOW_DAYS && entry.date <= throughDate);
  if (recent.length < 2) return null;
  let high = recent[0];
  let low = recent[0];
  for (const entry of recent) {
    if (entry.weight >= high.weight) high = entry;
    if (entry.weight <= low.weight) low = entry;
  }
  const describe = entry => ({ date: entry.date, weight: entry.weight, daysAgo: end - dayOf(entry.date) });
  return { high: describe(high), low: describe(low) };
}

export const RATE_DAYS = 21;
export const RATE_MIN_ENTRIES = 8;
export const RATE_MIN_SPAN = 14;
// Water weight lingers for days, so neighboring weigh-ins err together and the
// textbook two standard errors calls flat logs a trend too often. 2.5 keeps that
// to about one log in six while still catching a 0.5 kg/week loss most of the time.
const RATE_CLEAR_ERRORS = 2.5;

// The input is a normalized log (one entry per date, ascending).
// Weekly rate of change: the slope of a least-squares line through the weigh-ins
// of the last RATE_DAYS calendar days. An average trails the weight by half its
// window; a fitted line does not. Needs RATE_MIN_ENTRIES weigh-ins spread over at
// least RATE_MIN_SPAN days, otherwise returns null. `clear` is false when the
// slope is too close to flat to tell apart from scale noise.
export function calculateRate(entries, throughDate) {
  const end = dayOf(throughDate);
  const points = entries
    .map(entry => [dayOf(entry.date) - end, entry.weight])
    .filter(([x]) => x > -RATE_DAYS && x <= 0);
  const n = points.length;
  if (n < RATE_MIN_ENTRIES || points.at(-1)[0] - points[0][0] < RATE_MIN_SPAN - 1) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - meanX) ** 2;
    sxy += (x - meanX) * (y - meanY);
  }
  const slope = sxy / sxx;
  let residuals = 0;
  for (const [x, y] of points) residuals += (y - meanY - slope * (x - meanX)) ** 2;
  const error = Math.sqrt(residuals / (n - 2) / sxx);
  const perWeek = Math.round(slope * 70) / 10 || 0;
  return { perWeek, clear: perWeek !== 0 && Math.abs(slope) > RATE_CLEAR_ERRORS * error, count: n };
}

// Progress toward a goal, measured with the 14-day average rounded to the 0.1 kg
// shown on screen. Works in tenths of a kilogram so every comparison is exact.
// Milestone k of n targets start − k × (start − goal) / n, and the last is the
// goal itself. A milestone is never smaller than 0.1 kg, so a short distance
// gets fewer of them. Returns null without a goal; `current` is null without an
// average to measure.
export function goalProgress(goal, average) {
  if (!goal) return null;
  const start = Math.round(goal.startWeight * 10);
  const end = Math.round(goal.weight * 10);
  const sign = Math.sign(end - start);
  const total = Math.abs(end - start);
  const count = Math.min(goal.milestones, total);
  const milestones = Array.from({ length: count }, (_, i) => {
    const index = i + 1;
    return { index, weight: (index === count ? end : Math.round(start + (end - start) * index / count)) / 10 };
  });
  const result = {
    direction: sign < 0 ? "lose" : sign > 0 ? "gain" : "maintain",
    start: start / 10, goal: end / 10, milestones,
    current: null, difference: null, toGo: null, overall: 0, completed: 0, next: null, reached: false, behindStart: 0
  };
  if (!Number.isFinite(average)) return result;
  const current = Math.round(average * 10);
  result.current = current / 10;
  result.difference = (current - end) / 10;
  if (!sign) return result;
  // How far the average has moved from the start toward the goal, in tenths.
  const done = (current - start) * sign;
  const reachedAt = weight => (Math.round(weight * 10) - start) * sign <= done;
  result.reached = done >= total;
  result.toGo = Math.max(0, total - done) / 10;
  result.overall = Math.min(1, Math.max(0, done / total));
  result.completed = milestones.filter(milestone => reachedAt(milestone.weight)).length;
  result.behindStart = Math.max(0, -done) / 10;
  const next = milestones.find(milestone => !reachedAt(milestone.weight));
  if (next) result.next = { ...next, toGo: Math.abs(Math.round(next.weight * 10) - current) / 10 };
  return result;
}

export const OVERALL_MIN_DAYS = 14;

// The 14-day average's change since the goal's start, in kg a week, rounded to
// 0.1 like the weekly trend. Waits OVERALL_MIN_DAYS after the start date, so
// the current average no longer shares most of its weigh-ins with the start.
export function overallRate(goal, average, throughDate) {
  if (!goal || !Number.isFinite(average)) return null;
  const days = dayOf(throughDate) - dayOf(goal.startDate);
  if (days < OVERALL_MIN_DAYS) return null;
  return Math.round((average - goal.startWeight) / days * 70) / 10 || 0;
}

export const FORECAST_MAX_DAYS = 5 * 365;

// When the 14-day average would reach each milestone still ahead if it kept
// changing by `perWeek` kg a week. Returns null when the rate is flat or heads
// away from the goal. `date` is null past FORECAST_MAX_DAYS.
export function forecastGoal(progress, perWeek, fromDate) {
  if (!progress?.next || !Number.isFinite(perWeek) || Math.sign(perWeek) !== (progress.direction === "lose" ? -1 : 1)) return null;
  const from = dayOf(fromDate);
  return progress.milestones.filter(milestone => milestone.index >= progress.next.index).map(milestone => {
    const days = Math.round(Math.abs(milestone.weight - progress.current) / Math.abs(perWeek) * 7);
    return { ...milestone, days, date: days > FORECAST_MAX_DAYS ? null : dateOf(from + days) };
  });
}
