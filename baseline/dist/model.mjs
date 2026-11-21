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

export function prettyDate(date, kind = "short") {
  if (!dateFormats.has(kind)) {
    const choices = {
      short: { month: "short", day: "numeric" },
      full: { year: "numeric", month: "short", day: "numeric" },
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

export function normalizeState(value) {
  const byDate = new Map();
  for (const item of Array.isArray(value?.entries) ? value.entries : []) {
    if (validDate(item?.date) && validWeight(item.weight)) {
      byDate.set(item.date, { date: item.date, weight: Math.round(item.weight * 10) / 10 });
    }
  }
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const height = positive(value?.height) && value.height >= .1 && value.height <= 400 ? value.height : null;
  return { version: 1, started: Boolean(value?.started || entries.length || height), height, entries };
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
      const previous = readings.at(-1);
      const point = {
        day, date: dateOf(day), weight: entry?.weight ?? null,
        average: sum / (count * 10), count,
        change: entry && previous ? (entry.tenths - Math.round(previous.weight * 10)) / 10 : null
      };
      days.push(point);
      if (entry) readings.push(point);
    }
    day++;
  }
  const last = days.at(-1);
  return { days, readings, current: last?.day === end ? last : null };
}

const sampleWeights = [
  78.3, 77.8, 78.0, 78.4, 77.7, 77.6, 78.0, 77.4, 77.8, 77.3, 77.5, 77.9,
  77.3, 77.2, 77.6, 77.4, 77.0, 77.4, 77.5, 77.0, 76.9, 77.2, 76.7, 76.9,
  76.6, 76.3, 76.7, 76.1, 76.5, 76.7, 76.2, 76.4, 76.8, 76.3, 76.6, 76.0, 76.5, 76.2,
  76.2, 76.8, 76.5, 77.1, 76.9, 76.4, 76.7, 76.1, 76.4, 75.9, 76.2, 75.7, 76.0,
  75.4, 75.6, 75.2, 75.4, 76.0, 75.7, 75.2, 75.6, 75.0, 74.9, 75.4, 74.8, 74.5,
  74.9, 74.6, 74.4, 74.2
];

export function sampleEntries(today) {
  const first = dayOf(today) - sampleWeights.length + 1;
  return sampleWeights.map((weight, i) => ({ date: dateOf(first + i), weight }));
}
