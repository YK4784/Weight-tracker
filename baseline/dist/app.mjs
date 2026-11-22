import { CM_PER_IN, FORECAST_MAX_DAYS, GOAL_MILESTONES, KG_PER_LB, OVERALL_MIN_DAYS, RATE_DAYS, RATE_MIN_ENTRIES, RATE_MIN_SPAN, SEXES, WINDOW_DAYS, averageChanges, bmi, bodyFat, bodyFatChange, bodyFatHistory, calculateRate, calculateTrend, cleanNote, dateOf, dayOf, forecastGoal, formatAmount, formatWaist, formatWeight, fromTenths, goalProgress, groupByMonth, heightParts, localToday, monthlyReports, normalizeGoal, normalizeState, oneDecimal, overallRate, positive, prettyDate, recentRange, roundHeight, roundWaist, roundWeight, saveWaist, saveWeight, shiftDate, spokenHeight, spokenWeight, toTenths, validDate, validWaist, waistParts, waistTenths, weightParts } from "./model.mjs";
import { BodyFatChart, TrendChart } from "./chart.mjs";
import { claimLegacyLog, storageKeyFor } from "./account.mjs";
import { AuthSetupError, startClerk } from "./auth.mjs";
import { PUSH_PUBLIC_KEY } from "./config.mjs";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 15;
const WAIST_ROWS = 5; // Waist measurements listed before "Show all".
const chart = new TrendChart();
const fatChart = new BodyFatChart();
let today = localToday();
let clerk;
let mounted = null; // Which Clerk component is on the page: "sign-in" or "user".
let account = null; // { id, email } of the signed-in user.
let session = null; // The open log. Replies meant for an earlier one are ignored.
let state = null; // The log on screen. Null while signed out or loading.
let saved = null; // The log as the server last returned it.
let queue = Promise.resolve(); // Changes reach the server one at a time, in order.
let unsaved = 0; // Changes sent and not yet answered.
let trend;
let weeklyRate; // calculateRate for today, or null.
let progress; // goalProgress for today's average, or null without a goal.
let fat = []; // bodyFatHistory through today: each waist measurement and its estimate.
let allWaists = false; // Whether the body fat table lists every measurement.
let waistAutoFill = true; // The waist dialog shows the measurement on its date until the user types in it.
let deletingWaist = null; // The date of the waist measurement waiting for the user to confirm its deletion.
let rateSource = null; // The rate the forecast uses. Null picks one from the goal.
let startWeightFrom = "average"; // Where the goal dialog's start weight came from: "average", "saved" or "typed".
let range = "30";
let page = 0;
let editingDate = null;
let autoFill = true; // The log form shows the weigh-in on its date until the user types in it.
let fieldUnits = null; // The units the inputs are set up for, which follow state.units.
let toastTimer;
let worker = null; // The service worker's registration, which receives reminders. Null until it's ready or where there is none.
let deviceEndpoint = null; // This device's push subscription, if it has one.

function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  toastTimer = setTimeout(() => { $("toast").textContent = ""; }, 3600);
}

// Reads the log, or applies one change to it on the server (see server/ops.mjs).
// Resolves to { log, ... } as the server returns it.
async function sendLog(change = null) {
  const token = await clerk.session?.getToken();
  if (!token) throw new Error("Not signed in.");
  const response = await fetch("/api/log", {
    method: change ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, ...(change && { "Content-Type": "application/json" }) },
    body: change ? JSON.stringify(change) : undefined,
    cache: "no-store"
  });
  if (!response.ok) throw new Error("The log request failed with status " + response.status + ".");
  return response.json();
}

// Shows a change at once, then saves it. Once nothing else is on its way, the
// server's copy replaces the screen. A failed save falls back to the server's copy.
// Resolves to the server's reply, or null if the change wasn't saved.
async function changeState(change, request) {
  const current = session;
  state = normalizeState(change(state));
  render();
  unsaved++;
  const reply = queue.then(() => sendLog(request));
  queue = reply.catch(() => {});
  let result = null;
  try { result = await reply; } catch (error) { console.error(error); }
  if (session !== current) return null;
  unsaved--;
  if (result) saved = normalizeState(result.log);
  if (!result || !unsaved) {
    state = saved;
    render();
  }
  if (!result) notify("Couldn’t save that change. Check your connection and try again.");
  return result;
}

function icon(name) {
  return '<svg class="icon" aria-hidden="true"><use href="./icons.svg#' + name + '"></use></svg>';
}

function shortDate(date) {
  return date.slice(0, 4) === today.slice(0, 4) ? prettyDate(date) : prettyDate(date, "full");
}

// Weights are stored in kg and shown in the user's unit (see weightParts).
const unit = () => state.units.weight;
// "61.6 kg", "135.8 lb" or "9 st 9.8 lb".
const weight = kg => formatWeight(kg, unit());
// A change in weight without its sign: kg, or pounds for stones too.
const amount = kg => formatAmount(kg, unit());
const rateUnit = () => unit() === "kg" ? "kg" : "lb";
const perUnit = kg => unit() === "kg" ? kg : kg / KG_PER_LB;
// A weight in a table: numbers with small units. Phones leave out the "lb"
// after stones to fit ("9 st 9.8").
const weightCell = kg => weightParts(kg, unit()).map(([number, name], index) => number + '<span class="table-unit' + (index ? " after-stones" : "") + '">' + name + "</span>").join(" ");

// Missing values show a quiet dash instead of a big bold one.
function setText(id, text) {
  $(id).textContent = text ?? "—";
  $(id).classList.toggle("is-empty", text == null);
}

function setValue(id, value) {
  setText(id, Number.isFinite(value) ? oneDecimal(value) : null);
}

function setWeight(id, kg) {
  setText(id, Number.isFinite(kg) ? weight(kg) : null);
}

function showHero(average) {
  const hero = $("hero");
  hero.classList.toggle("is-empty", !Number.isFinite(average));
  if (!Number.isFinite(average)) {
    hero.textContent = "—";
    return;
  }
  hero.replaceChildren(...weightParts(average, unit()).flatMap(([number, name]) => {
    const unitSpan = document.createElement("span");
    unitSpan.className = "hero-unit";
    unitSpan.textContent = name;
    return [number, unitSpan];
  }));
}

function showMetrics() {
  const latest = trend.readings.at(-1);
  const height = state.height;
  showHero(trend.current?.average);
  const count = trend.current?.count ?? 0;
  $("avg-detail").textContent = count ? "From " + count + (count === 1 ? " weigh-in" : " weigh-ins") + " in the last 14 days" : "No weigh-ins in the last 14 days";
  showRate();
  showFigures();
  setWeight("weight-value", latest?.weight);
  $("weight-detail").textContent = latest ? shortDate(latest.date) : "";
  setText("height-value", height ? heightParts(height, state.units.height).map(part => part.join(" ")).join(" ") : null);
  $("height-label").textContent = height ? "Edit" : "Add";
  $("height-label").setAttribute("aria-label", height ? "Edit height, currently " + spokenHeight(height, state.units.height) : "Add your height for BMI");
  setValue("bmi-value", bmi(latest?.weight, height));
  showFatFact();
  showGoal();
  showReminder();
}

// Body fat as shown, to 0.1 of a percent: "24.3%".
const percent = value => oneDecimal(value) + "%";

function signedPercent(change) {
  return (change < 0 ? "−" : change > 0 ? "+" : "") + percent(Math.abs(change));
}

// Waists follow the height unit: centimeters, or inches for feet and inches.
const waist = cm => formatWaist(cm, state.units.height);

// A change in waist between two measurements as shown: "−3.0 cm".
function waistChange(from, to) {
  const tenths = waistTenths(to, state.units.height) - waistTenths(from, state.units.height);
  return (tenths < 0 ? "−" : tenths > 0 ? "+" : "") + oneDecimal(Math.abs(tenths) / 10) + " " + waistParts(to, state.units.height)[0][1];
}

// The latest waist measurement's estimate, among the facts. The section at the
// bottom of the overview has the rest.
function showFatFact() {
  const latest = fat.at(-1);
  setText("fat-value", latest?.bodyFat == null ? null : percent(latest.bodyFat));
  $("fat-detail").textContent = latest ? shortDate(latest.date) : "";
  $("fat-label").textContent = latest ? "Update" : "Add";
  $("fat-label").setAttribute("aria-label", latest ? "Log a new waist measurement for body fat" : "Add a waist measurement to estimate body fat");
}

// Up to two decimals, as the target rate is entered, and at least one.
const rateFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function showGoal() {
  const goal = state.goal;
  setWeight("goal-value", goal?.weight);
  $("goal-label").textContent = goal ? "Edit" : "Set";
  $("goal-label").setAttribute("aria-label", goal ? "Edit your goal of " + spokenWeight(goal.weight, unit()) : "Set a goal weight");
  showProgress();
  showForecast();
}

// A bold lead followed by quieter detail, as in the weekly trend line.
function writeLine(element, lead, rest = "") {
  const strong = document.createElement("strong");
  strong.textContent = lead;
  element.replaceChildren(strong, rest);
}

function showProgress() {
  $("goal-progress").hidden = !progress;
  if (!progress) return;
  const note = $("progress-note");
  const { current, direction } = progress;
  $("progress-track").hidden = current === null || direction === "maintain";
  note.classList.toggle("is-pending", current === null);
  if (current === null) {
    note.textContent = "Log a weigh-in to see your progress toward " + weight(progress.goal) + ".";
    return;
  }
  if (direction === "maintain") {
    const off = progress.difference;
    if (off === 0) writeLine(note, "At your goal", " of " + weight(progress.goal));
    else writeLine(note, amount(off) + (off > 0 ? " above" : " below"), " your goal of " + weight(progress.goal));
    return;
  }
  const count = progress.milestones.length;
  $("progress-fill").style.width = progress.overall * 100 + "%";
  $("progress-track").replaceChildren($("progress-fill"), ...progress.milestones.slice(0, -1).map(milestone => {
    const tick = document.createElement("span");
    tick.className = "progress-tick";
    tick.style.left = milestone.index / count * 100 + "%";
    return tick;
  }));
  const losing = direction === "lose";
  if (progress.reached) {
    const past = Math.abs(progress.difference);
    writeLine(note, "Goal reached", past ? " · " + amount(past) + (losing ? " below " : " above ") + weight(progress.goal) : "");
    return;
  }
  const details = [];
  if (progress.behindStart) details.push(amount(progress.behindStart) + (losing ? " above" : " below") + " where you started");
  else {
    if (progress.next.index < count) details.push(amount(progress.next.toGo) + " to milestone " + progress.next.index + " of " + count);
    details.push(Math.floor(progress.overall * 100) + "% of the way");
  }
  writeLine(note, amount(progress.toGo) + " to go", details.map(text => " · " + text).join(""));
}

function signedRate(perWeek) {
  return (perWeek < 0 ? "−" : perWeek > 0 ? "+" : "") + rateFormat.format(Math.abs(perUnit(perWeek))) + " " + rateUnit() + "/wk";
}

function setRate(id, text, empty = false) {
  $(id).textContent = text;
  $(id).classList.toggle("is-empty", empty);
}

function duration(days) {
  if (days < 14) return days + (days === 1 ? " day" : " days");
  if (days < 63) return "about " + Math.round(days / 7) + " weeks";
  return "about " + Math.round(days / 30.44) + " months";
}

function expected(row) {
  if (!row.date) return "Over " + FORECAST_MAX_DAYS / 365 + " years";
  return row.days ? shortDate(row.date) : "Any day now";
}

// The forecast shows only while there is distance left to cover.
function showForecast() {
  const open = Boolean(progress?.next) && progress.direction !== "maintain";
  $("forecast").hidden = !open;
  if (!open) return;
  const goal = state.goal;
  const sign = progress.direction === "lose" ? -1 : 1;
  const overall = overallRate(goal, trend.current.average, today, unit());
  const source = rateSource ?? (goal.rate ? "committed" : "current");
  for (const input of $("rate-choice").querySelectorAll("input")) input.checked = input.value === source;

  setRate("rate-committed", goal.rate ? signedRate(sign * goal.rate) : "Not set", !goal.rate);
  setRate("rate-current", !weeklyRate ? "Not yet" : weeklyRate.clear ? signedRate(weeklyRate.perWeek) : "No clear change", !weeklyRate?.clear);
  $("rate-overall-name").textContent = "Since " + shortDate(goal.startDate);
  setRate("rate-overall", overall === null ? "Not yet" : overall ? signedRate(overall) : "No change", !overall);

  const lead = $("forecast-lead");
  const away = "away from your goal, so there’s no date to forecast.";
  const perWeek = { committed: goal.rate && sign * goal.rate, current: weeklyRate?.clear ? weeklyRate.perWeek : null, overall }[source];
  const rows = forecastGoal(progress, perWeek, today);
  $("forecast-table").hidden = !rows || rows.length < 2;
  if (!rows) {
    if (source === "committed") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.dataset.goalRate = "";
      button.textContent = "Add a target rate";
      lead.replaceChildren(button, " to forecast from the pace you’re aiming for.");
    } else if (source === "current") {
      lead.textContent = !weeklyRate ? "Your weekly trend shows after " + RATE_MIN_ENTRIES + " weigh-ins over " + RATE_MIN_SPAN / 7 + " weeks."
        : !weeklyRate.clear ? "Your weight shows no clear change over the last " + RATE_DAYS / 7 + " weeks, so there’s no date to forecast."
        : "Your weight is going " + (weeklyRate.perWeek > 0 ? "up" : "down") + " over the last " + RATE_DAYS / 7 + " weeks, " + away;
    } else {
      lead.textContent = overall === null ? "Your rate since you started shows from " + shortDate(dateOf(dayOf(goal.startDate) + OVERALL_MIN_DAYS)) + "."
        : !overall ? "Your 14-day average hasn’t changed since " + shortDate(goal.startDate) + ", so there’s no date to forecast."
        : "Your 14-day average is " + (overall > 0 ? "higher" : "lower") + " than when you started, " + away;
    }
    return;
  }
  const last = rows.at(-1);
  const pace = "At " + rateFormat.format(Math.abs(perUnit(perWeek))) + " " + rateUnit() + " a week, ";
  if (!last.date) lead.textContent = pace + weight(progress.goal) + " is more than " + FORECAST_MAX_DAYS / 365 + " years away.";
  else if (!last.days) lead.textContent = pace + "you’d reach " + weight(progress.goal) + " any day now.";
  else {
    const strong = document.createElement("strong");
    strong.textContent = shortDate(last.date);
    lead.replaceChildren(pace + "you’d reach " + weight(progress.goal) + " around ", strong, ", in " + duration(last.days) + ".");
  }
  const count = progress.milestones.length;
  $("forecast-rows").innerHTML = rows.map(row => "<tr><td>" + (row.index === count ? "Goal" : row.index + " of " + count) + "</td>" +
    '<td class="num">' + weightCell(row.weight) + '</td><td class="num">' + expected(row) + "</td></tr>").join("");
}

function showRate() {
  const line = $("rate-detail");
  line.hidden = !state.entries.length;
  line.classList.toggle("is-pending", !weeklyRate);
  if (!weeklyRate) {
    line.textContent = "Your weekly trend shows after " + RATE_MIN_ENTRIES + " weigh-ins over " + RATE_MIN_SPAN / 7 + " weeks.";
    return;
  }
  const strong = document.createElement("strong");
  strong.textContent = !weeklyRate.clear ? "No clear change"
    : (weeklyRate.perWeek < 0 ? "Down " : "Up ") + amount(weeklyRate.perWeek) + " a week";
  line.replaceChildren(strong, " over the last " + RATE_DAYS / 7 + " weeks");
}

function signedAmount(kg) {
  return (kg < 0 ? "−" : kg > 0 ? "+" : "") + amount(kg);
}

function daysAgo(days) {
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : days + " days ago";
}

// One label and value in a row of figures, styled like the facts. A null
// value shows a quiet dash, read out as `missing`. A `quiet` value is a word
// rather than a figure, such as "No clear change".
function figure(label, value, note = "", missing = "", quiet = false) {
  const item = document.createElement("div");
  item.className = "fact";
  const term = document.createElement("dt");
  term.textContent = label;
  const number = document.createElement("span");
  number.className = "fact-value";
  number.classList.toggle("is-empty", value === null || quiet);
  if (value === null) {
    number.innerHTML = '<span aria-hidden="true">—</span><span class="sr-only"></span>';
    number.lastChild.textContent = missing;
  } else number.textContent = value;
  const detail = document.createElement("dd");
  detail.append(number);
  if (note) {
    const span = document.createElement("span");
    span.className = "fact-note";
    span.textContent = note;
    detail.append(span);
  }
  item.append(term, detail);
  return item;
}

// Changes in the average and the recent high and low, above the chart. They
// need a weigh-in in the last 14 days, like the average itself.
function showFigures() {
  $("trend-figures").hidden = !trend.current;
  if (!trend.current) return;
  const changes = averageChanges(trend, unit());
  $("change-figures").hidden = !changes.length;
  $("change-pending").hidden = changes.length > 0;
  $("change-figures").replaceChildren(...changes.map(({ days, change }) => figure(days === null ? "All-time change" : days + "-day change", signedAmount(change))));
  const recent = recentRange(state.entries, today);
  $("range-figures").hidden = !recent;
  $("range-figures").replaceChildren(...!recent ? [] : [
    figure("Highest in " + WINDOW_DAYS + " days", weight(recent.high.weight), daysAgo(recent.high.daysAgo)),
    figure("Lowest in " + WINDOW_DAYS + " days", weight(recent.low.weight), daysAgo(recent.low.daysAgo))
  ]);
}

function syncEntryForm() {
  const date = $("entry-date").value;
  const entry = state.entries.find(item => item.date === date);
  if (autoFill) {
    writeWeight("entry-weight", entry?.weight);
    $("entry-note").value = entry?.note ?? "";
  }
  // aria-disabled keeps the button focusable when repeated presses reach today.
  $("next-day").setAttribute("aria-disabled", String(validDate(date) && date >= today));
  $("save-label").textContent = entry ? "Update entry" : "Save entry";
  $("entry-hint").textContent = !state.entries.length ? "Your first weigh-in starts your log."
    : entry ? "You have a weigh-in on this date." : "Choose an earlier date to add a past weigh-in.";
}

// The weekly trend as it stood on a row's date (see showRate). Phones head the
// column "Per week" and drop the "/wk".
function rateCell(rate) {
  if (!rate) return '<span class="dash" aria-hidden="true">—</span><span class="sr-only">Not enough weigh-ins</span>';
  if (!rate.clear) return '<span class="rate-cell unclear">No clear change</span>';
  const [number, name] = amount(rate.perWeek).split(" ");
  return '<span class="rate-cell">' + (rate.perWeek < 0 ? "−" : "+") + number + '</span><span class="table-unit">' + name + '<span class="long-label">/wk</span></span>';
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => "&#" + char.charCodeAt(0) + ";");

// A table's date: the weekday this year, and shorter on phones.
function dateCell(date) {
  return '<td><time datetime="' + date + '"><span class="long-label">' + (date.slice(0, 4) === today.slice(0, 4) ? prettyDate(date, "weekday") : prettyDate(date, "full")) +
    '</span><span class="short-label">' + shortDate(date) + "</span></time></td>";
}

// A quiet dash in a table, with what it means for screen readers.
function dashCell(meaning) {
  return '<span class="dash" aria-hidden="true">—</span><span class="sr-only">' + meaning + "</span>";
}

// A weigh-in's row, and its note on a row of its own underneath.
function entryRows(point) {
  const date = prettyDate(point.date, "full");
  const row = "<tr" + (point.note ? ' class="has-note"' : "") + ">" + dateCell(point.date) +
    '<td class="num entry-weight">' + weightCell(point.weight) + "</td>" +
    '<td class="num">' + weightCell(point.average) + "</td>" +
    '<td class="num">' + rateCell(calculateRate(state.entries, point.date, unit())) + "</td>" +
    '<td class="row-action"><button type="button" class="icon-button" data-edit="' + point.date + '" aria-label="Edit weigh-in for ' + date + '">' + icon("pencil") + "</button></td></tr>";
  return point.note ? row + '<tr class="note-row"><td colspan="5"><span class="sr-only">Note: </span>' + escapeHtml(point.note) + "</td></tr>" : row;
}

// The log page groups each page's rows by month. A month that carries over
// from the previous page gets its heading again.
function showTable(isLog) {
  const readings = trend.readings;
  const total = readings.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const offset = isLog ? page * PAGE_SIZE : 0;
  const rows = readings.slice(Math.max(0, total - offset - (isLog ? PAGE_SIZE : 5)), total - offset).reverse();
  $("entries-title").textContent = isLog ? "All entries" : "Recent entries";
  $("view-log").hidden = isLog || !total;
  $("action-heading").hidden = !total;
  const table = $("entry-table");
  for (const body of [...table.tBodies]) body.remove();
  const groups = isLog ? groupByMonth(rows) : [{ month: null, rows }];
  table.insertAdjacentHTML("beforeend", groups.map(group => "<tbody>" +
    (group.month ? '<tr class="month-row"><th scope="rowgroup" colspan="5">' + prettyDate(group.month + "-01", "month") + "</th></tr>" : "") +
    group.rows.map(entryRows).join("") + "</tbody>").join(""));
  $("table-empty").hidden = total > 0;
  $("pagination").hidden = !isLog || pages <= 1;
  $("page-count").textContent = "Page " + (page + 1) + " of " + pages;
  $("prev-page").disabled = page === 0;
  $("next-page").disabled = page >= pages - 1;
}

// The body fat section at the bottom of the overview: the latest estimate and
// the change since the first, a chart of every estimate, and the measurements.
function showBodyFat() {
  const estimates = fat.filter(point => point.bodyFat !== null);
  const latest = estimates.at(-1);
  const lead = $("fat-lead");
  lead.hidden = estimates.length > 0;
  lead.textContent = !fat.length ? "Measure your waist now and then and log it here. Baseline estimates your body fat from it and your 14-day average."
    : !state.sex ? "Choose a formula in Log waist to see your body fat."
    : "Your body fat shows once a waist measurement has a weigh-in in the 14 days up to it.";
  $("fat-figures").hidden = !latest;
  $("fat-chart-wrap").hidden = !latest;
  if (latest) {
    const lastWaist = fat.at(-1);
    const change = bodyFatChange(fat);
    $("fat-figures").replaceChildren(
      figure("Body fat", percent(latest.bodyFat), shortDate(latest.date)),
      figure("Waist", waist(lastWaist.waist), lastWaist === latest ? "" : shortDate(lastWaist.date)),
      ...change ? [figure("Change since " + shortDate(change.from.date), signedPercent(change.change), waistChange(change.from.waist, change.to.waist) + " waist")] : []
    );
    fatChart.update(estimates, today, state.units);
  }
  showWaistRows();
}

// The measurements, newest first: the latest few, or all of them.
function showWaistRows() {
  const rows = [...fat].reverse();
  const shown = allWaists ? rows : rows.slice(0, WAIST_ROWS);
  $("waist-table-wrap").hidden = !rows.length;
  $("waist-rows").innerHTML = shown.map(point => "<tr>" + dateCell(point.date) +
    '<td class="num">' + waistParts(point.waist, state.units.height).map(([number, name]) => number + '<span class="table-unit">' + name + "</span>").join("") + "</td>" +
    '<td class="num">' + (point.weight === null ? dashCell("No weigh-ins in the 14 days up to it") : weightCell(point.weight)) + "</td>" +
    '<td class="num fat-cell">' + (point.bodyFat === null ? dashCell("No estimate") : percent(point.bodyFat)) + "</td>" +
    '<td class="row-action"><button type="button" class="icon-button" data-waist-edit="' + point.date + '" aria-label="Edit waist measurement for ' + prettyDate(point.date, "full") + '">' + icon("pencil") + "</button></td></tr>").join("");
  const more = $("waist-more");
  more.hidden = rows.length <= WAIST_ROWS;
  more.textContent = allWaists ? "Show fewer" : "Show all " + rows.length;
  more.setAttribute("aria-expanded", String(allWaists));
}

// A clear weekly trend as a signed figure: "−0.4 kg/wk".
function signedRateAmount(perWeek) {
  return (perWeek < 0 ? "−" : "+") + amount(perWeek) + "/wk";
}

// The milestones a month's average first reached: "Reached milestones 3 to 5
// of 10." They are always consecutive, and the last one is the goal itself.
function milestoneNote(indices) {
  const count = progress.milestones.length;
  const goal = indices.at(-1) === count;
  const steps = goal ? indices.slice(0, -1) : indices;
  const parts = [];
  if (steps.length) {
    parts.push((steps.length === 1 ? "milestone " + steps[0] : "milestones " + steps[0] + (steps.length === 2 ? " and " : " to ") + steps.at(-1)) + " of " + count);
  }
  if (goal) parts.push("your goal of " + weight(progress.goal));
  return "Reached " + parts.join(steps.length > 1 ? ", and " : " and ") + ".";
}

const monthName = report => prettyDate(report.first, "month");

// A run of months without weigh-ins, newest first, as one line. `before` is
// the month with weigh-ins that came before them.
function gapText(run, before) {
  if (run[0].partial) return run.length === 1 ? "No weigh-ins yet in " + monthName(run[0]) + "." : "No weigh-ins since " + monthName(before) + ".";
  if (run.length === 1) return "No weigh-ins in " + monthName(run[0]) + ".";
  const [newest, oldest] = [run[0], run.at(-1)];
  // The year once, unless the run crosses into a new one.
  const from = newest.first.slice(0, 4) === oldest.first.slice(0, 4) ? prettyDate(oldest.first, "monthName") : monthName(oldest);
  return "No weigh-ins " + (run.length === 2 ? "in " + from + " and " : "from " + from + " to ") + monthName(newest) + ".";
}

function monthItem(report) {
  const item = document.createElement("li");
  item.className = "month";
  const head = document.createElement("div");
  head.className = "month-head";
  const title = document.createElement("h3");
  title.textContent = monthName(report);
  const detail = document.createElement("p");
  detail.className = "month-detail";
  const count = !report.count ? "No weigh-ins" : report.count + (report.count === 1 ? " weigh-in" : " weigh-ins");
  detail.textContent = (report.partial ? "Partial month · " : "") + count;
  head.append(title, detail);
  // Figures and the milestone note share a column beside the month's name.
  const body = document.createElement("div");
  body.className = "month-body";
  item.append(head, body);
  if (report.count) {
    const { start, end, change, rate, low } = report;
    const figures = document.createElement("dl");
    figures.className = "figures month-figures";
    figures.append(
      figure("Start average", weight(start.average), start.date < report.first ? "" : prettyDate(start.date)),
      figure("End average", weight(end.average), end.date === report.through ? "" : prettyDate(end.date)),
      figure("Change", change === null ? null : signedAmount(change), "", "Not enough weigh-ins"),
      figure("Weekly trend", !rate ? null : rate.clear ? signedRateAmount(rate.perWeek) : "No clear change", "", "Not enough weigh-ins", rate && !rate.clear),
      figure("Lowest weigh-in", weight(low.weight), prettyDate(low.date))
    );
    body.append(figures);
  }
  if (report.milestones.length) {
    const note = document.createElement("p");
    note.className = "month-note";
    note.textContent = milestoneNote(report.milestones);
    body.append(note);
  }
  return item;
}

// Newest month first. Months without weigh-ins (or milestones) share a line.
function showMonths() {
  const reports = monthlyReports(state.entries, today, unit(), state.goal);
  const items = [];
  for (let index = 0; index < reports.length;) {
    const report = reports[index];
    if (report.count || report.milestones.length) {
      items.push(monthItem(report));
      index++;
      continue;
    }
    const run = [];
    while (index < reports.length && !reports[index].count && !reports[index].milestones.length) run.push(reports[index++]);
    const gap = document.createElement("li");
    gap.className = "month-gap";
    gap.textContent = gapText(run, reports[index]);
    items.push(gap);
  }
  $("month-list").replaceChildren(...items);
  $("month-list").hidden = !reports.length;
  $("months-empty").hidden = reports.length > 0;
  $("months-note").hidden = !reports.length;
}

const VIEWS = { "#weight-log": "entries", "#monthly-summary": "months" };
// "overview", or one of the log's views: "entries" or "months".
function currentView() { return VIEWS[location.hash] ?? "overview"; }

function markCurrent(links, current) {
  for (const id of links) {
    if (id === current) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
}

function showPage() {
  const view = currentView();
  const isLog = view !== "overview";
  document.body.dataset.view = isLog ? "log" : "overview";
  document.title = view === "months" ? "Monthly summary · Baseline" : isLog ? "Weight log · Baseline" : "Baseline";
  // The overview is a page for today, so today's date is its heading.
  $("page-title").textContent = isLog ? "Weight log" : prettyDate(today, "day");
  $("overview-view").hidden = isLog;
  $("log-tabs").hidden = !isLog;
  $("entries").hidden = view === "months";
  $("months").hidden = view !== "months";
  markCurrent(["overview-link", "log-link"], isLog ? "log-link" : "overview-link");
  markCurrent(["entries-link", "months-link"], view === "months" ? "months-link" : "entries-link");
  const first = trend.readings[0];
  const last = trend.readings.at(-1);
  const total = trend.readings.length;
  $("heading-detail").textContent = !isLog || !first ? ""
    : (first === last ? prettyDate(first.date, "full") : prettyDate(first.date, "full") + " – " + prettyDate(last.date, "full")) +
      " · " + total + (total === 1 ? " entry" : " entries");
  if (view === "months") showMonths();
  else showTable(isLog);
  // Body fat sits under the recent entries, on the overview only.
  $("body-fat").hidden = isLog;
  if (!isLog) {
    drawChart();
    showBodyFat();
  }
}

function drawChart() {
  $("legend-goal").hidden = !state.goal;
  chart.update(trend, range, today, state.goal?.weight ?? null, unit());
}

function render() {
  trend = calculateTrend(state.entries, today);
  weeklyRate = calculateRate(state.entries, today, unit());
  progress = goalProgress(state.goal, trend.current?.average, unit());
  fat = bodyFatHistory(state.entries, state.waists, state.sex, today);
  $("entry-date").max = today;
  applyUnits();
  showMetrics();
  syncEntryForm();
  showPage();
  showStorageStatus();
}

function showStorageStatus() {
  $("storage-status").textContent = (account.email ? "Signed in as " + account.email + ". " : "") + "Your log is saved to your account.";
}

// Until a log is open, the page shows one of these in place of the app.
const authViews = ["auth-loading", "auth-setup", "auth-error", "sign-in", "log-loading", "log-error"];

function showAuth(view) {
  for (const id of authViews) $(id).hidden = id !== view;
  $("auth-note").hidden = view !== "sign-in";
  $("auth").setAttribute("aria-busy", String(view.endsWith("-loading")));
  $("auth").hidden = false;
  $("main").hidden = true;
  $("account-bar").hidden = !account;
  $("main-nav").hidden = true;
  document.title = view === "sign-in" ? "Sign in · Baseline" : "Baseline";
}

function emailOf(user) {
  return user.primaryEmailAddress?.emailAddress ?? "";
}

// Logs from before accounts were saved online live in this browser. The first
// time an account's online log is empty, the browser's log moves into it.
async function importBrowserLog(result, userId) {
  if (normalizeState(result.log).started) return result;
  const key = storageKeyFor(userId);
  let local;
  try {
    claimLegacyLog(localStorage, userId);
    local = normalizeState(JSON.parse(localStorage.getItem(key)));
  } catch {
    return result;
  }
  if (!local.started) return result;
  const imported = await sendLog({ op: "import", log: local });
  if (imported.imported) {
    try { localStorage.removeItem(key); } catch { /* Harmless: the account is no longer empty, so it won't import again. */ }
  }
  return imported;
}

async function openLog(user) {
  const current = session = {};
  account = { id: user.id, email: emailOf(user) };
  state = saved = null;
  queue = Promise.resolve();
  unsaved = 0;
  showAuth("log-loading");
  let result;
  try {
    result = await importBrowserLog(await sendLog(), user.id);
  } catch (error) {
    if (session !== current) return;
    console.error(error);
    showAuth("log-error");
    return;
  }
  if (session !== current) return;
  saved = state = normalizeState(result.log);
  today = localToday();
  page = 0;
  editingDate = null;
  autoFill = true;
  rateSource = null;
  allWaists = false;
  $("entry-date").value = today;
  $("auth").hidden = true;
  $("main").hidden = false;
  $("main-nav").hidden = false;
  render();
}

// Picks up changes made in other tabs or on other devices.
async function refreshLog() {
  if (!state || unsaved) return;
  const current = session;
  let result;
  try { result = await sendLog(); } catch { return; }
  if (session !== current || unsaved) return;
  const log = normalizeState(result.log);
  if (JSON.stringify(log) === JSON.stringify(saved)) return;
  saved = state = log;
  render();
}

function closeLog() {
  account = null;
  session = null;
  state = saved = null;
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  clearTimeout(toastTimer);
  $("toast").textContent = "";
}

function showSignedIn(user) {
  if (account?.id !== user.id) openLog(user);
  else if (account.email !== emailOf(user)) {
    account.email = emailOf(user);
    showStorageStatus();
  }
  if (mounted === "user") return;
  if (mounted === "sign-in") clerk.unmountSignIn($("sign-in-card"));
  clerk.mountUserButton($("user-button"), { appearance: { elements: { userButtonAvatarBox: { width: "2rem", height: "2rem" } } } });
  mounted = "user";
}

function showSignedOut() {
  if (account) closeLog();
  // Clerk's sign-in steps live in the hash ("#/factor-one"), so drop the app's own views from it.
  if (location.hash && !location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search);
  showAuth("sign-in");
  if (mounted === "sign-in") return;
  if (mounted === "user") clerk.unmountUserButton($("user-button"));
  // Clerk styles the node it mounts into, so it gets a child of the centered wrapper.
  clerk.mountSignIn($("sign-in-card"), { withSignUp: true });
  mounted = "sign-in";
}

async function startAuth() {
  showAuth("auth-loading");
  try {
    clerk = await startClerk();
  } catch (error) {
    console.error(error);
    showAuth(error instanceof AuthSetupError ? "auth-setup" : "auth-error");
    return;
  }
  // Fires now with the current user, then on every sign-in, sign-out and profile change,
  // including ones made in other tabs.
  clerk.addListener(({ user }) => {
    if (user) showSignedIn(user);
    else if (user === null) showSignedOut();
  });
}

function focusEntry() {
  if (currentView() !== "overview") {
    window.addEventListener("hashchange", focusEntry, { once: true });
    location.hash = "overview";
    return;
  }
  requestAnimationFrame(() => {
    $("entry-panel").scrollIntoView({ block: "center", behavior: "auto" });
    $("entry-weight").focus({ preventScroll: true });
  });
}

// Weight inputs: a main input in kg, pounds or stones, and a pounds input
// (id + "-lb") that shows only for stones. Heights work the same way, with an
// inches input for feet. The inputs use `fieldUnits`, which applyUnits keeps
// in step with the saved units, converting anything already typed.
const WEIGHT_FIELDS = ["entry-weight", "edit-weight", "goal-weight", "goal-start-weight"];

// The weight typed into a field, in kg, or NaN. A field that still shows
// `stored` as it was filled in returns it unchanged, so saving again never
// rounds away hundredths that another unit needed.
function readWeight(id, stored) {
  const weightUnit = fieldUnits.weight;
  const main = $(id).valueAsNumber;
  const pounds = $(id + "-lb").valueAsNumber;
  const kg = weightUnit === "kg" ? main
    : weightUnit === "lb" ? main * KG_PER_LB
    : Number.isNaN(main) && Number.isNaN(pounds) ? NaN : ((main || 0) * 14 + (pounds || 0)) * KG_PER_LB;
  return Number.isFinite(stored) && Number.isFinite(kg) && toTenths(kg, weightUnit) === toTenths(stored, weightUnit) ? stored : kg;
}

function writeWeight(id, kg) {
  const parts = Number.isFinite(kg) ? weightParts(kg, fieldUnits.weight).map(([number]) => number.replaceAll(",", "")) : [];
  $(id).value = parts[0] ?? "";
  $(id + "-lb").value = parts[1] ?? "";
}

function readHeight(stored) {
  const heightUnit = fieldUnits.height;
  const main = $("profile-height").valueAsNumber;
  const inches = $("profile-height-in").valueAsNumber;
  const cm = heightUnit === "cm" ? main
    : Number.isNaN(main) && Number.isNaN(inches) ? NaN : ((main || 0) * 12 + (inches || 0)) * CM_PER_IN;
  const shown = value => heightParts(value, heightUnit).flat().join(" ");
  return Number.isFinite(stored) && Number.isFinite(cm) && cm > 0 && shown(cm) === shown(stored) ? stored : cm;
}

function writeHeight(cm) {
  const parts = Number.isFinite(cm) ? heightParts(cm, fieldUnits.height).map(([number]) => number) : [];
  $("profile-height").value = parts[0] ?? "";
  $("profile-height-in").value = parts[1] ?? "";
}

// A waist is typed in centimeters or, with feet and inches for height, inches.
function readWaist(stored) {
  const value = $("waist-size").valueAsNumber;
  const cm = fieldUnits.height === "cm" ? value : value * CM_PER_IN;
  return Number.isFinite(stored) && Number.isFinite(cm) && waistTenths(cm, fieldUnits.height) === waistTenths(stored, fieldUnits.height) ? stored : cm;
}

function writeWaist(cm) {
  $("waist-size").value = Number.isFinite(cm) ? waistParts(cm, fieldUnits.height)[0][0].replaceAll(",", "") : "";
}

// The target rate is typed to 0.01 kg or lb a week.
function readRate(stored) {
  const weightUnit = fieldUnits.weight;
  const value = $("goal-rate").valueAsNumber;
  if (!Number.isFinite(value)) return null;
  const toUnit = kg => weightUnit === "kg" ? kg : kg / KG_PER_LB;
  if (stored && Math.round(toUnit(stored) * 100) === Math.round(value * 100)) return stored;
  return weightUnit === "kg" ? value : value * KG_PER_LB;
}

function writeRate(kg) {
  $("goal-rate").value = kg ? String(Math.round((fieldUnits.weight === "kg" ? kg : kg / KG_PER_LB) * 100) / 100) : "";
}

function setInput(id, attributes) {
  for (const [name, value] of Object.entries(attributes)) $(id).setAttribute(name, value);
}

// Sets the inputs up for the saved units. Anything typed is converted, so it
// still means the same weight or height.
function applyUnits() {
  const { weight: weightUnit, height: heightUnit } = state.units;
  for (const button of document.querySelectorAll("#weight-units [data-unit]")) button.setAttribute("aria-pressed", String(button.dataset.unit === weightUnit));
  for (const button of document.querySelectorAll("#height-units [data-unit], #waist-units [data-unit]")) button.setAttribute("aria-pressed", String(button.dataset.unit === heightUnit));
  document.body.dataset.weightUnit = weightUnit;
  const previous = fieldUnits;
  if (previous?.weight !== weightUnit) {
    const weights = previous ? WEIGHT_FIELDS.map(id => readWeight(id)) : [];
    const rate = previous ? readRate() : null;
    fieldUnits = { ...fieldUnits, weight: weightUnit };
    const stones = weightUnit === "st";
    for (const id of WEIGHT_FIELDS) {
      setInput(id, stones ? { min: 0, max: 314, step: 1, placeholder: "0", inputmode: "numeric" }
        : { min: 0.1, max: weightUnit === "kg" ? 2000 : 4409.2, step: 0.1, placeholder: "0.0", inputmode: "decimal" });
      $(id + "-unit").textContent = weightUnit;
      $(id + "-lb").parentElement.hidden = !stones;
    }
    WEIGHT_FIELDS.forEach((id, index) => writeWeight(id, weights[index]));
    $("goal-rate-unit").textContent = rateUnit() + "/wk";
    setInput("goal-rate", weightUnit === "kg" ? { max: 5, placeholder: "e.g. 0.5" } : { max: 11, placeholder: "e.g. 1" });
    writeRate(rate);
  }
  if (previous?.height !== heightUnit) {
    const height = previous ? readHeight() : NaN;
    const typedWaist = previous ? readWaist() : NaN;
    fieldUnits = { ...fieldUnits, height: heightUnit };
    const feet = heightUnit === "ft";
    setInput("profile-height", feet ? { min: 0, max: 13, step: 1, placeholder: "e.g. 5", inputmode: "numeric" }
      : { min: 0.1, max: 400, step: 0.1, placeholder: "e.g. 178", inputmode: "decimal" });
    $("height-unit").textContent = heightUnit;
    $("profile-height-in").parentElement.hidden = !feet;
    writeHeight(height);
    // 4 to 157.4 inches stays within the 10 to 400 cm that can be saved.
    setInput("waist-size", feet ? { min: 4, max: 157.4, placeholder: "e.g. 34" } : { min: 10, max: 400, placeholder: "e.g. 86.5" });
    $("waist-size-unit").textContent = feet ? "in" : "cm";
    writeWaist(typedWaist);
    if ($("waist-dialog").open) previewFat();
  }
}

const unitNames = { kg: "kilograms", lb: "pounds", st: "stones and pounds", cm: "centimeters", ft: "feet and inches" };
// Height and waist share a unit, so either switch changes both.
const lengthMessage = choice => choice === "ft" ? "Height now shows in feet and inches, and waist in inches." : "Height and waist now show in centimeters.";

async function changeUnits(units, message) {
  if (units.weight === state.units.weight && units.height === state.units.height) return;
  if (await changeState(current => ({ ...current, started: true, units }), { op: "set-units", units })) notify(message);
}

function openProfile() {
  writeHeight(state.height);
  $("profile-description").textContent = trend.readings.length
    ? "Your height and latest weight are used to calculate BMI."
    : "Your height and latest weight are used to calculate BMI. Your BMI will appear after your first weigh-in.";
  previewBmi();
  $("profile-dialog").showModal();
  $("profile-height").focus();
}

function openGoal(focusId = "goal-weight") {
  const goal = state.goal;
  $("goal-title").textContent = goal ? "Edit your goal" : "Set a goal";
  writeWeight("goal-weight", goal?.weight);
  $("goal-start-date").max = today;
  $("goal-start-date").value = goal?.startDate ?? today;
  writeRate(goal?.rate);
  $("goal-milestones").value = goal?.milestones ?? GOAL_MILESTONES;
  startWeightFrom = goal ? "saved" : "average";
  if (goal) writeWeight("goal-start-weight", goal.startWeight);
  else fillStartWeight();
  $("clear-goal").hidden = !goal;
  showStartHint();
  previewGoal();
  $("goal-dialog").showModal();
  $(focusId).focus();
}

// The start weight defaults to the 14-day average on the start date.
function fillStartWeight() {
  const date = $("goal-start-date").value;
  const average = validDate(date) ? calculateTrend(state.entries, date).current?.average : undefined;
  writeWeight("goal-start-weight", average);
}

function showStartHint() {
  const date = $("goal-start-date").value;
  const filled = $("goal-start-weight").value !== "";
  $("goal-start-hint").hidden = startWeightFrom !== "average" || !validDate(date);
  $("goal-start-hint").textContent = !filled ? "No weigh-ins in the 14 days up to " + shortDate(date) + ", so enter your weight then."
    : "Your 14-day average on " + shortDate(date) + ".";
}

function readGoal() {
  const saved = state.goal;
  return normalizeGoal({
    weight: readWeight("goal-weight", saved?.weight),
    startDate: $("goal-start-date").value,
    startWeight: readWeight("goal-start-weight", saved?.startWeight),
    rate: readRate(saved?.rate),
    milestones: $("goal-milestones").valueAsNumber
  });
}

function previewGoal() {
  const preview = $("goal-preview");
  const goal = readGoal();
  preview.hidden = !goal;
  if (!goal) return;
  const plan = goalProgress(goal, goal.startWeight, unit());
  if (plan.direction === "maintain") {
    preview.textContent = "Stay at " + weight(plan.goal) + ".";
    return;
  }
  // The distance in tenths of the unit shown.
  const tenths = Math.abs(toTenths(plan.goal, unit()) - toTenths(plan.start, unit()));
  const count = plan.milestones.length;
  let text = (plan.direction === "lose" ? "Lose " : "Gain ") + amount(fromTenths(tenths, unit()));
  if (count > 1) text += " in " + count + " milestones of " + (tenths % count ? "about " : "") + amount(fromTenths(tenths / count, unit()));
  text += ".";
  if (goal.rate) text += " At " + rateFormat.format(perUnit(goal.rate)) + " " + rateUnit() + " a week, that’s " + duration(Math.round(fromTenths(tenths, unit()) / goal.rate * 7)) + ".";
  preview.textContent = text;
}

// The waist dialog logs a measurement, or edits or deletes the one on its date.
function openWaist(date = today) {
  syncDay();
  $("waist-date").max = today;
  $("waist-date").value = date;
  waistAutoFill = true;
  for (const input of document.querySelectorAll('#waist-form [name="sex"]')) input.checked = input.value === state.sex;
  $("waist-form").hidden = false;
  $("waist-confirm").hidden = true;
  syncWaistForm();
  $("waist-dialog").showModal();
  $("waist-size").focus();
}

const chosenSex = () => document.querySelector('#waist-form [name="sex"]:checked')?.value ?? null;

function syncWaistForm() {
  const existing = state.waists.find(item => item.date === $("waist-date").value);
  if (waistAutoFill) writeWaist(existing?.waist);
  $("waist-title").textContent = existing ? "Edit waist measurement" : "Log your waist";
  $("save-waist").textContent = existing ? "Update waist" : "Save waist";
  $("delete-waist").hidden = !existing;
  previewFat();
}

// The estimate for what's in the dialog, and what it's based on.
function previewFat() {
  const date = $("waist-date").value;
  const sex = chosenSex();
  const size = readWaist(state.waists.find(item => item.date === date)?.waist);
  const average = validDate(date) ? calculateTrend(state.entries, date).current?.average : undefined;
  const estimate = bodyFat(average, size, sex);
  $("waist-fat").textContent = estimate === null ? "—" : percent(estimate);
  $("waist-hint").textContent = !validDate(date) ? ""
    : !Number.isFinite(average) ? "No weigh-ins in the 14 days up to " + shortDate(date) + ". Your body fat shows once there is one."
    : !sex ? "Choose the formula to see your body fat."
    : validWaist(size) && estimate === null ? "That waist is outside what the formula covers. Check that it’s in " + (fieldUnits.height === "cm" ? "centimeters." : "inches.")
    : "Uses your 14-day average on " + shortDate(date) + ", " + weight(average) + ".";
}

// Reminders are push notifications (see sw.js and server/reminders.mjs). The
// hour and time zone belong to the account; each device that turns reminders
// on adds its own push subscription.
const hourFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const hourLabel = hour => hourFormat.format(new Date(2026, 0, 1, hour));
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
// "America/New_York" reads as "New York".
const zoneName = zone => zone.split("/").at(-1).replaceAll("_", " ");
const onThisDevice = () => Boolean(deviceEndpoint && state.reminder?.devices.includes(deviceEndpoint));
const devicesText = count => count === 1 ? "1 other device" : count + " other devices";

function showReminder() {
  const reminder = state.reminder;
  $("reminder-value").textContent = reminder ? hourLabel(reminder.hour) : "Off";
  $("reminder-value").classList.toggle("is-empty", !reminder);
  // One short note at most; the dialog has the details.
  $("reminder-detail").textContent = !reminder ? "" : !onThisDevice() ? "Not this device"
    : reminder.timeZone !== deviceZone() ? zoneName(reminder.timeZone) + " time" : "";
  $("reminder-label").textContent = reminder ? "Edit" : "Set";
  $("reminder-label").setAttribute("aria-label", reminder ? "Edit your daily reminder at " + hourLabel(reminder.hour) : "Set a daily reminder");
  if ($("reminder-dialog").open) showReminderStatus();
}

// Whether this device can get reminders: "ready", "blocked" (notifications are
// turned off for the site), "home-screen" (an iPhone or iPad, where push needs
// Baseline on the Home Screen) or "unsupported".
function reminderAccess() {
  if (!worker?.pushManager || !("Notification" in window)) {
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return apple && !navigator.standalone ? "home-screen" : "unsupported";
  }
  return Notification.permission === "denied" ? "blocked" : "ready";
}

const blockedText = "Notifications are blocked for Baseline in this browser. Allow them in its site settings, then try again.";

function showReminderStatus(message = "") {
  const reminder = state.reminder;
  const access = reminderAccess();
  const others = reminder ? reminder.devices.length - (onThisDevice() ? 1 : 0) : 0;
  const zone = deviceZone();
  $("reminder-zone").textContent = zoneName(zone) + " time";
  const lines = [];
  if (reminder && reminder.timeZone !== zone) lines.push("Your reminder is at " + hourLabel(reminder.hour) + " " + zoneName(reminder.timeZone) + " time. Saving changes it to " + zoneName(zone) + " time.");
  if (message) lines.push(message);
  else if (access === "home-screen") lines.push("On iPhone and iPad, reminders need Baseline on your Home Screen. In Safari, tap Share, then Add to Home Screen, and open Baseline from there.");
  else if (access === "unsupported") lines.push("This browser can’t show notifications, so reminders can’t reach this device.");
  else if (access === "blocked") lines.push(blockedText);
  else if (reminder && !onThisDevice()) lines.push("Reminders go to " + devicesText(others) + ". Saving adds this one.");
  else if (others) lines.push("Reminders also go to " + devicesText(others) + ".");
  $("reminder-status").textContent = lines.join(" ");
  $("reminder-status").hidden = !lines.length;
  $("save-reminder").textContent = reminder ? "Save reminder" : "Turn on reminders";
  // Without notifications here, only the time of reminders already on elsewhere can change.
  $("save-reminder").disabled = !reminder && access !== "ready";
  $("clear-reminder").hidden = !reminder;
}

function openReminder() {
  const select = $("reminder-hour");
  if (!select.options.length) select.append(...Array.from({ length: 24 }, (_, hour) => new Option(hourLabel(hour), String(hour))));
  select.value = String(state.reminder?.hour ?? 8);
  showReminderStatus();
  $("reminder-dialog").showModal();
  select.focus();
}

const pushKey = Uint8Array.from(atob(PUSH_PUBLIC_KEY.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));

// This device's push subscription, made with Baseline's key. A subscription
// made with another key can't receive Baseline's messages, so it's replaced.
async function subscribeDevice() {
  let subscription = await worker.pushManager.getSubscription();
  const key = subscription?.options?.applicationServerKey;
  if (subscription && key && new Uint8Array(key).join() !== pushKey.join()) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey });
  deviceEndpoint = subscription.endpoint;
  return subscription.toJSON();
}

// Registers the service worker that shows reminders, and finds out whether
// this device already has a push subscription.
async function startWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    worker = await navigator.serviceWorker.ready;
    deviceEndpoint = (await worker.pushManager?.getSubscription())?.endpoint ?? null;
  } catch (error) {
    console.warn("Reminders aren't available in this browser.", error);
    worker = null;
  }
  if (state) showReminder();
}

function previewBmi() {
  const latest = trend.readings.at(-1);
  $("profile-bmi").textContent = oneDecimal(bmi(latest?.weight, readHeight()));
}

function syncDay() {
  const now = localToday();
  if (now === today) return;
  if ($("entry-date").value === today && autoFill) $("entry-date").value = now;
  today = now;
  if (state) render();
}

function scheduleMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { syncDay(); scheduleMidnight(); }, midnight - now + 100);
}

function dateChanged() {
  if (state.entries.some(item => item.date === $("entry-date").value)) autoFill = true;
  syncEntryForm();
}

function stepDate(delta) {
  syncDay();
  const input = $("entry-date");
  const date = shiftDate(input.value, delta, today);
  if (date === input.value) return;
  input.value = date;
  dateChanged();
  $("date-announce").textContent = prettyDate(date, "long");
}

$("entry-date").value = today;
$("entry-date").addEventListener("change", dateChanged);
$("prev-day").addEventListener("click", () => stepDate(-1));
$("next-day").addEventListener("click", () => {
  if ($("next-day").getAttribute("aria-disabled") !== "true") stepDate(1);
});
for (const id of ["entry-weight", "entry-weight-lb", "entry-note"]) $(id).addEventListener("input", () => { autoFill = false; });
$("entry-form").addEventListener("submit", async event => {
  event.preventDefault();
  syncDay();
  const date = $("entry-date").value;
  const existing = state.entries.find(entry => entry.date === date);
  const weight = roundWeight(readWeight("entry-weight", existing?.weight));
  // The form shows the date's note, so an empty field removes it.
  const note = cleanNote($("entry-note").value);
  if (!validDate(date) || date > today || !positive(weight)) return;
  const updating = Boolean(existing);
  autoFill = true;
  const before = progress;
  if (await changeState(current => saveWeight(current, date, weight, note), { op: "save-weight", date, weight, note })) {
    notify((updating ? "Weigh-in updated" : "Weigh-in saved") + " for " + prettyDate(date) + "." + celebrate(before, progress));
  }
});

// A word when a weigh-in carries the average past a milestone. Needs an average
// before the weigh-in too, so returning after a break doesn't count every milestone.
function celebrate(before, after) {
  if (before?.current == null || after?.current == null || after.direction === "maintain") return "";
  if (after.reached && !before.reached) return " You’ve reached your goal.";
  if (after.completed > before.completed) return " Milestone " + after.completed + " of " + after.milestones.length + " reached.";
  return "";
}
$("ranges").addEventListener("click", event => {
  const button = event.target.closest("[data-range]");
  if (!button) return;
  range = button.dataset.range;
  for (const item of $("ranges").querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === button));
  drawChart();
});
$("quick-log").addEventListener("click", focusEntry);
$("prev-page").addEventListener("click", () => { page--; showTable(true); });
$("next-page").addEventListener("click", () => { page++; showTable(true); });

for (const button of document.querySelectorAll("[data-profile]")) button.addEventListener("click", openProfile);
for (const button of document.querySelectorAll("[data-goal]")) button.addEventListener("click", () => openGoal());
$("forecast-lead").addEventListener("click", event => {
  if (event.target.closest("[data-goal-rate]")) openGoal("goal-rate");
});
$("rate-choice").addEventListener("change", event => {
  rateSource = event.target.value;
  showForecast();
});
// A new start date brings its own average, unless a start weight was typed.
$("goal-start-date").addEventListener("change", () => {
  if (startWeightFrom !== "typed") {
    startWeightFrom = "average";
    fillStartWeight();
  }
  showStartHint();
  previewGoal();
});
for (const id of ["goal-start-weight", "goal-start-weight-lb"]) $(id).addEventListener("input", () => {
  startWeightFrom = "typed";
  showStartHint();
});
$("goal-form").addEventListener("input", previewGoal);
$("goal-form").addEventListener("submit", async event => {
  event.preventDefault();
  syncDay();
  const goal = readGoal();
  if (!goal || goal.startDate > today) return;
  $("goal-dialog").close();
  if (await changeState(current => ({ ...current, started: true, goal }), { op: "set-goal", goal })) notify("Goal saved.");
});
$("clear-goal").addEventListener("click", async () => {
  $("goal-dialog").close();
  if (await changeState(current => ({ ...current, goal: null }), { op: "clear-goal" })) notify("Goal removed.");
});
for (const button of document.querySelectorAll("[data-reminder]")) button.addEventListener("click", openReminder);
$("reminder-form").addEventListener("submit", async event => {
  event.preventDefault();
  const hour = Number($("reminder-hour").value);
  const timeZone = deviceZone();
  let subscription;
  if (reminderAccess() === "ready") {
    // Safari only asks for permission straight from a tap, so this comes before anything else is awaited.
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      showReminderStatus(permission === "denied" ? blockedText : "Allow notifications when your browser asks, so reminders can reach this device.");
      return;
    }
    try {
      subscription = await subscribeDevice();
    } catch (error) {
      console.error(error);
      showReminderStatus("This device couldn’t sign up for notifications. Check your connection and try again.");
      return;
    }
  } else if (!state.reminder) return;
  $("reminder-dialog").close();
  const added = subscription ? [subscription.endpoint] : [];
  if (await changeState(current => ({ ...current, reminder: { hour, timeZone, devices: [...(current.reminder?.devices ?? []), ...added] } }),
    { op: "set-reminder", hour, timeZone, ...(subscription && { subscription }) })) {
    notify("You’ll get a reminder at " + hourLabel(hour) + " on days you haven’t weighed in.");
  }
});
$("clear-reminder").addEventListener("click", async () => {
  $("reminder-dialog").close();
  if (!await changeState(current => ({ ...current, reminder: null }), { op: "clear-reminder" })) return;
  notify("Reminders turned off.");
  // The server has forgotten every device, so this one starts afresh next time.
  try { await (await worker?.pushManager?.getSubscription())?.unsubscribe(); } catch { /* Harmless: the server no longer sends to it. */ }
  deviceEndpoint = null;
  if (state) showReminder();
});
for (const id of ["profile-height", "profile-height-in"]) $(id).addEventListener("input", previewBmi);
$("weight-units").addEventListener("click", event => {
  const choice = event.target.closest("[data-unit]")?.dataset.unit;
  if (choice) changeUnits({ ...state.units, weight: choice }, "Weights now show in " + unitNames[choice] + ".");
});
for (const id of ["height-units", "waist-units"]) $(id).addEventListener("click", event => {
  const choice = event.target.closest("[data-unit]")?.dataset.unit;
  if (choice) changeUnits({ ...state.units, height: choice }, lengthMessage(choice));
});
for (const button of document.querySelectorAll("[data-waist]")) button.addEventListener("click", () => openWaist());
$("waist-table").addEventListener("click", event => {
  const button = event.target.closest("button[data-waist-edit]");
  if (button) openWaist(button.dataset.waistEdit);
});
$("waist-more").addEventListener("click", () => {
  allWaists = !allWaists;
  showWaistRows();
});
// Picking a date that has a measurement shows it, unless a waist was typed.
$("waist-date").addEventListener("change", () => {
  if (state.waists.some(item => item.date === $("waist-date").value)) waistAutoFill = true;
  syncWaistForm();
});
$("waist-size").addEventListener("input", () => {
  waistAutoFill = false;
  previewFat();
});
$("waist-form").addEventListener("change", event => {
  if (event.target.name === "sex") previewFat();
});
$("waist-form").addEventListener("submit", async event => {
  event.preventDefault();
  syncDay();
  const date = $("waist-date").value;
  const existing = state.waists.find(item => item.date === date);
  const size = roundWaist(readWaist(existing?.waist));
  const sex = chosenSex();
  if (!validDate(date) || date > today || !validWaist(size) || !SEXES.includes(sex)) return;
  $("waist-dialog").close();
  if (await changeState(current => saveWaist(current, date, size, sex), { op: "save-waist", date, waist: size, sex })) {
    const estimate = fat.find(point => point.date === date)?.bodyFat;
    notify((existing ? "Waist updated" : "Waist saved") + " for " + prettyDate(date) + "." + (estimate == null ? "" : " Body fat " + percent(estimate) + "."));
  }
});
$("delete-waist").addEventListener("click", () => {
  deletingWaist = $("waist-date").value;
  $("waist-form").hidden = true;
  $("waist-confirm").hidden = false;
  $("keep-waist").focus();
});
$("keep-waist").addEventListener("click", () => {
  $("waist-confirm").hidden = true;
  $("waist-form").hidden = false;
  $("waist-size").focus();
});
$("confirm-waist-delete").addEventListener("click", async () => {
  const date = deletingWaist;
  $("waist-dialog").close();
  if (await changeState(current => ({ ...current, waists: current.waists.filter(item => item.date !== date) }), { op: "delete-waist", date })) {
    notify("Waist measurement deleted.");
  }
});
$("waist-dialog").addEventListener("close", () => { deletingWaist = null; });
$("profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const height = roundHeight(readHeight(state.height));
  if (!positive(height)) return;
  $("profile-dialog").close();
  if (await changeState(current => ({ ...current, started: true, height }), { op: "set-height", height })) notify("Height saved.");
});

$("entry-table").addEventListener("click", event => {
  const button = event.target.closest("button[data-edit]");
  if (!button) return;
  const entry = state.entries.find(item => item.date === button.dataset.edit);
  if (!entry) return;
  editingDate = entry.date;
  $("edit-date-label").textContent = prettyDate(entry.date, "long");
  writeWeight("edit-weight", entry.weight);
  $("edit-note").value = entry.note ?? "";
  $("edit-form").hidden = false;
  $("delete-confirm").hidden = true;
  $("edit-dialog").showModal();
  $("edit-weight").focus();
});
$("edit-form").addEventListener("submit", async event => {
  event.preventDefault();
  const date = editingDate;
  const weight = roundWeight(readWeight("edit-weight", state.entries.find(entry => entry.date === date)?.weight));
  const note = cleanNote($("edit-note").value);
  if (!date || !positive(weight)) return;
  $("edit-dialog").close();
  const result = await changeState(
    current => current.entries.some(entry => entry.date === date) ? saveWeight(current, date, weight, note) : current,
    { op: "update-weight", date, weight, note });
  if (result) notify(result.found ? "Weigh-in updated." : "This weigh-in has already been removed.");
});
$("delete-entry").addEventListener("click", () => {
  $("edit-form").hidden = true;
  $("delete-confirm").hidden = false;
  $("keep-entry").focus();
});
$("keep-entry").addEventListener("click", () => {
  $("delete-confirm").hidden = true;
  $("edit-form").hidden = false;
  $("edit-weight").focus();
});
$("confirm-delete").addEventListener("click", async () => {
  const date = editingDate;
  $("edit-dialog").close();
  if (await changeState(current => ({ ...current, entries: current.entries.filter(item => item.date !== date) }), { op: "delete-weight", date })) {
    notify("Weigh-in deleted.");
  }
});
$("edit-dialog").addEventListener("close", () => { editingDate = null; });
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => button.closest("dialog").close());
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
window.addEventListener("hashchange", () => {
  if (!state) return;
  page = 0;
  showPage();
  window.scrollTo({ top: 0, behavior: "auto" });
});
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  ($("main").hidden ? $("auth") : $("main")).focus();
});
// Signed out, the wordmark's "#overview" would land in Clerk's hash routes.
document.querySelector(".wordmark").addEventListener("click", event => { if (!state) event.preventDefault(); });
$("auth-retry").addEventListener("click", () => location.reload());
$("log-retry").addEventListener("click", () => { if (clerk.user) openLog(clerk.user); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  syncDay();
  refreshLog();
});
window.addEventListener("focus", syncDay);
startAuth();
startWorker();
scheduleMidnight();
