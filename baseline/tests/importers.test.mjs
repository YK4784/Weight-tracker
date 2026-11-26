import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exportJson, weighInsCsv } from "../dist/export.mjs";
import {
  ImportError, appleHealthScanner, csvDelimiter, dateOrderOf, findColumns, guessUnit, importParts, parseCsv, previewImport,
  readCsv, readDate, readImportFile, readImportFiles, readJson, readWeight, resolveImport
} from "../dist/importers.mjs";
import { KG_PER_LB, normalizeState, roundWeight, saveWeight } from "../dist/model.mjs";
import { MAX_MERGE_ENTRIES, parseOp } from "../../server/ops.mjs";

// Every fixture is synthetic: the headers and shape of a real export, with made-up values.
const fixture = name => readFile(new URL("fixtures/" + name, import.meta.url));
const fileOf = async name => new File([await fixture(name)], name);
const TODAY = "2026-11-24";
const NOW = new Date("2026-11-24T12:00:00Z");
const lb = pounds => roundWeight(pounds * KG_PER_LB);
const resolve = (file, options = {}) => resolveImport(file, { today: TODAY, timeZone: "America/Los_Angeles", ...options });
const rowsOf = result => result.rows.map(row => [row.date, row.weightKg, row.note]);

test("the CSV reader handles quotes, line breaks inside them, and every kind of line end", () => {
  const records = parseCsv('﻿date,note\r\n2026-01-05,"says ""hi"", then left"\n\n2026-01-06,"two\r\nlines"\r2026-01-07,plain "quote"\n', ",");
  assert.deepEqual(records.map(record => [...record]), [
    ["date", "note"], ["2026-01-05", 'says "hi", then left'], ["2026-01-06", "two\nlines"], ["2026-01-07", 'plain "quote"']
  ]);
  assert.deepEqual(records.map(record => record.line), [1, 2, 4, 6], "the line each record starts on, blank lines counted");
  assert.deepEqual(parseCsv("a;b\n1;2", ";").map(record => [...record]), [["a", "b"], ["1", "2"]]);
});

test("the delimiter is the one that splits the lines evenly, so a decimal comma isn't one", () => {
  assert.equal(csvDelimiter("Date,Weight\n2026-01-05,84.5\n"), ",");
  assert.equal(csvDelimiter("Datum;Gewicht\n05.01.2026;84,5\n06.01.2026;84,3\n"), ";");
  assert.equal(csvDelimiter("Date\tWeight\n2026-01-05\t84,5\n"), "\t");
  assert.equal(csvDelimiter('date,note\n2026-01-05,"a; b; c"\n'), ",");
  assert.equal(csvDelimiter("Weight\n84.5\n"), ",");
});

test("columns are found by their usual names, with the unit a header states", () => {
  const columns = headers => findColumns(headers);
  assert.deepEqual(columns(["Date", "Weight (kg)", "Notes"]), { date: 0, time: -1, weight: 1, unit: "kg", unitColumn: -1, note: 2 });
  assert.equal(columns(["Day", "Body weight [lbs]"]).unit, "lb");
  assert.deepEqual(columns(["Timestamp", "kg"]), { date: 0, time: -1, weight: 1, unit: "kg", unitColumn: -1, note: -1 });
  assert.equal(columns(["Date", "Time", "Weight", "Unit", "Comment"]).time, 1);
  assert.equal(columns(["Date", "Time", "Weight", "Unit", "Comment"]).unitColumn, 3);
  assert.equal(columns(["Time", "Mass"]).date, 0, "a lone Time column holds the date");
  // A stated unit wins, and nothing that only mentions weight is taken for it.
  assert.equal(columns(["date", "weight_kg", "weight", "note"]).weight, 1);
  assert.equal(columns(["Date", "Fat mass (kg)", "Weight (kg)", "Bone mass (kg)"]).weight, 2);
  assert.equal(columns(["Date", "Trend weight", "Goal weight", "Morning weight"]).weight, 3);
  assert.equal(columns(["Date", "Fat mass (kg)", "Calories"]), null);
  assert.equal(columns(["Weight"]), null);
});

test("weights can carry their unit, and stones and pounds read as pounds", () => {
  assert.deepEqual(readWeight("84.5"), { amount: 84.5, unit: null });
  assert.deepEqual(readWeight(84.5), { amount: 84.5, unit: null });
  assert.deepEqual(readWeight("84.5 kg"), { amount: 84.5, unit: "kg" });
  assert.deepEqual(readWeight("186.3lbs"), { amount: 186.3, unit: "lb" });
  assert.deepEqual(readWeight("13 st 2"), { amount: 13 * 14 + 2, unit: "lb", stones: true });
  assert.deepEqual(readWeight("13st 2.5lb"), { amount: 13 * 14 + 2.5, unit: "lb", stones: true });
  assert.deepEqual(readWeight("13 st"), { amount: 13 * 14, unit: "lb", stones: true });
  assert.deepEqual(readWeight("13 stone 5.2 pounds"), { amount: 13 * 14 + 5.2, unit: "lb", stones: true });
  // A decimal comma only where the file allows one.
  assert.equal(readWeight("84,5"), null);
  assert.deepEqual(readWeight("84,5", true), { amount: 84.5, unit: null });
  for (const junk of ["", "-84", "84.5.1", "eighty", "84 kg 2", "1,234.5"]) assert.equal(readWeight(junk, true), null, junk);
});

test("dates are read year first, or year last with dots, slashes or dashes, with any time after them", () => {
  assert.deepEqual(readDate("2026-01-05"), { yearFirst: true, year: 2026, first: 1, second: 5, time: null, utc: false });
  assert.deepEqual(readDate("2026/1/5 7:30 PM"), { yearFirst: true, year: 2026, first: 1, second: 5, time: "19:30:00", utc: false });
  assert.deepEqual(readDate("2024-02-06 07:30:00 -0800"), { yearFirst: true, year: 2024, first: 2, second: 6, time: "07:30:00", utc: false });
  assert.deepEqual(readDate("2023-10-16T05:19:20.000Z"), { yearFirst: true, year: 2023, first: 10, second: 16, time: "05:19:20", utc: true });
  assert.deepEqual(readDate("05.01.26"), { yearFirst: false, year: "26", first: 5, second: 1, time: null, utc: false });
  assert.deepEqual(readDate("13/04/2026, 06:15"), { yearFirst: false, year: "2026", first: 13, second: 4, time: "06:15:00", utc: false });
  for (const junk of ["Jan 5, 2026", "2026-01", "20260105", "2026-01-05 noonish", "5/1"]) assert.equal(readDate(junk), null, junk);
});

test("a day over 12 makes a file day-first, a second number over 12 month-first, and otherwise Baseline asks", () => {
  const order = texts => dateOrderOf(texts.map(text => ({ text, date: readDate(text) })));
  assert.deepEqual(order(["03/04/2026", "13/04/2026"]).order, "day-first");
  assert.equal(order(["03/04/2026", "13/04/2026"]).needed, false);
  assert.equal(order(["03/04/2026", "04/13/2026"]).order, "month-first");
  assert.equal(order(["2026-03-04", "05/05/2026"]).needed, false, "no date reads two ways");
  const unsure = order(["05/05/2026", "03/04/2026", "04/03/2026"]);
  assert.equal(unsure.needed, true);
  assert.equal(unsure.example.text, "03/04/2026");
});

test("a file whose dates read both ways asks instead of guessing, then reads them as answered", () => {
  const file = readCsv("Date,Weight (kg)\n03/04/2026,84.5\n03/05/2026,84.3\n12/05/2026,84.1\n");
  const unanswered = resolve(file);
  assert.equal(unanswered.ready, false);
  assert.deepEqual(unanswered.rows, []);
  assert.equal(unanswered.ask.dateOrder.text, "Is 03/04/2026 the 3rd of April or March 4th?");
  assert.equal(unanswered.ask.dateOrder.dayFirst, "the 3rd of April");
  assert.equal(unanswered.ask.dateOrder.monthFirst, "March 4th");
  assert.deepEqual(resolve(file, { dateOrder: "day-first" }).rows.map(row => row.date), ["2026-04-03", "2026-05-03", "2026-05-12"]);
  assert.deepEqual(resolve(file, { dateOrder: "month-first" }).rows.map(row => row.date), ["2026-03-04", "2026-03-05", "2026-12-05"].filter(date => date <= TODAY));
  assert.equal(resolve(file, { dateOrder: "month-first" }).rejected[0].reason, "Date after today");
  // A file settled by one date asks nothing.
  const settled = resolve(readCsv("Date,Weight (kg)\n13/04/2026,84.5\n03/04/2026,84.3\n"));
  assert.equal(settled.ask.dateOrder, null);
  assert.deepEqual(settled.rows.map(row => row.date), ["2026-04-03", "2026-04-13"]);
  // A file that goes both ways asks, and a date against the answer is turned down.
  const mixed = readCsv("Date,Weight (kg)\n13/04/2026,84.5\n03/04/2026,84.3\n04/14/2026,84.1\n");
  assert.equal(resolve(mixed).ready, false);
  const answered = resolve(mixed, { dateOrder: "day-first" });
  assert.deepEqual(answered.rows.map(row => row.date), ["2026-04-03", "2026-04-13"]);
  assert.deepEqual(answered.rejected.map(row => [row.place, row.date, row.reason]), [["Row 4", "04/14/2026", "Date not recognized"]]);
  assert.equal(resolve(readCsv("Date,Weight\n2026-02-30,84.5\n")).rejected[0].reason, "Date not recognized");
});

test("a time with an offset keeps the date written with it, and a time in UTC moves to the device's time zone", () => {
  const file = readCsv("Date,Weight (kg)\n2026-01-05 23:30:00 -0800,84.5\n2026-01-06T22:30:00Z,84.3\n");
  assert.deepEqual(resolve(file, { timeZone: "Asia/Tokyo" }).rows.map(row => row.date), ["2026-01-05", "2026-01-07"]);
  assert.deepEqual(resolve(file, { timeZone: "America/Los_Angeles" }).rows.map(row => row.date), ["2026-01-05", "2026-01-06"]);
  assert.deepEqual(resolve(file, { timeZone: "UTC" }).rows.map(row => row.date), ["2026-01-05", "2026-01-06"]);
});

test("a generic CSV in kg, lb or stones imports as kg", () => {
  const kg = resolve(readCsv("Date,Weight (kg),Note\n2026-01-05,84.5,after travel\n2026-01-06,84.25,\n"));
  assert.deepEqual(rowsOf(kg), [["2026-01-05", 84.5, "after travel"], ["2026-01-06", 84.25, null]]);
  assert.equal(kg.unit, "kg");
  assert.equal(kg.ask.unit, null, "the header says");
  // Semicolons, with a decimal comma and day-first dates.
  const pounds = resolve(readCsv("Date;Weight lbs\n13.01.2026;185,2\n05.01.2026;186\n"));
  assert.deepEqual(rowsOf(pounds), [["2026-01-05", lb(186), null], ["2026-01-13", lb(185.2), null]]);
  assert.equal(pounds.unit, "lb");
  const stones = resolve(readCsv("Date,Weight\n2026-01-05,13 st 5.2\n2026-01-06,13st 4lb\n"));
  assert.deepEqual(rowsOf(stones), [["2026-01-05", 84.91, null], ["2026-01-06", lb(13 * 14 + 4), null]]);
  assert.equal(stones.unit, "st");
  assert.equal(stones.ask.unit, null, "each weight says");
  // A unit column, row by row.
  const mixed = resolve(readCsv("Date,Weight,Unit\n2026-01-05,84.5,kg\n2026-01-06,186.0,lbs\n"));
  assert.deepEqual(rowsOf(mixed), [["2026-01-05", 84.5, null], ["2026-01-06", lb(186), null]]);
  assert.equal(mixed.unit, "mixed");
});

test("without a stated unit, Baseline guesses one for the user to confirm, and the answer wins", () => {
  const file = readCsv("Date,Weight\n2026-01-05,185.2\n2026-01-06,184.8\n");
  const guessed = resolve(file);
  assert.deepEqual(guessed.ask.unit, { guess: "lb", answer: null });
  assert.equal(guessed.ready, true, "the guess shows in the preview until the user changes it");
  assert.deepEqual(rowsOf(guessed)[0], ["2026-01-05", lb(185.2), null]);
  assert.deepEqual(rowsOf(resolve(file, { unit: "kg" }))[0], ["2026-01-05", 185.2, null]);
  // The log tells kilograms from pounds best; without one, the numbers and the account's unit do.
  assert.equal(guessUnit([120], { referenceKg: 118 }), "kg");
  assert.equal(guessUnit([120], { referenceKg: 55 }), "lb");
  assert.equal(guessUnit([70, 72, 71]), "kg");
  assert.equal(guessUnit([180, 182]), "lb");
  assert.equal(guessUnit([120]), "kg");
  assert.equal(guessUnit([120], { accountUnit: "lb" }), "lb");
  assert.equal(guessUnit([120], { accountUnit: "st" }), "lb");
  assert.equal(resolve(file, { log: [84, 85] }).ask.unit.guess, "lb");
  assert.equal(resolve(readCsv("Date,Weight\n2026-01-05,120\n"), { log: [118] }).ask.unit.guess, "kg");
});

test("rows that can't be imported say why, and the rest still import", () => {
  const result = resolve(readCsv([
    "Date,Weight (kg)", ",84.5", "someday,84.5", "2026-01-05,", "2026-01-06,heavy", "2026-01-07,0.05", "2026-01-08,2000.01",
    "2026-11-25,84.5", "2026-01-09,84.5", "2026-01-10,2000"
  ].join("\n")));
  assert.deepEqual(result.rejected.map(row => [row.place, row.date, row.weight, row.reason]), [
    ["Row 2", "", "84.5", "No date"],
    ["Row 3", "someday", "84.5", "Date not recognized"],
    ["Row 4", "2026-01-05", "", "No weight"],
    ["Row 5", "2026-01-06", "heavy", "Weight not recognized"],
    ["Row 6", "2026-01-07", "0.05", "Weight outside 0.1–2,000 kg"],
    ["Row 7", "2026-01-08", "2000.01", "Weight outside 0.1–2,000 kg"],
    ["Row 8", "2026-11-25", "84.5", "Date after today"]
  ]);
  assert.deepEqual(rowsOf(result), [["2026-01-09", 84.5, null], ["2026-01-10", 2000, null]]);
});

test("a day with several readings keeps its earliest, by time or else by the file's order", () => {
  const timed = resolve(readCsv("Date,Weight (kg),Note\n2026-01-05 21:10,85.9,evening\n2026-01-05 07:30,84.5,morning\n2026-01-05,86.0,no time\n2026-01-06 07:00,84.4,\n"));
  assert.deepEqual(rowsOf(timed), [["2026-01-05", 84.5, "morning"], ["2026-01-06", 84.4, null]]);
  assert.equal(timed.collapsed, 2);
  assert.equal(timed.collapsedDates, 1);
  assert.deepEqual(timed.warnings, ["1 date has more than one weigh-in. Baseline keeps the earliest of each day and leaves out the other 2."]);
  // Oldest first: the first of a day's rows is the earliest.
  assert.deepEqual(rowsOf(resolve(readCsv("Date,Weight (kg)\n2026-01-05,84.5\n2026-01-05,85.0\n2026-01-06,84.4\n"))), [["2026-01-05", 84.5, null], ["2026-01-06", 84.4, null]]);
  // Newest first, as many apps list them: the last of a day's rows is the earliest.
  const newest = resolve(readCsv("Date,Weight (kg)\n2026-01-06,84.4\n2026-01-05,85.0\n2026-01-05,84.5\n"));
  assert.deepEqual(rowsOf(newest), [["2026-01-05", 84.5, null], ["2026-01-06", 84.4, null]]);
  assert.deepEqual(newest.warnings, ["1 date has more than one weigh-in. Baseline keeps the earliest of each day and leaves out the other one."]);
});

test("notes are cleaned and cut to 100 characters, and the preview says so", () => {
  const long = "x".repeat(120);
  const result = resolve(readCsv('Date,Weight (kg),Comment\n2026-01-05,84.5,"two\nlines  here"\n2026-01-06,84.4,' + long + "\n2026-01-07,84.3,   \n"));
  assert.deepEqual(result.rows.map(row => row.note), ["two lines here", "x".repeat(100), null]);
  assert.deepEqual(result.warnings, ["1 note is longer than 100 characters, so it’s cut to fit."]);
});

test("Baseline's JSON export imports into an empty log as the same weigh-ins, notes and sources", async () => {
  const log = normalizeState({
    started: true, units: { weight: "st", height: "cm" }, height: 178, goal: { weight: 75, startDate: "2026-01-01", startWeight: 85, rate: null, milestones: 10 },
    entries: [
      { date: "2026-01-01", weight: 85, note: null, source: "apple-health" },
      { date: "2026-01-02", weight: 84.91, note: "=1+1, a formula-looking note" },
      { date: "2026-01-03", weight: 84.37, note: "says \"hi\", then 🙂 left" }
    ],
    waists: [{ date: "2026-01-02", waist: 86.61 }]
  });
  const file = await readImportFiles([new File([exportJson(log, NOW)], "baseline-export-2026-11-24.json")]);
  assert.equal(file.source, "baseline");
  const result = resolve(file);
  assert.deepEqual(result.ask, { dateOrder: null, unit: null });
  assert.deepEqual(result.warnings, ["The file also has waist measurements, a goal and a height. Only weigh-ins and their notes are imported."]);
  assert.deepEqual(roundTrip(result.rows, normalizeState({})).entries, log.entries);
});

test("Baseline's CSV export imports into an empty log as the same weigh-ins and notes", async () => {
  const log = normalizeState({ entries: [
    { date: "2026-01-01", weight: 85, note: null },
    { date: "2026-01-02", weight: 84.91, note: "=HYPERLINK(\"http://evil.test\")" },
    { date: "2026-01-03", weight: 84.37, note: "-2 after a run, then 🙂" },
    { date: "2026-01-04", weight: 84.2, note: "says \"hi\", ok" }
  ] });
  for (const unit of ["kg", "lb", "st"]) {
    const file = await readImportFiles([new File([weighInsCsv(log, unit)], "baseline-weigh-ins-2026-11-24.csv")]);
    assert.equal(file.source, "baseline", unit);
    const result = resolve(file);
    assert.deepEqual(result.ask, { dateOrder: null, unit: null }, unit);
    // The CSV doesn't say where each weigh-in came from, so they take the import's source.
    assert.deepEqual(roundTrip(result.rows, normalizeState({})).entries, log.entries.map(entry => ({ ...entry, source: "baseline" })), unit);
  }
  // An export from when the average covered 14 days names its last column for that.
  const older = weighInsCsv(log, "lb").replace("average_10d_kg", "average_14d_kg");
  assert.ok(older.includes("average_14d_kg"));
  const file = await readImportFiles([new File([older], "baseline-weigh-ins-2026-11-20.csv")]);
  assert.equal(file.source, "baseline");
  assert.deepEqual(roundTrip(resolve(file).rows, normalizeState({})).entries, log.entries.map(entry => ({ ...entry, source: "baseline" })));
});

// Sends rows as the app does (importParts, then parseOp as the server checks
// them), and adds them to `log` as the store does: only on dates it doesn't have.
function roundTrip(rows, log) {
  let entries = [...log.entries];
  for (const part of importParts(rows, MAX_MERGE_ENTRIES)) {
    const change = parseOp({ op: "merge-import", batch: "0b6f3c1e-2a4d-4c3b-9e1f-7a8b9c0d1e2f", source: "baseline", entries: part }, NOW);
    assert.ok(change, "the server takes it");
    const have = new Set(entries.map(entry => entry.date));
    entries = [...entries, ...change.entries.filter(entry => !have.has(entry.date)).map(({ source, ...entry }) => source ? { ...entry, source } : entry)];
  }
  return normalizeState({ ...log, entries });
}

test("Apple Health's export streams through the scanner, keeping only weigh-ins", async () => {
  let progress = 0;
  const file = await readImportFile(await fileOf("apple-health-export.xml"), { onProgress: ({ read, total }) => { progress = read / total; } });
  assert.equal(file.source, "apple-health");
  assert.equal(progress, 1);
  assert.deepEqual(file.readings.map(reading => [reading.date, reading.weight, reading.unit]), [
    ["2026-01-05 07:30:00 -0800", "185.2", "lb"],
    ["2026-01-05 21:12:00 -0800", "186.9", "lb"],
    ["2026-01-06 23:40:00 -0800", "185.0", "lb"],
    ["2026-01-07 06:58:00 -0800", "184.6", "lb"],
    ["2026-01-09 07:05:00 +0100", "83.6", "kg"],
    ["2026-01-09 06:50:00 -0800", "184.1", "lb"],
    ["2026-01-10 07:00:00 -0800", "4410", "lb"]
  ], "no BMI, lean body mass or other record");
  const result = resolve(file);
  assert.deepEqual(result.ask, { dateOrder: null, unit: null });
  assert.deepEqual(rowsOf(result), [
    ["2026-01-05", lb(185.2), null],
    ["2026-01-06", lb(185), null],
    ["2026-01-07", lb(184.6), null],
    ["2026-01-09", lb(184.1), null]
  ]);
  assert.equal(result.unit, "lb");
  assert.equal(result.collapsed, 2);
  assert.deepEqual(result.rejected.map(row => [row.place, row.reason]), [["Record 7", "Weight outside 0.1–2,000 kg"]]);
});

test("a weigh-in cut off between two pieces of the stream is read once, wherever the cut falls", async () => {
  const text = (await fixture("apple-health-export.xml")).toString("utf8");
  const whole = appleHealthScanner();
  whole.push(text);
  const expected = whole.end();
  assert.equal(expected.length, 7);
  for (let cut = 1; cut < text.length; cut += 7) {
    const scanner = appleHealthScanner();
    scanner.push(text.slice(0, cut));
    scanner.push(text.slice(cut));
    assert.deepEqual(scanner.end(), expected, "cut at " + cut);
  }
  // In many small pieces too.
  const pieces = appleHealthScanner();
  for (let start = 0; start < text.length; start += 13) pieces.push(text.slice(start, start + 13));
  assert.deepEqual(pieces.end(), expected);
});

test("a large Apple Health export never holds more than a piece and a tag", async () => {
  const record = (index, value) => ' <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2025-01-01 07:00:00 -0800" endDate="2025-01-01 07:00:00 -0800" value="' + value + '"/>\n' +
    (index % 50 ? "" : ' <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" startDate="2025-' + String(1 + index % 12).padStart(2, "0") + "-" + String(1 + index % 28).padStart(2, "0") + ' 07:00:00 +0000" endDate="x" value="80.5"/>\n');
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [\n]>\n<HealthData locale="en_GB">\n';
  const body = Array.from({ length: 40_000 }, (_, index) => record(index, 60 + index % 40)).join("");
  const file = await readImportFile(new File([head, body, "</HealthData>\n"], "export.xml"));
  assert.equal(file.readings.length, 800);
  const dates = new Set(Array.from({ length: 800 }, (_, step) => step * 50).map(index => "2025-" + String(1 + index % 12).padStart(2, "0") + "-" + String(1 + index % 28).padStart(2, "0")));
  assert.deepEqual(resolve(file).rows.map(row => row.date), [...dates].sort());
});

test("files Baseline can't read say what to do instead", async () => {
  const message = async (parts, name) => {
    try { await readImportFiles([new File(parts, name)]); } catch (error) { return error instanceof ImportError ? error.message : "not an ImportError: " + error; }
    return "read";
  };
  assert.equal(await message([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], "export.zip"), "Unzip export.zip first, then choose the export.xml inside it.");
  assert.equal(await message([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], "data.bin"), "Unzip data.bin first, then choose the file with your weigh-ins inside it.");
  assert.equal(await message(['<?xml version="1.0"?>\n<ClinicalDocument xmlns="urn:hl7-org:v3">'], "export_cda.xml"), "This is export_cda.xml. Choose export.xml, which is in the same folder.");
  assert.equal(await message(['<?xml version="1.0"?>\n<gpx version="1.1">'], "run.xml"), "Baseline can’t read this XML file. It reads Apple Health’s export.xml.");
  assert.equal(await message(['{"hello": "world"}'], "x.json"), "Baseline can’t read this JSON file. It reads Baseline’s own export, and Fitbit’s weight files from Google Takeout.");
  assert.equal(await message(['{"format": "baseline-export", "version": 2, "entries": []}'], "x.json"), "This export comes from a newer version of Baseline. Reload Baseline, then try again.");
  assert.equal(await message(["{not json"], "x.json"), "This file isn’t valid JSON, so Baseline can’t read it.");
  assert.equal(await message(["Name,Calories\nToast,90\n"], "food.csv"), "Baseline couldn’t find a date column and a weight column in this file. Check that its first line names them, such as “Date” and “Weight”.");
  assert.equal(await message([""], "empty.csv"), "This file is empty.");
  assert.equal(await message([new Uint8Array([1, 2, 0, 4, 5])], "photo.csv"), "Baseline can’t read this file. Choose a CSV, a JSON export or Apple Health’s export.xml.");
  assert.equal(await message(["Date,Weight\n2026-01-05,84.5\n"], "a.csv").then(() => readImportFiles([new File(["Date,Weight\n"], "a.csv"), new File(["[]"], "weight-2026-01-01.json")]).catch(error => error.message)),
    "These files come from different apps. Choose files from one app at a time.");
});

test("Fitbit's monthly files import together, with the dates' order and the unit worked out", async () => {
  const file = await readImportFiles([await fileOf("fitbit-weight-2026-01-01.json"), await fileOf("fitbit-weight-2026-02-01.json")]);
  assert.equal(file.source, "fitbit");
  assert.deepEqual(file.names, ["fitbit-weight-2026-01-01.json", "fitbit-weight-2026-02-01.json"]);
  assert.equal(file.readings[3].place, "fitbit-weight-2026-02-01.json, weigh-in 1");
  const result = resolve(file);
  assert.equal(result.ask.dateOrder, null, "01/14/26 settles it");
  assert.deepEqual(result.ask.unit, { guess: "lb", answer: null });
  assert.deepEqual(rowsOf(result), [["2026-01-05", lb(185.2), null], ["2026-01-06", lb(184.8), null], ["2026-01-14", lb(184), null], ["2026-02-02", lb(183.6), null]]);
  assert.deepEqual(rowsOf(resolve(file, { unit: "kg" }))[0], ["2026-01-05", 185.2, null]);
  // An empty month is still Fitbit's.
  assert.equal(readJson("[]", "weight-2026-03-01.json").source, "fitbit");
});

// TrendWeight's columns come from apps/web/src/lib/download/csv-export.ts in
// github.com/ervwalter/trendweight; Libra's from libra-app.eu/support/csv.
test("TrendWeight's computed download leaves out the days it filled in", async () => {
  const file = await readImportFiles([await fileOf("trendweight-computed-2026-01-10.csv")]);
  assert.equal(file.source, "trendweight");
  const result = resolve(file);
  assert.deepEqual(result.rows.map(row => row.date), ["2026-01-05", "2026-01-07", "2026-01-09"]);
  assert.deepEqual(result.ask.unit, { guess: "lb", answer: null }, "the file doesn't name its unit");
  assert.deepEqual(result.warnings, ["2 days TrendWeight filled in between weigh-ins are left out."]);
  assert.deepEqual(result.rejected, []);
});

test("TrendWeight's readings download keeps each day's earliest reading", async () => {
  const result = resolve(await readImportFiles([await fileOf("trendweight-manual-2026-01-10.csv")]));
  assert.equal(result.source, "trendweight");
  assert.deepEqual(rowsOf(result), [["2026-01-05", 84, null], ["2026-01-06", 83.9, null], ["2026-01-07", 83.7, null]]);
  assert.equal(result.ask.unit.guess, "kg");
});

test("Libra's CSV takes its unit from its #Units line, its notes from its log column, and its UTC times to the device's day", async () => {
  const file = await readImportFiles([await fileOf("libra-weights.csv")]);
  assert.equal(file.source, "libra");
  const result = resolve(file);
  assert.deepEqual(result.ask, { dateOrder: null, unit: null });
  assert.deepEqual(rowsOf(result), [["2026-01-05", lb(185.2), null], ["2026-01-06", lb(184.8), "after travel"], ["2026-01-07", lb(184.6), null]]);
  assert.equal(result.collapsed, 1);
  // In Tokyo the same readings fall a day later, and 00:41 is that day's earliest.
  assert.deepEqual(rowsOf(resolve(file, { timeZone: "Asia/Tokyo" })), [["2026-01-06", lb(185.2), null], ["2026-01-07", lb(184.8), "after travel"]]);
});

test("the preview sorts weigh-ins into new dates, the same weight, and a different weight the log keeps", () => {
  const rows = [
    { date: "2026-01-04", weightKg: 84.0, note: null },
    { date: "2026-01-05", weightKg: 84.55, note: null },
    { date: "2026-01-06", weightKg: 84.46, note: null },
    { date: "2026-01-07", weightKg: 90, note: "x" }
  ];
  const entries = [{ date: "2026-01-05", weight: 84.5 }, { date: "2026-01-06", weight: 84.4 }, { date: "2026-01-07", weight: 84.3 }, { date: "2026-01-08", weight: 84 }];
  const preview = previewImport(rows, entries);
  assert.deepEqual(preview.fresh.map(row => row.date), ["2026-01-04"]);
  assert.deepEqual(preview.same.map(row => row.date), ["2026-01-05"], "0.05 kg apart is the same");
  assert.deepEqual(preview.different.map(row => [row.date, row.logKg]), [["2026-01-06", 84.4], ["2026-01-07", 84.3]]);
  assert.deepEqual([preview.from, preview.to], ["2026-01-04", "2026-01-07"]);
  // What's imported is what the preview counts, and no weigh-in in the log changes.
  const log = normalizeState({ entries: entries.map(entry => ({ ...entry, note: "mine" })) });
  const after = roundTrip(preview.fresh, log);
  assert.equal(after.entries.length, log.entries.length + preview.fresh.length);
  for (const entry of log.entries) assert.deepEqual(after.entries.find(other => other.date === entry.date), entry);
});

test("an import goes in parts of at most 5,000 weigh-ins, each with a note or source only if it has one", () => {
  const day = index => new Date(Date.UTC(1980, 0, 1 + index)).toISOString().slice(0, 10);
  const rows = Array.from({ length: 12_001 }, (_, index) => ({ date: day(index), weightKg: 80, note: index ? null : "first" }));
  const parts = importParts(rows, MAX_MERGE_ENTRIES);
  assert.deepEqual(parts.map(part => part.length), [5000, 5000, 2001]);
  assert.deepEqual(parts[0].slice(0, 2), [{ date: day(0), weight: 80, note: "first" }, { date: day(1), weight: 80 }]);
  for (const part of parts) assert.ok(parseOp({ op: "merge-import", batch: "0b6f3c1e-2a4d-4c3b-9e1f-7a8b9c0d1e2f", source: "csv", entries: part }, NOW));
  assert.deepEqual(importParts([{ date: day(0), weightKg: 80, note: null, source: null }], 10), [[{ date: day(0), weight: 80, source: null }]]);
});

test("saving an imported weigh-in at the same weight keeps its source, and a new weight drops it", () => {
  const log = normalizeState({ entries: [{ date: "2026-01-05", weight: 84.5, note: null, source: "apple-health" }] });
  assert.equal(saveWeight(log, "2026-01-05", 84.5, "a note").entries[0].source, "apple-health");
  assert.equal(saveWeight(log, "2026-01-05", 84.6).entries[0].source, undefined);
  assert.equal(normalizeState({ entries: [{ date: "2026-01-05", weight: 84.5, source: "Not Valid" }] }).entries[0].source, undefined);
});
