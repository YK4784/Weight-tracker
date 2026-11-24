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
      dayName: { weekday: "short" },
      day: { weekday: "long", month: "long", day: "numeric" },
      monthYear: { year: "numeric", month: "short" },
      month: { year: "numeric", month: "long" },
      monthName: { month: "long" },
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

// Weights are stored in kilograms to 0.01, so a weight entered in pounds comes
// back as entered. Every weight on screen shows one decimal: 0.1 kg, or 0.1 lb
// for pounds and for the pounds in stones and pounds.
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const WEIGHT_UNITS = ["kg", "lb", "st"];
export const HEIGHT_UNITS = ["cm", "ft"]; // "ft" is feet and inches.
export const UNITS = { weight: "kg", height: "cm" };
const TENTHS_PER_KG = { kg: 10, lb: 10 / KG_PER_LB, st: 10 / KG_PER_LB };

export function normalizeUnits(value) {
  return {
    weight: WEIGHT_UNITS.includes(value?.weight) ? value.weight : UNITS.weight,
    height: HEIGHT_UNITS.includes(value?.height) ? value.height : UNITS.height
  };
}

// The units a new account starts with, from the region of a browser locale
// such as "en-US" (navigator.languages[0]): pounds and feet in the United
// States, and kilograms and centimeters everywhere else, the UK and Ireland
// included, where stones sit beside them on the first-run screen. A locale
// without a region, such as "en", doesn't say where, so it gets the default.
export function defaultUnits(locale) {
  let region;
  try { region = new Intl.Locale(String(locale).replaceAll("_", "-")).region; } catch { region = undefined; }
  return region === "US" ? { weight: "lb", height: "ft" } : { ...UNITS };
}

// A weight in kg as a whole number of the tenths shown in `unit` (0.1 kg or
// 0.1 lb), and back. For kg these are the same sums as Math.round(kg * 10) / 10.
export function toTenths(kg, unit = "kg") {
  return Math.round(kg * TENTHS_PER_KG[unit]);
}

export function fromTenths(tenths, unit = "kg") {
  return tenths / TENTHS_PER_KG[unit];
}

// A weight as it reads on screen, split into numbers and units: [["61.6", "kg"]],
// [["135.8", "lb"]] or [["9", "st"], ["9.8", "lb"]].
export function weightParts(kg, unit = "kg") {
  const tenths = toTenths(kg, unit);
  if (unit !== "st") return [[decimal.format(tenths / 10), unit]];
  const stones = Math.floor(tenths / 140);
  return [[String(stones), "st"], [decimal.format((tenths - stones * 140) / 10), "lb"]];
}

export function formatWeight(kg, unit = "kg") {
  return Number.isFinite(kg) ? weightParts(kg, unit).map(part => part.join(" ")).join(" ") : "—";
}

// A range of weights as it reads on screen: "78.1–79.9 kg", or with stones
// "12 st 6.2 lb – 12 st 8.1 lb". A range that shows as one weight is that weight.
export function formatRange(low, high, unit = "kg") {
  const from = formatWeight(low, unit);
  const to = formatWeight(high, unit);
  if (from === to) return to;
  return unit === "st" ? from + " – " + to : weightParts(low, unit)[0][0] + "–" + to;
}

// A change in weight, without its sign, in kg or, for stones too, in pounds.
export function formatAmount(kg, unit = "kg") {
  return decimal.format(Math.abs(toTenths(kg, unit)) / 10) + (unit === "kg" ? " kg" : " lb");
}

const spokenUnits = { kg: "kilograms", lb: "pounds", st: "stone", cm: "centimeters", ft: "feet", in: "inches" };
const spoken = parts => parts.map(([number, unit]) => number + " " + spokenUnits[unit]).join(" ");

// For screen readers, which may read "st" as "street": "9 stone 9.8 pounds".
export function spokenWeight(kg, unit = "kg") {
  return spoken(weightParts(kg, unit));
}

// A range of weights for screen readers: "78.1 to 79.9 kilograms".
export function spokenRange(low, high, unit = "kg") {
  const from = spokenWeight(low, unit);
  const to = spokenWeight(high, unit);
  if (from === to) return to;
  return unit === "st" ? from + " to " + to : weightParts(low, unit)[0][0] + " to " + to;
}

export function spokenHeight(cm, unit = "cm") {
  return spoken(heightParts(cm, unit));
}

const heightNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

// A height as it reads on screen: [["172", "cm"]] or [["5", "ft"], ["7.7", "in"]].
export function heightParts(cm, unit = "cm") {
  if (unit === "cm") return [[heightNumber.format(cm), "cm"]];
  const tenths = Math.round(cm / CM_PER_IN * 10);
  const feet = Math.floor(tenths / 120);
  return [[String(feet), "ft"], [heightNumber.format((tenths - feet * 120) / 10), "in"]];
}

// What is stored: weights to 0.01 kg, rates to 0.001 kg a week, heights to 0.1 cm.
export const roundWeight = value => Math.round(value * 100) / 100;
export const roundRate = value => Math.round(value * 1000) / 1000;
export const roundHeight = value => Math.round(value * 10) / 10;

export function bmi(weight, heightCm) {
  if (!positive(weight) || !positive(heightCm)) return null;
  return weight / (heightCm / 100) ** 2;
}

// Waists are stored in centimeters to 0.01, so a waist entered in inches comes
// back as entered. They show to 0.1 cm, or to 0.1 in when heights show in feet
// and inches: the height unit is the unit for every length.
export const WAIST_MIN = 10;
export const WAIST_MAX = 400;
export const SEXES = ["male", "female"];
export const roundWaist = value => Math.round(value * 100) / 100;

export function validWaist(value) {
  return positive(value) && value >= WAIST_MIN && value <= WAIST_MAX;
}

// A waist as a whole number of the tenths shown: 0.1 cm, or 0.1 in.
export function waistTenths(cm, heightUnit = "cm") {
  return Math.round(cm / (heightUnit === "cm" ? 1 : CM_PER_IN) * 10);
}

// A waist as it reads on screen: [["86.5", "cm"]] or [["34.1", "in"]].
export function waistParts(cm, heightUnit = "cm") {
  return [[decimal.format(waistTenths(cm, heightUnit) / 10), heightUnit === "cm" ? "cm" : "in"]];
}

export function formatWaist(cm, heightUnit = "cm") {
  return Number.isFinite(cm) ? waistParts(cm, heightUnit)[0].join(" ") : "—";
}

export function spokenWaist(cm, heightUnit = "cm") {
  return spoken(waistParts(cm, heightUnit));
}

// The U.S. Army's one-site tape estimate of body fat, in percent (Army
// Directive 2023-11; the equations are in ALARACT 046/2023, table B-5). It
// takes body weight in pounds and the waist at the navel in inches:
//   men:   −26.97 − 0.12 × weight + 1.99 × waist
//   women: −9.15 − 0.015 × weight + 1.27 × waist
// The Army rounds the result to a whole percent; this leaves it unrounded.
// Null when something is missing, or when the result is outside 0–100%,
// which only measurements far outside the formula's range (or a waist in the
// wrong unit) give.
export function bodyFat(weightKg, waistCm, sex) {
  if (!positive(weightKg) || !positive(waistCm) || !SEXES.includes(sex)) return null;
  const pounds = weightKg / KG_PER_LB;
  const inches = waistCm / CM_PER_IN;
  const percent = sex === "male" ? -26.97 - 0.12 * pounds + 1.99 * inches : -9.15 - 0.015 * pounds + 1.27 * inches;
  return percent > 0 && percent < 100 ? percent : null;
}

export const GOAL_MILESTONES = 10;
export const GOAL_MAX_MILESTONES = 20;
// The fastest target rate that can be stored, in kg a week, and the bound in
// the database's CHECK. It is not the limit on a new goal, which is
// maxGoalRate: goals saved before that limit existed keep their rate and still
// load, display and forecast.
export const GOAL_STORED_MAX_RATE = 5;

// A goal is a target weight, where and when the user started, an optional
// planned rate in kg a week (a size; the direction comes from start and target)
// and how many milestones to split the distance into. Returns null if invalid.
export const GOAL_MIN_RATE = .001;

export function normalizeGoal(value) {
  if (!validWeight(value?.weight) || !validWeight(value.startWeight) || !validDate(value.startDate)) return null;
  const rate = positive(value.rate) && value.rate >= GOAL_MIN_RATE && value.rate <= GOAL_STORED_MAX_RATE ? roundRate(value.rate) : null;
  const milestones = Number.isInteger(value.milestones) && value.milestones >= 1 && value.milestones <= GOAL_MAX_MILESTONES ? value.milestones : GOAL_MILESTONES;
  return { weight: roundWeight(value.weight), startDate: value.startDate, startWeight: roundWeight(value.startWeight), rate, milestones };
}

// Above about 1.5 kg a week, the risk of gallstones climbs steeply (Weinsier
// 1995, https://pubmed.ncbi.nlm.nih.gov/7847427/). So the fastest target rate
// a new goal can have is the lower of GOAL_RATE_CAP and GOAL_RATE_CAP_SHARE of
// its start weight a week. A rate is a size, so this applies to every goal,
// though only loss carries the gallstone risk.
export const GOAL_RATE_CAP = 1.5;
export const GOAL_RATE_CAP_SHARE = .015;
// A loss of more than this share of the start weight a week is faster than
// most guidance suggests.
export const GOAL_FAST_SHARE = .01;
// How far past the cap a rate may round, in kg a week. A rate is typed to
// 0.01 lb, which seldom lands on the cap in kilograms, so the nearest 0.01 lb
// to the cap still counts as the cap.
export const GOAL_RATE_SLACK = .001;

// The fastest target rate for a goal that starts at `weightKg`, in kg a week,
// rounded like a stored rate.
export function maxGoalRate(weightKg) {
  return roundRate(Math.min(GOAL_RATE_CAP, GOAL_RATE_CAP_SHARE * weightKg));
}

// Whether a new goal that starts at `startWeight` may have `rate`, both in kg.
// Compares whole thousandths of a kilogram, as stored. The server checks the same.
export function goalRateAllowed(rate, startWeight) {
  return Math.round(rate * 1000) <= Math.round((maxGoalRate(startWeight) + GOAL_RATE_SLACK) * 1000);
}

// The fastest target rate that can be typed for a goal that starts at
// `startWeight`, in kg a week, or lb a week for pounds and for stones. Rates are
// typed to 0.01. Null without a start weight.
export function goalRateLimit(startWeight, unit = "kg") {
  if (!positive(startWeight)) return null;
  const perUnit = unit === "kg" ? 1 : KG_PER_LB;
  // One step past the cap, then down to the fastest rate allowed.
  let hundredths = Math.ceil((maxGoalRate(startWeight) + GOAL_RATE_SLACK) / perUnit * 100) + 1;
  while (hundredths > 0 && !goalRateAllowed(hundredths / 100 * perUnit, startWeight)) hundredths--;
  return hundredths / 100;
}

// Whether `rate` is more than GOAL_FAST_SHARE of `startWeight` a week, both in kg.
export function fastGoalRate(rate, startWeight) {
  return Math.round(rate * 1000) > Math.round(startWeight * GOAL_FAST_SHARE * 1000);
}

export const NOTE_MAX_LENGTH = 100;

// A note is one line of text. Line breaks, control characters and runs of
// spaces become a single space. Returns null for no note or anything but text.
export function cleanNote(value) {
  if (typeof value !== "string") return null;
  return value.replace(/[\s\p{Cc}\p{Cs}]+/gu, " ").trim() || null;
}

// Characters as Postgres counts them (code points), so an emoji counts once.
export function noteLength(note) {
  return [...note].length;
}

// Cuts a cleaned note to NOTE_MAX_LENGTH characters.
export function shortNote(value) {
  const note = cleanNote(value);
  return note && noteLength(note) > NOTE_MAX_LENGTH ? [...note].slice(0, NOTE_MAX_LENGTH).join("").trim() : note;
}

// Where a weigh-in came from (weigh_ins.source in server/schema.mjs): a short
// name, such as "apple-health" for one brought in by the importer, or null for
// one typed in Baseline. It follows the weight, so saving a different weight
// on that date in Baseline sets it back to null (see saveWeight). The importer
// (importers.mjs) uses the names in IMPORT_SOURCES. Later ways in, such as an
// API, add their own.
export const IMPORT_SOURCES = { csv: "CSV file", baseline: "Baseline export", "apple-health": "Apple Health", fitbit: "Fitbit", trendweight: "TrendWeight", libra: "Libra" };
const SOURCE_ARTICLES = new Set(["csv", "baseline"]);
export const validSource = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value);
export const sourceName = source => IMPORT_SOURCES[source] ?? source;
// For a sentence: "a CSV file" or "Apple Health".
export const sourcePhrase = source => (SOURCE_ARTICLES.has(source) ? "a " : "") + sourceName(source);

// The most recent imports the log lists, each of which can be undone (see
// merge-import and undo-import in server/store.mjs): its batch id, its source,
// when it was made (an ISO time from the server) and how many of its weigh-ins
// are left to undo. Newest first. An import with nothing left isn't listed.
export const IMPORTS_LISTED = 10;
export function normalizeImports(value) {
  const valid = item => typeof item?.id === "string" && item.id.length >= 1 && item.id.length <= 64 && validSource(item.source)
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) && Number.isInteger(item.count) && item.count > 0;
  return (Array.isArray(value) ? value : []).filter(valid).slice(0, IMPORTS_LISTED)
    .map(({ id, source, createdAt, count }) => ({ id, source, createdAt, count }));
}

// An IANA time zone the runtime knows, such as "Europe/London".
export function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// A daily weigh-in reminder: the hour (0–23) in the account's time zone, and
// the push endpoints of the devices that get it. Null when reminders are off,
// which includes when no device is left to send them to.
export function normalizeReminder(value) {
  if (!Number.isInteger(value?.hour) || value.hour < 0 || value.hour > 23 || !validTimeZone(value.timeZone)) return null;
  const devices = [...new Set((Array.isArray(value.devices) ? value.devices : []).filter(device => typeof device === "string" && device))];
  return devices.length ? { hour: value.hour, timeZone: value.timeZone, devices } : null;
}

// Choices about what Baseline shows, kept with the account. Each key has the
// type its value must have and the value it takes when it isn't set. The
// server checks a change against these (see parseOp) and merges it into what's
// saved, so a key an older version of the app doesn't know is never lost.
// Later keys go here too: G3's showGoal and showChanges, G4's hideNumbers and
// H9's trendMethod.
export const PREFERENCE_KEYS = {
  showBmi: { type: "boolean", fallback: true }, // The BMI fact on the overview.
  showBodyFat: { type: "boolean", fallback: true } // The body fat fact and the Body fat section.
};

export function validPreference(key, value) {
  return Object.hasOwn(PREFERENCE_KEYS, key) && typeof value === PREFERENCE_KEYS[key].type;
}

// Every known preference, from `value` where it holds a valid one and the
// default otherwise. Unknown keys are left out.
export function normalizePreferences(value) {
  const preferences = {};
  for (const [key, { fallback }] of Object.entries(PREFERENCE_KEYS)) {
    preferences[key] = value && typeof value === "object" && Object.hasOwn(value, key) && validPreference(key, value[key]) ? value[key] : fallback;
  }
  return preferences;
}

// A change to some of the preferences, as the app sends it in set-preferences:
// at least one key, each known and of the right type. Null for anything else.
export function preferencesChange(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.length && entries.every(([key, item]) => validPreference(key, item)) ? Object.fromEntries(entries) : null;
}

// The version of the health data policy (health-data-privacy.html) that the
// consent step asks people to agree to: the date on the policy. The server
// keeps the version each account agreed to (see the consent op in
// server/ops.mjs), and turns down every change that saves data until it is
// this one. Change it, with the date on the policy page, when the policy
// changes in a way people must agree to again. npm test checks they match.
export const CONSENT_VERSION = "2026-11-23";

// The version of the policy an account agreed to, and when, as an ISO time
// from the server. `at` is null while an agreement made on this device is on
// its way to the server. Null when the account hasn't agreed to any version.
export function normalizeConsent(value) {
  const version = value?.version;
  if (typeof version !== "string" || !/^[\w.-]{1,32}$/.test(version)) return null;
  const at = typeof value.at === "string" && Number.isFinite(Date.parse(value.at)) ? value.at : null;
  return { version, at };
}

// Whether a log's account has agreed to the current policy. Until it has, the
// app shows the consent step in place of the log.
export const hasConsent = log => log?.consent?.version === CONSENT_VERSION;

export function normalizeState(value) {
  const byDate = new Map();
  for (const item of Array.isArray(value?.entries) ? value.entries : []) {
    if (validDate(item?.date) && validWeight(item.weight)) {
      const entry = { date: item.date, weight: roundWeight(item.weight), note: shortNote(item.note) };
      // Only an imported weigh-in has a source (see IMPORT_SOURCES).
      if (validSource(item.source)) entry.source = item.source;
      byDate.set(item.date, entry);
    }
  }
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const waistsByDate = new Map();
  for (const item of Array.isArray(value?.waists) ? value.waists : []) {
    if (validDate(item?.date) && validWaist(item.waist)) waistsByDate.set(item.date, { date: item.date, waist: roundWaist(item.waist) });
  }
  const waists = [...waistsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const height = positive(value?.height) && value.height >= .1 && value.height <= 400 ? value.height : null;
  // Which of the body fat formulas applies. Null until the first waist is logged.
  const sex = SEXES.includes(value?.sex) ? value.sex : null;
  const goal = normalizeGoal(value?.goal);
  const units = normalizeUnits(value?.units);
  const reminder = normalizeReminder(value?.reminder);
  const preferences = normalizePreferences(value?.preferences);
  // Agreeing to the policy saves no data, so it doesn't start the log.
  const consent = normalizeConsent(value?.consent);
  const imports = normalizeImports(value?.imports);
  return { version: 1, started: Boolean(value?.started || entries.length || height || goal || waists.length), consent, height, sex, goal, units, preferences, reminder, entries, waists, imports };
}

// Adds or replaces the waist measurement on `date`, and sets which body fat
// formula applies. The server does the same.
export function saveWaist(state, date, waist, sex) {
  if (!validDate(date) || !validWaist(waist) || !SEXES.includes(sex)) throw new Error("Enter a valid date, waist and sex.");
  return normalizeState({ ...state, started: true, sex, waists: [...state.waists, { date, waist }] });
}

// What a change sent to the server (see server/ops.mjs) applies to: the
// weigh-in or waist measurement on its date, or the goal, height, units,
// reminder or the preferences it sets. A later change to the same thing
// replaces an earlier one, so once it's saved, an earlier change to it that
// failed needn't be sent again. Null for changes that apply to the whole log.
const CHANGE_TARGETS = {
  "save-weight": "weigh-in", "update-weight": "weigh-in", "delete-weight": "weigh-in",
  "save-waist": "waist", "delete-waist": "waist",
  "set-goal": "goal", "clear-goal": "goal",
  "set-reminder": "reminder", "clear-reminder": "reminder",
  "set-height": "height", "set-units": "units", "consent": "consent"
};

export function changeTarget(change) {
  // Preferences merge, so only a change to the very same keys replaces another.
  if (change?.op === "set-preferences") {
    const preferences = preferencesChange(change.preferences);
    return preferences && "preferences " + Object.keys(preferences).sort().join(" ");
  }
  const target = CHANGE_TARGETS[change?.op];
  if (!target) return null;
  return target === "weigh-in" || target === "waist" ? (validDate(change.date) ? target + " " + change.date : null) : target;
}

// Adds or replaces the weigh-in on `date`. Leaving out `note` keeps the note
// already on that date; null or "" removes it. An imported weigh-in saved again
// at the same weight keeps its source, and a different weight, typed in
// Baseline, has none. The server does the same, and also takes the weigh-in
// out of its import, so undoing the import leaves it (see store.mjs).
export function saveWeight(state, date, weight, note) {
  if (!validDate(date) || !validWeight(weight)) throw new Error("Enter a valid date and weight.");
  const existing = state.entries.find(entry => entry.date === date);
  const kept = note === undefined ? existing?.note : note;
  const source = existing && existing.weight === roundWeight(weight) ? existing.source : undefined;
  return normalizeState({ ...state, started: true, entries: [...state.entries, { date, weight, note: kept, source }] });
}

// A button's name for screen readers when its text shows a weight in stones,
// which they may read as "street": the text as shown, so voice control finds
// the button by what it says, then the weight in words, as the unit buttons
// do ("13 st 5.2 lb (13 stone 5.2 pounds)"). Other units read as shown.
export function spokenLabel(text, kg, unit) {
  return unit === "st" ? text + " (" + spokenWeight(kg, unit) + ")" : text;
}

// The label of the bar that logs today's weight on phones: "Log today’s
// weight", or once today has a weigh-in, "Today 84.9 kg · Edit" in the chosen
// unit. `spoken` is its name for screen readers (see spokenLabel).
export function todayLabel(entries, today, unit = "kg") {
  const entry = entries.find(item => item.date === today);
  if (!entry) return { text: "Log today’s weight", spoken: "Log today’s weight" };
  const text = "Today " + formatWeight(entry.weight, unit) + " · Edit";
  return { text, spoken: spokenLabel(text, entry.weight, unit) };
}

// The heading of the sheet that logs today's weight: "Today, Mon Nov 23".
export function todayHeading(today) {
  return "Today, " + prettyDate(today, "dayName") + " " + prettyDate(today);
}

// A link that opens today's weigh-in, filled in: "#log", or with any of
// "?weight=84.9&unit=kg&date=2026-11-23&note=after%20run". It never saves
// anything: the app fills the fields and waits for Save. Returns
// { date, weight, unit, note }, or null for any other hash.
// - `weight` is the number as the link gives it, with a point or a comma, or
//   null. An unknown unit leaves it out, since it can't be read.
// - `unit` is "kg", "lb" or null for none ("lbs" counts as "lb"). Without one,
//   logLinkWeight reads the number in the unit the user shows.
// - `date` is the link's date, or today for a missing or invalid date or one after today.
// - `note` is cleaned (see cleanNote) and cut to NOTE_MAX_LENGTH characters, or null.
export function parseLogLink(hash, today) {
  const match = /^#log(?:\?([^]*))?$/.exec(typeof hash === "string" ? hash : "");
  if (!match) return null;
  const query = new URLSearchParams(match[1] ?? "");
  const named = query.get("unit")?.trim().toLowerCase() || null;
  const unit = named === "kg" ? "kg" : named === "lb" || named === "lbs" ? "lb" : null;
  const text = query.get("weight")?.trim() ?? "";
  const number = /^\d{1,4}(?:[.,]\d{1,8})?$/.test(text) ? Number(text.replace(",", ".")) : NaN;
  const given = query.get("date");
  return {
    date: validDate(given) && given <= today ? given : today,
    weight: positive(number) && (unit || !named) ? number : null,
    unit,
    note: shortNote(query.get("note"))
  };
}

// The highest number a weight field takes, in the unit it shows (see the max
// of each weight input in index.html).
const WEIGHT_FIELD_MAX = 2000;

// The weight a #log link fills in, in kg to 0.01, for a user who shows
// weights in `shown` ("kg", "lb" or "st"). A number without a unit is read in
// kg by someone who shows kg, and in pounds by someone who shows pounds or
// stones. Null when the link has no weight, or when the weight is outside what
// the field takes once it's shown in that unit (0.1 to 2,000) or what Baseline
// stores (0.1 to 2,000 kg), so the field is left as it was.
export function logLinkWeight(link, shown = "kg") {
  if (!positive(link?.weight)) return null;
  const unit = link.unit ?? (shown === "kg" ? "kg" : "lb");
  const kg = roundWeight(unit === "kg" ? link.weight : link.weight * KG_PER_LB);
  const inField = shown === "kg" ? kg : shown === "lb" ? kg / KG_PER_LB : kg / KG_PER_LB / 14;
  return validWeight(kg) && toTenths(kg, shown) >= 1 && inField <= WEIGHT_FIELD_MAX ? kg : null;
}

// The quiet line that suggests installing Baseline (see showInstallHint in
// app.mjs) waits until the log is a habit: weigh-ins on INSTALL_HINT_DAYS
// different days, the first of them INSTALL_HINT_AGE or more days before
// today. Weigh-ins dated after today don't count until their day.
export const INSTALL_HINT_DAYS = 5;
export const INSTALL_HINT_AGE = 7;

export function installHintDue(entries, today) {
  const dates = [...new Set(entries.filter(entry => entry.date <= today).map(entry => entry.date))].sort();
  return dates.length >= INSTALL_HINT_DAYS && dayOf(today) - dayOf(dates[0]) >= INSTALL_HINT_AGE;
}

// What a weigh-in is checked against before it's saved (see checkWeighIn):
// the 14-day average on its date, from the weigh-ins in the 13 days before
// it, or, without two of those, the nearest weigh-in before the date. The
// date's own weigh-in, which a save replaces, and later ones don't count.
// `age` is how many days before the date the latest of them was. `last` says
// whether no other weigh-in comes after the date. Null without a weigh-in
// before the date.
export function weighInReference(entries, date) {
  const day = dayOf(date);
  const before = entries.filter(entry => entry.date < date);
  const latest = before.at(-1);
  if (!latest) return null;
  const age = day - dayOf(latest.date);
  const last = !entries.some(entry => entry.date > date);
  const recent = before.filter(entry => dayOf(entry.date) > day - WINDOW_DAYS);
  if (recent.length < 2) return { kind: "weigh-in", weight: latest.weight, date: latest.date, age, last };
  // Whole hundredths of a kilogram, as calculateTrend sums them.
  const hundredths = recent.reduce((sum, entry) => sum + Math.round(entry.weight * 100), 0);
  return { kind: "average", weight: hundredths / (recent.length * 100), date, age, last };
}

// A weigh-in is checked when it differs from its reference by more than
// CHECK_SHARE, plus CHECK_SHARE_PER_WEEK for each week the reference is older
// than one, since weight drifts over a gap. A reference older than
// CHECK_MAX_DAYS says too little to check against. A reading in another unit,
// or with the decimal point moved, counts as the likely cause when it comes
// within CHECK_MATCH of the reference.
export const CHECK_SHARE = .05;
export const CHECK_SHARE_PER_WEEK = .01;
export const CHECK_MAX_DAYS = 180;
export const CHECK_MATCH = .03;
const KG_PER_UNIT = { kg: 1, lb: KG_PER_LB, st: 14 * KG_PER_LB };

// Whether two weights differ by no more than `share` of the second, to 0.01%,
// so that a difference of exactly 5% counts as 5%.
const within = (weight, reference, share) => Math.round(Math.abs(weight / reference - 1) * 10_000) <= Math.round(share * 10_000);

// The number typed for a weight of `kg` in `unit`: kilograms, pounds to 0.1,
// or stones as a decimal, from stones and pounds to 0.1 lb.
function typedNumber(kg, unit) {
  if (unit === "kg") return kg;
  const pounds = toTenths(kg, unit) / 10;
  return unit === "st" ? pounds / 14 : pounds;
}

// Checks a weigh-in before it's saved, for a slip that would skew the
// average for two weeks. `weight` is in kg, as it would be saved, and `unit`
// is the unit it was typed in. Returns null when it's within reach of its
// reference (see weighInReference), or when there's nothing recent enough to
// check against. Otherwise returns { reason, suggestion, reference, change }:
// - "unit": the number typed, read in another unit (lb or st typed into a kg
//   field, kg or st into an lb field, kg or lb into a st field), comes within
//   CHECK_MATCH of the reference. `suggestion` is { unit, weight } in kg.
// - "decimal": the number divided or multiplied by 10 does, as 849 for 84.9.
//   `suggestion` is in the same unit.
// - "jump": neither does. `suggestion` is null.
// `change` is how far the weight is from the reference, as a signed share of it.
export function checkWeighIn({ weight, date, entries, unit = "kg" }) {
  if (!positive(weight) || !validDate(date) || !WEIGHT_UNITS.includes(unit)) return null;
  const reference = weighInReference(entries, date);
  if (!reference || reference.age > CHECK_MAX_DAYS) return null;
  const extraWeeks = Math.max(0, Math.ceil(reference.age / 7) - 1);
  if (within(weight, reference.weight, CHECK_SHARE + CHECK_SHARE_PER_WEEK * extraWeeks)) return null;
  const result = (reason, suggestion) => ({ reason, suggestion, reference, change: weight / reference.weight - 1 });
  const typed = typedNumber(weight, unit);
  const near = kg => within(kg, reference.weight, CHECK_MATCH);
  // The closest reading in another unit, if any comes near. Their factors are
  // far enough apart that only one can.
  const readings = WEIGHT_UNITS.filter(other => other !== unit)
    .map(other => ({ unit: other, weight: roundWeight(typed * KG_PER_UNIT[other]) }))
    .filter(reading => near(reading.weight))
    .sort((a, b) => Math.abs(a.weight - reference.weight) - Math.abs(b.weight - reference.weight));
  if (readings.length) return result("unit", readings[0]);
  for (const factor of [.1, 10]) {
    const moved = roundWeight(typed * factor * KG_PER_UNIT[unit]);
    if (near(moved)) return result("decimal", { unit, weight: moved });
  }
  return result("jump", null);
}

// A date in a sentence: "Nov 22" this year, or "Nov 22, 2025" before.
const dateIn = (date, today) => date.slice(0, 4) === today.slice(0, 4) ? prettyDate(date) : prettyDate(date, "full");

// What Baseline asks under the weight field about a weigh-in checkWeighIn
// flagged, for a weight of `weight` kg typed in `unit`, which is also the unit
// Baseline shows weights in. Returns { text, choices }. Each choice is
// { label, spoken, weight, unit }: `spoken` is its name for screen readers
// (see spokenLabel); `weight` is the weight in kg it saves, or null for
// "Change it", which saves nothing; `unit` is set when it saves the weight read
// in another unit, which Baseline then offers to show weights in.
export function weighInQuestion(check, weight, unit, today) {
  const { reference, suggestion } = check;
  const shown = (kg, as = unit) => formatWeight(kg, as);
  const save = (prefix, kg, as = unit) => ({ label: prefix + shown(kg, as), spoken: spokenLabel(prefix + shown(kg, as), kg, as), weight: kg, unit: as === unit ? null : as });
  const against = reference.kind === "average"
    ? "your 14-day average" + (reference.date === today ? "" : " on " + dateIn(reference.date, today)) + " (" + shown(reference.weight) + ")"
    : (reference.last ? "your last weigh-in" : "your previous weigh-in") + " (" + shown(reference.weight) + " on " + dateIn(reference.date, today) + ")";
  const percent = Math.round(Math.abs(check.change) * 100);
  const away = "That’s " + percent + "% " + (check.change > 0 ? "above " : "below ") + against + ".";
  switch (check.reason) {
    case "unit":
      return { text: away + " Did you mean " + shown(suggestion.weight, suggestion.unit) + "?", choices: [save("Save as ", suggestion.weight, suggestion.unit), save("Save ", weight)] };
    case "decimal":
      return { text: "Did you mean " + shown(suggestion.weight) + "?", choices: [save("Save ", suggestion.weight), save("Save ", weight)] };
    default:
      return { text: away + " Save it anyway?", choices: [save("Save ", weight), { label: "Change it", spoken: "Change it", weight: null, unit: null }] };
  }
}

// The changes that can wait on the device while it's offline and be sent
// later, in order (see the outbox in app.mjs). Reminders need a live push
// subscription, so they aren't among them. Agreeing to the health data policy
// can wait too, and goes ahead of the changes it allows (see agree in app.mjs).
// So can skipping the first-run screen ("start"), which only starts the log.
export const QUEUEABLE_OPS = ["save-weight", "update-weight", "delete-weight", "set-height", "save-waist", "delete-waist", "set-goal", "clear-goal", "set-units", "set-preferences", "consent", "start"];

// Applies a change the app sends (see server/ops.mjs) to a normalized log, as
// server/store.mjs does on the server, so the screen can show changes that
// haven't reached it yet. Throws for a change it can't apply.
export function applyOp(state, change) {
  switch (change?.op) {
    case "save-weight":
      return saveWeight(state, change.date, change.weight, change.note);
    // An edit changes a weigh-in that's there, and adds none.
    case "update-weight":
      return state.entries.some(entry => entry.date === change.date) ? saveWeight(state, change.date, change.weight, change.note) : state;
    case "delete-weight":
      return normalizeState({ ...state, entries: state.entries.filter(entry => entry.date !== change.date) });
    case "set-height":
      if (!positive(change.height) || change.height < .1 || change.height > 400) throw new Error("Enter a valid height.");
      return normalizeState({ ...state, started: true, height: change.height });
    case "save-waist":
      return saveWaist(state, change.date, change.waist, change.sex);
    case "delete-waist":
      return normalizeState({ ...state, waists: state.waists.filter(item => item.date !== change.date) });
    case "set-goal":
      if (!normalizeGoal(change.goal)) throw new Error("Enter a valid goal.");
      return normalizeState({ ...state, started: true, goal: change.goal });
    case "clear-goal":
      return normalizeState({ ...state, goal: null });
    case "set-units":
      if (!WEIGHT_UNITS.includes(change.units?.weight) || !HEIGHT_UNITS.includes(change.units.height)) throw new Error("Choose valid units.");
      return normalizeState({ ...state, started: true, units: change.units });
    // Only the keys sent change, as the server merges them into what it has.
    case "set-preferences": {
      const preferences = preferencesChange(change.preferences);
      if (!preferences) throw new Error("Choose valid preferences.");
      return normalizeState({ ...state, started: true, preferences: { ...state.preferences, ...preferences } });
    }
    // The device that sent its subscription joins the others. Without any
    // device, reminders are off, as the server has it.
    case "set-reminder": {
      const device = change.subscription?.endpoint;
      const devices = [...(state.reminder?.devices ?? []), ...(device ? [device] : [])];
      return normalizeState({ ...state, reminder: { hour: change.hour, timeZone: change.timeZone, devices } });
    }
    case "clear-reminder":
      return normalizeState({ ...state, reminder: null });
    // The server records when it receives the agreement, so until then it has
    // no time. Agreeing again to the same version keeps the first time, as on the server.
    case "consent":
      if (change.version !== CONSENT_VERSION) throw new Error("Agree to the current policy.");
      return hasConsent(state) ? state : normalizeState({ ...state, consent: { version: change.version, at: null } });
    case "start":
      return normalizeState({ ...state, started: true });
    default:
      throw new Error("Unknown change: " + change?.op);
  }
}

// Applies changes in order. One that can't be applied is skipped, so the rest
// still show; the server turns it down when it's sent.
export function applyOps(state, changes) {
  return changes.reduce((current, change) => {
    try { return applyOp(current, change); } catch { return current; }
  }, state);
}

// The change that undoes a deletion, built from the log as it was just before
// it (`before`, a normalized log): deleting a weigh-in is undone by saving it
// again with its weight in kg as stored and its note, deleting a waist
// measurement by saving it again with the formula's sex, and removing a goal by
// setting the whole goal again. It's an ordinary change that the server
// checks like any other, so it's sent rather than held back, and survives a
// closed tab like any change. Null for any other change, when there was
// nothing to delete, or when the server would turn the inverse down: a goal
// saved before the cap on the target rate (see goalRateAllowed) can't be set
// again as it was.
export function inverseOf(change, before) {
  switch (change?.op) {
    case "delete-weight": {
      const entry = before?.entries.find(item => item.date === change.date);
      return entry ? { op: "save-weight", date: entry.date, weight: entry.weight, note: entry.note ?? null } : null;
    }
    case "delete-waist": {
      const measurement = before?.waists.find(item => item.date === change.date);
      return measurement && SEXES.includes(before.sex) ? { op: "save-waist", date: measurement.date, waist: measurement.waist, sex: before.sex } : null;
    }
    case "clear-goal": {
      const goal = before?.goal;
      if (!goal || goal.rate !== null && !goalRateAllowed(goal.rate, goal.startWeight)) return null;
      return { op: "set-goal", goal: { weight: goal.weight, startDate: goal.startDate, startWeight: goal.startWeight, rate: goal.rate, milestones: goal.milestones } };
    }
    default:
      return null;
  }
}

// A line that rests on fewer weigh-ins than this is drawn thin (see lineParts
// in chart.mjs): an average of two or three readings still swings with them.
export const THIN_COUNT = 4;

// The 14-day average for each day from the first weigh-in through
// `throughDate`. The input is a normalized log (one entry per date, ascending).
// - On a day with a weigh-in, the average is the mean of the weigh-ins that day
//   and on the 13 days before it.
// - A day without a weigh-in keeps the average of the last weigh-in before it,
//   as of that weigh-in (`asOf`, its date). So the figures stay put until the
//   next weigh-in, rather than drifting toward the last few readings as older
//   ones leave the window. `count` is how many weigh-ins that average has.
// - Once the last weigh-in is WINDOW_DAYS days old, its window no longer
//   reaches the day, so the day has no average and the line breaks.
// Each point is { day, date, weight, note, average, count, asOf }, with
// `weight` and `note` null on days without a weigh-in. `readings` are the
// points with a weigh-in, and `current` is the point on `throughDate`, or null.
// It sums whole hundredths of a kilogram, as stored, so no rounding error builds up.
export function calculateTrend(entries, throughDate) {
  const days = [];
  const readings = [];
  const end = dayOf(throughDate);
  const source = entries.map(entry => ({ ...entry, day: dayOf(entry.date), hundredths: Math.round(entry.weight * 100) }));
  let day = source[0]?.day;
  let left = 0;
  let next = 0;
  let sum = 0;
  let held = null; // The point of the last weigh-in so far.
  while (day <= end && (next < source.length || left < next)) {
    while (left < next && source[left].day < day - WINDOW_DAYS + 1) {
      sum -= source[left++].hundredths;
    }
    if (left === next && next < source.length) day = Math.max(day, source[next].day);
    if (day > end) break;
    if (source[next]?.day === day) {
      const entry = source[next++];
      sum += entry.hundredths;
      const count = next - left;
      held = { day, date: entry.date, weight: entry.weight, note: entry.note ?? null, average: sum / (count * 100), count, asOf: entry.date };
      days.push(held);
      readings.push(held);
    } else if (next > left) {
      // The last weigh-in is still inside this day's window.
      days.push({ day, date: dateOf(day), weight: null, note: null, average: held.average, count: held.count, asOf: held.asOf });
    }
    day++;
  }
  const last = days.at(-1);
  return { days, readings, current: last?.day === end ? last : null };
}

// The date of the weigh-in whose 14-day average stands for `throughDate` (see
// calculateTrend): the last weigh-in on or before it, while that is less than
// WINDOW_DAYS days earlier. Null when there's none.
export function asOfDate(entries, throughDate) {
  const last = entries.findLast(entry => entry.date <= throughDate);
  return last && dayOf(throughDate) - dayOf(last.date) < WINDOW_DAYS ? last.date : null;
}

// Splits rows that are in date order into runs from the same calendar month,
// as { month: "YYYY-MM", rows }.
export function groupByMonth(rows) {
  const groups = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (groups.at(-1)?.month !== month) groups.push({ month, rows: [] });
    groups.at(-1).rows.push(row);
  }
  return groups;
}

export const CHANGE_WINDOWS = [7, 30, 90];

// How much the 14-day average has changed over each of CHANGE_WINDOWS days, and
// since the first weigh-in (`days` null), in kg, using averages rounded to the
// 0.1 of `unit` shown on screen. `trend` comes from calculateTrend through today.
// Like the average itself, the changes are as of the last weigh-in: each runs
// back from its date (`trend.current.asOf`), so they hold still until the next
// weigh-in. A window is left out when there is no average exactly that many
// days before: the log is shorter than the window, or a gap of more than 14
// days leaves that day without one. The change since the first weigh-in needs
// the log to go back further than the longest window shown, and further than a
// week, so it never repeats another figure. Empty without an average today.
export function averageChanges(trend, unit = "kg") {
  const now = trend.current;
  if (!now) return [];
  const end = dayOf(now.asOf);
  const byDay = new Map(trend.days.map(point => [point.day, point]));
  const since = point => fromTenths(toTenths(now.average, unit) - toTenths(point.average, unit), unit);
  const changes = [];
  for (const days of CHANGE_WINDOWS) {
    const then = byDay.get(end - days);
    if (then) changes.push({ days, change: since(then) });
  }
  const first = trend.days[0];
  if (first.day < end - (changes.at(-1)?.days ?? CHANGE_WINDOWS[0])) changes.push({ days: null, change: since(first) });
  return changes;
}

// The highest and lowest weigh-ins in the WINDOW_DAYS days through `throughDate`
// (the same days as the 14-day average on that date), with how many days before
// it each was. A tie goes to the most recent. Null with fewer than two weigh-ins
// in those days.
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

// The noise in weigh-ins, as both the weekly trend's likely range and the
// trend forecast's band model it: how far the weigh-ins sit from the straight
// line fitted through them. It isn't new from one day to the next: water and
// food carry over, so a heavy day tends to follow a heavy day. The noise on
// days k apart is taken to be correlated by NOISE_CORRELATION to the power k,
// so 21 daily weigh-ins tell less than 21 unrelated ones would, while weekly
// ones are nearly unrelated. That fits the spread of day-to-day changes in a
// 26-year daily record, 0.53% of body weight a day apart and 0.69% a week apart
// (Renal Failure, 2023, https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/).
// It leaves out what weigh-ins can't show, such as a change in what someone
// eats or does.
export const NOISE_CORRELATION = .4;
// The least noise assumed, in kg: about a scale's own error, so weigh-ins
// typed on an exact line still get a range.
export const MIN_NOISE = .1;

// The weekly trend's likely range is the fitted slope give or take
// RATE_INTERVAL_ERRORS standard errors. The standard error allows for the
// correlated noise above, which for daily weigh-ins makes it about 1.5 times
// the textbook one that takes each day's noise as new. The textbook one called
// a flat weight a change too often. A later change may estimate the correlation
// from the log itself, and lengthen the 21 days for people who weigh less often.
export const RATE_INTERVAL_ERRORS = 2;
// A trend is steady when its whole likely range lies within this many kg a
// week either way. Three weeks of weigh-ins seldom pin a trend down that
// closely, so with RATE_DAYS it rarely shows. That's expected: it needs about
// four to six weeks of daily weigh-ins, not a wider band.
export const RATE_STEADY_BAND = .15;

// The least-squares line through the weigh-ins of the last RATE_DAYS calendar
// days through `throughDate`. `points` are [x, kg], with x the day counted from
// `throughDate`: 0 for that day, −1 the day before. `residuals` is the sum of
// the squared distances of the weigh-ins from the line. Null with fewer than
// RATE_MIN_ENTRIES weigh-ins, or when they span fewer than RATE_MIN_SPAN days.
// The input is a normalized log (one entry per date, ascending).
function rateLine(entries, throughDate) {
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
  return { points, n, meanX, sxx, slope, residuals };
}

// The noise model above, fitted to a rateLine, for days up to `ahead` days
// after its last. `correlation(a, b)` is how correlated the noise is on days a
// and b. A line fitted through correlated noise follows some of it, so the
// residuals understate the noise. Dividing by n − tr(HΩ) rather than n − 2
// corrects for that, where H is the fit's hat matrix and Ω the correlations.
// That divisor is `freedom`, the degrees of freedom left. `noise` is the
// noise's variance in kg², at least MIN_NOISE squared.
function lineNoise({ points, n, meanX, sxx, residuals }, ahead = 0) {
  // The furthest apart two days can be is the start of the fit and the last day ahead.
  const correlations = Array.from({ length: RATE_DAYS + ahead }, (_, gap) => NOISE_CORRELATION ** gap);
  const correlation = (a, b) => correlations[Math.abs(a - b)];
  let followed = 0;
  for (const [a] of points) for (const [b] of points) followed += (1 / n + (a - meanX) * (b - meanX) / sxx) * correlation(a, b);
  const freedom = Math.max(2, n - followed);
  return { correlation, freedom, noise: Math.max(MIN_NOISE ** 2, residuals / freedom) };
}

// The weekly trend from a rateLine (see calculateRate).
function rateOf(line, unit) {
  const { points, n, meanX, sxx, slope } = line;
  const { correlation, noise } = lineNoise(line);
  // The slope is a weighted sum of the weigh-ins, with weights (x − mean x) / sxx,
  // so its variance sums the noise's covariance over every pair of them.
  let pairs = 0;
  for (const [a] of points) for (const [b] of points) pairs += (a - meanX) * (b - meanX) * correlation(a, b);
  const reach = RATE_INTERVAL_ERRORS * Math.sqrt(noise * pairs) / sxx;
  const low = slope - reach;
  const high = slope + reach;
  const perWeek = weeklyTenths(slope, unit);
  const state = perWeek !== 0 && (low > 0 || high < 0) ? "moving"
    : Math.max(-low, high) * 7 <= RATE_STEADY_BAND ? "steady"
    : "unclear";
  return { perWeek, low: weeklyTenths(low, unit), high: weeklyTenths(high, unit), state, clear: state === "moving", count: n };
}

// The input is a normalized log (one entry per date, ascending).
// Weekly rate of change: the slope of a least-squares line through the weigh-ins
// of the last RATE_DAYS calendar days. An average trails the weight by half its
// window; a fitted line does not. Needs RATE_MIN_ENTRIES weigh-ins spread over at
// least RATE_MIN_SPAN days, otherwise returns null.
// Returns { perWeek, low, high, state, clear, count }:
// - `perWeek` is the slope in kg a week, rounded to the 0.1 of `unit` shown.
// - `low` and `high` are the likely range (see RATE_INTERVAL_ERRORS), rounded
//   the same way, with their signs, so `low` <= `perWeek` <= `high`.
// - `state` is judged before rounding:
//   - "moving": the whole likely range is on one side of zero, and the trend
//     doesn't show as 0.0.
//   - "steady": the whole likely range is within RATE_STEADY_BAND either way.
//   - "unclear": anything else. The weigh-ins so far can't tell the trend
//     apart from day-to-day swings.
// - `clear` is state === "moving", from before there were three states.
// - `count` is how many weigh-ins the line fits.
export function calculateRate(entries, throughDate, unit = "kg") {
  const line = rateLine(entries, throughDate);
  return line && rateOf(line, unit);
}

// The weekly trend that stands for `throughDate`: calculateRate as of the
// weigh-in whose 14-day average does (see asOfDate). Like the average, it holds
// still between weigh-ins, rather than changing as the 21 days move past older
// weigh-ins with no new one. Null without a weigh-in in the 14 days through
// `throughDate`, or without a weekly trend on that weigh-in's date.
export function rateAsOf(entries, throughDate, unit = "kg") {
  const date = asOfDate(entries, throughDate);
  return date && calculateRate(entries, date, unit);
}

// A weekly trend from calculateRate in words, as the line under the average
// reads: { lead, rest }, with `lead` in bold, or null for a trend that isn't
// clear yet, which has no bold. Amounts are in kg, or in pounds for stones
// too. The words say "Down" and "Up" rather than signs, so they read aloud.
// - Moving: "Down about 0.3 kg a week" and " · likely 0.1 to 0.5", the likely
//   range's sizes, which can't cross zero in this state.
// - Steady: "Steady" and " · within 0.1 kg a week either way", from the
//   range's larger bound.
// - Not clear yet: "Down about 0.2 kg a week · a few more weigh-ins will
//   tell", or "Little change so far · …" when the trend shows as 0.0. Its
//   range is left out, since one that crosses zero is hard to read.
export function weeklyTrendWords(rate, unit = "kg") {
  const amount = kg => formatAmount(kg, unit);
  const size = kg => amount(kg).split(" ")[0];
  const way = (rate.perWeek < 0 ? "Down about " : "Up about ") + amount(rate.perWeek) + " a week";
  if (rate.state === "moving") {
    const [near, far] = [Math.abs(rate.low), Math.abs(rate.high)].sort((a, b) => a - b);
    return { lead: way, rest: " · likely " + size(near) + " to " + size(far) };
  }
  if (rate.state === "steady") return { lead: "Steady", rest: " · within " + amount(Math.max(-rate.low, rate.high)) + " a week either way" };
  return { lead: null, rest: (rate.perWeek ? way : "Little change so far") + " · a few more weigh-ins will tell" };
}

// The trend forecast on the chart: where the 14-day average is heading if the
// weekly trend holds.
//
// The line starts at the 14-day average on the last weigh-in, on that day, and
// moves by the weekly trend as of that weigh-in, as shown: the same figures as
// at the top of the overview and in the goal forecast. Starting from the last
// weigh-in rather than today means a few days without one move the forecast's
// end out by those days, and widen its band, but don't shift where it starts.
// It's a straight line, because over the few weeks the chart
// looks ahead a straight line is close to how weight changes. Over months it
// isn't: loss slows as weight falls (Hall et al., Lancet 2011,
// https://pubmed.ncbi.nlm.nih.gov/21872751/), so the forecast stops at
// FORECAST_CHART_MAX_DAYS.
//
// The band around it is the likely range, where the average would land 8 times
// in 10 if the trend holds. It comes from the same weigh-ins as the trend,
// modelled as a straight line plus the correlated noise that the trend's own
// likely range assumes (see NOISE_CORRELATION), and allows for two things:
// - The slope is only an estimate, and an error in it grows with each day ahead.
// - The days ahead bring new weigh-ins, with noise of their own, into the
//   average, and the last weigh-in's average has noise that the forecast
//   starts from.
// So the band has no width on the day of the last weigh-in, and widens as the
// days go on.

// The furthest the chart forecasts, in days after the last weigh-in: about 3
// months. Further out, a straight line overstates how fast weight keeps changing.
export const FORECAST_CHART_MAX_DAYS = 84;
// The standard normal's 90th percentile: 80% of outcomes lie within ±z.
const LIKELY_Z = 1.2815515655446004;

// Student's t quantile for `z`, a quantile of the standard normal, with `df`
// degrees of freedom, by the Cornish–Fisher expansion. For z = LIKELY_Z it is
// within 0.012 of the exact value from 3 degrees of freedom up.
export function tQuantile(z, df) {
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
}

// How far ahead the chart forecasts, in days, when it shows `span` days: half
// as far as it shows, in whole weeks, from one week up to
// FORECAST_CHART_MAX_DAYS. 14D looks 1 week ahead, 30D 2 weeks and 90D 6.
export function forecastReach(span) {
  return 7 * Math.min(FORECAST_CHART_MAX_DAYS / 7, Math.max(1, Math.round(span / 14)));
}

// The trend forecast (see above) from the last weigh-in on or before
// `throughDate` (today), for each day after it through `days` days after
// `throughDate`, and at most FORECAST_CHART_MAX_DAYS after the weigh-in.
// Returns the weekly trend as of the weigh-in (see rateAsOf and calculateRate)
// for `unit`, the same object the overview shows, with three more fields: the
// weigh-in's date `from`, the 14-day `average` on it that the forecast starts
// from, and `points`, a point { day, date, average, low, high } for each day
// after it, in kg, with the likely range from `low` to `high`. Null without a
// weekly trend as of a weigh-in in the 14 days through `throughDate`. The
// input is a normalized log (one entry per date, ascending).
export function forecastTrend(entries, throughDate, days, unit = "kg") {
  const from = asOfDate(entries, throughDate);
  const line = from && rateLine(entries, from);
  if (!line) return null;
  const rate = rateOf(line, unit);
  const { points, meanX, sxx } = line;
  const end = dayOf(from);
  const length = Math.min(dayOf(throughDate) + days - end, FORECAST_CHART_MAX_DAYS);
  // The weigh-ins in the last weigh-in's 14-day average. Summed in hundredths,
  // as calculateTrend does.
  const recent = points.filter(([x]) => x > -WINDOW_DAYS);
  const average = recent.reduce((sum, [, y]) => sum + Math.round(y * 100), 0) / (recent.length * 100);
  // The band's width uses Student's t with the degrees of freedom the fit leaves.
  const { correlation, freedom, noise } = lineNoise(line, length);
  const spread = tQuantile(LIKELY_Z, freedom);
  // The slope is a weighted sum of the weigh-ins, with these weights.
  const slopeWeights = points.map(([x]) => (x - meanX) / sxx);
  const forecast = [];
  for (let ahead = 1; ahead <= length; ahead++) {
    // The forecast misses by the noise in the average `ahead` days after the
    // weigh-in, taken to have weigh-ins on the same days of its 14 as the
    // weigh-in's, less the noise in the weigh-in's average, less `ahead` times
    // the error in the slope.
    // Each is a weighted sum of the noise on single days.
    const weights = new Map();
    const add = (day, weight) => weights.set(day, (weights.get(day) ?? 0) + weight);
    for (const [x] of recent) {
      add(x + ahead, 1 / recent.length);
      add(x, -1 / recent.length);
    }
    points.forEach(([x], i) => add(x, -ahead * slopeWeights[i]));
    let variance = 0;
    for (const [a, wa] of weights) for (const [b, wb] of weights) variance += wa * wb * correlation(a, b);
    const reach = spread * Math.sqrt(Math.max(0, noise * variance));
    const center = average + rate.perWeek / 7 * ahead;
    forecast.push({ day: end + ahead, date: dateOf(end + ahead), average: center, low: Math.max(0, center - reach), high: center + reach });
  }
  return { ...rate, from, average, points: forecast };
}

// Whether the weekly trend (see calculateRate) has shown on any day through
// `throughDate`: whether some RATE_MIN_ENTRIES weigh-ins fit in RATE_DAYS days
// and span at least RATE_MIN_SPAN of them. If it showed on any day, it showed
// on the date of the last weigh-in in that day's window, so only those dates
// need checking. The input is a normalized log (one entry per date, ascending).
export function weeklyTrendShown(entries, throughDate) {
  const days = entries.filter(entry => entry.date <= throughDate).map(entry => dayOf(entry.date));
  let first = 0;
  for (let last = 0; last < days.length; last++) {
    while (days[first] <= days[last] - RATE_DAYS) first++;
    if (last - first + 1 >= RATE_MIN_ENTRIES && days[last] - days[first] >= RATE_MIN_SPAN - 1) return true;
  }
  return false;
}

// What the overview has to show on `today`:
// - "empty": no weigh-ins through today.
// - "lapsed": weigh-ins, but none in the WINDOW_DAYS days through today, so
//   there's no 14-day average today.
// - "active": a weigh-in in those days, and so an average today.
// `lastDate` is the last weigh-in's date, `daysAgo` how many days before today
// it was, and `lastAverage` the 14-day average in kg on that date; all three
// are null for an empty log. While the log is active, today's average is the
// same one, as of `lastDate` (see calculateTrend). Weigh-ins dated after today, which a device in a
// time zone ahead can save, don't count until their day comes, as in
// calculateTrend. The input is a normalized log (one entry per date, ascending).
export function logStatus(entries, today) {
  const past = entries.filter(entry => entry.date <= today);
  if (!past.length) return { kind: "empty", lastDate: null, daysAgo: null, lastAverage: null };
  const lastDate = past.at(-1).date;
  const daysAgo = dayOf(today) - dayOf(lastDate);
  return {
    kind: daysAgo < WINDOW_DAYS ? "active" : "lapsed",
    lastDate,
    daysAgo,
    lastAverage: calculateTrend(past, lastDate).current.average
  };
}

// A change per day in kg as a weekly rate, rounded to the 0.1 of `unit` shown.
// For kg this is Math.round(perDay * 70) / 10.
function weeklyTenths(perDay, unit) {
  return Math.round(perDay * (7 * TENTHS_PER_KG[unit])) / TENTHS_PER_KG[unit] || 0;
}

// Progress toward a goal, measured with the 14-day average rounded to the 0.1 of
// `unit` shown on screen. Works in whole tenths of that unit so every comparison
// is exact, and returns kg. Milestone k of n targets start − k × (start − goal) / n,
// and the last is the goal itself. A milestone is never smaller than 0.1 of the
// unit, so a short distance gets fewer of them. Returns null without a goal;
// `current` is null without an average to measure.
export function goalProgress(goal, average, unit = "kg") {
  if (!goal) return null;
  const tenths = weight => toTenths(weight, unit);
  const kg = count => fromTenths(count, unit);
  const start = tenths(goal.startWeight);
  const end = tenths(goal.weight);
  const sign = Math.sign(end - start);
  const total = Math.abs(end - start);
  const count = Math.min(goal.milestones, total);
  const milestones = Array.from({ length: count }, (_, i) => {
    const index = i + 1;
    return { index, weight: kg(index === count ? end : Math.round(start + (end - start) * index / count)) };
  });
  const result = {
    direction: sign < 0 ? "lose" : sign > 0 ? "gain" : "maintain",
    start: kg(start), goal: kg(end), milestones,
    current: null, difference: null, toGo: null, overall: 0, completed: 0, next: null, reached: false, behindStart: 0
  };
  if (!Number.isFinite(average)) return result;
  const current = tenths(average);
  result.current = kg(current);
  result.difference = kg(current - end);
  if (!sign) return result;
  // How far the average has moved from the start toward the goal, in tenths.
  const done = (current - start) * sign;
  const reachedAt = weight => (tenths(weight) - start) * sign <= done;
  result.reached = done >= total;
  result.toGo = kg(Math.max(0, total - done));
  result.overall = Math.min(1, Math.max(0, done / total));
  result.completed = milestones.filter(milestone => reachedAt(milestone.weight)).length;
  result.behindStart = kg(Math.max(0, -done));
  const next = milestones.find(milestone => !reachedAt(milestone.weight));
  if (next) result.next = { ...next, toGo: kg(Math.abs(tenths(next.weight) - current)) };
  return result;
}

export const OVERALL_MIN_DAYS = 14;

// The 14-day average's change since the goal's start, in kg a week, rounded to
// the 0.1 of `unit` shown, like the weekly trend. `average` is the average on
// `throughDate`, which for the current average is its last weigh-in's date, so
// days without a weigh-in don't slow it. Waits OVERALL_MIN_DAYS after the start
// date, so the current average no longer shares most of its weigh-ins with the start.
export function overallRate(goal, average, throughDate, unit = "kg") {
  if (!goal || !Number.isFinite(average)) return null;
  const days = dayOf(throughDate) - dayOf(goal.startDate);
  if (days < OVERALL_MIN_DAYS) return null;
  return weeklyTenths((average - goal.startWeight) / days, unit);
}

export const FAST_LOSS_DAYS = 21;
export const FAST_LOSS_AFTER_DAYS = 14;

// Whether the weight has come down faster than a loss goal's cap
// (maxGoalRate) for a while: on each of the FAST_LOSS_DAYS days up to the last
// weigh-in in the 14 days through `today`, the weekly trend that stood for the
// day (rateAsOf) was moving down (see calculateRate) faster than the cap. Like
// the figures, it's as of the last weigh-in, so days without one don't change
// it. The first of
// those days must be at least FAST_LOSS_AFTER_DAYS after the goal's start date,
// so the water lost in a goal's first weeks doesn't count. The trend and the
// cap are compared as shown, to 0.1 of `unit`.
export function fastLossCaution(entries, goal, today, unit = "kg") {
  if (!goal || goalProgress(goal, null, unit).direction !== "lose") return false;
  const last = asOfDate(entries, today);
  if (!last) return false;
  const end = dayOf(last);
  const from = end - FAST_LOSS_DAYS + 1;
  if (from < dayOf(goal.startDate) + FAST_LOSS_AFTER_DAYS) return false;
  const cap = toTenths(maxGoalRate(goal.startWeight), unit);
  // The weigh-ins that reach the trend on any of those days, through an
  // earlier weigh-in's when a day has none.
  const recent = entries.filter(entry => dayOf(entry.date) > from - WINDOW_DAYS - RATE_DAYS && entry.date <= last);
  for (let day = from; day <= end; day++) {
    const rate = rateAsOf(recent, dateOf(day), unit);
    if (rate?.state !== "moving" || toTenths(-rate.perWeek, unit) <= cap) return false;
  }
  return true;
}

// The last day of a calendar month ("YYYY-MM"), and the month after it.
function lastOfMonth(month) {
  const [year, number] = month.split("-").map(Number);
  return dateOf(Date.UTC(year, number, 0) / DAY_MS);
}

function monthAfter(month) {
  return dateOf(dayOf(lastOfMonth(month)) + 1).slice(0, 7);
}

// The day the 14-day average, as shown, first reached each milestone of `goal`,
// counting from the goal's start date, as a Map from milestone index to day.
// The average changes only on days with a weigh-in (see calculateTrend), so
// that's always a weigh-in's day. Each milestone is listed once, even if the
// average later moved back past it.
function milestoneDays(trend, goal, unit) {
  const days = new Map();
  if (!goal) return days;
  const from = dayOf(goal.startDate);
  let reached = 0;
  for (const point of trend.days) {
    if (point.day < from) continue;
    const { completed } = goalProgress(goal, point.average, unit);
    for (; reached < completed; reached++) days.set(reached + 1, point.day);
  }
  return days;
}

// A summary of each calendar month from the first weigh-in's through today's,
// newest first. The month in progress is `partial` and runs through today.
// Averages are as of a weigh-in (see calculateTrend), and `date` with each is
// that weigh-in's date.
// - `start` is the 14-day average as the month began, on the last day of the
//   month before, so each month picks up where the one before it ended. That's
//   the average on the last weigh-in up to that day, if it came in the 14 days
//   up to it. Otherwise it is the average on the month's first weigh-in.
// - `end` is the average on the month's last weigh-in, which is the average on
//   its last day, so the month's end doesn't drift after its last weigh-in.
// - `change` compares them as shown, to 0.1 of `unit`, in kg. It needs them
//   from different weigh-ins.
// - `rate` is calculateRate on the month's last weigh-in.
// - `low` is the month's lowest weigh-in. A tie goes to the most recent.
// - `milestones` lists, with a goal, the milestones the average first reached
//   that month (see milestoneDays).
// A month without weigh-ins has a `count` of 0 and no figures or milestones.
export function monthlyReports(entries, today, unit = "kg", goal = null) {
  const logged = entries.filter(entry => entry.date <= today);
  if (!logged.length) return [];
  const trend = calculateTrend(logged, today);
  const byDay = new Map(trend.days.map(point => [point.day, point]));
  const reachedOn = [...milestoneDays(trend, goal, unit)];
  const shown = point => ({ date: point.asOf, average: point.average });
  const reports = [];
  const current = today.slice(0, 7);
  let next = 0;
  for (let month = logged[0].date.slice(0, 7); month <= current; month = monthAfter(month)) {
    const first = month + "-01";
    const firstDay = dayOf(first);
    const lastDay = Math.min(dayOf(lastOfMonth(month)), dayOf(today));
    const weighIns = [];
    while (next < logged.length && logged[next].date.slice(0, 7) === month) weighIns.push(logged[next++]);
    const report = {
      month, first, through: dateOf(lastDay), partial: month === current, count: weighIns.length,
      start: null, end: null, change: null, rate: null, low: null,
      milestones: reachedOn.filter(([, day]) => day >= firstDay && day <= lastDay).map(([index]) => index)
    };
    reports.push(report);
    if (!weighIns.length) continue;
    const start = byDay.get(firstDay - 1) ?? byDay.get(dayOf(weighIns[0].date));
    const end = byDay.get(dayOf(weighIns.at(-1).date));
    report.start = shown(start);
    report.end = shown(end);
    if (start.asOf !== end.asOf) report.change = fromTenths(toTenths(end.average, unit) - toTenths(start.average, unit), unit);
    report.rate = calculateRate(logged, end.asOf, unit);
    let low = weighIns[0];
    for (const entry of weighIns) if (entry.weight <= low.weight) low = entry;
    report.low = { date: low.date, weight: low.weight };
  }
  return reports.reverse();
}

export const FORECAST_MAX_DAYS = 5 * 365;

// When the 14-day average would reach each milestone still ahead if it kept
// changing by `perWeek` kg a week from `progress.current`, its value on
// `fromDate`: the last weigh-in, which the average is as of. `days` counts from
// `today`, and is 0 for a milestone the line would already have reached.
// Returns null when the rate is flat or heads away from the goal. `date` is
// null past FORECAST_MAX_DAYS.
export function forecastGoal(progress, perWeek, fromDate, today = fromDate) {
  if (!progress?.next || !Number.isFinite(perWeek) || Math.sign(perWeek) !== (progress.direction === "lose" ? -1 : 1)) return null;
  const from = dayOf(fromDate);
  const now = dayOf(today);
  return progress.milestones.filter(milestone => milestone.index >= progress.next.index).map(milestone => {
    const days = Math.max(0, from + Math.round(Math.abs(milestone.weight - progress.current) / Math.abs(perWeek) * 7) - now);
    return { ...milestone, days, date: days > FORECAST_MAX_DAYS ? null : dateOf(now + days) };
  });
}

// Body fat at each waist measurement through `today`, oldest first. The weight
// is the 14-day average on the day of the measurement, so one heavy or light
// day moves the estimate little, and a later weigh-in in those 14 days updates
// it. On a day without a weigh-in, that's the average as of the last one (see
// calculateTrend). `weight` is null without an average that day; `bodyFat` is
// null then, or without a sex, or outside the formula's range (see bodyFat).
export function bodyFatHistory(entries, waists, sex, today) {
  const measured = waists.filter(item => item.date <= today);
  if (!measured.length) return [];
  const averages = new Map(calculateTrend(entries, measured.at(-1).date).days.map(point => [point.day, point.average]));
  return measured.map(({ date, waist }) => {
    const day = dayOf(date);
    const weight = averages.get(day) ?? null;
    return { date, day, waist, weight, bodyFat: weight === null ? null : bodyFat(weight, waist, sex) };
  });
}

// The change from the first body fat estimate to the latest, using both as
// shown, to 0.1 of a percent. Null with fewer than two estimates.
export function bodyFatChange(history) {
  const estimates = history.filter(point => point.bodyFat !== null);
  if (estimates.length < 2) return null;
  const from = estimates[0];
  const to = estimates.at(-1);
  return { from, to, change: (Math.round(to.bodyFat * 10) - Math.round(from.bodyFat * 10)) / 10 };
}
