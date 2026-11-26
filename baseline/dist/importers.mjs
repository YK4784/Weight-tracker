// Reading weigh-ins from a file for the importer on Your data: a CSV from a
// spreadsheet or another app, Baseline's own export, Fitbit's weight files from
// Google Takeout, or Apple Health's export.xml. import-worker.mjs reads the
// file off the page's thread (readImportFiles); the page then turns what it
// read into weigh-ins (resolveImport), with the user's answers to any
// questions, and compares them with the log (previewImport). No DOM access,
// so Node can test it.
//
// Presets are named only where a public, primary source documents the file:
// the app's own help pages, or open-source code that writes it. Files from
// other apps, such as Withings and MacroFactor, go through the generic CSV
// reader, whose header names cover the usual ones.
import { KG_PER_LB, NOTE_MAX_LENGTH, cleanNote, noteLength, roundWeight, shortNote, validDate, validSource } from "./model.mjs";

// A file Baseline can't read, with a message for the user.
export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
  }
}

// What a file holds before any question about it is answered: where it came
// from (a key of IMPORT_SOURCES in model.mjs), and each reading as written.
// A reading is { place, date, weight, unit, note, source? }: `place` says where
// it is in the file ("Row 14"), `date` and `weight` are as written, `unit` is
// the unit the file states for it, or null, and `source` is a weigh-in's own
// source in Baseline's export. `decimalComma` says whether "84,5" is a weight.
// `warnings` are things to tell the user about the file as a whole.
const read = (source, readings, { decimalComma = false, warnings = [], skipped = 0 } = {}) => ({ source, readings, decimalComma, warnings, skipped });

const plural = (count, one, many = one + "s") => count.toLocaleString("en-US") + " " + (count === 1 ? one : many);

// ---------------------------------------------------------------------------
// CSV

// The delimiter of a CSV file: the comma, semicolon or tab that splits its
// first lines most evenly, outside quotes. A comma when none does.
export function csvDelimiter(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/, 40).filter(line => line.trim()).slice(0, 12);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of [",", ";", "\t"]) {
    const counts = lines.map(line => {
      let count = 0;
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (char === delimiter && !quoted) count++;
      }
      return count;
    });
    // The most common count above zero, and how many lines have it.
    const tally = new Map();
    for (const count of counts) if (count) tally.set(count, (tally.get(count) ?? 0) + 1);
    const [usual, steady] = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    const score = steady * 1000 + usual;
    if (score > bestScore) [best, bestScore] = [delimiter, score];
  }
  return best;
}

// Splits CSV text into records of fields, as RFC 4180 has it: a field in double
// quotes can hold the delimiter, line breaks and doubled quotes. Records end
// with CRLF, LF or CR, and blank lines are left out. Each record's `line` is
// the line of the file it starts on, as a spreadsheet numbers its rows.
export function parseCsv(text, delimiter = csvDelimiter(text)) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  let started = false; // Whether the field has begun, so a quote is literal.
  let line = 1;
  let first = 1; // The line the record starts on.
  const end = () => {
    record.push(field);
    if (record.length > 1 || record[0].trim()) records.push(Object.assign(record, { line: first }));
    record = [];
    field = "";
    started = false;
    first = line;
  };
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index++) {
    let char = source[index];
    // A line break is CRLF, LF or CR, and reads as "\n" inside a quoted field.
    if (char === "\r") {
      if (source[index + 1] === "\n") index++;
      char = "\n";
    }
    if (char === "\n") line++;
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[index + 1] === '"') { field += '"'; index++; }
      else quoted = false;
    } else if (char === '"' && !started) {
      quoted = started = true;
    } else if (char === delimiter) {
      record.push(field);
      field = "";
      started = false;
    } else if (char === "\n") {
      end();
    } else {
      field += char;
      started = true;
    }
  }
  if (field || record.length) end();
  return records;
}

// A header as it's matched: lower case, single spaces, without a byte order
// mark or a leading "#" (Libra starts its header line with one).
const headerName = name => String(name).replace(/^\uFEFF/, "").replace(/^#\s*/, "").trim().toLowerCase().replace(/[\s_]+/g, " ");

const UNIT_WORDS = { kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", st: "st", stone: "st", stones: "st" };
// A unit at the end of a header: "Weight (kg)", "weight kg", "Body weight [lbs]", or just "kg".
function headerUnit(name) {
  const match = /^(.*?)[\s(\[]*\b(kgs?|kilograms?|lbs?|pounds?|st|stones?)\b[)\]]?$/.exec(name);
  return match ? { base: match[1].trim(), unit: UNIT_WORDS[match[2]] } : { base: name, unit: null };
}

const WEIGHT_NAMES = new Set(["weight", "body weight", "bodyweight", "body mass", "mass", "scale weight", "actual weight", "weight measurement", ""]);
const NOT_WEIGHT = /trend|average|avg|mean|goal|target|lean|fat|change|diff|bone|muscle|water|bmi|interpolated|moving|delta|loss|gain/;
const DATE_NAMES = new Set(["date", "day", "datetime", "date time", "date/time", "date and time", "timestamp", "measured at", "recorded at"]);
const NOTE_NAMES = new Set(["note", "notes", "comment", "comments", "memo"]);
const UNIT_NAMES = new Set(["unit", "units", "weight unit"]);

// Which columns hold what, from the headers: the date, a separate time of day,
// the weight (with the unit its header states), a unit for each row and a
// note. Null if there's no date or no weight column.
export function findColumns(headers) {
  const names = headers.map(headerName);
  const find = test => names.findIndex(test);
  let date = find(name => DATE_NAMES.has(name));
  if (date < 0) date = find(name => /\bdate\b/.test(name));
  if (date < 0) date = find(name => /\bday\b/.test(name) && !/\bper day\b/.test(name));
  const time = find((name, index) => index !== date && (name === "time" || name === "time of day"));
  if (date < 0 && time >= 0) date = time;
  const weights = names.map((name, index) => ({ index, ...headerUnit(name) }));
  const named = weights.filter(item => WEIGHT_NAMES.has(item.base) && (item.base || item.unit));
  const weight = named.find(item => item.unit) ?? named[0]
    ?? weights.find(item => /weight/.test(item.base) && !NOT_WEIGHT.test(item.base));
  if (date < 0 || !weight) return null;
  return {
    date,
    time: time === date ? -1 : time,
    weight: weight.index,
    unit: weight.unit,
    unitColumn: find(name => UNIT_NAMES.has(name)),
    note: find(name => NOTE_NAMES.has(name))
  };
}

// The record that holds the headers: the first of the first few with a date
// and a weight column. Files can start with lines of their own, as Libra's
// "#Version" and "#Units" lines do.
function headerRecord(records) {
  for (let index = 0; index < Math.min(records.length, 20); index++) {
    const columns = findColumns(records[index]);
    if (columns) return { index, columns };
  }
  return null;
}

const cell = (record, index) => index >= 0 ? (record[index] ?? "").trim() : "";

// Baseline's own CSV export (weighInsCsv in export.mjs). Its `weight` column
// shows the weight in the user's unit, so weight_kg is the one read. A note
// that starts with =, +, - or @ was written with an apostrophe in front, so a
// spreadsheet doesn't run it as a formula; the apostrophe comes off. The last
// column was average_14d_kg while the average covered 14 days, and files
// exported then still import.
const BASELINE_CSV = ["date", "weight kg", "weight", "note", "average 10d kg"];
const BASELINE_CSV_14D = [...BASELINE_CSV.slice(0, 4), "average 14d kg"];
const unformula = note => /^'[=+\-@]/.test(note) ? note.slice(1) : note;

// TrendWeight's downloads, written by apps/web/src/lib/download/csv-export.ts
// in github.com/ervwalter/trendweight (lines 6-10 at 3135fbf): the computed
// view, which fills in days without a weigh-in, and a scale's own readings.
// Weights follow the account's unit, which the file doesn't name.
const TRENDWEIGHT_COMPUTED = ["date", "actual weight", "weight is interpolated", "trend weight", "actual fat %", "fat is interpolated", "trend fat %"];
const TRENDWEIGHT_READINGS = ["date", "time", "weight", "body fat %"];

// Libra's CSV, as its help page documents it (libra-app.eu/support/csv): a
// "#Units: kg" or "#Units: lbs" line, then "#date;weight;weight trend;…;log",
// with dates in UTC such as 2023-10-16T05:19:20.000Z.
const isLibra = names => names[0] === "date" && names[1] === "weight" && names[2] === "weight trend";

const same = (names, expected) => names.length === expected.length && names.every((name, index) => name === expected[index]);

// Reads a CSV file: one of the presets above if its headers are one's, or else
// any file with a date column and a weight column.
export function readCsv(text) {
  const delimiter = csvDelimiter(text);
  const records = parseCsv(text, delimiter);
  const found = headerRecord(records);
  if (!found) {
    throw new ImportError(records.length ? "Baseline couldn’t find a date column and a weight column in this file. Check that its first line names them, such as “Date” and “Weight”."
      : "This file is empty.");
  }
  const names = records[found.index].map(headerName);
  const { columns } = found;
  let source = "csv";
  let unit = columns.unit;
  let note = text => text;
  let skip = () => false;
  let skippedWhy = "";
  if (same(names, BASELINE_CSV) || same(names, BASELINE_CSV_14D)) {
    source = "baseline";
    columns.weight = 1;
    unit = "kg";
    note = unformula;
  } else if (same(names, TRENDWEIGHT_COMPUTED)) {
    source = "trendweight";
    columns.weight = 1;
    skip = record => cell(record, 2).toLowerCase() === "yes";
    skippedWhy = "TrendWeight filled in between weigh-ins";
  } else if (same(names, TRENDWEIGHT_READINGS)) {
    source = "trendweight";
  } else if (isLibra(names)) {
    source = "libra";
    if (columns.note < 0) columns.note = names.indexOf("log");
    const units = records.slice(0, found.index).map(record => /^units?\s*:\s*(kgs?|lbs?)\b/.exec(headerName(record.join(" ")))?.[1]).find(Boolean);
    if (units) unit = UNIT_WORDS[units];
  }
  const readings = [];
  let skipped = 0;
  for (let index = found.index + 1; index < records.length; index++) {
    const record = records[index];
    if (skip(record)) {
      skipped++;
      continue;
    }
    const time = cell(record, columns.time);
    const rowUnit = UNIT_WORDS[cell(record, columns.unitColumn).toLowerCase()] ?? unit;
    readings.push({
      place: "Row " + record.line,
      date: time ? cell(record, columns.date) + " " + time : cell(record, columns.date),
      weight: cell(record, columns.weight),
      unit: rowUnit,
      note: columns.note >= 0 ? note(cell(record, columns.note)) : null
    });
  }
  const warnings = skipped ? [plural(skipped, "day") + " " + skippedWhy + " " + (skipped === 1 ? "is" : "are") + " left out."] : [];
  return read(source, readings, { decimalComma: delimiter !== ",", warnings, skipped });
}

// ---------------------------------------------------------------------------
// JSON

// Baseline's own JSON export (exportJson in export.mjs), version 1: its
// weigh-ins, with their notes and sources. The rest of the log isn't imported.
function readBaselineJson(data) {
  if (data.version !== 1) {
    throw new ImportError(Number(data.version) > 1 ? "This export comes from a newer version of Baseline. Reload Baseline, then try again."
      : "Baseline can’t read this export.");
  }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const readings = entries.map((entry, index) => ({
    place: "Weigh-in " + (index + 1),
    date: typeof entry?.date === "string" ? entry.date : "",
    weight: entry?.weightKg ?? "",
    unit: "kg",
    note: typeof entry?.note === "string" ? entry.note : null,
    source: validSource(entry?.source) ? entry.source : null
  }));
  const rest = [
    Array.isArray(data.waists) && data.waists.length && "waist measurements",
    data.goal && "a goal",
    data.heightCm && "a height",
    data.reminder && "a reminder"
  ].filter(Boolean);
  const warnings = rest.length ? ["The file also has " + rest.join(", ").replace(/, ([^,]*)$/, " and $1") + ". Only weigh-ins and their notes are imported."] : [];
  return read("baseline", readings, { warnings });
}

// Fitbit's weight files from Google Takeout (Takeout/Fitbit/Global Export
// Data/weight-YYYY-MM-DD.json), one a month: [{ logId, weight, bmi, date,
// time, source }]. Neither the date's format nor the weight's unit is
// documented, so dates are read as any file's are, and the user confirms the unit.
const isFitbit = data => Array.isArray(data) && data.some(item => item && typeof item === "object" && "logId" in item && "bmi" in item);

function readFitbit(data) {
  const readings = data.filter(item => item && typeof item === "object").map((item, index) => ({
    place: "Weigh-in " + (index + 1),
    date: [item.date, item.time].filter(part => typeof part === "string" && part).join(" "),
    weight: item.weight ?? "",
    unit: null,
    note: null
  }));
  return read("fitbit", readings);
}

export function readJson(text, name = "") {
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new ImportError("This file isn’t valid JSON, so Baseline can’t read it."); }
  if (data?.format === "baseline-export") return readBaselineJson(data);
  if (isFitbit(data) || Array.isArray(data) && !data.length && /^weight-\d{4}-\d{2}-\d{2}\.json$/i.test(name)) return readFitbit(data);
  throw new ImportError("Baseline can’t read this JSON file. It reads Baseline’s own export, and Fitbit’s weight files from Google Takeout.");
}

// ---------------------------------------------------------------------------
// Apple Health

// Apple Health's export.xml holds every kind of health record, so it's often
// hundreds of megabytes. Weigh-ins are records such as
// <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="…" unit="kg"
// startDate="2024-02-06 07:30:00 -0800" … value="84.5">. The scanner reads
// the text a piece at a time, as the file streams in, and keeps only those
// records' opening tags. A tag cut off at the end of one piece is kept until
// the next arrives. It never holds the whole file.
const BODY_MASS = 'type="HKQuantityTypeIdentifierBodyMass"';
const APPLE_UNITS = { kg: "kg", lb: "lb", st: "st", g: "g" };
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = text => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => name[0] === "#"
  ? String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : ENTITIES[name] ?? whole);

// The index of the ">" that ends the tag `from` is in, outside quoted
// attribute values, or -1 if the text ends first.
function tagEnd(text, from) {
  let quoted = false;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    else if (char === ">" && !quoted) return index;
  }
  return -1;
}

export function appleHealthScanner() {
  let carry = "";
  const readings = [];
  const record = tag => {
    const attributes = {};
    for (const [, name, value] of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) attributes[name] = unescapeXml(value);
    readings.push({
      place: "Record " + (readings.length + 1),
      date: attributes.startDate ?? "",
      weight: attributes.value ?? "",
      unit: attributes.unit ? APPLE_UNITS[attributes.unit] ?? "unknown" : null,
      note: null
    });
  };
  return {
    push(text) {
      const buffer = carry + text;
      let from = 0;
      let done = 0;
      for (;;) {
        const hit = buffer.indexOf(BODY_MASS, from);
        if (hit < 0) break;
        const end = tagEnd(buffer, hit);
        if (end < 0) break;
        const start = buffer.lastIndexOf("<", hit);
        if (start >= done && buffer.startsWith("<Record", start) && /\s/.test(buffer[start + 7])) record(buffer.slice(start, end + 1));
        from = done = end + 1;
      }
      // The last tag may be cut off, so it waits for the next piece.
      const last = buffer.lastIndexOf("<");
      carry = buffer.slice(Math.max(done, last < 0 ? buffer.length : last));
    },
    end() {
      carry = "";
      return readings;
    }
  };
}

// ---------------------------------------------------------------------------
// Files

// How much of a file is read to tell what it is, and the largest file read
// whole. Only Apple Health's export, which streams, can be larger.
const HEAD_BYTES = 256 * 1024;
export const MAX_TEXT_BYTES = 64 * 1024 * 1024;

// Reads one file, a File or Blob with a name. `onProgress({ read, total })`
// follows the bytes of an Apple Health export as they stream.
export async function readImportFile(file, { onProgress = () => {} } = {}) {
  const name = file.name ?? "";
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (/\.zip$/i.test(name) || magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 3 && magic[3] === 4) {
    throw new ImportError(/export/i.test(name) || !name ? "Unzip export.zip first, then choose the export.xml inside it."
      : "Unzip " + name + " first, then choose the file with your weigh-ins inside it.");
  }
  if (!file.size) throw new ImportError("This file is empty.");
  const head = (await file.slice(0, HEAD_BYTES).text()).replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("<")) {
    if (/<ClinicalDocument[\s>]/.test(head)) throw new ImportError("This is export_cda.xml. Choose export.xml, which is in the same folder.");
    if (!/<HealthData[\s>]|<!DOCTYPE HealthData[\s[]/.test(head)) throw new ImportError("Baseline can’t read this XML file. It reads Apple Health’s export.xml.");
    return readAppleHealth(file, onProgress);
  }
  if (file.size > MAX_TEXT_BYTES) throw new ImportError("This file is too large to be a list of weigh-ins.");
  const text = await file.text();
  if (/^[[{]/.test(head)) return readJson(text, name);
  if (text.includes("\u0000")) throw new ImportError("Baseline can’t read this file. Choose a CSV, a JSON export or Apple Health’s export.xml.");
  return readCsv(text);
}

async function readAppleHealth(file, onProgress) {
  const scanner = appleHealthScanner();
  let bytes = 0;
  let told = 0;
  const counter = new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    }
  });
  const reader = file.stream().pipeThrough(counter).pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    scanner.push(value);
    if (bytes - told >= file.size / 100) {
      told = bytes;
      onProgress({ read: bytes, total: file.size });
    }
  }
  return read("apple-health", scanner.end());
}

// Reads the files the user chose, which must all be from one app, as Fitbit's
// monthly files are. Their readings come in the order chosen.
export async function readImportFiles(files, options) {
  const list = [...files];
  if (!list.length) throw new ImportError("Choose a file to import.");
  const results = [];
  for (const file of list) {
    let result;
    try {
      result = await readImportFile(file, options);
    } catch (error) {
      if (error instanceof ImportError && list.length > 1) throw new ImportError(file.name + ": " + error.message);
      throw error;
    }
    if (list.length > 1) for (const reading of result.readings) reading.place = file.name + ", " + reading.place.toLowerCase();
    results.push(result);
  }
  if (new Set(results.map(result => result.source)).size > 1) throw new ImportError("These files come from different apps. Choose files from one app at a time.");
  return {
    ...results[0],
    names: list.map(file => file.name),
    readings: results.flatMap(result => result.readings),
    warnings: [...new Set(results.flatMap(result => result.warnings))],
    decimalComma: results.some(result => result.decimalComma)
  };
}

// ---------------------------------------------------------------------------
// Dates

const pad = number => String(number).padStart(2, "0");

// A time of day as written after a date: "07:30", "7:30:15.250", "7:30 PM",
// with or without a zone: "Z", "UTC", "+01:00", "-0800". `utc` says the
// time is in UTC rather than the local time it was written in.
function readTime(text) {
  let rest = text.trim();
  const zone = /\s*(z|utc|gmt|[+-]\d{2}(?::?\d{2})?)$/i.exec(rest);
  if (zone) rest = rest.slice(0, zone.index);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(?:\s*([ap])\.?\s*m\.?)?$/i.exec(rest.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (match[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[4].toLowerCase() === "p" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { time: pad(hour) + ":" + pad(minute) + ":" + pad(second), utc: Boolean(zone) && /^(z|utc|gmt)$/i.test(zone[1]) };
}

// A date as written: year first (2024-02-06, 2024/2/6, 2024.02.06), or year
// last with day and month in an order the file as a whole decides (03/04/2026,
// 3.4.26), either followed by a time. Returns { year, first, second, yearFirst,
// time, utc }, or null if it isn't a date in one of those forms.
export function readDate(text) {
  const value = String(text ?? "").trim();
  const match = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:(?:T|\s+|,\s*)(.+))?$/i.exec(value)
    ?? /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?:(?:T|\s+|,\s*)(.+))?$/i.exec(value);
  if (!match) return null;
  const yearFirst = match[1].length === 4;
  const time = match[5] ? readTime(match[5]) : null;
  if (match[5] && !time) return null;
  return {
    yearFirst,
    year: yearFirst ? Number(match[1]) : match[4],
    first: Number(yearFirst ? match[3] : match[1]),
    second: Number(yearFirst ? match[4] : match[3]),
    time: time?.time ?? null,
    utc: time?.utc ?? false
  };
}

// How a file writes day and month when its year comes last: "day-first" if
// any first number is over 12, "month-first" if any second one is, and
// otherwise null. `needed` says the user has to answer: some date reads two
// ways (both numbers 12 or less, and different), and the rest don't settle
// it. `example` is the first such date, for the question.
export function dateOrderOf(dates) {
  let dayFirst = false;
  let monthFirst = false;
  let example = null;
  for (const { date, text } of dates) {
    if (!date || date.yearFirst) continue;
    if (date.first > 12) dayFirst = true;
    else if (date.second > 12) monthFirst = true;
    else if (date.first !== date.second) example ??= { date, text };
  }
  const order = dayFirst === monthFirst ? null : dayFirst ? "day-first" : "month-first";
  return { needed: Boolean(example) && !order, order, example };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = day => day + (day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th");

// The question for a file whose dates could be either way round: "Is
// 03/04/2026 the 3rd of April or March 4th?", with the two answers.
export function dateOrderQuestion(example) {
  const { first, second } = example.date;
  const written = example.text.trim().split(/[T\s,]/)[0];
  const dayFirst = "the " + ordinal(first) + " of " + MONTHS[second - 1];
  const monthFirst = MONTHS[first - 1] + " " + ordinal(second);
  return { text: "Is " + written + " " + dayFirst + " or " + monthFirst + "?", dayFirst, monthFirst };
}

// The year of a two-digit year: the latest one up to `today`'s year that ends in it.
function fullYear(year, today) {
  if (typeof year === "number") return year;
  if (year.length === 4) return Number(year);
  const current = Number(today.slice(0, 4));
  const candidate = current - current % 100 + Number(year);
  return candidate > current ? candidate - 100 : candidate;
}

const zoneFormats = new Map();
// The date and time on the clock in `timeZone` at a UTC date and time.
function localTo(date, time, timeZone) {
  if (!zoneFormats.has(timeZone)) {
    zoneFormats.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
  }
  const parts = Object.fromEntries(zoneFormats.get(timeZone).formatToParts(Date.parse(date + "T" + time + "Z")).map(part => [part.type, part.value]));
  return { date: parts.year + "-" + parts.month + "-" + parts.day, time: parts.hour + ":" + parts.minute + ":" + parts.second };
}

// The calendar date and time a reading was made, as YYYY-MM-DD and HH:MM:SS
// (or null), or null if the date isn't real in the file's `order`. Without an
// order, which happens only when no date in the file could be read both ways,
// each date is read the one way it can be. A time with an offset, such as
// Apple Health's "-0800", keeps the date written with it. A time in UTC is
// moved to `timeZone`, so a weigh-in at 7 in the morning in Tokyo, written as
// 22:00 the evening before in UTC, lands on the day it was made.
function calendarDate(date, order, today, timeZone) {
  const year = fullYear(date.year, today);
  const monthFirst = date.yearFirst || (order ? order === "month-first" : date.first <= 12);
  const [month, day] = monthFirst ? [date.first, date.second] : [date.second, date.first];
  const iso = String(year).padStart(4, "0") + "-" + pad(month) + "-" + pad(day);
  if (!validDate(iso)) return null;
  return date.time && date.utc ? localTo(iso, date.time, timeZone) : { date: iso, time: date.time };
}

// ---------------------------------------------------------------------------
// Weights

// A weight as written: a number, with a decimal comma where the file allows
// one, and perhaps its unit: "84.5", "84.5 kg", "186.3 lbs", or stones and
// pounds: "13 st 2", "13st 2.5lb", "13 st". Returns { amount, unit } with
// stones in pounds, unit null when none is written, or null if it isn't one.
export function readWeight(value, decimalComma = false) {
  if (typeof value === "number") return Number.isFinite(value) ? { amount: value, unit: null } : null;
  const text = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const number = decimalComma ? "(\\d+(?:[.,]\\d+)?)" : "(\\d+(?:\\.\\d+)?)";
  const toNumber = part => Number(part.replace(",", "."));
  const stones = new RegExp("^" + number + " ?(?:st|stones?)\\.?(?: ?" + number + " ?(?:lbs?|pounds?)?\\.?)?$").exec(text);
  if (stones) return { amount: toNumber(stones[1]) * 14 + (stones[2] ? toNumber(stones[2]) : 0), unit: "lb", stones: true };
  const plain = new RegExp("^" + number + " ?(kgs?|kilograms?|lbs?|pounds?|#)?\\.?$").exec(text);
  if (!plain) return null;
  return { amount: toNumber(plain[1]), unit: plain[2] ? plain[2] === "#" ? "lb" : UNIT_WORDS[plain[2]] : null };
}

const TO_KG = { kg: 1, g: .001, lb: KG_PER_LB, st: 14 * KG_PER_LB };

// The unit plain numbers are most likely in: the one that puts their median
// nearer the median of the user's log (`referenceKg`), or without a log,
// kilograms below 90 and pounds from 150, and between them the account's unit.
export function guessUnit(amounts, { referenceKg = null, accountUnit = "kg" } = {}) {
  if (!amounts.length) return accountUnit === "kg" ? "kg" : "lb";
  const sorted = [...amounts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (referenceKg > 0 && median > 0) {
    return Math.abs(Math.log(median / referenceKg)) <= Math.abs(Math.log(median * KG_PER_LB / referenceKg)) ? "kg" : "lb";
  }
  if (median < 90) return "kg";
  if (median >= 150) return "lb";
  return accountUnit === "kg" ? "kg" : "lb";
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

// ---------------------------------------------------------------------------
// Turning readings into weigh-ins

export const REJECT_REASONS = {
  noDate: "No date",
  badDate: "Date not recognized",
  future: "Date after today",
  noWeight: "No weight",
  badWeight: "Weight not recognized",
  badUnit: "Unit not recognized",
  range: "Weight outside 0.1–2,000 kg"
};

// Turns what readImportFiles read into weigh-ins, one per date, ready to
// compare with the log and send. `dateOrder` ("day-first" or "month-first")
// and `unit` ("kg" or "lb") are the user's answers to the questions a file can
// raise. `log` is the log's weights in kg, which help guess the unit;
// `accountUnit` is the unit Baseline shows. Returns:
// - `ask`: the questions, each null when it isn't needed. `dateOrder` holds
//   the question (dateOrderQuestion); `unit` holds the guess, which is used
//   until the user answers. While dateOrder is unanswered, `ready` is false
//   and there are no rows: Baseline never guesses a date.
// - `rows`: [{ date, weightKg, note, source? }], oldest first. A day with
//   several readings keeps its earliest: by time where the file gives one,
//   and otherwise by the order in the file, read oldest first.
// - `rejected`: [{ place, date, weight, reason }] for readings that can't be
//   imported, `collapsed` the readings left out for another on the same day,
//   `unit` the unit the weights were read in ("kg", "lb", "st" or "mixed"),
//   and `warnings`, sentences about the file.
export function resolveImport(file, { dateOrder = null, unit = null, today, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, log = [], accountUnit = "kg" } = {}) {
  const dates = file.readings.map(reading => {
    const text = typeof reading.date === "string" ? reading.date : "";
    return { text, date: text.trim() ? readDate(text) : null };
  });
  const weights = file.readings.map(reading => readWeight(reading.weight, file.decimalComma));
  const order = dateOrderOf(dates);
  const effectiveOrder = order.order ?? (order.needed ? dateOrder : null);
  const ready = !order.needed || dateOrder === "day-first" || dateOrder === "month-first";
  const unstated = weights.filter((weight, index) => weight && !weight.unit && !file.readings[index].unit).map(weight => weight.amount);
  const guess = unstated.length ? guessUnit(unstated, { referenceKg: median(log), accountUnit }) : null;
  const ask = {
    dateOrder: order.needed && !order.order ? { ...dateOrderQuestion(order.example), answer: dateOrder } : null,
    unit: unstated.length ? { guess, answer: unit } : null
  };
  const result = { source: file.source, names: file.names ?? [], ask, ready, rows: [], rejected: [], collapsed: 0, collapsedDates: 0, notesCut: 0, unit: null, warnings: [...file.warnings] };
  if (!result.ready) return result;

  const plainUnit = unit === "kg" || unit === "lb" ? unit : guess;
  const kept = [];
  file.readings.forEach((reading, index) => {
    const reject = reason => result.rejected.push({ place: reading.place, date: dates[index].text.trim(), weight: String(reading.weight ?? "").trim(), reason: REJECT_REASONS[reason] });
    if (!dates[index].text.trim()) return reject("noDate");
    const when = dates[index].date && calendarDate(dates[index].date, effectiveOrder, today, timeZone);
    if (!when) return reject("badDate");
    const weight = weights[index];
    if (String(reading.weight ?? "").trim() === "") return reject("noWeight");
    if (!weight) return reject("badWeight");
    const weightUnit = weight.unit ?? reading.unit ?? plainUnit;
    if (!TO_KG[weightUnit]) return reject("badUnit");
    const kg = roundWeight(weight.amount * TO_KG[weightUnit]);
    if (!(kg >= .1 && kg <= 2000)) return reject("range");
    if (when.date > today) return reject("future");
    const shown = weight.stones ? "st" : weightUnit === "g" ? "kg" : weightUnit;
    kept.push({ index, date: when.date, time: when.time, weightKg: kg, shown, note: reading.note, source: reading.source });
  });

  // Without times, the file's order says which reading came first. Files that
  // list the newest first are read from the end.
  const newestFirst = kept.length > 1 && kept[0].date > kept.at(-1).date;
  const earlier = (a, b) => {
    if (a.time && b.time && a.time !== b.time) return a.time < b.time;
    if (Boolean(a.time) !== Boolean(b.time)) return Boolean(a.time); // A reading without a time counts as later.
    return newestFirst ? a.index > b.index : a.index < b.index;
  };
  const byDate = new Map();
  const counts = new Map();
  for (const reading of kept) {
    counts.set(reading.date, (counts.get(reading.date) ?? 0) + 1);
    const other = byDate.get(reading.date);
    if (!other || earlier(reading, other)) byDate.set(reading.date, reading);
  }
  result.collapsed = kept.length - byDate.size;
  result.collapsedDates = [...counts.values()].filter(count => count > 1).length;
  result.rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(reading => {
    const clean = cleanNote(reading.note);
    if (clean && noteLength(clean) > NOTE_MAX_LENGTH) result.notesCut++;
    const row = { date: reading.date, weightKg: reading.weightKg, note: shortNote(clean) };
    if (reading.source !== undefined) row.source = reading.source;
    return row;
  });
  const units = new Set([...byDate.values()].map(reading => reading.shown));
  result.unit = units.size > 1 ? "mixed" : [...units][0] ?? null;
  if (result.collapsedDates) {
    result.warnings.push(plural(result.collapsedDates, "date has", "dates have") + " more than one weigh-in. Baseline keeps the earliest of each day and leaves out " +
      (result.collapsed === 1 ? "the other one." : "the other " + result.collapsed.toLocaleString("en-US") + "."));
  }
  if (result.notesCut) result.warnings.push(plural(result.notesCut, "note is", "notes are") + " longer than " + NOTE_MAX_LENGTH + " characters, so " + (result.notesCut === 1 ? "it’s" : "they’re") + " cut to fit.");
  return result;
}

// ---------------------------------------------------------------------------
// Comparing with the log

// Weights within this much of each other, in kg, count as the same.
export const SAME_WEIGHT_KG = .05;

// Sorts an import's weigh-ins against the log: `fresh` on dates the log
// doesn't have, which are the ones imported; `same` where the log has the
// date with the same weight; `different` where it has another weight, which it
// keeps (each with `logKg`). Also the first and last date.
export function previewImport(rows, entries) {
  const byDate = new Map(entries.map(entry => [entry.date, entry.weight]));
  const preview = { fresh: [], same: [], different: [], from: rows[0]?.date ?? null, to: rows.at(-1)?.date ?? null };
  for (const row of rows) {
    const logKg = byDate.get(row.date);
    if (logKg === undefined) preview.fresh.push(row);
    else if (Math.round(Math.abs(logKg - row.weightKg) * 100) <= SAME_WEIGHT_KG * 100) preview.same.push(row);
    else preview.different.push({ ...row, logKg });
  }
  return preview;
}

// The weigh-ins as merge-import sends them (see server/ops.mjs), in parts of
// at most `size`: an entry carries its note only if it has one, and its own
// source only if it came from Baseline's export.
export function importParts(rows, size) {
  const entries = rows.map(row => {
    const entry = { date: row.date, weight: row.weightKg };
    if (row.note) entry.note = row.note;
    if (row.source !== undefined) entry.source = row.source;
    return entry;
  });
  const parts = [];
  for (let start = 0; start < entries.length; start += size) parts.push(entries.slice(start, start + size));
  return parts;
}
