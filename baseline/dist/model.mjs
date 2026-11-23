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
function shortNote(value) {
  const note = cleanNote(value);
  return note && noteLength(note) > NOTE_MAX_LENGTH ? [...note].slice(0, NOTE_MAX_LENGTH).join("").trim() : note;
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
      byDate.set(item.date, { date: item.date, weight: roundWeight(item.weight), note: shortNote(item.note) });
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
  return { version: 1, started: Boolean(value?.started || entries.length || height || goal || waists.length), consent, height, sex, goal, units, preferences, reminder, entries, waists };
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
// already on that date; null or "" removes it. The server does the same.
export function saveWeight(state, date, weight, note) {
  if (!validDate(date) || !validWeight(weight)) throw new Error("Enter a valid date and weight.");
  const kept = note === undefined ? state.entries.find(entry => entry.date === date)?.note : note;
  return normalizeState({ ...state, started: true, entries: [...state.entries, { date, weight, note: kept }] });
}

// The label of the bar that logs today's weight on phones: "Log today’s
// weight", or once today has a weigh-in, "Today 84.9 kg · Edit" in the chosen
// unit. `spoken` is the same for screen readers, which may read "st" as
// "street".
export function todayLabel(entries, today, unit = "kg") {
  const entry = entries.find(item => item.date === today);
  if (!entry) return { text: "Log today’s weight", spoken: "Log today’s weight" };
  return { text: "Today " + formatWeight(entry.weight, unit) + " · Edit", spoken: "Today " + spokenWeight(entry.weight, unit) + ", edit" };
}

// The heading of the sheet that logs today's weight: "Today, Mon Nov 23".
export function todayHeading(today) {
  return "Today, " + prettyDate(today, "dayName") + " " + prettyDate(today);
}

// The changes that can wait on the device while it's offline and be sent
// later, in order (see the outbox in app.mjs). Reminders need a live push
// subscription, so they aren't among them. Agreeing to the health data policy
// can wait too, and goes ahead of the changes it allows (see agree in app.mjs).
export const QUEUEABLE_OPS = ["save-weight", "update-weight", "delete-weight", "set-height", "save-waist", "delete-waist", "set-goal", "clear-goal", "set-units", "set-preferences", "consent"];

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

// The input is a normalized log (one entry per date, ascending). Emit averages
// for unlogged days too, while there is still a measurement inside the window.
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
  while (day <= end && (next < source.length || left < next)) {
    while (left < next && source[left].day < day - WINDOW_DAYS + 1) {
      sum -= source[left++].hundredths;
    }
    if (left === next && next < source.length) day = Math.max(day, source[next].day);
    if (day > end) break;
    let entry = null;
    if (source[next]?.day === day) {
      entry = source[next++];
      sum += entry.hundredths;
    }
    const count = next - left;
    if (count) {
      const point = { day, date: dateOf(day), weight: entry?.weight ?? null, note: entry?.note ?? null, average: sum / (count * 100), count };
      days.push(point);
      if (entry) readings.push(point);
    }
    day++;
  }
  const last = days.at(-1);
  return { days, readings, current: last?.day === end ? last : null };
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
// 0.1 of `unit` shown on screen. `trend` comes from calculateTrend through today. A window is
// left out when there is no average exactly that many days ago: the log is
// shorter than the window, or a gap of more than 14 days leaves that day without
// one. The change since the first weigh-in needs the log to go back further than
// the longest window shown, and further than a week, so it never repeats another
// figure. Empty without an average today.
export function averageChanges(trend, unit = "kg") {
  const now = trend.current;
  if (!now) return [];
  const byDay = new Map(trend.days.map(point => [point.day, point]));
  const since = point => fromTenths(toTenths(now.average, unit) - toTenths(point.average, unit), unit);
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
// least RATE_MIN_SPAN days, otherwise returns null. `perWeek` is in kg, rounded
// to the 0.1 of `unit` shown. `clear` is false when the slope is too close to
// flat to tell apart from scale noise.
export function calculateRate(entries, throughDate, unit = "kg") {
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
  const perWeek = weeklyTenths(slope, unit);
  return { perWeek, clear: perWeek !== 0 && Math.abs(slope) > RATE_CLEAR_ERRORS * error, count: n };
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
// the 0.1 of `unit` shown, like the weekly trend. Waits OVERALL_MIN_DAYS after the start date, so
// the current average no longer shares most of its weigh-ins with the start.
export function overallRate(goal, average, throughDate, unit = "kg") {
  if (!goal || !Number.isFinite(average)) return null;
  const days = dayOf(throughDate) - dayOf(goal.startDate);
  if (days < OVERALL_MIN_DAYS) return null;
  return weeklyTenths((average - goal.startWeight) / days, unit);
}

export const FAST_LOSS_DAYS = 21;
export const FAST_LOSS_AFTER_DAYS = 14;

// Whether the weight has come down faster than a loss goal's cap
// (maxGoalRate) for a while: on each of the last FAST_LOSS_DAYS days through
// `today`, the weekly trend (calculateRate) was a clear fall faster than the
// cap. The first of those days must be at least FAST_LOSS_AFTER_DAYS after the
// goal's start date, so the water lost in a goal's first weeks doesn't count.
// The trend and the cap are compared as shown, to 0.1 of `unit`.
export function fastLossCaution(entries, goal, today, unit = "kg") {
  if (!goal || goalProgress(goal, null, unit).direction !== "lose") return false;
  const end = dayOf(today);
  const from = end - FAST_LOSS_DAYS + 1;
  if (from < dayOf(goal.startDate) + FAST_LOSS_AFTER_DAYS) return false;
  const cap = toTenths(maxGoalRate(goal.startWeight), unit);
  // The weigh-ins that reach the trend on any of those days.
  const recent = entries.filter(entry => dayOf(entry.date) > from - RATE_DAYS);
  for (let day = from; day <= end; day++) {
    const rate = calculateRate(recent, dateOf(day), unit);
    if (!rate?.clear || toTenths(-rate.perWeek, unit) <= cap) return false;
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
// Each milestone is listed once, even if the average later moved back past it.
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
// - `start` is the 14-day average as the month began, on the last day of the
//   month before, so each month picks up where the one before it ended. Without
//   an average that day, it is the average on the month's first weigh-in.
// - `end` is the average on the month's last day, or the last average in the
//   month if the average had run out by then.
// - `change` compares them as shown, to 0.1 of `unit`, in kg. It needs them on
//   different days.
// - `rate` is calculateRate on the month's last day.
// - `low` is the month's lowest weigh-in. A tie goes to the most recent.
// - `milestones` lists, with a goal, the milestones the average first reached
//   that month (see milestoneDays).
// A month without weigh-ins has a `count` of 0 and no figures, but it can
// still have milestones, since the average moves as old weigh-ins leave it.
export function monthlyReports(entries, today, unit = "kg", goal = null) {
  const logged = entries.filter(entry => entry.date <= today);
  if (!logged.length) return [];
  const trend = calculateTrend(logged, today);
  const byDay = new Map(trend.days.map(point => [point.day, point]));
  const reachedOn = [...milestoneDays(trend, goal, unit)];
  const shown = point => ({ date: point.date, average: point.average });
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
    let endDay = lastDay;
    while (!byDay.has(endDay)) endDay--;
    const end = byDay.get(endDay);
    report.start = shown(start);
    report.end = shown(end);
    if (start.day !== end.day) report.change = fromTenths(toTenths(end.average, unit) - toTenths(start.average, unit), unit);
    report.rate = calculateRate(logged, report.through, unit);
    let low = weighIns[0];
    for (const entry of weighIns) if (entry.weight <= low.weight) low = entry;
    report.low = { date: low.date, weight: low.weight };
  }
  return reports.reverse();
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

// Body fat at each waist measurement through `today`, oldest first. The weight
// is the 14-day average on the day of the measurement, so one heavy or light
// day moves the estimate little, and a later weigh-in in those 14 days updates
// it. `weight` is null without an average that day; `bodyFat` is null then, or
// without a sex, or outside the formula's range (see bodyFat).
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
