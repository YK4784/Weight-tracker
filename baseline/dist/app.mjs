import { bmi, calculateTrend, localToday, normalizeState, oneDecimal, positive, prettyDate, sampleEntries, saveWeight, shiftDate, validDate } from "./model.mjs";
import { TrendChart } from "./chart.mjs";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "baseline.weight-log.v1";
const PAGE_SIZE = 15;
const chart = new TrendChart();
let today = localToday();
let state;
let sessionOnly = false;
let demo;
let trend;
let range = "30";
let page = 0;
let editingDate = null;
let autoWeight = true;
let toastTimer;

function readState() {
  return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
}

try {
  state = readState();
} catch {
  state = normalizeState(null);
  sessionOnly = true;
}

function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  toastTimer = setTimeout(() => { $("toast").textContent = ""; }, 3600);
}

// Start a transaction from the latest browser state so edits from another
// open tab survive. Keep the current session usable if storage is unavailable.
async function changeState(change) {
  const commit = () => {
    let current = state;
    if (!sessionOnly) {
      try { current = readState(); } catch { sessionOnly = true; }
    }
    const next = normalizeState(change(current));
    if (!sessionOnly) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { sessionOnly = true; }
    }
    state = next;
    render();
  };
  if (!sessionOnly) {
    try {
      if (navigator.locks) {
        await navigator.locks.request(STORAGE_KEY, commit);
        return;
      }
    } catch (error) {
      if (error.name !== "SecurityError" && error.name !== "NotAllowedError") throw error;
    }
  }
  commit();
}

function icon(name) {
  return '<svg class="icon" aria-hidden="true"><use href="./icons.svg#' + name + '"></use></svg>';
}

function shortDate(date) {
  return date.slice(0, 4) === today.slice(0, 4) ? prettyDate(date) : prettyDate(date, "full");
}

// Missing values show a quiet dash instead of a big bold one.
function setValue(id, value, unit = "") {
  const empty = !Number.isFinite(value);
  $(id).textContent = empty ? "—" : oneDecimal(value) + unit;
  $(id).classList.toggle("is-empty", empty);
}

function showMetrics() {
  const latest = trend.readings.at(-1);
  const height = demo ? 178 : state.height;
  setValue("avg-value", trend.current?.average);
  document.querySelector(".hero").classList.toggle("is-empty", !trend.current);
  const count = trend.current?.count ?? 0;
  $("avg-detail").textContent = count ? "From " + count + (count === 1 ? " weigh-in" : " weigh-ins") + " in the last 14 days" : "No weigh-ins in the last 14 days";
  setValue("weight-value", latest?.weight, " kg");
  $("weight-detail").textContent = latest ? shortDate(latest.date) : "";
  $("height-value").textContent = height ? height + " cm" : "—";
  $("height-value").classList.toggle("is-empty", !height);
  $("height-label").textContent = height ? "Edit" : "Add";
  $("height-label").setAttribute("aria-label", height ? "Edit height, currently " + height + " centimeters" : "Add your height for BMI");
  setValue("bmi-value", bmi(latest?.weight, height));
}

function syncEntryForm(force = false) {
  const input = $("entry-weight");
  const date = $("entry-date").value;
  const entry = state.entries.find(item => item.date === date);
  if (force || autoWeight) {
    input.value = entry ? entry.weight.toFixed(1) : "";
    autoWeight = true;
  }
  // aria-disabled keeps the button focusable when repeated presses reach today.
  $("next-day").setAttribute("aria-disabled", String(validDate(date) && date >= today));
  $("save-label").textContent = entry ? "Update entry" : "Save entry";
  $("entry-hint").textContent = demo ? "Your first entry starts your personal log."
    : entry ? "You have a weigh-in on this date." : "Choose an earlier date to add a past weigh-in.";
}

function changeCell(change) {
  if (change === null) return '<span class="dash" aria-label="First entry">—</span>';
  const sign = change < 0 ? "−" : change > 0 ? "+" : "";
  return '<span class="change">' + sign + oneDecimal(Math.abs(change)) + '</span><span class="table-unit">kg</span>';
}

function showTable(isLog) {
  const readings = trend.readings;
  const total = readings.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const offset = isLog ? page * PAGE_SIZE : 0;
  const rows = readings.slice(Math.max(0, total - offset - (isLog ? PAGE_SIZE : 5)), total - offset).reverse();
  $("entries-title").textContent = isLog ? "All entries" : "Recent entries";
  $("view-log").hidden = isLog || !total;
  $("log-count").hidden = !isLog;
  $("log-count").textContent = total + (total === 1 ? " entry" : " entries");
  const canEdit = !demo && total > 0;
  $("action-heading").hidden = !canEdit;
  $("entry-rows").innerHTML = rows.map(point => {
    const date = prettyDate(point.date, "full");
    const action = canEdit ? '<td class="row-action"><button type="button" class="icon-button" data-edit="' + point.date + '" aria-label="Edit weigh-in for ' + date + '">' + icon("pencil") + "</button></td>" : "";
    return '<tr><td><time datetime="' + point.date + '"><span class="long-label">' + (point.date.slice(0, 4) === today.slice(0, 4) ? prettyDate(point.date, "weekday") : date) + '</span><span class="short-label">' + shortDate(point.date) + '</span></time></td>' +
      '<td class="num entry-weight">' + oneDecimal(point.weight) + '<span class="table-unit">kg</span></td>' +
      '<td class="num">' + oneDecimal(point.average) + '<span class="table-unit">kg</span></td>' +
      '<td class="num">' + changeCell(point.change) + "</td>" + action + "</tr>";
  }).join("");
  $("table-empty").hidden = total > 0;
  $("pagination").hidden = !isLog || pages <= 1;
  $("page-count").textContent = "Page " + (page + 1) + " of " + pages;
  $("prev-page").disabled = page === 0;
  $("next-page").disabled = page >= pages - 1;
}

function onLogPage() { return location.hash === "#weight-log"; }

function showPage() {
  const isLog = onLogPage();
  document.body.dataset.view = isLog ? "log" : "overview";
  document.title = isLog ? "Weight log · Baseline" : "Baseline";
  // The overview is a page for today, so today's date is its heading.
  $("page-title").textContent = isLog ? "Weight log" : prettyDate(today, "day");
  $("overview-view").hidden = isLog;
  $("overview-link").toggleAttribute("aria-current", !isLog);
  $("log-link").toggleAttribute("aria-current", isLog);
  $(isLog ? "log-link" : "overview-link").setAttribute("aria-current", "page");
  const first = trend.readings[0];
  const last = trend.readings.at(-1);
  $("heading-detail").textContent = !isLog || !first ? ""
    : first === last ? prettyDate(first.date, "full")
    : prettyDate(first.date, "full") + " – " + prettyDate(last.date, "full");
  $("sample-note").hidden = !demo;
  showTable(isLog);
  if (!isLog) chart.update(trend, range, today);
}

function render() {
  demo = !state.started;
  trend = calculateTrend(demo ? sampleEntries(today) : state.entries, today);
  $("entry-date").max = today;
  showMetrics();
  syncEntryForm();
  showPage();
  $("storage-status").textContent = sessionOnly
    ? "Browser storage is unavailable, so changes last only for this session."
    : "Your log is stored only in this browser.";
}

function focusEntry() {
  if (onLogPage()) {
    window.addEventListener("hashchange", focusEntry, { once: true });
    location.hash = "overview";
    return;
  }
  requestAnimationFrame(() => {
    $("entry-panel").scrollIntoView({ block: "center", behavior: "auto" });
    $("entry-weight").focus({ preventScroll: true });
  });
}

function openProfile() {
  $("profile-height").value = state.height ?? "";
  $("profile-description").textContent = demo
    ? "Save your own height to start your log. Your BMI will appear after your first weigh-in."
    : "Your height and latest weight are used to calculate BMI.";
  previewBmi();
  $("profile-dialog").showModal();
  $("profile-height").focus();
}

function previewBmi() {
  const latest = demo ? null : trend.readings.at(-1);
  $("profile-bmi").textContent = oneDecimal(bmi(latest?.weight, $("profile-height").valueAsNumber));
}

function syncDay() {
  const now = localToday();
  if (now === today) return;
  if ($("entry-date").value === today && autoWeight) $("entry-date").value = now;
  today = now;
  render();
}

function scheduleMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { syncDay(); scheduleMidnight(); }, midnight - now + 100);
}

function dateChanged() {
  if (state.entries.some(item => item.date === $("entry-date").value)) autoWeight = true;
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
$("entry-weight").addEventListener("input", () => { autoWeight = false; });
$("entry-form").addEventListener("submit", async event => {
  event.preventDefault();
  syncDay();
  const date = $("entry-date").value;
  const weight = $("entry-weight").valueAsNumber;
  if (!validDate(date) || date > today || !positive(weight)) return;
  const updating = state.entries.some(entry => entry.date === date);
  autoWeight = true;
  await changeState(current => saveWeight(current, date, weight));
  notify((updating ? "Weigh-in updated" : "Weigh-in saved") + " for " + prettyDate(date) + ".");
});
$("ranges").addEventListener("click", event => {
  const button = event.target.closest("[data-range]");
  if (!button) return;
  range = button.dataset.range;
  for (const item of $("ranges").querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === button));
  chart.update(trend, range, today);
});
$("quick-log").addEventListener("click", focusEntry);
$("prev-page").addEventListener("click", () => { page--; showTable(true); });
$("next-page").addEventListener("click", () => { page++; showTable(true); });

for (const button of document.querySelectorAll("[data-profile]")) button.addEventListener("click", openProfile);
$("profile-height").addEventListener("input", previewBmi);
$("profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const height = $("profile-height").valueAsNumber;
  if (!positive(height)) return;
  await changeState(current => ({ ...current, started: true, height }));
  $("profile-dialog").close();
  notify("Height saved.");
});
$("start-log").addEventListener("click", async () => {
  await changeState(current => ({ ...current, started: true }));
  focusEntry();
});

$("entry-rows").addEventListener("click", event => {
  const button = event.target.closest("button[data-edit]");
  if (!button || demo) return;
  const entry = state.entries.find(item => item.date === button.dataset.edit);
  if (!entry) return;
  editingDate = entry.date;
  $("edit-date-label").textContent = prettyDate(entry.date, "long");
  $("edit-weight").value = entry.weight.toFixed(1);
  $("edit-form").hidden = false;
  $("delete-confirm").hidden = true;
  $("edit-dialog").showModal();
  $("edit-weight").focus();
});
$("edit-form").addEventListener("submit", async event => {
  event.preventDefault();
  const date = editingDate;
  const weight = $("edit-weight").valueAsNumber;
  if (!date || !positive(weight)) return;
  let found = false;
  await changeState(current => {
    found = current.entries.some(entry => entry.date === date);
    return found ? saveWeight(current, date, weight) : current;
  });
  $("edit-dialog").close();
  notify(found ? "Weigh-in updated." : "This weigh-in has already been removed.");
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
  await changeState(current => ({ ...current, entries: current.entries.filter(item => item.date !== date) }));
  $("edit-dialog").close();
  notify("Weigh-in deleted.");
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
  page = 0;
  showPage();
  window.scrollTo({ top: 0, behavior: "auto" });
});
document.querySelector(".skip-link").addEventListener("click", event => { event.preventDefault(); $("main").focus(); });
window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try { state = readState(); } catch { sessionOnly = true; }
  render();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncDay(); });
window.addEventListener("focus", syncDay);
render();
scheduleMidnight();
