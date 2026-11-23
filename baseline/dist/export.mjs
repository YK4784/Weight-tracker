// The files a user downloads from "Your data": their weigh-ins as CSV for a
// spreadsheet, and their whole log as JSON. No DOM access, so Node can test it.
import { calculateTrend, formatWeight, normalizeState } from "./model.mjs";

// The JSON format's name and version, so a later importer can recognize it.
export const EXPORT_FORMAT = "baseline-export";
export const EXPORT_VERSION = 1;

export const csvFileName = date => "baseline-weigh-ins-" + date + ".csv";
export const jsonFileName = date => "baseline-export-" + date + ".json";

// Spreadsheets run a cell that starts with one of these as a formula, so a
// note that does is written with a leading apostrophe, which shows it as text.
const FORMULA_START = /^[=+\-@\t\r]/;

// One CSV field, quoted as RFC 4180 has it when it holds a comma, a quote or a
// line break, with each quote doubled.
function field(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

const kg = value => value.toFixed(2);
// The 14-day average to 0.01 kg. It's rounded from the exact sum of the weights
// as stored, in hundredths, so a mean that ends in half a hundredth rounds up.
const averageKg = point => kg(Math.round(Math.round(point.average * point.count * 100) / point.count) / 100);

// Every weigh-in, oldest first: the date, the weight in kg as stored (to 0.01
// kg), the weight as Baseline shows it in `unit`, the note, and the 14-day
// average on that date in kg (to 0.01 kg). It starts with a UTF-8 byte order
// mark and ends lines with CRLF, so Excel reads accents and emoji in notes.
export function weighInsCsv(state, unit = "kg") {
  const { entries } = normalizeState(state);
  const readings = entries.length ? calculateTrend(entries, entries.at(-1).date).readings : [];
  const rows = [["date", "weight_kg", "weight", "note", "average_14d_kg"]];
  for (const reading of readings) {
    const note = reading.note && FORMULA_START.test(reading.note) ? "'" + reading.note : reading.note;
    rows.push([reading.date, kg(reading.weight), formatWeight(reading.weight, unit), note, averageKg(reading)]);
  }
  return "\uFEFF" + rows.map(row => row.map(field).join(",") + "\r\n").join("");
}

// Everything in the log, as Baseline stores it, in metric units: the units
// shown, what the overview shows, height, the body fat formula, the goal, the
// reminder's hour and time zone, the weigh-ins with their notes, and the waist
// measurements. It holds nothing that identifies the account or a device: no
// user ID, email, or push subscription. `now` is when it was exported.
export function exportJson(state, now = new Date()) {
  const log = normalizeState(state);
  const goal = log.goal && {
    weightKg: log.goal.weight,
    startDate: log.goal.startDate,
    startWeightKg: log.goal.startWeight,
    rateKgPerWeek: log.goal.rate,
    milestones: log.goal.milestones
  };
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    units: log.units,
    preferences: log.preferences,
    heightCm: log.height,
    sex: log.sex,
    goal,
    reminder: log.reminder && { hour: log.reminder.hour, timeZone: log.reminder.timeZone },
    entries: log.entries.map(entry => ({ date: entry.date, weightKg: entry.weight, note: entry.note })),
    waists: log.waists.map(item => ({ date: item.date, waistCm: item.waist }))
  }, null, 2) + "\n";
}
