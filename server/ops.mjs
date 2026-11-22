import { GOAL_MAX_MILESTONES, GOAL_MAX_RATE, GOAL_MIN_RATE, HEIGHT_UNITS, NOTE_MAX_LENGTH, WEIGHT_UNITS, cleanNote, dateOf, dayOf, noteLength, normalizeState, roundHeight, roundRate, roundWeight, validDate } from "../baseline/dist/model.mjs";

export const MAX_IMPORT_ENTRIES = 20_000;

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
    case "set-goal": {
      const goal = body.goal;
      const valid = inRange(goal?.weight, 0.1, 2000) && inRange(goal.startWeight, 0.1, 2000)
        && validDate(goal.startDate) && goal.startDate <= latest
        && (goal.rate == null || inRange(goal.rate, GOAL_MIN_RATE, GOAL_MAX_RATE))
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
    case "clear-goal":
    case "start":
      return { op: body.op };
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
