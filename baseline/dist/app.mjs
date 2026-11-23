import { CM_PER_IN, CONSENT_VERSION, FAST_LOSS_DAYS, FORECAST_MAX_DAYS, GOAL_MILESTONES, GOAL_RATE_CAP, KG_PER_LB, OVERALL_MIN_DAYS, QUEUEABLE_OPS, RATE_DAYS, RATE_MIN_ENTRIES, RATE_MIN_SPAN, SEXES, WINDOW_DAYS, applyOps, averageChanges, bmi, bodyFat, bodyFatChange, bodyFatHistory, calculateRate, changeTarget, calculateTrend, checkWeighIn, cleanNote, dateOf, dayOf, defaultUnits, fastGoalRate, fastLossCaution, forecastGoal, formatAmount, formatWaist, formatWeight, fromTenths, goalProgress, goalRateAllowed, goalRateLimit, groupByMonth, hasConsent, heightParts, inverseOf, localToday, logStatus, maxGoalRate, monthlyReports, normalizeGoal, normalizeState, oneDecimal, overallRate, positive, prettyDate, recentRange, roundHeight, roundWaist, roundWeight, shiftDate, spokenHeight, spokenWeight, toTenths, todayHeading, todayLabel, validDate, validWaist, waistParts, waistTenths, weeklyTrendShown, weighInQuestion, weightParts } from "./model.mjs";
import { BodyFatChart, TrendChart } from "./chart.mjs";
import { claimLegacyLog, clearDeviceData, clearLogCache, fastLossHiddenKeyFor, hasLegacyLog, lastUser, readLogCache, readOutbox, signOutWarning, storageKeyFor, writeLogCache, writeOutbox } from "./account.mjs";
import { csvFileName, exportJson, jsonFileName, weighInsCsv } from "./export.mjs";
import { AuthSetupError, startClerk } from "./auth.mjs";
import { PUSH_PUBLIC_KEY } from "./config.mjs";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 15;
const WAIST_ROWS = 5; // Waist measurements listed before "Show all".
// On a phone, the charts' tooltips keep clear of the log bar.
const chart = new TrendChart({ cover: "log-bar" });
const fatChart = new BodyFatChart({ cover: "log-bar" });
let today = localToday();
let clerk;
let clerkReady = null; // Resolves to Clerk once it has loaded. Null before that starts, or after it failed.
let mounted = null; // Which Clerk component is on the page: "sign-in" or "user".
// { id, email, confirmed } of the user whose log is open. `confirmed` is false
// while the log shown is the copy on this device and Clerk hasn't yet said
// that this user is signed in.
let account = null;
let session = null; // The open log. Replies meant for an earlier one are ignored.
let state = null; // The log on screen: `saved` with the changes on their way replayed on top. Null while signed out or loading.
let saved = null; // The log as the server last returned it, or as it was cached on this device.
let cachedAt = null; // When the cached copy on screen was saved. Null once the server has answered.
let cacheUpdating = false; // Whether the server's copy is on its way to replace the cached one.
let queue = Promise.resolve(); // Requests reach the server one at a time, in order.

// The outbox holds every change that can wait (see QUEUEABLE_OPS) from the
// moment it's made until the server has it, so a change survives a failed
// request, going offline and a reload. It lives in localStorage under the
// account (see readOutbox), and syncOutbox sends it in order, one change at a
// time. Changes that need a connection, such as reminders, skip it (see sendNow).
let outbox = []; // [{ id, change }], oldest first.
let outboxInPage = false; // Whether storage failed, so the outbox lives only in this page.
// Changes made in this page that are in the outbox, by id: { done, kept, offer, announced, resolve }.
// `announced` is whether the user has been told the change is saved on this device.
// `offer` is an action the message about it carries (see changeState).
const madeHere = new Map();
let sending = []; // Changes that skip the outbox, sent and not yet answered: [{ change }].
let syncing = null; // The running syncOutbox, or null.
let syncProblem = null; // Why the outbox stopped: "offline", "server", "sign-in" or "consent". Null when it didn't.
let syncTimer; // Tries the outbox again while the device seems to have a connection.
const SYNC_RETRY = 60_000;
// Whether a deletion of the log or the account is on its way to the server.
// Nothing else is sent or read meanwhile, so nothing lands after it.
let deleting = false;
let trend;
let weeklyRate; // calculateRate for today, or null.
let progress; // goalProgress for today's average, or null without a goal.
let status; // logStatus for today: whether the log is empty, active or back after a break.
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
let entryEdits = 0; // Counts what's typed into the log form, so a save that's answered later doesn't refill it.
let sheetAutoFill = true; // The log sheet shows today's weigh-in until the user types in it.
let sheetEdits = 0; // Counts what's typed into the log sheet, as entryEdits does for the form.
let fieldUnits = null; // The units the inputs are set up for, which follow state.units.
let worker = null; // The service worker's registration, which receives reminders. Null until it's ready or where there is none.
let deviceEndpoint = null; // This device's push subscription, if it has one.

// The toast at the bottom of the page. Its message goes through a status
// region, so screen readers announce it. It can carry an action button, such
// as "Try again". An error stays until it's dismissed or its action succeeds.
// Anything else fades after `duration` ms, but not while the mouse is over it
// or focus is in it.
const TOAST_DURATION = 4000;
// A message that offers something, such as showing weights in another unit, stays longer.
const OFFER_DURATION = 10_000;
// A message that offers Undo, after a deletion (see deleteWithUndo).
const UNDO_DURATION = 8000;
let toast = null; // What the toast shows: { error, duration, acting, target }. Null while it's closed.
let toastTimer;
let toastHover = false;
let toastReturn = null; // Where focus was before it moved into the toast.

// `action` is { label, run }. While `run` is working its button does nothing,
// and once it's done the toast closes, unless `run` showed a message of its own.
// Returns what the toast shows, or null if the message was left out.
function notify(message, { action = null, error = false, duration = TOAST_DURATION } = {}) {
  // A confirmation doesn't push an error out of view, unless it comes from that error's own action.
  if (toast?.error && !error && !toast.acting) return null;
  const element = $("toast");
  const hadFocus = element.contains(document.activeElement);
  const shown = toast = { error, duration, acting: false };
  $("toast-message").textContent = message;
  const buttons = [];
  if (action) {
    buttons.push(toastButton(action.label, async button => {
      if (shown.acting) return;
      shown.acting = true;
      button.setAttribute("aria-disabled", "true");
      try { await action.run(); } catch (failure) { console.error(failure); }
      shown.acting = false;
      button.removeAttribute("aria-disabled");
      if (toast === shown) closeToast();
    }));
  }
  if (error) buttons.push(toastButton("Dismiss", closeToast));
  $("toast-actions").replaceChildren(...buttons);
  element.classList.toggle("has-actions", buttons.length > 0);
  element.classList.add("is-open");
  // Replacing the buttons would drop focus, so it moves to the new ones, or back where it came from.
  if (hadFocus) buttons[0] ? buttons[0].focus() : returnFocus();
  startToastTimer();
  return shown;
}

function toastButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toast-button";
  button.textContent = label;
  button.addEventListener("click", () => onClick(button));
  return button;
}

function closeToast() {
  clearTimeout(toastTimer);
  const hadFocus = $("toast").contains(document.activeElement);
  toast = null;
  toastHover = false;
  $("toast").classList.remove("is-open", "has-actions");
  $("toast-message").textContent = "";
  $("toast-actions").replaceChildren();
  if (hadFocus) returnFocus();
}

function returnFocus() {
  const target = toastReturn?.isConnected && toastReturn.checkVisibility?.() !== false ? toastReturn : $("main").hidden ? $("auth") : $("main");
  target.focus({ preventScroll: true });
}

function startToastTimer() {
  clearTimeout(toastTimer);
  if (toast && !toast.error && !toastHover && !$("toast").contains(document.activeElement)) toastTimer = setTimeout(closeToast, toast.duration);
}

// Loads Clerk and starts following who is signed in. Resolves to Clerk once
// it has loaded and said who that is. After a failure, the next call tries again.
// Clerk holds the account and nothing else: weights, measurements, notes, the
// goal, sex and every other part of the log must never go into Clerk, including
// its user metadata (publicMetadata, privateMetadata, unsafeMetadata). Clerk's
// data processing agreement forbids health data, and the privacy policy says
// none of the log goes to Clerk. The log lives only in Baseline's database.
function connectClerk() {
  clerkReady ??= startClerk().then(instance => {
    clerk = instance;
    // Fires now with the current user, then on every sign-in, sign-out and profile change,
    // including ones made in other tabs.
    clerk.addListener(({ user }) => {
      if (user) showSignedIn(user);
      else if (user === null) showSignedOut();
    });
    return clerk;
  }, error => {
    clerkReady = null;
    throw error;
  });
  return clerkReady;
}

// A request that couldn't reach the server: the device is offline, the network
// failed or took too long, or sign-in couldn't load or give a token. It may
// work later.
class Unreachable extends Error {
  constructor(cause) {
    super("Couldn’t reach Baseline.", { cause });
    this.name = "Unreachable";
  }
}

// The server answered with an error status.
class Refused extends Error {
  constructor(status) {
    super("The log request failed with status " + status + ".");
    this.name = "Refused";
    this.status = status;
  }
}

const REQUEST_TIMEOUT = 15_000;

// Reads the log, or applies one change to it on the server (see server/ops.mjs),
// for the account `userId`. It waits for Clerk and a session token first, so a
// change made to the cached log before Clerk has loaded is sent once it has.
// Resolves to { log, ... } as the server returns it. Rejects with Unreachable
// when the server can't be reached, and Refused when it answers with an error.
async function sendLog(change, userId) {
  if (navigator.onLine === false) throw new Unreachable(new Error("The browser is offline."));
  let instance;
  try { instance = await connectClerk(); } catch (error) { throw error instanceof AuthSetupError ? error : new Unreachable(error); }
  // A change made to one account's log is never sent as another account.
  if (!userId || instance.user?.id !== userId) throw new Error("The log's account isn't the one signed in.");
  let token;
  try { token = await instance.session?.getToken(); } catch (error) { throw new Unreachable(error); }
  // Clerk still has the user, so a missing token means it couldn't refresh one.
  if (!token) throw new Unreachable(new Error("No session token."));
  let response;
  try {
    response = await fetch("/api/log", {
      method: change ? "POST" : "GET",
      headers: { Authorization: "Bearer " + token, ...(change && { "Content-Type": "application/json" }) },
      body: change ? JSON.stringify(change) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout?.(REQUEST_TIMEOUT)
    });
    // A redirect comes from a network that wants a sign-in of its own, as some Wi-Fi does.
    if (response.ok && !response.redirected) return await response.json();
  } catch (error) {
    throw new Unreachable(error);
  }
  if (response.redirected) throw new Unreachable(new Error("The request was redirected."));
  throw new Refused(response.status);
}

// Runs `task` once the requests before it have finished.
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

const newId = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

// Reads this account's outbox again, in case another tab changed it.
function loadOutbox() {
  if (outboxInPage) return;
  try { outbox = readOutbox(localStorage, account.id); } catch { outboxInPage = true; }
}

// Changes the outbox in storage, or only in the page if storage fails.
function editOutbox(edit) {
  if (!outboxInPage) {
    try {
      const next = edit(readOutbox(localStorage, account.id));
      writeOutbox(localStorage, account.id, next);
      outbox = next;
      return;
    } catch {
      outboxInPage = true;
    }
  }
  outbox = edit(outbox);
}

// The log on screen: the server's copy with every change still on its way
// replayed on top, in order. Until the account has agreed to the health data
// policy, counting an agreement still on its way, the consent step shows in
// the log's place (see showConsent).
function showState() {
  state = applyOps(saved, [...outbox, ...sending].map(item => item.change));
  if (!hasConsent(state)) {
    showConsent();
    return;
  }
  if ($("main").hidden) {
    $("auth").hidden = true;
    $("consent").hidden = true;
    $("main").hidden = false;
    $("main-nav").hidden = false;
    $("account-bar").hidden = false;
  }
  render();
  followLogLink();
}

// Shows a change at once, then saves it. A change that can wait goes into the
// outbox first, and syncOutbox sends it. If it can't be sent for lack of a
// connection, it stays on this device and is sent later. If the server turns
// it down or fails, it's undone, and the toast offers "Try again", which makes
// the same change again. `kept()` runs once the change is saved, on the server
// or on this device; `done(reply)` runs once the server has it, at first or on
// a retry. Resolves to the server's reply, or null if the server doesn't have
// the change yet. The agreement to the health data policy goes ahead of
// everything waiting, since the server saves nothing without it. `offer`, an
// action { label, run }, goes with the message that the change is saved on
// this device; `done` shows its own message, so it offers it there.
function changeState(change, done = null, kept = null, offer = null) {
  if (!QUEUEABLE_OPS.includes(change.op)) return sendNow(change, done);
  const item = { id: newId(), change };
  editOutbox(items => change.op === "consent" ? [item, ...items] : [...items, item]);
  const reply = new Promise(resolve => madeHere.set(item.id, { done, kept, offer, announced: false, resolve }));
  showState();
  syncOutbox();
  return reply;
}

// Sends a change that needs a connection straight away. If it fails, it's
// undone, and the toast offers "Try again".
async function sendNow(change, done) {
  const current = session;
  const userId = account.id;
  const item = { change };
  sending.push(item);
  showState();
  let result = null;
  let failure = null;
  try { result = await enqueue(() => sendLog(change, userId)); } catch (error) { failure = error; console.error(error); }
  if (session !== current) return null;
  sending = sending.filter(other => other !== item);
  if (result) receive(result.log);
  // The account hasn't agreed to the policy, so the consent step shows instead (see showState).
  if (lacksConsent(failure)) forgetConsent();
  showState();
  if (!result) {
    if (!lacksConsent(failure)) saveFailed(change, done);
    return null;
  }
  savedChange(change, null, done, result);
  return result;
}

// A change made in this page has reached the server.
function savedChange(change, kept, done, result) {
  // Saving the same thing again, by "Try again" or from the form, settles the
  // error about it, which would otherwise offer to send an older change.
  const target = changeTarget(change);
  if (target && toast?.target === target) closeToast();
  kept?.();
  done?.(result);
}

function saveFailed(change, done = null, kept = null, offer = null) {
  notify("Couldn’t save that change. Check your connection and try again.", {
    error: true,
    action: { label: "Try again", run: () => changeState(change, done, kept, offer) }
  }).target = changeTarget(change);
}

// What a change was, for a message: "the weigh-in for Nov 23".
function changeName(change) {
  const day = validDate(change.date) ? " for " + prettyDate(change.date) : "";
  switch (change.op) {
    case "save-weight":
    case "update-weight": return "the weigh-in" + day;
    case "delete-weight": return "the deletion of the weigh-in" + day;
    case "save-waist": return "the waist measurement" + day;
    case "delete-waist": return "the deletion of the waist measurement" + day;
    case "set-goal": return "your goal";
    case "clear-goal": return "the removal of your goal";
    case "set-height": return "your height";
    case "set-units": return "your choice of units";
    case "set-preferences": return "your choice of what the overview shows";
    case "consent": return "your agreement to the health data policy";
    default: return "a change";
  }
}

// Whether the server turned a change down because the account hasn't agreed
// to the health data policy (see needsConsent in server/ops.mjs). The change
// waits for the agreement rather than being dropped.
const lacksConsent = error => error instanceof Refused && error.status === 403;

// Whether the server turned a change down for good, rather than failing for now.
const turnedDown = error => error instanceof Refused && error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status);

// The server has no agreement for this account, as after the data was deleted
// on another device, so the log on screen hasn't either. The consent step
// shows until the user agrees again.
function forgetConsent() {
  if (saved?.consent) saved = normalizeState({ ...saved, consent: null });
}

// Sends the outbox to the server, oldest change first, one at a time, through
// the queue. It stops at a change it can't send yet, so nothing goes out of
// order, and tries again on the next sign-in, `online` event, return to the
// tab or SYNC_RETRY. A change the server turns down is dropped. Resolves once
// it has stopped; while it runs, calling it again returns the same promise.
function syncOutbox() {
  if (!syncing && account && !deleting) {
    const current = session;
    // It starts once `syncing` is set, so the status line says it's syncing.
    const run = syncing = Promise.resolve().then(() => sendOutbox(current)).finally(() => {
      if (syncing === run) syncing = null;
      if (session === current) showLogStatus();
    });
  }
  return syncing;
}

async function sendOutbox(current) {
  const userId = account.id;
  clearTimeout(syncTimer);
  syncProblem = null;
  let synced = false; // Whether a change that had waited on this device reached the server.
  showLogStatus();
  for (;;) {
    loadOutbox();
    const item = outbox[0];
    if (!item || deleting) break;
    const local = madeHere.get(item.id);
    const fresh = local && !local.announced; // Made in this page and not yet said to be on this device.
    let result = null;
    let failure = null;
    try { result = await enqueue(() => sendLog(item.change, userId)); } catch (error) { failure = error; }
    if (session !== current) return;
    if (lacksConsent(failure)) {
      loadOutbox();
      // An agreement made meanwhile has gone to the front, so it goes next.
      if (outbox[0]?.change.op === "consent" && outbox[0].id !== item.id) continue;
      console.error(failure);
      syncProblem = "consent";
      forgetConsent();
      showState();
      break;
    }
    if (result || turnedDown(failure) || fresh && !(failure instanceof Unreachable)) {
      editOutbox(items => items.filter(other => other.id !== item.id));
      madeHere.delete(item.id);
    }
    if (result) {
      receive(result.log);
      showState();
      if (fresh) savedChange(item.change, local.kept, local.done, result);
      else synced = true;
      local?.resolve(result);
      continue;
    }
    console.error(failure);
    if (turnedDown(failure) && !fresh) {
      showState();
      notify("Couldn’t sync " + changeName(item.change) + ". Baseline didn’t accept it, so it wasn’t saved.", { error: true }).target = changeTarget(item.change);
      continue;
    }
    if (fresh && !(failure instanceof Unreachable)) {
      // As before the outbox, a change that fails while the user waits for it is undone.
      showState();
      saveFailed(item.change, local.done, local.kept, local.offer);
      local.resolve(null);
      continue;
    }
    syncProblem = failure instanceof Unreachable ? "offline" : failure instanceof Refused && failure.status === 401 ? "sign-in" : "server";
    break;
  }
  if (syncProblem) {
    announceKept();
    // Without the agreement, trying again changes nothing until the user agrees (see agree).
    if (navigator.onLine !== false && syncProblem !== "consent") syncTimer = setTimeout(reconnect, SYNC_RETRY);
    return;
  }
  if (!synced) return;
  // The last reply was the whole log, and reading it again picks up anything
  // another tab sent from this outbox.
  notify("Synced.");
  setTimeout(refreshLog);
}

// Tells the user that changes made in this page that the server doesn't have
// yet are saved on this device, once each.
function announceKept() {
  let told = false;
  let offer = null; // What one of them offers, if any (see changeState).
  for (const item of outbox) {
    const local = madeHere.get(item.id);
    if (!local || local.announced) continue;
    local.announced = true;
    const target = changeTarget(item.change);
    if (target && toast?.target === target) closeToast();
    local.kept?.();
    local.resolve(null);
    told = true;
    offer = local.offer ?? offer;
  }
  if (told) {
    notify(syncProblem === "offline" ? "Saved on this device. It’ll sync when you’re back online."
      : syncProblem === "consent" ? "Saved on this device. It’ll sync once you agree to the health data policy."
      : "Saved on this device. It’ll sync once Baseline can reach your account.", offered(offer));
  }
  showLogStatus();
}

// Back online, or back in the tab: loads sign-in if it failed, sends what's
// waiting on this device, and picks up changes made elsewhere.
function reconnect() {
  clearTimeout(syncTimer);
  if (!state || navigator.onLine === false) return;
  if (!account.confirmed) {
    if (clerkReady) return; // Still loading.
    cacheUpdating = cachedAt !== null;
    showLogStatus();
    // Once Clerk has loaded, its listener confirms the user (see confirmLog).
    connectClerk().catch(error => {
      console.error(error);
      if (!state || account.confirmed) return;
      cacheUpdating = false;
      showLogStatus();
    });
    return;
  }
  if (outbox.length) syncOutbox();
  else refreshLog();
}

// Takes the log as the server returned it. It becomes the saved copy and the
// copy kept on this device, and the screen no longer shows an older copy.
function receive(log) {
  saved = normalizeState(log);
  cachedAt = null;
  try { writeLogCache(localStorage, account.id, saved); } catch { /* Nothing is cached, so the next start shows the skeleton. */ }
  showLogStatus();
  return saved;
}

// When a cached copy was saved: "9:41 AM" today, or "Nov 21, 9:41 AM" before.
function cacheTime(ms) {
  const date = new Date(ms);
  const day = localToday(date);
  return (day === today ? "" : shortDate(day) + ", ") + hourFormat.format(date);
}

// Quiet lines under the heading: one while the log on screen is the copy kept
// on this device, and one while changes are waiting on this device.
function showLogStatus() {
  const lines = [];
  if (cachedAt !== null) {
    lines.push(cacheUpdating ? "Updating…" : navigator.onLine === false ? "Offline · showing your log as of " + cacheTime(cachedAt)
      : "Couldn’t update. Showing your log as of " + cacheTime(cachedAt) + ".");
  }
  // Changes from an earlier visit, or another tab, count as told.
  if (outbox.some(item => madeHere.get(item.id)?.announced !== false)) {
    lines.push("Saved on this device · " + (syncing || cacheUpdating ? "syncing…" : syncProblem === "offline" || syncProblem === null ? "syncing when you’re back online" : "not synced yet"));
  }
  const element = $("log-status");
  element.hidden = !lines.length;
  element.replaceChildren(...lines.map(text => {
    const line = document.createElement("span");
    line.textContent = text;
    return line;
  }));
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

// The top of the overview, which depends on the state of the log (see logStatus
// in model.mjs, and data-status on #main for the styles):
// - An empty log has "Log your first weigh-in" and a line on the average, with
//   no facts. showPage and showBodyFat leave out the rest of the overview.
// - After a break of 14 days or more, the hero keeps the last average in grey,
//   says when it was, and invites the next weigh-in, which ends the state.
// - Otherwise, today's average.
// Nothing here blames anyone for a break.
function showMetrics() {
  const latest = trend.readings.at(-1);
  const height = state.height;
  const { kind } = status;
  $("main").dataset.status = kind;
  $("avg-title").textContent = kind === "empty" ? "Log your first weigh-in" : kind === "lapsed" ? "Last 14-day average" : "14-day average";
  $("hero").hidden = kind === "empty";
  showHero(kind === "lapsed" ? status.lastAverage : trend.current?.average);
  const count = trend.current?.count ?? 0;
  $("avg-detail").textContent = kind === "empty" ? "Baseline averages your last " + WINDOW_DAYS + " days, so day-to-day swings don’t hide where you are."
    : kind === "lapsed" ? "Your last weigh-in was " + shortDate(status.lastDate) + ", " + status.daysAgo + " days ago. Your average then was " + weight(status.lastAverage) + ". Log today to pick up where you left off."
    : "From " + count + (count === 1 ? " weigh-in" : " weigh-ins") + " in the last " + WINDOW_DAYS + " days";
  showRate();
  showFigures();
  $("facts").hidden = kind === "empty";
  setWeight("weight-value", latest?.weight);
  $("weight-detail").textContent = latest ? shortDate(latest.date) : "";
  // Height lives in Settings. Without one, BMI offers to add it here. BMI uses
  // the latest weigh-in, so its date shows with it.
  $("bmi-fact").hidden = !state.preferences.showBmi;
  const bmiValue = bmi(latest?.weight, height);
  setValue("bmi-value", bmiValue);
  $("bmi-detail").textContent = Number.isFinite(bmiValue) ? shortDate(latest.date) : "";
  $("bmi-add").hidden = Boolean(height);
  $("fat-fact").hidden = !state.preferences.showBodyFat;
  showFatFact();
  showGoal();
  // A quiet offer of a goal, for the first two weeks of a log without one.
  $("goal-invite").hidden = Boolean(state.goal) || !latest || logAge() >= NEW_LOG_DAYS;
}

// A log's first two weeks, while the goal line under the average and the hint
// about past dates under the log form show.
const NEW_LOG_DAYS = 14;
// Days since the first weigh-in, for a log that has one through today.
const logAge = () => dayOf(today) - dayOf(state.entries[0].date);

// "Your weekly trend shows after 8 weigh-ins over 2 weeks.", or "returns" for a
// log where it has shown before, as after a break.
const trendPending = () => "Your weekly trend " + (weeklyTrendShown(state.entries, today) ? "returns" : "shows") +
  " after " + RATE_MIN_ENTRIES + " weigh-ins over " + RATE_MIN_SPAN / 7 + " weeks.";

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

// The latest body fat estimate, among the facts, with its date, even when a
// later waist measurement has none. Without any estimate, a dash with what one
// needs instead of a date. The section at the bottom of the overview has the rest.
function showFatFact() {
  const latest = fat.at(-1);
  const estimate = fat.findLast(point => point.bodyFat !== null);
  setText("fat-value", estimate ? percent(estimate.bodyFat) : null);
  $("fat-detail").textContent = estimate ? shortDate(estimate.date) : latest ? fatNeeds(latest) : "";
  $("fat-label").textContent = latest ? "Update" : "Add";
  // The name starts with the word shown, so voice control finds it.
  $("fat-label").setAttribute("aria-label", latest ? "Update body fat with a new waist measurement" : "Add a waist measurement for body fat");
}

// Why a waist measurement has no estimate (see bodyFat in model.mjs), short
// enough to sit on the fact's line on a phone.
const fatNeeds = point => !state.sex ? "No formula chosen" : point.weight === null ? "No weigh-in near its date" : "Outside the formula’s range";

// Up to two decimals, as the target rate is entered, and at least one.
const rateFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function showGoal() {
  const goal = state.goal;
  setWeight("goal-value", goal?.weight);
  $("goal-label").textContent = goal ? "Edit" : "Set";
  $("goal-label").setAttribute("aria-label", goal ? "Edit your goal of " + spokenWeight(goal.weight, unit()) : "Set a goal weight");
  showProgress();
  showCaution();
  showForecast();
}

// A bold lead followed by quieter detail, as in the weekly trend line.
function writeLine(element, lead, rest = "") {
  const strong = document.createElement("strong");
  strong.textContent = lead;
  element.replaceChildren(strong, rest);
}

// After a break, the bar stays where the last average left it, in grey, and the
// note says which day that was. `progress` stays today's, which has none, so
// the forecast stays hidden and the next weigh-in isn't counted as reaching
// milestones (see celebrate).
function showProgress() {
  const stale = status.kind === "lapsed";
  const shown = stale ? goalProgress(state.goal, status.lastAverage, unit()) : progress;
  $("goal-progress").hidden = !shown;
  $("goal-progress").classList.toggle("is-stale", stale);
  if (!shown) return;
  const note = $("progress-note");
  const line = (lead, rest) => {
    writeLine(note, lead, rest);
    if (stale) note.prepend("As of " + shortDate(status.lastDate) + " · ");
  };
  const { current, direction } = shown;
  $("progress-track").hidden = current === null || direction === "maintain";
  note.classList.toggle("is-pending", current === null);
  if (current === null) {
    note.textContent = "Log a weigh-in to see your progress toward " + weight(shown.goal) + ".";
    return;
  }
  if (direction === "maintain") {
    const off = shown.difference;
    if (off === 0) line("At your goal", " of " + weight(shown.goal));
    else line(amount(off) + (off > 0 ? " above" : " below"), " your goal of " + weight(shown.goal));
    return;
  }
  const count = shown.milestones.length;
  $("progress-fill").style.width = shown.overall * 100 + "%";
  $("progress-track").replaceChildren($("progress-fill"), ...shown.milestones.slice(0, -1).map(milestone => {
    const tick = document.createElement("span");
    tick.className = "progress-tick";
    tick.style.left = milestone.index / count * 100 + "%";
    return tick;
  }));
  const losing = direction === "lose";
  if (shown.reached) {
    const past = Math.abs(shown.difference);
    line("Goal reached", past ? " · " + amount(past) + (losing ? " below " : " above ") + weight(shown.goal) : "");
    return;
  }
  const details = [];
  if (shown.behindStart) details.push(amount(shown.behindStart) + (losing ? " above" : " below") + " where you started");
  else {
    if (shown.next.index < count) details.push(amount(shown.next.toGo) + " to milestone " + shown.next.index + " of " + count);
    details.push(Math.floor(shown.overall * 100) + "% of the way");
  }
  line(amount(shown.toGo) + " to go", details.map(text => " · " + text).join(""));
}

// Hiding the note about fast loss lasts for that goal, known by its start date,
// on this device. The page also remembers it, in case the device can't store it.
const hiddenCautions = new Set();
const cautionKey = () => fastLossHiddenKeyFor(account.id);

function cautionHidden(goal) {
  if (hiddenCautions.has(account.id + " " + goal.startDate)) return true;
  try { return localStorage.getItem(cautionKey()) === goal.startDate; } catch { return false; }
}

// A quiet line under the progress when a loss goal's weight has come down
// faster than its cap for three weeks (see fastLossCaution). It informs and
// never changes the goal.
function showCaution() {
  const goal = state.goal;
  const show = Boolean(goal) && !cautionHidden(goal) && fastLossCaution(state.entries, goal, today, unit());
  $("fast-loss").hidden = !show;
  if (!show) return;
  $("fast-loss-text").textContent = "Your weight has come down faster than " + amount(maxGoalRate(goal.startWeight)) + " a week for " + FAST_LOSS_DAYS / 7 +
    " weeks. Loss this fast raises the risk of gallstones, so it’s worth mentioning to your doctor if you haven’t already.";
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
      lead.textContent = !weeklyRate ? trendPending()
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
  line.hidden = status.kind === "empty";
  line.classList.toggle("is-pending", !weeklyRate);
  if (!weeklyRate) {
    line.textContent = trendPending();
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
// need a weigh-in in the last 14 days, like the average itself. An empty log
// has no Trend section at all, rather than an empty chart.
function showFigures() {
  $("trend").hidden = status.kind === "empty";
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
  // The hint about past dates helps while the log is new, and once a date other
  // than today is picked. After that it would sit under Save every day.
  $("entry-hint").textContent = status.kind === "empty" ? "Your first weigh-in starts your log."
    : entry ? "You have a weigh-in on this date."
    : logAge() < NEW_LOG_DAYS || date !== today ? "Choose an earlier date to add a past weigh-in." : "";
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
  const row = '<tr data-edit="' + point.date + '"' + (point.note ? ' class="has-note"' : "") + ">" + dateCell(point.date) +
    '<td class="num entry-weight">' + weightCell(point.weight) + "</td>" +
    '<td class="num">' + weightCell(point.average) + "</td>" +
    '<td class="num">' + rateCell(calculateRate(state.entries, point.date, unit())) + "</td>" +
    '<td class="row-action"><button type="button" class="icon-button" data-edit="' + point.date + '" aria-label="Edit weigh-in for ' + date + '">' + icon("pencil") + "</button></td></tr>";
  return point.note ? row + '<tr class="note-row" data-edit="' + point.date + '"><td colspan="5"><span class="sr-only">Note: </span>' + escapeHtml(point.note) + "</td></tr>" : row;
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
// With no weigh-ins and no measurements, the section is one line that offers
// Log waist.
function showBodyFat() {
  const estimates = fat.filter(point => point.bodyFat !== null);
  const latest = estimates.at(-1);
  const invite = status.kind === "empty" && !fat.length;
  $("fat-invite").hidden = !invite;
  $("fat-head").hidden = invite;
  $("fat-note").hidden = invite;
  const lead = $("fat-lead");
  lead.hidden = invite || estimates.length > 0;
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
  $("waist-rows").innerHTML = shown.map(point => '<tr data-waist-edit="' + point.date + '">' + dateCell(point.date) +
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

const VIEWS = { "#weight-log": "entries", "#monthly-summary": "months", "#settings": "settings", "#your-data": "data" };
// "overview", one of the log's views ("entries" or "months"), "settings" or
// "data" (Your data, linked from Settings and the footer).
function currentView() { return VIEWS[location.hash] ?? "overview"; }
const VIEW_TITLES = { overview: "Baseline", entries: "Weight log · Baseline", months: "Monthly summary · Baseline", settings: "Settings · Baseline", data: "Your data · Baseline" };
const PAGE_TITLES = { log: "Weight log", settings: "Settings", data: "Your data" };

function markCurrent(links, current) {
  for (const id of links) {
    if (id === current) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
}

function showPage() {
  const view = currentView();
  // The page: "overview", "log", "settings" or "data". The nav marks the first
  // three; Your data has no link of its own there.
  const section = view === "entries" || view === "months" ? "log" : view;
  const isLog = section === "log";
  // A new account's overview is the first-run screen (see showFirstRun).
  const firstRun = section === "overview" && wantsFirstRun();
  const overview = section === "overview" && !firstRun;
  document.body.dataset.view = firstRun ? "first-run" : section;
  document.title = firstRun ? "Your first weigh-in · Baseline" : VIEW_TITLES[view];
  // The overview is a page for today, so today's date is its heading.
  $("page-title").textContent = firstRun ? "Your first weigh-in" : PAGE_TITLES[section] ?? prettyDate(today, "day");
  $("overview-view").hidden = !overview;
  showFirstRun(firstRun);
  $("log-tabs").hidden = !isLog;
  // An empty log's overview leaves out Recent entries; the log keeps its line about them.
  $("entries").hidden = !(overview && status.kind !== "empty" || view === "entries");
  $("months").hidden = view !== "months";
  $("settings-view").hidden = section !== "settings";
  $("data-view").hidden = section !== "data";
  // Settings and Your data show the account in full, so the line about it would repeat it.
  $("storage-status").hidden = section === "settings" || section === "data";
  $("footer-data-link").hidden = section === "data";
  markCurrent(["overview-link", "log-link", "settings-link"], section + "-link");
  markCurrent(["entries-link", "months-link"], view === "months" ? "months-link" : "entries-link");
  const first = trend.readings[0];
  const last = trend.readings.at(-1);
  const total = trend.readings.length;
  $("heading-detail").textContent = !isLog || !first ? ""
    : (first === last ? prettyDate(first.date, "full") : prettyDate(first.date, "full") + " – " + prettyDate(last.date, "full")) +
      " · " + total + (total === 1 ? " entry" : " entries");
  if (view === "months") showMonths();
  else if (overview || isLog) showTable(isLog);
  // Body fat sits under the recent entries, on the overview only, unless it's hidden in Settings.
  const bodyFatShown = overview && state.preferences.showBodyFat;
  $("body-fat").hidden = !bodyFatShown;
  if (overview) drawChart();
  if (bodyFatShown) showBodyFat();
}

// A new account's overview: one screen that takes the first weigh-in, in a
// unit picked from the browser's language (see defaultUnits in model.mjs). It
// shows in the overview's place once the account has agreed to the health
// data policy, until anything is saved or "Skip for now" starts the log. It
// waits while a log from before accounts is on its way into the account (see
// importAfterConsent), so an account that takes one in never sees it.
let firstRunUnits = null; // The units it offers: from the browser's language, then as picked. Null until it shows.
let firstRunOpen = false; // Whether it's on the page.

function wantsFirstRun() {
  if (!state || state.started || !hasConsent(state)) return false;
  try { return !hasLegacyLog(localStorage, account.id); } catch { return true; }
}

function showFirstRun(open) {
  const appearing = open && !firstRunOpen;
  firstRunOpen = open;
  $("first-run").hidden = !open;
  if (!open) return;
  firstRunUnits ??= defaultUnits(navigator.languages?.[0] ?? navigator.language);
  pickFirstRunUnit(firstRunUnits.weight);
  if (appearing) $("first-run-weight").focus({ preventScroll: true });
}

// Picking a unit says what the number typed is in, so the number stays as it is.
function pickFirstRunUnit(choice) {
  firstRunUnits = { ...firstRunUnits, weight: choice };
  for (const input of document.querySelectorAll('[name="first-run-unit"]')) input.checked = input.value === choice;
  setWeightInput("first-run-weight", choice);
  $("first-run-lead").textContent = "Your weight swings by " + (choice === "kg" ? "a kilo" : "two pounds") +
    " or more from day to day, so Baseline shows the average of your last " + WINDOW_DAYS + " days.";
}

// Saving the first weigh-in, or skipping it, saves the unit picked, with the
// height unit that goes with the browser's language, unless they're the
// units already saved.
function saveFirstRunUnits() {
  const units = { weight: firstRunUnits.weight, height: firstRunUnits.height };
  if (units.weight !== state.units.weight || units.height !== state.units.height) changeState({ op: "set-units", units });
}

// Either change starts the log, so the overview takes the screen's place.
function leaveFirstRun() {
  window.scrollTo({ top: 0, behavior: "auto" });
  $("main").focus({ preventScroll: true });
}

function drawChart() {
  $("legend-goal").hidden = !state.goal;
  chart.update(trend, range, today, state.goal?.weight ?? null, unit());
}

function render() {
  trend = calculateTrend(state.entries, today);
  status = logStatus(state.entries, today);
  weeklyRate = calculateRate(state.entries, today, unit());
  progress = goalProgress(state.goal, trend.current?.average, unit());
  fat = bodyFatHistory(state.entries, state.waists, state.sex, today);
  $("entry-date").max = today;
  applyUnits();
  showMetrics();
  showSettings();
  syncEntryForm();
  showLogBar();
  showPage();
  showAccount();
  showLogStatus();
}

// The account: the line at the bottom of the page, the email in Settings, the
// agreement and what Your data offers, and the consent step's way out.
function showAccount() {
  $("storage-status").textContent = (account.email ? "Signed in as " + account.email + ". " : "") + "Your log is saved to your account.";
  // Before Clerk has loaded, the log on screen is the copy on this device, which doesn't keep the email.
  $("account-email").textContent = account.email || "Shows once Baseline reaches your account.";
  $("account-email").classList.toggle("is-empty", !account.email);
  showYourData();
  if (!$("consent").hidden) showConsentChoices();
}

// When the account agreed, in the reader's time zone: "Agreed on Nov 23, 2026".
// An agreement made on this device has no time until the server records it.
function showAgreement() {
  // Clerk can report a profile change while a log is still loading.
  if (!state) return;
  const consent = state.consent;
  $("consent-value").textContent = !consent ? "" : consent.at ? "Agreed on " + prettyDate(localToday(new Date(consent.at)), "full") : "Agreed on this device, not synced yet";
  $("consent-version").textContent = prettyDate(CONSENT_VERSION, "full");
}

// Until the account agrees to the current health data policy, this step shows
// in place of the log (see showState). Nothing is saved before, and the server
// turns down any change that would save data (see needsConsent in
// server/ops.mjs). An account that already holds a log can still download or
// delete it without agreeing, or sign out.
function showConsent() {
  const appearing = $("consent").hidden;
  showAuth("consent");
  if (appearing) {
    $("consent-agree").checked = false;
    $("consent-continue").disabled = true;
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  // The agreement on record, if any, is to an older version of the policy.
  const earlier = state.consent;
  const change = $("consent-change");
  change.hidden = !earlier && !holdsData(state);
  change.textContent = earlier ? "The health data policy has changed since you agreed to it" + (earlier.at ? " on " + prettyDate(localToday(new Date(earlier.at)), "full") : "") + ". Read what it says now, then agree to keep using Baseline."
    : "Baseline now asks before it stores health data. Your log is still here, and nothing changes until you choose.";
  showConsentChoices();
}

// Whether the account holds anything that a download would carry.
const holdsData = log => log.entries.length > 0 || log.waists.length > 0 || log.height !== null || log.goal !== null || log.reminder !== null;

function showConsentChoices() {
  const data = holdsData(state);
  const whole = canDeleteAccount();
  $("consent-other-text").textContent = data ? "Your log stays as it is, and nothing new is saved. You can download it or delete it, or sign out."
    : "Nothing has been saved. You can sign out" + (whole ? " or delete your account." : ".");
  $("consent-download").hidden = !data;
  $("consent-delete-data").hidden = !data;
  $("consent-delete-account").hidden = !whole;
}

// Agreeing shows the log at once. The agreement can wait on this device like
// any change, ahead of the rest, and the server records the time it arrives.
function agree() {
  if (!$("consent-agree").checked || !state || hasConsent(state)) return;
  changeState({ op: "consent", version: CONSENT_VERSION }, importAfterConsent);
  // Unless the first-run screen has put focus in its weight field.
  if (!$("main").hidden && !$("main").contains(document.activeElement)) $("main").focus({ preventScroll: true });
}

// A log saved in this browser before accounts moves into an empty account once
// it has agreed to the policy, as it would have at sign-in (see importBrowserLog).
async function importAfterConsent(reply) {
  if (normalizeState(reply.log).started) return;
  const current = session;
  const userId = account.id;
  let result;
  try { result = await enqueue(() => importBrowserLog(reply, userId)); } catch (error) { console.error(error); return; }
  if (session !== current || !result.imported) return;
  receive(result.log);
  showState();
}

// Until a log is open, the page shows one of these in place of the app.
const authViews = ["auth-loading", "auth-setup", "auth-error", "sign-in", "log-loading", "log-error", "consent"];
const AUTH_TITLES = { "sign-in": "Sign in · Baseline", consent: "Your health data · Baseline" };
// A message over the sign-in form, such as the confirmation that an account
// was deleted. It stays until someone signs in. Null when there is none.
let authNotice = null;

function showAuth(view) {
  for (const id of authViews) $(id).hidden = id !== view;
  $("auth").dataset.view = view;
  const notice = view === "sign-in" ? authNotice : null;
  $("auth-notice").textContent = notice ?? "";
  $("auth-notice").hidden = !notice;
  $("auth").setAttribute("aria-busy", String(view.endsWith("-loading")));
  $("auth").hidden = false;
  $("main").hidden = true;
  $("account-bar").hidden = !account;
  $("main-nav").hidden = true;
  document.title = AUTH_TITLES[view] ?? "Baseline";
}

function emailOf(user) {
  return user.primaryEmailAddress?.emailAddress ?? "";
}

// The server saves nothing for an account that hasn't agreed to the health data
// policy, so a browser's old log waits for the agreement (see importAfterConsent).
const importOnceAgreed = (read, userId) => hasConsent(read.log) ? importBrowserLog(read, userId) : read;

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
  const imported = await sendLog({ op: "import", log: local }, userId);
  if (imported.imported) {
    try { localStorage.removeItem(key); } catch { /* Harmless: the account is no longer empty, so it won't import again. */ }
  }
  return imported;
}

// Starts a new open log for an account, leaving the one before behind. The
// account's outbox comes with it.
function beginSession(id, email, confirmed) {
  forgetChanges();
  session = {};
  account = { id, email, confirmed };
  state = saved = null;
  cachedAt = null;
  cacheUpdating = false;
  queue = Promise.resolve();
  loadOutbox();
  return session;
}

// Drops what this page knows about changes on their way. Changes made here
// that were still waiting resolve to null.
function forgetChanges() {
  for (const local of madeHere.values()) local.resolve(null);
  madeHere.clear();
  outbox = [];
  outboxInPage = false;
  sending = [];
  syncing = null;
  syncProblem = null;
  clearTimeout(syncTimer);
}

// Puts the open log on the page, starting from the overview for today, or the
// consent step until the account has agreed (see showState).
function showLog() {
  today = localToday();
  page = 0;
  editingDate = null;
  autoFill = true;
  sheetAutoFill = true;
  rateSource = null;
  allWaists = false;
  $("entry-date").value = today;
  for (const form of Object.keys(CHECKED_FIELDS)) closeCheck(form);
  firstRunUnits = null;
  $("first-run-weight").value = "";
  $("first-run-weight-lb").value = "";
  showState();
}

// Shows the log cached on this device at once, before Clerk has loaded, with
// the changes still waiting on this device. It's marked "Updating…" until
// Clerk confirms the user and the server's copy arrives.
function showCachedLog(cached) {
  beginSession(cached.userId, "", false);
  saved = cached.log;
  cachedAt = cached.savedAt;
  cacheUpdating = true;
  showLog();
}

async function openLog(user) {
  authNotice = null;
  if (account && account.id !== user.id) closeLog();
  const current = beginSession(user.id, emailOf(user), true);
  showAuth("log-loading");
  let result;
  try {
    result = await enqueue(() => sendLog(null, user.id).then(read => importOnceAgreed(read, user.id)));
  } catch (error) {
    if (session !== current) return;
    console.error(error);
    showAuth("log-error");
    return;
  }
  if (session !== current) return;
  receive(result.log);
  showLog();
  if (outbox.length) syncOutbox();
}

// Clerk has confirmed the user whose cached log is on screen. Changes made
// while it loaded go out first, then the server's copy replaces the cached
// one, and then anything still waiting on this device is sent.
async function confirmLog(user) {
  const current = session;
  account.confirmed = true;
  account.email = emailOf(user);
  cacheUpdating = true;
  showAccount();
  showLogStatus();
  let result;
  try {
    result = await enqueue(() => sendLog(null, user.id).then(read => importOnceAgreed(read, user.id)));
  } catch (error) {
    if (session !== current) return;
    console.error(error);
    cacheUpdating = false;
    showLogStatus();
    return;
  }
  if (session !== current) return;
  cacheUpdating = false;
  receive(result.log);
  showState();
  if (outbox.length) syncOutbox();
}

// Whether changes are on their way, so a read could come back without them.
const changesPending = () => outbox.length > 0 || sending.length > 0 || syncing !== null || deleting;

// Picks up changes made in other tabs or on other devices.
async function refreshLog() {
  if (!state || changesPending() || !account.confirmed || cacheUpdating) return;
  const current = session;
  let result;
  try { result = await sendLog(null, account.id); } catch { return; }
  if (session !== current || changesPending()) return;
  const before = JSON.stringify(saved);
  receive(result.log);
  if (JSON.stringify(saved) === before) return;
  showState();
}

// Closes the open log, on sign-out or when another account signs in. The copy
// kept on this device goes too, with any changes that haven't synced, so a
// shared device keeps no one's weights. `keepOutbox` keeps those changes when
// nobody signed out and they exist nowhere else.
function closeLog({ keepOutbox = false } = {}) {
  forgetChanges();
  account = null;
  session = null;
  state = saved = null;
  cachedAt = null;
  cacheUpdating = false;
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  closeToast();
  try { clearLogCache(localStorage, { keepOutbox }); } catch { /* Storage is blocked, so nothing was cached. */ }
}

function showSignedIn(user) {
  if (account?.id !== user.id) openLog(user);
  else if (!account.confirmed) confirmLog(user);
  else {
    // The email, or whether the user may delete their account, can change.
    account.email = emailOf(user);
    showAccount();
    // A change the server turned away for want of a sign-in can go now.
    if (syncProblem === "sign-in") syncOutbox();
  }
  if (mounted === "user") return;
  if (mounted === "sign-in") clerk.unmountSignIn($("sign-in-card"));
  clerk.mountUserButton($("user-button"), { appearance: { elements: { userButtonAvatarBox: { width: "2rem", height: "2rem" } } } });
  mounted = "user";
}

function showSignedOut() {
  closeLog();
  // Clerk's sign-in steps live in the hash ("#/factor-one"), so drop the app's own views from it.
  if (location.hash && !location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search);
  showAuth("sign-in");
  if (mounted === "sign-in") return;
  if (mounted === "user") clerk.unmountUserButton($("user-button"));
  // Clerk styles the node it mounts into, so it gets a child of the centered wrapper.
  clerk.mountSignIn($("sign-in-card"), { withSignUp: true });
  mounted = "sign-in";
}

// Shows the last user's cached log straight away, if this device has one,
// then loads Clerk to find out who is signed in.
async function startAuth() {
  let userId = null;
  let cached = null;
  try {
    userId = lastUser(localStorage);
    cached = readLogCache(localStorage, userId);
  } catch { /* Storage is blocked, so there's no copy to show. */ }
  if (cached) showCachedLog(cached);
  // Without a copy, the skeleton shows when someone was signed in here last time.
  else showAuth(userId ? "log-loading" : "auth-loading");
  try {
    await connectClerk();
  } catch (error) {
    console.error(error);
    if (error instanceof AuthSetupError) {
      // Sign-in isn't set up, so nobody signed out: changes waiting on this
      // device stay until it is, and then sync.
      closeLog({ keepOutbox: true });
      showAuth("auth-setup");
    } else if (state) {
      // Offline, Clerk can't load, so the cached log stays, marked as not
      // updated. Coming back online, returning to the tab or saving tries again.
      cacheUpdating = false;
      showLogStatus();
    } else showAuth("auth-error");
  }
}

// Brings the log form into view on the overview, with focus in `field`.
function focusEntry(field = "entry-weight") {
  if (currentView() !== "overview") {
    window.addEventListener("hashchange", () => focusEntry(field), { once: true });
    location.hash = "overview";
    return;
  }
  requestAnimationFrame(() => {
    // A new account's first weigh-in comes from the first-run screen, in the unit it picks.
    if (firstRunOpen) {
      $("first-run-weight").focus();
      return;
    }
    $("entry-panel").scrollIntoView({ block: "center", behavior: "auto" });
    $(field).focus({ preventScroll: true });
  });
}

// Today's weigh-in on phones: the bar at the bottom of the overview and the
// log opens the log sheet, a dialog with the weight field focused and Save
// right above the keyboard. The log form stays for other dates, and on wider
// screens it's the only way in. The width matches the bar's in styles.css.
const phoneLayout = matchMedia("(max-width: 600px)");

// The bar's label, and the sheet's heading and fields, for today. Once today
// has a weigh-in, the bar shows it and turns from the accent to an outline.
function showLogBar() {
  const label = todayLabel(state.entries, today, unit());
  const logged = state.entries.some(entry => entry.date === today);
  const button = $("log-bar-button");
  button.textContent = label.text;
  if (label.spoken === label.text) button.removeAttribute("aria-label");
  else button.setAttribute("aria-label", label.spoken);
  button.classList.toggle("primary", !logged);
  button.classList.toggle("secondary", logged);
  syncSheet();
}

function syncSheet() {
  const entry = state.entries.find(item => item.date === today);
  $("sheet-title").textContent = todayHeading(today);
  $("sheet-save").textContent = entry ? "Update entry" : "Save entry";
  if (!sheetAutoFill) return;
  writeWeight("sheet-weight", entry?.weight);
  $("sheet-note").value = entry?.note ?? "";
  // Today's note shows, so it can be changed. Without one, the field waits behind "Add a note".
  showSheetNote(Boolean(entry?.note));
}

function showSheetNote(shown) {
  $("sheet-note-field").hidden = !shown;
  $("sheet-add-note").hidden = shown;
}

// Opens the sheet with focus in the weight field. Called from a tap, the focus
// is part of it, which iOS needs before it raises the keyboard.
function openSheet() {
  if (!state || $("main").hidden || document.querySelector("dialog[open]:not(#log-sheet)")) return;
  syncDay();
  const sheet = $("log-sheet");
  if (!sheet.open) {
    fitSheet();
    window.visualViewport?.addEventListener("resize", fitSheet);
    window.visualViewport?.addEventListener("scroll", fitSheet);
    sheet.showModal();
  }
  $("sheet-weight").focus();
}

// Keeps the sheet's bottom at the bottom of the visible part of the screen,
// which an on-screen keyboard moves up: the visual viewport ends at
// --view-bottom, measured from the top of the layout viewport that fixed
// elements sit in (see dialog.sheet in styles.css). Over a keyboard, which
// covers the home indicator, the sheet leaves no room for it. On a short
// screen the fields scroll, and the one being typed in stays in view.
function fitSheet() {
  const view = window.visualViewport;
  if (!view) return;
  const root = document.documentElement.style;
  root.setProperty("--view-bottom", view.offsetTop + view.height + "px");
  root.setProperty("--view-height", view.height + "px");
  $("log-sheet").classList.toggle("over-keyboard", window.innerHeight - view.height > 100);
  const fields = $("sheet-fields");
  const typing = document.activeElement?.closest(".input-frame");
  if (!typing || !fields.contains(typing)) return;
  const shown = fields.getBoundingClientRect();
  const field = typing.getBoundingClientRect();
  if (field.bottom > shown.bottom) fields.scrollTop += field.bottom - shown.bottom;
  else if (field.top < shown.top) fields.scrollTop -= shown.top - field.top;
}

// Today's weigh-in, from a reminder, the home-screen shortcut or a #log link:
// the sheet on phones, and the log form on wider screens.
function openLogEntry() {
  if (phoneLayout.matches && !wantsFirstRun()) openSheet();
  else focusEntry();
}

// Opening Baseline at #log asks for today's weigh-in. #log isn't a view, so the
// overview shows, and once the log is on the page the address goes back to
// the overview and the weigh-in opens. While sign-in loads or the consent step
// shows, the hash waits. Signed out, Clerk's sign-in takes over the hash.
function followLogLink() {
  if (location.hash !== "#log" || !state || $("main").hidden) return;
  history.replaceState(null, "", location.pathname + location.search + "#overview");
  openLogEntry();
}

// Weight inputs: a main input in kg, pounds or stones, and a pounds input
// (id + "-lb") that shows only for stones. Heights work the same way, with an
// inches input for feet. The inputs use `fieldUnits`, which applyUnits keeps
// in step with the saved units, converting anything already typed.
const WEIGHT_FIELDS = ["entry-weight", "sheet-weight", "edit-weight", "goal-weight", "goal-start-weight"];

// The weight typed into a field, in kg, or NaN. A field that still shows
// `stored` as it was filled in returns it unchanged, so saving again never
// rounds away hundredths that another unit needed. The first-run screen's
// field is in the unit picked there, rather than the saved one.
function readWeight(id, stored, weightUnit = fieldUnits.weight) {
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
const typedRate = kg => Math.round((fieldUnits.weight === "kg" ? kg : kg / KG_PER_LB) * 100) / 100;

function readRate(stored) {
  const value = $("goal-rate").valueAsNumber;
  if (!Number.isFinite(value)) return null;
  if (stored && typedRate(stored) === Math.round(value * 100) / 100) return stored;
  return fieldUnits.weight === "kg" ? value : value * KG_PER_LB;
}

function writeRate(kg) {
  $("goal-rate").value = kg ? String(typedRate(kg)) : "";
}

function setInput(id, attributes) {
  for (const [name, value] of Object.entries(attributes)) $(id).setAttribute(name, value);
}

// Sets a weight field and its pounds field up for kg, lb or st: limits that
// keep to the 0.1 to 2,000 kg that can be saved, the unit, and the pounds
// field for stones.
function setWeightInput(id, weightUnit) {
  const stones = weightUnit === "st";
  setInput(id, stones ? { min: 0, max: 314, step: 1, placeholder: "0", inputmode: "numeric" }
    : { min: 0.1, max: weightUnit === "kg" ? 2000 : 4409.2, step: 0.1, placeholder: "0.0", inputmode: "decimal" });
  $(id + "-unit").textContent = weightUnit;
  $(id + "-lb").parentElement.hidden = !stones;
}

// Sets the inputs up for the saved units. Anything typed is converted, so it
// still means the same weight or height.
function applyUnits() {
  const { weight: weightUnit, height: heightUnit } = state.units;
  for (const button of document.querySelectorAll(":is(#weight-units, #settings-weight-units) [data-unit]")) button.setAttribute("aria-pressed", String(button.dataset.unit === weightUnit));
  for (const button of document.querySelectorAll(":is(#height-units, #waist-units, #settings-length-units) [data-unit]")) button.setAttribute("aria-pressed", String(button.dataset.unit === heightUnit));
  document.body.dataset.weightUnit = weightUnit;
  const previous = fieldUnits;
  if (previous?.weight !== weightUnit) {
    const weights = previous ? WEIGHT_FIELDS.map(id => readWeight(id)) : [];
    const rate = previous ? readRate() : null;
    fieldUnits = { ...fieldUnits, weight: weightUnit };
    for (const id of WEIGHT_FIELDS) setWeightInput(id, weightUnit);
    WEIGHT_FIELDS.forEach((id, index) => writeWeight(id, weights[index]));
    // A question about a weigh-in names weights in the old unit.
    for (const form of Object.keys(CHECKED_FIELDS)) closeCheck(form);
    $("goal-rate-unit").textContent = rateUnit() + "/wk";
    $("goal-rate").placeholder = weightUnit === "kg" ? "e.g. 0.5" : "e.g. 1";
    writeRate(rate);
    checkRate();
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

function changeUnits(units, message) {
  if (units.weight === state.units.weight && units.height === state.units.height) return;
  changeState({ op: "set-units", units }, () => notify(message));
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
  showGoalForm();
  showStartHint();
  updateGoalForm();
  $("goal-dialog").showModal();
  $(focusId).focus();
}

// The goal dialog shows its form, or asks before removing the goal.
function showGoalForm(confirming = false) {
  $("goal-detail").hidden = confirming;
  $("goal-form").hidden = confirming;
  $("goal-confirm").hidden = !confirming;
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

// The target rate can be no faster than the cap for the start weight (see
// maxGoalRate), so the field's limit and message follow the start weight. On a
// loss goal, a rate above 1% of the start weight a week brings a note.
function checkRate() {
  const input = $("goal-rate");
  const saved = state.goal;
  const start = roundWeight(readWeight("goal-start-weight", saved?.startWeight));
  const target = roundWeight(readWeight("goal-weight", saved?.weight));
  const rate = readRate(saved?.rate);
  const limit = goalRateLimit(start, fieldUnits.weight);
  const losing = positive(target) && toTenths(target, unit()) < toTenths(start, unit());
  // A saved rate within the cap can round, as typed, to just past the limit.
  const kept = saved?.rate && goalRateAllowed(saved.rate, start) ? typedRate(saved.rate) : 0;
  if (limit === null) input.removeAttribute("max");
  else input.max = String(Math.max(limit, kept));
  const over = rate !== null && limit !== null && !goalRateAllowed(rate, start);
  input.setCustomValidity(!over ? "" : "The fastest target rate Baseline saves is " + rateFormat.format(limit) + " " + rateUnit() + " a week for a start weight of " +
    weight(start) + "." + (losing ? " Faster loss raises health risks." : ""));
  $("goal-rate-note").textContent = losing && rate !== null && fastGoalRate(rate, start)
    ? "That’s faster than most guidance suggests. Losing more than about " + amount(GOAL_RATE_CAP) + " a week raises the risk of gallstones." : "";
}

// Everything in the goal dialog that follows what's typed.
function updateGoalForm() {
  checkRate();
  previewGoal();
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
  $("reminder-detail").textContent = !reminder ? "" : !onThisDevice() ? "Reminders go to another device"
    : reminder.timeZone !== deviceZone() ? zoneName(reminder.timeZone) + " time" : "";
  $("reminder-label").textContent = reminder ? "Edit" : "Set";
  $("reminder-label").setAttribute("aria-label", reminder ? "Edit your daily reminder at " + hourLabel(reminder.hour) : "Set a daily reminder");
  if ($("reminder-dialog").open) showReminderStatus();
}

// The settings page: units (see applyUnits), height, the reminder, what the
// overview shows, your data and your account (see showAccount).
function showSettings() {
  const height = state.height;
  $("height-value").textContent = height ? heightParts(height, state.units.height).map(part => part.join(" ")).join(" ") : "Not set";
  $("height-value").classList.toggle("is-empty", !height);
  $("height-label").textContent = height ? "Edit" : "Add";
  $("height-label").setAttribute("aria-label", height ? "Edit height, currently " + spokenHeight(height, state.units.height) : "Add your height for BMI");
  showReminder();
  for (const input of document.querySelectorAll("[data-preference]")) input.checked = state.preferences[input.dataset.preference];
}

// What each preference's checkbox says once its change is saved.
const preferenceMessages = {
  showBmi: { true: "BMI shows on the overview again.", false: "BMI hidden from the overview. Your height is kept." },
  showBodyFat: { true: "Body fat shows on the overview again.", false: "Body fat hidden from the overview. Your waist measurements are kept." }
};

// Hiding something on the overview changes only what shows, so it can wait on
// the device like units can.
function changePreference(key, value) {
  if (state.preferences[key] === value) return;
  changeState({ op: "set-preferences", preferences: { [key]: value } }, () => notify(preferenceMessages[key][value]));
}

// Whether this device can get reminders: "ready", "blocked" (notifications are
// turned off for the site), "home-screen" (an iPhone or iPad, where push needs
// Baseline on the Home Screen) or "unsupported".
function reminderAccess() {
  if (!worker?.pushManager || !("Notification" in window)) return appleTouch() && !navigator.standalone ? "home-screen" : "unsupported";
  return Notification.permission === "denied" ? "blocked" : "ready";
}

// An iPhone or iPad, including an iPad that reports itself as a Mac.
const appleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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

// Unsubscribes this device from push once the server has forgotten its
// subscription, so it starts afresh the next time reminders are turned on.
async function forgetDevice() {
  try { await (await worker?.pushManager?.getSubscription())?.unsubscribe(); } catch { /* Harmless: the server no longer sends to it. */ }
  deviceEndpoint = null;
  if (state) showReminder();
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

// Your data: downloading the log, and deleting it or the whole account.
// Withdrawing the agreement to the health data policy deletes the data too.
const DELETE_WORD = "delete"; // What the user types to confirm, and what server/ops.mjs checks.
let erasing = null; // What the delete dialog deletes: "data" or "account".
let withdrawing = false; // Whether the data is deleted to withdraw the agreement.
let accountDataGone = false; // The account's rows are deleted, and only the Clerk user is left.

// Deleting the account needs the Clerk Dashboard setting that lets users delete
// their own accounts, so without it the button doesn't show and the log is
// never deleted on the way to a deletion Clerk would refuse.
const canDeleteAccount = () => clerk?.user?.id === account?.id && clerk.user.deleteSelfEnabled === true;

function showYourData() {
  const whole = canDeleteAccount();
  $("delete-account").hidden = !whole;
  $("delete-note").textContent = "Delete my data empties your log on every device and keeps your account." +
    (whole ? " Delete my account deletes your log, then your account." : "");
  showAgreement();
}

// An iPhone or iPad app on the Home Screen, where a download link does nothing useful.
const homeScreenApple = () => appleTouch() && (navigator.standalone === true || matchMedia("(display-mode: standalone)").matches);

// Saves a file the page made. A Home Screen app on an iPhone or iPad offers
// the share sheet instead, which can save it to Files.
function download(name, type, text) {
  const blob = new Blob([text], { type });
  if (homeScreenApple() && navigator.canShare) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(error => {
        if (error.name === "AbortError") return;
        console.error(error);
        saveLink(blob, name);
      });
      return;
    }
  }
  saveLink(blob, name);
}

function saveLink(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the file after the click has returned.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The log on screen, with any changes still waiting on this device.
function downloadCsv() {
  syncDay();
  download(csvFileName(today), "text/csv;charset=utf-8", weighInsCsv(state, unit()));
}

function downloadJson() {
  syncDay();
  download(jsonFileName(today), "application/json", exportJson(state, new Date()));
}

// `withdraw` is when the user is withdrawing their agreement to the health data
// policy, which deletes the data as Delete my data does.
function openErase(kind, withdraw = false) {
  erasing = kind;
  withdrawing = withdraw && kind === "data";
  accountDataGone = false;
  const whole = kind === "account";
  $("erase-title").textContent = whole ? "Delete your account?" : withdrawing ? "Withdraw your agreement?" : "Delete your data?";
  $("erase-lead").textContent = (withdrawing ? "Withdrawing it permanently deletes" : "This permanently deletes") + " everything in your log, on every device:";
  $("erase-after").textContent = whole ? "Then your account is deleted and you’re signed out. This can’t be undone."
    : "Your account stays, with an empty log, and you stay signed in. Baseline asks you to agree again before it saves anything new. This can’t be undone.";
  $("erase-word").value = "";
  eraseBusy(false);
  showEraseStatus("");
  $("erase-dialog").showModal();
  $("erase-cancel").focus();
}

const eraseConfirmed = () => $("erase-word").value.trim().toLowerCase() === DELETE_WORD;

// While a deletion is on its way, the dialog can't be closed or sent again.
function eraseBusy(busy) {
  const dialog = $("erase-dialog");
  dialog.toggleAttribute("data-busy", busy);
  $("erase-word").readOnly = busy;
  for (const id of ["erase-close", "erase-cancel", "erase-download"]) $(id).disabled = busy;
  const submit = $("erase-submit");
  submit.setAttribute("aria-disabled", String(busy));
  submit.disabled = !busy && !eraseConfirmed();
  submit.textContent = accountDataGone ? "Try again" : erasing === "account" ? "Delete my account" : withdrawing ? "Withdraw and delete" : "Delete my data";
}

// A line in the delete dialog, or a message at the bottom of the page if the
// dialog has closed.
function showEraseStatus(message, error = false) {
  if (!$("erase-dialog").open) {
    if (message && error) notify(message, { error: true });
    return;
  }
  $("erase-status").textContent = message;
  $("erase-status").hidden = !message;
}

// Sends a deletion once the requests before it have finished. Nothing else is
// sent or read meanwhile (see `deleting`). Resolves to the server's reply, or
// to { failure } if it fails.
async function sendDeletion(op, userId) {
  deleting = true;
  clearTimeout(syncTimer);
  try {
    return await enqueue(() => sendLog({ op, confirm: DELETE_WORD }, userId));
  } catch (failure) {
    return { failure };
  } finally {
    deleting = false;
  }
}

function eraseFailed(failure, message) {
  console.error(failure);
  eraseBusy(false);
  showEraseStatus(failure instanceof Unreachable ? "Couldn’t reach Baseline. Check your connection and try again." : message, true);
  // What was waiting on this device can go now.
  if (outbox.length) syncOutbox();
}

// The server has deleted the log, so this device forgets it too: the changes
// waiting here, the copy kept here, any log from before accounts, the hidden
// note and this device's push subscription. A new session ignores replies to
// anything sent before the deletion. The empty log replaces it on screen.
function startAfresh(userId, log) {
  forgetChanges();
  session = {};
  cachedAt = null;
  cacheUpdating = false;
  hiddenCautions.clear();
  try { clearDeviceData(localStorage, userId); } catch { /* Storage is blocked, so nothing was kept. */ }
  forgetDevice();
  receive(log);
  showLog();
}

// Not applied until the server has done it: the dialog waits for the reply.
async function deleteData() {
  const current = session;
  const userId = account.id;
  eraseBusy(true);
  showEraseStatus("Deleting your data…");
  const result = await sendDeletion("delete-data", userId);
  if (session !== current) return;
  if (result.failure) return eraseFailed(result.failure, "Couldn’t delete your data. Try again.");
  startAfresh(userId, result.log);
  $("erase-dialog").removeAttribute("data-busy");
  $("erase-dialog").close();
  notify(withdrawing ? "Your agreement is withdrawn and your data has been deleted." : "Your data has been deleted.");
}

// Deletes every row for the account, then the Clerk user. If Clerk fails after
// the data has gone, "Try again" deletes only the Clerk user.
async function deleteAccount() {
  const userId = account.id;
  if (!accountDataGone && !canDeleteAccount()) {
    showEraseStatus("Deleting your account isn’t available. Your data is unchanged.");
    return;
  }
  eraseBusy(true);
  showEraseStatus("Deleting your account…");
  if (!accountDataGone) {
    const current = session;
    const result = await sendDeletion("delete-account", userId);
    if (session !== current) return;
    if (result.failure) return eraseFailed(result.failure, "Couldn’t delete your account. Try again.");
    accountDataGone = true;
    startAfresh(userId, result.log);
  }
  // Set first, since Clerk's listener shows sign-in as soon as the user has gone.
  authNotice = "Your account and all your data have been deleted.";
  try {
    const instance = await connectClerk();
    if (instance.user?.id !== userId) throw new Error("The account to delete isn't the one signed in.");
    await instance.user.delete();
  } catch (error) {
    authNotice = null;
    if (account?.id !== userId) return;
    console.error(error);
    eraseBusy(false);
    showEraseStatus("Your data has been deleted, but your account couldn’t be. Check your connection and try again.", true);
    return;
  }
  // Deleting the user ends its session. If Clerk still reports one, sign out too.
  if (clerk.user) {
    try { await clerk.signOut(); } catch (error) { console.error(error); }
  }
  if (account) showSignedOut();
}

// "Manage account" opens Clerk's account page, where the email, password and
// sign-in methods change.
async function manageAccount() {
  if (navigator.onLine === false) {
    notify("Managing your account needs a connection. Try again when you’re back online.");
    return;
  }
  const userId = account.id;
  let instance;
  try {
    instance = await connectClerk();
  } catch (error) {
    console.error(error);
    if (account?.id === userId) notify("Couldn’t reach your account. Check your connection and try again.", { error: true });
    return;
  }
  if (instance.user?.id === userId) instance.openUserProfile();
}

// Signing out removes the log from this device, with any changes that haven't
// synced, so it asks first when there are some. It needs a connection: Clerk
// ends the session on its server, and offline it would end only here.
function signOut() {
  if (navigator.onLine === false) {
    notify("Signing out needs a connection. Try again when you’re back online.");
    return;
  }
  loadOutbox();
  const warning = signOutWarning(outbox.length);
  if (!warning) {
    finishSignOut();
    return;
  }
  $("sign-out-warning").textContent = warning;
  $("sign-out-dialog").showModal();
  $("sign-out-dialog").querySelector(".button.secondary").focus();
}

async function finishSignOut() {
  const userId = account?.id;
  if (!userId) return;
  let instance;
  try {
    instance = await connectClerk();
  } catch (error) {
    console.error(error);
    if (account?.id === userId) notify("Couldn’t sign out. Check your connection and try again.", { error: true });
    return;
  }
  if (instance.user?.id !== userId) return;
  try {
    // Without a callback Clerk reloads the page before it says the user has
    // gone, so the copy on this device would outlast the session until the
    // next load. With one, it stays on the page: the device's copy is removed
    // first, then Clerk's listener shows sign-in (see showSignedOut).
    await instance.signOut(() => {
      try { clearLogCache(localStorage); } catch { /* Storage is blocked, so nothing was kept. */ }
    });
  } catch (error) {
    console.error(error);
    if (account?.id !== userId) return;
    // Still signed in, so the copy on this device comes back.
    try { writeLogCache(localStorage, userId, saved); } catch { /* The next reply caches it. */ }
    if (outbox.length && !outboxInPage) {
      try { writeOutbox(localStorage, userId, outbox); } catch { outboxInPage = true; }
    }
    notify("Couldn’t sign out. Check your connection and try again.", { error: true });
    return;
  }
  if (account?.id === userId && !instance.user) showSignedOut();
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
  // The consent step draws the log once it gives way (see showState).
  if (state && !$("main").hidden) render();
}

function scheduleMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { syncDay(); scheduleMidnight(); }, midnight - now + 100);
}

function dateChanged() {
  closeCheck("entry");
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
for (const id of ["entry-weight", "entry-weight-lb", "entry-note"]) $(id).addEventListener("input", () => {
  autoFill = false;
  entryEdits++;
});
// Saves a weigh-in from the log form or the log sheet. It shows at once, and
// a message confirms it once the server has it, with a word when it carries
// the average past a milestone. A failed save offers "Try again" (see
// changeState). `kept` runs once it's saved, on the server or on this device.
// Leaving out `note` keeps the date's note as it is. Returns false, saving
// nothing, for a date or weight that can't be saved. `offer` goes with the
// message (see changeState).
function saveWeighIn({ date, weight, note }, kept = null, offer = null) {
  if (!validDate(date) || date > today || !positive(weight)) return false;
  const updating = state.entries.some(entry => entry.date === date);
  const before = progress;
  const change = note === undefined ? { op: "save-weight", date, weight } : { op: "save-weight", date, weight, note };
  changeState(change, () => notify((updating ? "Weigh-in updated" : "Weigh-in saved") + " for " + prettyDate(date) + "." + celebrate(before, progress), offered(offer)), kept, offer);
  return true;
}

// The options for a message that carries an offer: { label, run }, and how
// long it stays if not OFFER_DURATION.
const offered = offer => offer ? { action: offer, duration: offer.duration ?? OFFER_DURATION } : undefined;

// Deletes a weigh-in or a waist measurement, or removes the goal, at once, as
// any change is made (see changeState). The message that says it's done, or
// that it's saved on this device, offers Undo for UNDO_DURATION. Undo makes
// the change that puts back what was there, built from the log on screen just
// before (see inverseOf in model.mjs). It's sent like any other change, so it
// works however far the deletion has got, offline included. Deleting the whole
// log or the account, and turning reminders off, have no Undo.
function deleteWithUndo(change, message, restored) {
  const inverse = inverseOf(change, state);
  const userId = account.id;
  const offer = inverse && {
    label: "Undo",
    duration: UNDO_DURATION,
    run: () => state && account?.id === userId ? changeState(inverse, () => notify(restored)) : null
  };
  changeState(change, () => notify(message, offered(offer)), null, offer);
}

// The question Baseline asks under a weight field before it saves a weigh-in
// that looks like a wrong unit, a slipped decimal point or an unlikely jump
// (see checkWeighIn in model.mjs): in the log form, the log sheet and the edit
// dialog. It's part of the form rather than a dialog. Its text goes through a
// live region and focus moves to its first button. Nothing is saved, and no
// weight changes, until a button is tapped. Typing a weight, picking another
// date or closing the form takes it away. Each form's weight field, by form.
const CHECKED_FIELDS = { entry: "entry-weight", sheet: "sheet-weight", edit: "edit-weight" };

// Saves `weight` (kg) for `date` through `save(weight, offer)` at once, or once
// a button in the question is tapped. Saving a weigh-in again as it was, as to
// change its note, asks nothing. `offer` is null, or after a unit mix-up, the
// offer to show weights in that unit (see changeState).
function saveChecked(form, { date, weight, unchanged }, save) {
  closeCheck(form);
  const check = unchanged ? null : checkWeighIn({ weight, date, entries: state.entries, unit: unit() });
  if (!check) {
    save(weight, null);
    return;
  }
  const question = weighInQuestion(check, weight, unit(), today);
  const buttons = question.choices.map(choice => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.textContent = choice.label;
    // Screen readers may read "st" as "street" (see spokenLabel).
    if (choice.spoken !== choice.label) button.setAttribute("aria-label", choice.spoken);
    button.addEventListener("click", () => {
      closeCheck(form);
      if (choice.weight === null) $(CHECKED_FIELDS[form]).focus();
      else save(choice.weight, choice.unit && unitOffer(choice.unit));
    });
    return button;
  });
  $(form + "-check-text").textContent = question.text;
  $(form + "-check-actions").replaceChildren(...buttons);
  $(form + "-check-actions").hidden = false;
  $(form + "-check").classList.add("is-open");
  buttons[0].focus();
}

function closeCheck(form) {
  if (!$(form + "-check").classList.contains("is-open")) return;
  $(form + "-check").classList.remove("is-open");
  $(form + "-check-text").textContent = "";
  $(form + "-check-actions").replaceChildren();
  $(form + "-check-actions").hidden = true;
}

// After a weigh-in typed in the wrong unit is saved in the right one, the
// message offers to show every weight in that unit.
const offerNames = { kg: "kg", lb: "lb", st: "stones and pounds" };
const unitOffer = choice => ({
  label: "Show weights in " + offerNames[choice] + " from now on",
  run: () => { if (state) changeUnits({ ...state.units, weight: choice }, "Weights now show in " + unitNames[choice] + "."); }
});

for (const [form, id] of Object.entries(CHECKED_FIELDS)) {
  for (const field of [id, id + "-lb"]) $(field).addEventListener("input", () => closeCheck(form));
}

$("entry-form").addEventListener("submit", event => {
  event.preventDefault();
  syncDay();
  const date = $("entry-date").value;
  const existing = state.entries.find(entry => entry.date === date);
  const weight = roundWeight(readWeight("entry-weight", existing?.weight));
  if (!validDate(date) || date > today || !positive(weight)) return;
  saveChecked("entry", { date, weight, unchanged: weight === existing?.weight }, (chosen, offer) => {
    // What was typed stays in the form until the weigh-in is saved, so a failed
    // save loses nothing. Then the form shows the saved weigh-in, unless
    // something new was typed meanwhile.
    const edits = entryEdits;
    saveWeighIn({
      date,
      weight: chosen,
      // The form shows the date's note, so an empty field removes it.
      note: cleanNote($("entry-note").value)
    }, () => {
      if (entryEdits !== edits) return;
      autoFill = true;
      syncEntryForm();
    }, offer);
    // A button in the question had focus, and it has gone.
    if (!$("entry-form").contains(document.activeElement)) $("entry-form").querySelector(".save-button").focus();
  });
});

// The log sheet saves today's weigh-in and closes at once, as the dialogs do.
// What was typed stays in it until the weigh-in is saved, so after a failed
// save it opens with the same weight and note.
for (const id of ["sheet-weight", "sheet-weight-lb", "sheet-note"]) $(id).addEventListener("input", () => {
  sheetAutoFill = false;
  sheetEdits++;
});
// Until a new account has used the first-run screen, the bar on the log leads there.
$("log-bar-button").addEventListener("click", () => wantsFirstRun() ? focusEntry() : openSheet());
// A question about the weight (see saveChecked) keeps the sheet open until it's answered.
$("sheet-form").addEventListener("submit", event => {
  event.preventDefault();
  syncDay();
  const date = today;
  const existing = state.entries.find(entry => entry.date === date);
  const weight = roundWeight(readWeight("sheet-weight", existing?.weight));
  if (!positive(weight)) return;
  saveChecked("sheet", { date, weight, unchanged: weight === existing?.weight }, (chosen, offer) => {
    const edits = sheetEdits;
    const sent = saveWeighIn({
      date,
      weight: chosen,
      // Today's note shows in the sheet, so an empty field removes it. Left
      // behind "Add a note", the field changes nothing.
      note: $("sheet-note-field").hidden ? undefined : cleanNote($("sheet-note").value)
    }, () => {
      if (sheetEdits !== edits) return;
      sheetAutoFill = true;
      syncSheet();
    }, offer);
    if (sent) $("log-sheet").close();
  });
});
$("first-run-form").addEventListener("change", event => {
  if (event.target.name === "first-run-unit") pickFirstRunUnit(event.target.value);
});
// The first weigh-in has nothing to check against, so it's saved straight away.
$("first-run-form").addEventListener("submit", event => {
  event.preventDefault();
  syncDay();
  if (!firstRunOpen) return;
  const weight = roundWeight(readWeight("first-run-weight", undefined, firstRunUnits.weight));
  if (!positive(weight)) return;
  saveFirstRunUnits();
  // If the save fails, the screen comes back with the weight as it was typed.
  saveWeighIn({ date: today, weight }, () => {
    $("first-run-weight").value = "";
    $("first-run-weight-lb").value = "";
  });
  leaveFirstRun();
});
$("first-run-skip").addEventListener("click", () => {
  if (!firstRunOpen) return;
  saveFirstRunUnits();
  changeState({ op: "start" });
  leaveFirstRun();
});
$("sheet-add-note").addEventListener("click", () => {
  showSheetNote(true);
  $("sheet-note").focus();
});
// "Another day" goes to the log form, set to yesterday. Anything typed in the
// sheet moves into the form with it. Without a note typed, the form keeps
// yesterday's note, as it shows when that date is chosen.
$("sheet-other-day").addEventListener("click", () => {
  const date = shiftDate(today, -1, today);
  $("entry-date").value = date;
  if (sheetAutoFill) dateChanged();
  else {
    $("entry-weight").value = $("sheet-weight").value;
    $("entry-weight-lb").value = $("sheet-weight-lb").value;
    $("entry-note").value = $("sheet-note-field").hidden ? state.entries.find(entry => entry.date === date)?.note ?? "" : $("sheet-note").value;
    autoFill = false;
    entryEdits++;
    sheetAutoFill = true;
    syncEntryForm();
    syncSheet();
  }
  $("log-sheet").close();
  focusEntry("entry-date");
});
$("log-sheet").addEventListener("close", () => {
  closeCheck("sheet");
  window.visualViewport?.removeEventListener("resize", fitSheet);
  window.visualViewport?.removeEventListener("scroll", fitSheet);
  $("log-sheet").classList.remove("over-keyboard");
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
$("quick-log").addEventListener("click", () => focusEntry());
$("prev-page").addEventListener("click", () => { page--; showTable(true); });
$("next-page").addEventListener("click", () => { page++; showTable(true); });

for (const button of document.querySelectorAll("[data-profile]")) button.addEventListener("click", openProfile);
for (const button of document.querySelectorAll("[data-goal]")) button.addEventListener("click", () => openGoal());
$("forecast-lead").addEventListener("click", event => {
  if (event.target.closest("[data-goal-rate]")) openGoal("goal-rate");
});
$("hide-fast-loss").addEventListener("click", () => {
  hiddenCautions.add(account.id + " " + state.goal.startDate);
  try { localStorage.setItem(cautionKey(), state.goal.startDate); } catch { /* The page still remembers it until it reloads. */ }
  $("fast-loss").hidden = true;
  notify("Note hidden for this goal.");
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
  updateGoalForm();
});
for (const id of ["goal-start-weight", "goal-start-weight-lb"]) $(id).addEventListener("input", () => {
  startWeightFrom = "typed";
  showStartHint();
});
$("goal-form").addEventListener("input", updateGoalForm);
$("goal-form").addEventListener("submit", event => {
  event.preventDefault();
  syncDay();
  const goal = readGoal();
  if (!goal || goal.startDate > today) return;
  // Dialogs close at once. If the save fails, "Try again" sends exactly what was typed.
  $("goal-dialog").close();
  changeState({ op: "set-goal", goal }, () => notify("Goal saved."));
});
// Removing the goal asks first, in the dialog, as deleting a weigh-in does,
// then offers Undo. A goal saved before the cap on the target rate can't be
// saved again as it was, so the question says it can't be undone.
$("clear-goal").addEventListener("click", () => {
  const permanent = Boolean(state.goal) && !inverseOf({ op: "clear-goal" }, state);
  $("goal-confirm-text").textContent = "Remove your goal? Your weigh-ins stay." +
    (permanent ? " Its target rate is faster than Baseline saves now, so removing it can’t be undone." : "");
  showGoalForm(true);
  $("keep-goal").focus();
});
$("keep-goal").addEventListener("click", () => {
  showGoalForm();
  $("goal-weight").focus();
});
$("confirm-clear-goal").addEventListener("click", () => {
  $("goal-dialog").close();
  deleteWithUndo({ op: "clear-goal" }, "Goal removed.", "Goal restored.");
});
for (const button of document.querySelectorAll("[data-reminder]")) button.addEventListener("click", openReminder);
// Reminders change which devices the server sends to, so they need a
// connection and never wait on this device.
const reminderOffline = "Reminders need a connection. Try again when you’re back online.";
$("reminder-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (navigator.onLine === false) {
    showReminderStatus(reminderOffline);
    return;
  }
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
  changeState({ op: "set-reminder", hour, timeZone, ...(subscription && { subscription }) },
    () => notify("You’ll get a reminder at " + hourLabel(hour) + " on days you haven’t weighed in."));
});
$("clear-reminder").addEventListener("click", () => {
  if (navigator.onLine === false) {
    showReminderStatus(reminderOffline);
    return;
  }
  $("reminder-dialog").close();
  changeState({ op: "clear-reminder" }, () => {
    notify("Reminders turned off.");
    // The server has forgotten every device, so this one starts afresh next time.
    forgetDevice();
  });
});
for (const id of ["profile-height", "profile-height-in"]) $(id).addEventListener("input", previewBmi);
for (const id of ["weight-units", "settings-weight-units"]) $(id).addEventListener("click", event => {
  const choice = event.target.closest("[data-unit]")?.dataset.unit;
  if (choice) changeUnits({ ...state.units, weight: choice }, "Weights now show in " + unitNames[choice] + ".");
});
for (const id of ["height-units", "waist-units", "settings-length-units"]) $(id).addEventListener("click", event => {
  const choice = event.target.closest("[data-unit]")?.dataset.unit;
  if (choice) changeUnits({ ...state.units, height: choice }, lengthMessage(choice));
});
for (const button of document.querySelectorAll("[data-waist]")) button.addEventListener("click", () => openWaist());
$("waist-table").addEventListener("click", event => {
  const date = rowTarget(event, "data-waist-edit");
  if (date) openWaist(date);
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
$("waist-form").addEventListener("submit", event => {
  event.preventDefault();
  syncDay();
  const date = $("waist-date").value;
  const existing = state.waists.find(item => item.date === date);
  const size = roundWaist(readWaist(existing?.waist));
  const sex = chosenSex();
  if (!validDate(date) || date > today || !validWaist(size) || !SEXES.includes(sex)) return;
  $("waist-dialog").close();
  changeState({ op: "save-waist", date, waist: size, sex }, () => {
    const estimate = fat.find(point => point.date === date)?.bodyFat;
    notify((existing ? "Waist updated" : "Waist saved") + " for " + prettyDate(date) + "." + (estimate == null ? "" : " Body fat " + percent(estimate) + "."));
  });
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
$("confirm-waist-delete").addEventListener("click", () => {
  const date = deletingWaist;
  $("waist-dialog").close();
  deleteWithUndo({ op: "delete-waist", date }, "Waist measurement deleted.", "Waist measurement restored.");
});
$("waist-dialog").addEventListener("close", () => { deletingWaist = null; });
$("profile-form").addEventListener("submit", event => {
  event.preventDefault();
  const height = roundHeight(readHeight(state.height));
  if (!positive(height)) return;
  $("profile-dialog").close();
  changeState({ op: "set-height", height }, () => notify("Height saved."));
});

// A tap anywhere on a row of a table, a weigh-in's note included, does what its
// pencil does. The pencil stays as the cue and the way in from the keyboard.
// Selecting text in a row, as to copy a note, doesn't count as a tap on it.
function rowTarget(event, attribute) {
  const target = event.target.closest("[" + attribute + "]");
  if (!target || target.localName === "tr" && document.getSelection()?.isCollapsed === false) return null;
  return target.getAttribute(attribute);
}

$("entry-table").addEventListener("click", event => {
  const date = rowTarget(event, "data-edit");
  if (date) openEdit(date);
});

function openEdit(date) {
  const entry = state.entries.find(item => item.date === date);
  if (!entry) return;
  editingDate = entry.date;
  $("edit-date-label").textContent = prettyDate(entry.date, "long");
  writeWeight("edit-weight", entry.weight);
  $("edit-note").value = entry.note ?? "";
  $("edit-form").hidden = false;
  $("delete-confirm").hidden = true;
  $("edit-dialog").showModal();
  $("edit-weight").focus();
}
$("edit-form").addEventListener("submit", event => {
  event.preventDefault();
  const date = editingDate;
  const existing = state.entries.find(entry => entry.date === date);
  const weight = roundWeight(readWeight("edit-weight", existing?.weight));
  if (!date || !positive(weight)) return;
  saveChecked("edit", { date, weight, unchanged: weight === existing?.weight }, (chosen, offer) => {
    const note = cleanNote($("edit-note").value);
    $("edit-dialog").close();
    changeState({ op: "update-weight", date, weight: chosen, note },
      result => notify(result.found ? "Weigh-in updated." : "This weigh-in has already been removed.", result.found ? offered(offer) : undefined), null, offer);
  });
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
$("confirm-delete").addEventListener("click", () => {
  const date = editingDate;
  $("edit-dialog").close();
  deleteWithUndo({ op: "delete-weight", date }, "Weigh-in deleted.", "Weigh-in restored.");
});
$("edit-dialog").addEventListener("close", () => {
  editingDate = null;
  closeCheck("edit");
});
$("settings-view").addEventListener("change", event => {
  const key = event.target.dataset.preference;
  if (key) changePreference(key, event.target.checked);
});
$("manage-account").addEventListener("click", manageAccount);
$("sign-out").addEventListener("click", signOut);
$("confirm-sign-out").addEventListener("click", () => {
  $("sign-out-dialog").close();
  finishSignOut();
});
$("download-csv").addEventListener("click", downloadCsv);
$("download-json").addEventListener("click", downloadJson);
$("erase-download").addEventListener("click", downloadJson);
$("delete-data").addEventListener("click", () => openErase("data"));
$("delete-account").addEventListener("click", () => openErase("account"));
$("withdraw-consent").addEventListener("click", () => openErase("data", true));
$("consent-agree").addEventListener("change", () => { $("consent-continue").disabled = !$("consent-agree").checked; });
$("consent-form").addEventListener("submit", event => {
  event.preventDefault();
  agree();
});
$("consent-download").addEventListener("click", downloadJson);
$("consent-delete-data").addEventListener("click", () => openErase("data"));
$("consent-delete-account").addEventListener("click", () => openErase("account"));
$("consent-sign-out").addEventListener("click", signOut);
$("erase-word").addEventListener("input", () => {
  if (!$("erase-dialog").hasAttribute("data-busy")) $("erase-submit").disabled = !eraseConfirmed();
});
// Deleting needs a connection, so it never waits on this device.
$("erase-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!eraseConfirmed() || $("erase-dialog").hasAttribute("data-busy")) return;
  if (navigator.onLine === false) {
    showEraseStatus("Deleting needs a connection. Try again when you’re back online.");
    return;
  }
  if (erasing === "account") deleteAccount();
  else deleteData();
});
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => button.closest("dialog").close());
// The dialogs something has been typed or chosen in since they opened. A tap
// outside a dialog closes it only while nothing has, so a stray tap never
// throws away a half-filled form. Escape and the close button still close it,
// since they're deliberate.
const typedIn = new WeakSet();
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("input", () => typedIn.add(dialog));
  // Closing forgets it, so the dialog opens again with nothing typed.
  dialog.addEventListener("close", () => typedIn.delete(dialog));
  // A dialog that's waiting for the server, as the delete dialog does, stays open.
  dialog.addEventListener("cancel", event => { if (dialog.hasAttribute("data-busy")) event.preventDefault(); });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog || dialog.hasAttribute("data-busy") || typedIn.has(dialog)) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
window.addEventListener("hashchange", () => {
  // The consent step stands in for the log until the account agrees.
  if (!state || $("main").hidden) return;
  page = 0;
  showPage();
  window.scrollTo({ top: 0, behavior: "auto" });
  // The home-screen shortcut can reach an open window as a new hash.
  followLogLink();
});
// A tapped reminder asks an open window for today's weigh-in (see sw.js).
// While the log isn't on the page yet, #log waits for it (see followLogLink).
navigator.serviceWorker?.addEventListener("message", event => {
  if (event.data?.type !== "open-log" || !account) return;
  if (state && !$("main").hidden) openLogEntry();
  else history.replaceState(null, "", location.pathname + location.search + "#log");
});
navigator.serviceWorker?.startMessages();
document.querySelector(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  ($("main").hidden ? $("auth") : $("main")).focus();
});
// Signed out, the wordmark's "#overview" would land in Clerk's hash routes.
document.querySelector(".wordmark").addEventListener("click", event => { if (!state) event.preventDefault(); });
$("auth-retry").addEventListener("click", () => location.reload());
$("log-retry").addEventListener("click", () => { if (clerk?.user) openLog(clerk.user); });
// The toast holds still while the mouse is over it or focus is in it.
$("toast").addEventListener("pointerenter", event => {
  if (event.pointerType !== "mouse") return;
  toastHover = true;
  clearTimeout(toastTimer);
});
$("toast").addEventListener("pointerleave", event => {
  if (event.pointerType !== "mouse") return;
  toastHover = false;
  startToastTimer();
});
$("toast").addEventListener("focusin", event => {
  if (!$("toast").contains(event.relatedTarget)) toastReturn = event.relatedTarget;
  clearTimeout(toastTimer);
});
// Once focus has settled somewhere else.
$("toast").addEventListener("focusout", () => setTimeout(startToastTimer));
// Coming back to the tab, or back online, sends what's waiting on this device
// and picks up changes made elsewhere. iOS has no Background Sync, so the page
// does this itself.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  syncDay();
  reconnect();
});
window.addEventListener("online", reconnect);
window.addEventListener("offline", () => { if (state) showLogStatus(); });
window.addEventListener("focus", syncDay);
startAuth();
startWorker();
scheduleMidnight();
