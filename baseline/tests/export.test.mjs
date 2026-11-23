import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_FORMAT, EXPORT_VERSION, csvFileName, exportJson, jsonFileName, weighInsCsv } from "../dist/export.mjs";
import { KG_PER_LB, normalizeState } from "../dist/model.mjs";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-secret-123";

// A log as the server returns it, with a reminder that lists this device's push endpoint.
const log = () => normalizeState({
  started: true, height: 178.5, sex: "female", units: { weight: "lb", height: "ft" }, preferences: { showBmi: false },
  goal: { weight: 75, startDate: "2026-11-01", startWeight: 84.91, rate: .5, milestones: 10 },
  reminder: { hour: 8, timeZone: "Europe/London", devices: [ENDPOINT] },
  entries: [
    { date: "2026-11-03", weight: 84.4, note: "says \"hi\", then 🙂 left" },
    { date: "2026-11-01", weight: 85, note: null },
    { date: "2026-11-02", weight: 84.91, note: "=HYPERLINK(\"http://evil.test\")" }
  ],
  waists: [{ date: "2026-11-02", waist: 86.61 }]
});

// Splits CSV text into rows of fields as RFC 4180 reads it.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\r" && text[index + 1] === "\n") { row.push(value); rows.push(row); row = []; value = ""; index++; }
    else value += char;
  }
  assert.equal(value + row.join(""), "", "the last line ends with CRLF");
  return rows;
}

test("the weigh-ins CSV has a header, a BOM and CRLF line ends", () => {
  const csv = weighInsCsv(log(), "lb");
  assert.ok(csv.startsWith("\uFEFFdate,weight_kg,weight,note,average_14d_kg\r\n"));
  assert.ok(csv.endsWith("\r\n"));
  assert.doesNotMatch(csv.replaceAll("\r\n", ""), /[\r\n]/, "no bare line breaks");
});

test("each weigh-in is a row, oldest first, with its weight as stored and as shown and its 14-day average", () => {
  const [header, ...rows] = parseCsv(weighInsCsv(log(), "lb").slice(1));
  assert.deepEqual(header, ["date", "weight_kg", "weight", "note", "average_14d_kg"]);
  assert.deepEqual(rows.map(row => row[0]), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.deepEqual(rows[0], ["2026-11-01", "85.00", "187.4 lb", "", "85.00"]);
  assert.deepEqual(rows[1].slice(0, 3), ["2026-11-02", "84.91", "187.2 lb"]);
  assert.equal(rows[1][4], "84.96", "the mean of 85 and 84.91, to 0.01 kg");
  assert.equal(rows[2][4], "84.77", "the mean of all three");
  assert.equal(rows.every(row => row.length === 5), true);
});

test("the shown weight follows the unit, including stones and pounds", () => {
  const weightOn = (unit, index = 0) => parseCsv(weighInsCsv(log(), unit).slice(1))[index + 1][2];
  assert.equal(weightOn("kg"), "85.0 kg");
  assert.equal(weightOn("st", 1), "13 st 5.2 lb");
  assert.equal(weighInsCsv(log()), weighInsCsv(log(), "kg"), "kg by default");
  // A weight typed in pounds reads back as typed.
  const typed = normalizeState({ entries: [{ date: "2026-11-01", weight: Math.round(150 * KG_PER_LB * 100) / 100 }] });
  assert.deepEqual(parseCsv(weighInsCsv(typed, "lb").slice(1))[1].slice(1, 3), ["68.04", "150.0 lb"]);
});

test("notes survive commas, quotes and emoji, and can't run as a formula", () => {
  const rows = parseCsv(weighInsCsv(log(), "lb").slice(1));
  assert.equal(rows[3][3], "says \"hi\", then 🙂 left");
  assert.equal(rows[2][3], "'=HYPERLINK(\"http://evil.test\")");
  for (const start of ["=", "+", "-", "@"]) {
    const note = start + "1+1";
    const [, row] = parseCsv(weighInsCsv(normalizeState({ entries: [{ date: "2026-11-01", weight: 80, note }] })).slice(1));
    assert.equal(row[3], "'" + note, start);
  }
  // Anything else is left as it is.
  const [, plain] = parseCsv(weighInsCsv(normalizeState({ entries: [{ date: "2026-11-01", weight: 80, note: "1 + 1, 'quoted'" }] })).slice(1));
  assert.equal(plain[3], "1 + 1, 'quoted'");
});

test("a note with a tab or a line break, as an older log might hold, is cleaned before it is written", () => {
  const csv = weighInsCsv({ entries: [{ date: "2026-11-01", weight: 80, note: "\tafter\r\ntravel" }] });
  assert.equal(parseCsv(csv.slice(1))[1][3], "after travel");
});

test("weights of 1,000 kg or more, which show with a comma, stay in one field", () => {
  const [, row] = parseCsv(weighInsCsv(normalizeState({ entries: [{ date: "2026-11-01", weight: 1500 }] }), "kg").slice(1));
  assert.deepEqual(row, ["2026-11-01", "1500.00", "1,500.0 kg", "", "1500.00"]);
});

test("an empty log gives only the header", () => {
  assert.equal(weighInsCsv(normalizeState({})), "\uFEFFdate,weight_kg,weight,note,average_14d_kg\r\n");
  assert.equal(weighInsCsv(null), "\uFEFFdate,weight_kg,weight,note,average_14d_kg\r\n");
});

test("the JSON export holds the whole log, in metric units, under a named format", () => {
  const data = JSON.parse(exportJson(log(), new Date("2026-11-23T09:41:00Z")));
  assert.deepEqual(data, {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: "2026-11-23T09:41:00.000Z",
    units: { weight: "lb", height: "ft" },
    preferences: { showBmi: false, showBodyFat: true },
    heightCm: 178.5,
    sex: "female",
    goal: { weightKg: 75, startDate: "2026-11-01", startWeightKg: 84.91, rateKgPerWeek: .5, milestones: 10 },
    reminder: { hour: 8, timeZone: "Europe/London" },
    entries: [
      { date: "2026-11-01", weightKg: 85, note: null },
      { date: "2026-11-02", weightKg: 84.91, note: "=HYPERLINK(\"http://evil.test\")" },
      { date: "2026-11-03", weightKg: 84.4, note: "says \"hi\", then 🙂 left" }
    ],
    waists: [{ date: "2026-11-02", waistCm: 86.61 }]
  });
  assert.equal(data.format, "baseline-export");
  assert.equal(data.version, 1);
});

test("the JSON export holds no push endpoint, key, account ID or email", () => {
  const withExtras = { ...log(), userId: "user_2abc", email: "someone@example.com", reminder: { ...log().reminder, p256dh: "key", auth: "secret" } };
  const text = exportJson(withExtras, new Date("2026-11-23T09:41:00Z"));
  for (const word of [ENDPOINT, "fcm.googleapis", "devices", "p256dh", "auth", "user_2abc", "userId", "email", "@example.com"]) {
    assert.ok(!text.includes(word), word);
  }
});

test("an empty log exports with empty lists and nulls", () => {
  const data = JSON.parse(exportJson(normalizeState({}), new Date("2026-11-23T00:00:00Z")));
  assert.deepEqual(data, {
    format: "baseline-export", version: 1, exportedAt: "2026-11-23T00:00:00.000Z",
    units: { weight: "kg", height: "cm" }, preferences: { showBmi: true, showBodyFat: true }, heightCm: null, sex: null, goal: null, reminder: null, entries: [], waists: []
  });
});

test("download names carry the date", () => {
  assert.equal(csvFileName("2026-11-23"), "baseline-weigh-ins-2026-11-23.csv");
  assert.equal(jsonFileName("2026-11-23"), "baseline-export-2026-11-23.json");
});
