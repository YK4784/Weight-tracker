import { CONSENT_VERSION, GOAL_MAX_MILESTONES, GOAL_MIN_RATE, GOAL_STORED_MAX_RATE, HEIGHT_UNITS, NOTE_MAX_LENGTH, SEXES, WAIST_MAX, WAIST_MIN, WEIGHT_UNITS, cleanNote, dateOf, dayOf, goalRateAllowed, noteLength, normalizeState, preferencesChange, roundHeight, roundRate, roundWaist, roundWeight, validDate, validTimeZone } from "../baseline/dist/model.mjs";
import { parseSubscription } from "./push.mjs";

export const MAX_IMPORT_ENTRIES = 20_000;
// What a deletion's `confirm` must be. The app sends it once the user has typed it.
export const DELETE_WORD = "delete";

// Changes that save nothing new, so an account that hasn't agreed to the
// health data policy can still make them: agreeing, and taking data away.
// Every other change needs the agreement, including any op added later.
export const OPS_WITHOUT_CONSENT = ["consent", "delete-weight", "delete-waist", "clear-goal", "clear-reminder", "delete-data", "delete-account"];

// Whether a change needs the account's agreement to the current policy (see
// require_consent in schema.mjs). Reading the log never does.
export const needsConsent = change => Boolean(change) && !OPS_WITHOUT_CONSENT.includes(change.op);

// The SQLSTATE require_consent raises, and the error the store turns it into.
export const CONSENT_ERROR_CODE = "BL403";
export class ConsentRequired extends Error {
  constructor() {
    super("Agree to the health data policy first.");
    this.name = "ConsentRequired";
  }
}

const inRange = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

// Clients log by their own calendar date. A day past UTC's date covers every time zone.
export function latestDate(now = new Date()) {
  return dateOf(dayOf(now.toISOString().slice(0, 10)) + 1);
}

// Checks a change sent by the app. Returns the cleaned change, or null if it is invalid.
export function parseOp(body, now = new Date()) {
  const latest = latestDate(now);
  switch (body?.op) {
    case "save-weight":
    case "update-weight": {
      if (!validDate(body.date) || body.date > latest || !inRange(body.weight, 0.1, 2000)) return null;
      const change = { op: body.op, date: body.date, weight: roundWeight(body.weight) };
      // Without a note the existing one stays; null or "" removes it.
      if (body.note === undefined) return change;
      if (body.note !== null && typeof body.note !== "string") return null;
      const note = cleanNote(body.note);
      return note && noteLength(note) > NOTE_MAX_LENGTH ? null : { ...change, note };
    }
    case "delete-weight":
      return validDate(body.date) ? { op: body.op, date: body.date } : null;
    case "set-height":
      return inRange(body.height, 0.1, 400) ? { op: body.op, height: roundHeight(body.height) } : null;
    // A waist measurement in cm, kept to 0.01 cm, and the sex whose body fat
    // formula applies, which is saved to the profile with it.
    case "save-waist":
      return validDate(body.date) && body.date <= latest && inRange(body.waist, WAIST_MIN, WAIST_MAX) && SEXES.includes(body.sex)
        ? { op: body.op, date: body.date, waist: roundWaist(body.waist), sex: body.sex } : null;
    case "delete-waist":
      return validDate(body.date) ? { op: body.op, date: body.date } : null;
    // A new or edited goal's target rate can be no faster than the cap for its
    // start weight (see maxGoalRate in model.mjs). Goals stored before the cap
    // keep their rate until they are saved again.
    case "set-goal": {
      const goal = body.goal;
      const valid = inRange(goal?.weight, 0.1, 2000) && inRange(goal.startWeight, 0.1, 2000)
        && validDate(goal.startDate) && goal.startDate <= latest
        && (goal.rate == null || inRange(goal.rate, GOAL_MIN_RATE, GOAL_STORED_MAX_RATE) && goalRateAllowed(goal.rate, roundWeight(goal.startWeight)))
        && Number.isInteger(goal.milestones) && goal.milestones >= 1 && goal.milestones <= GOAL_MAX_MILESTONES;
      return valid ? { op: body.op, goal: {
        weight: roundWeight(goal.weight), startDate: goal.startDate, startWeight: roundWeight(goal.startWeight),
        rate: goal.rate == null ? null : roundRate(goal.rate), milestones: goal.milestones
      } } : null;
    }
    // The units the app shows. Weights are always stored in kg and heights in cm.
    case "set-units": {
      const units = body.units;
      return WEIGHT_UNITS.includes(units?.weight) && HEIGHT_UNITS.includes(units.height)
        ? { op: body.op, units: { weight: units.weight, height: units.height } } : null;
    }
    // Some of the preferences (see PREFERENCE_KEYS in model.mjs), such as
    // whether the overview shows BMI. Every key must be known and have the
    // right type, or the whole change is turned down. Keys left out keep
    // their saved value (see store.mjs).
    case "set-preferences": {
      const preferences = preferencesChange(body.preferences);
      return preferences ? { op: body.op, preferences } : null;
    }
    // A daily reminder at a whole hour in the account's time zone. The
    // subscription, when given, adds the device it came from (see push.mjs).
    case "set-reminder": {
      if (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23 || !validTimeZone(body.timeZone)) return null;
      const change = { op: body.op, hour: body.hour, timeZone: body.timeZone };
      if (body.subscription === undefined) return change;
      const subscription = parseSubscription(body.subscription);
      return subscription ? { ...change, subscription } : null;
    }
    // Agreement to the health data policy, which the server records with the
    // time it arrives. Only the current version counts, so an app that shows
    // an older policy can't agree on the user's behalf to the newer one.
    case "consent":
      return body.version === CONSENT_VERSION ? { op: body.op, version: CONSENT_VERSION } : null;
    // Turns reminders off on every device.
    case "clear-reminder":
    case "clear-goal":
    case "start":
      return { op: body.op };
    // Deletes everything in the log and keeps the account, or deletes the
    // account's every row before the app deletes the Clerk user. Each needs the
    // word the user typed to confirm it, so a stray request can't delete anything.
    case "delete-data":
    case "delete-account":
      return body.confirm === DELETE_WORD ? { op: body.op } : null;
    case "import": {
      const log = body.log;
      if (typeof log !== "object" || log === null) return null;
      if (log.entries !== undefined && (!Array.isArray(log.entries) || log.entries.length > MAX_IMPORT_ENTRIES)) return null;
      const clean = normalizeState(log);
      return { op: body.op, height: clean.height === null ? null : roundHeight(clean.height), entries: clean.entries.filter(entry => entry.date <= latest) };
    }
    default:
      return null;
  }
}
