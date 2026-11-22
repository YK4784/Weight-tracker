import { RATE_DAYS, RATE_MIN_ENTRIES, RATE_MIN_SPAN, bmi, calculateRate, calculateTrend, localToday, normalizeState, oneDecimal, positive, prettyDate, saveWeight, shiftDate, validDate } from "./model.mjs";
import { TrendChart } from "./chart.mjs";
import { claimLegacyLog, storageKeyFor } from "./account.mjs";
import { AuthSetupError, startClerk } from "./auth.mjs";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 15;
const chart = new TrendChart();
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
let range = "30";
let page = 0;
let editingDate = null;
let autoWeight = true;
let toastTimer;

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

// Missing values show a quiet dash instead of a big bold one.
function setValue(id, value, unit = "") {
  const empty = !Number.isFinite(value);
  $(id).textContent = empty ? "—" : oneDecimal(value) + unit;
  $(id).classList.toggle("is-empty", empty);
}

function showMetrics() {
  const latest = trend.readings.at(-1);
  const height = state.height;
  setValue("avg-value", trend.current?.average);
  document.querySelector(".hero").classList.toggle("is-empty", !trend.current);
  const count = trend.current?.count ?? 0;
  $("avg-detail").textContent = count ? "From " + count + (count === 1 ? " weigh-in" : " weigh-ins") + " in the last 14 days" : "No weigh-ins in the last 14 days";
  showRate();
  setValue("weight-value", latest?.weight, " kg");
  $("weight-detail").textContent = latest ? shortDate(latest.date) : "";
  $("height-value").textContent = height ? height + " cm" : "—";
  $("height-value").classList.toggle("is-empty", !height);
  $("height-label").textContent = height ? "Edit" : "Add";
  $("height-label").setAttribute("aria-label", height ? "Edit height, currently " + height + " centimeters" : "Add your height for BMI");
  setValue("bmi-value", bmi(latest?.weight, height));
}

function showRate() {
  const rate = calculateRate(state.entries, today);
  const line = $("rate-detail");
  line.hidden = !state.entries.length;
  line.classList.toggle("is-pending", !rate);
  if (!rate) {
    line.textContent = "Your weekly trend shows after " + RATE_MIN_ENTRIES + " weigh-ins over " + RATE_MIN_SPAN / 7 + " weeks.";
    return;
  }
  const strong = document.createElement("strong");
  strong.textContent = !rate.clear ? "No clear change"
    : (rate.perWeek < 0 ? "Down " : "Up ") + oneDecimal(Math.abs(rate.perWeek)) + " kg a week";
  line.replaceChildren(strong, " over the last " + RATE_DAYS / 7 + " weeks");
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
  $("entry-hint").textContent = !state.entries.length ? "Your first weigh-in starts your log."
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
  const canEdit = total > 0;
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
  showTable(isLog);
  if (!isLog) chart.update(trend, range, today);
}

function render() {
  trend = calculateTrend(state.entries, today);
  $("entry-date").max = today;
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
  autoWeight = true;
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
  $("profile-description").textContent = trend.readings.length
    ? "Your height and latest weight are used to calculate BMI."
    : "Your height and latest weight are used to calculate BMI. Your BMI will appear after your first weigh-in.";
  previewBmi();
  $("profile-dialog").showModal();
  $("profile-height").focus();
}

function previewBmi() {
  const latest = trend.readings.at(-1);
  $("profile-bmi").textContent = oneDecimal(bmi(latest?.weight, $("profile-height").valueAsNumber));
}

function syncDay() {
  const now = localToday();
  if (now === today) return;
  if ($("entry-date").value === today && autoWeight) $("entry-date").value = now;
  today = now;
  if (state) render();
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
  if (await changeState(current => saveWeight(current, date, weight), { op: "save-weight", date, weight })) {
    notify((updating ? "Weigh-in updated" : "Weigh-in saved") + " for " + prettyDate(date) + ".");
  }
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
  $("profile-dialog").close();
  if (await changeState(current => ({ ...current, started: true, height }), { op: "set-height", height })) notify("Height saved.");
});

$("entry-rows").addEventListener("click", event => {
  const button = event.target.closest("button[data-edit]");
  if (!button) return;
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
  $("edit-dialog").close();
  const result = await changeState(
    current => current.entries.some(entry => entry.date === date) ? saveWeight(current, date, weight) : current,
    { op: "update-weight", date, weight });
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
scheduleMidnight();
