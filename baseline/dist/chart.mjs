import { KG_PER_LB, THIN_COUNT, dateOf, dayOf, formatRange, formatWaist, formatWeight, oneDecimal, prettyDate, spokenRange, spokenWaist, spokenWeight, weightParts } from "./model.mjs";

const NS = "http://www.w3.org/2000/svg";

// Colors live in styles.css (by class), so the chart follows light and dark mode.
function svg(name, attributes = {}, content) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}

const coord = value => Math.round(value * 100) / 100;

// Roughly how wide a label is: digits at `digit` px, a point at `point` px,
// and letters and spaces (as in "9 st 12") at 4.5 px.
const textWidth = (text, digit, point = digit) => [...text].reduce((sum, char) => sum + (char === "." ? point : /\d/.test(char) ? digit : 4.5), 0);

// The y-axis range: every plotted average and weigh-in, and the goal (null for
// none) so its line stays on screen, with some room above and below, at least
// `minPad`. The grid step is a round number, or the one of `steps` nearest a
// quarter of the range.
export function yDomain(points, goal = null, steps = null, minPad = .25) {
  let low = goal ?? Infinity;
  let high = goal ?? -Infinity;
  for (const point of points) {
    low = Math.min(low, point.average, point.weight ?? Infinity);
    high = Math.max(high, point.average, point.weight ?? -Infinity);
  }
  const pad = Math.max(minPad, (high - low) * .11);
  const bottom = Math.max(0, low - pad);
  const top = high + pad;
  const target = (top - bottom) / 4;
  if (steps) return { bottom, top, step: steps.reduce((best, n) => Math.abs(Math.log(n / target)) < Math.abs(Math.log(best / target)) ? n : best) };
  const power = 10 ** Math.floor(Math.log10(target));
  const factors = [1, 2, 2.5, 5, 10];
  const step = factors.reduce((best, n) => Math.abs(n - target / power) < Math.abs(best - target / power) ? n : best) * power;
  return { bottom, top, step };
}

// Grid steps in pounds for stones: whole pounds, then half a stone and stones.
const STONE_STEPS = [0.5, 1, 2, 7, 14, 28, 70, 140];

// A grid label in pounds, written as stones and pounds: "9 st 10", "10 st".
export function stoneTick(pounds) {
  const stones = Math.floor((pounds + 1e-9) / 14);
  const rest = Number((pounds - stones * 14).toFixed(2));
  return stones + " st" + (rest ? " " + rest : "");
}

// The value printed beside a line: "61.8", or "9 st 9.8" for stones.
function lineLabel(kg, unit) {
  const parts = weightParts(kg, unit);
  return parts.length > 1 ? parts[0].join(" ") + " " + parts[1][0] : parts[0][0];
}

// Where to put a label centered at `y` so it stays `gap` away from another label
// centered at `avoid`: on its own side of it if that fits within [min, max],
// otherwise on the other side.
export function separateLabel(y, avoid, gap, min, max) {
  if (Math.abs(y - avoid) >= gap) return y;
  const side = y >= avoid ? 1 : -1;
  const preferred = avoid + side * gap;
  return preferred >= min && preferred <= max ? preferred : avoid - side * gap;
}

// The first day the trend chart shows for `range` ("14", "30", "90" or "all")
// on `today`: as far back as the range goes, but not before the first average.
export function rangeStart(trend, range, today) {
  const end = dayOf(today);
  const firstDay = trend.days[0]?.day ?? end;
  return range === "all" ? firstDay : Math.max(firstDay, end - Number(range) + 1);
}

// The pieces to draw the 10-day average's line in, from its points in order of
// day (see calculateTrend in model.mjs). A day without an average breaks the
// line, so each run of days is drawn on its own. Within a run, the line is thin
// (dashed and lighter) between days whose average rests on fewer than
// THIN_COUNT weigh-ins, and after the run's last weigh-in, where it holds that
// weigh-in's average. Returns [{ thin, points }]: neighbouring pieces of a run
// share a point, so the line stays joined, and a run of one day is a piece of
// one point.
export function lineParts(points) {
  const runs = [];
  for (const point of points) {
    const run = runs.at(-1);
    if (run && run.at(-1).day === point.day - 1) run.push(point);
    else runs.push([point]);
  }
  const parts = [];
  for (const run of runs) {
    const lastReading = run.findLastIndex(point => point.weight !== null);
    const thin = run.map((point, i) => point.count < THIN_COUNT || i > lastReading);
    const pieces = [{ thin: thin[0], points: [run[0]] }];
    for (let i = 1; i < run.length; i++) {
      const piece = pieces.at(-1);
      const segment = thin[i - 1] || thin[i];
      if (piece.points.length === 1) piece.thin = segment;
      if (piece.thin === segment) piece.points.push(run[i]);
      else pieces.push({ thin: segment, points: [run[i - 1], run[i]] });
    }
    parts.push(...pieces);
  }
  return parts;
}

// A date in a sentence about `on`, another date: "Nov 20", or "Nov 20, 2025"
// in an earlier year.
const dateBeside = (date, on) => prettyDate(date, date.slice(0, 4) === on.slice(0, 4) ? "short" : "full");

// The index of the point whose `day` is nearest `day`, which can fall between
// two days, or -1 when there are no points. `points` are in order of day, and
// a tie goes to the earlier point.
export function nearestIndex(points, day) {
  if (!points.length) return -1;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].day < day) low = middle + 1;
    else high = middle;
  }
  // `low` is the first point on or after `day`, or the last point.
  return low > 0 && day - points[low - 1].day <= points[low].day - day ? low - 1 : low;
}

// Marks for days, such as days with a note: short ticks in the strip between
// the plot and the date labels, `MARK_TOP` px below the plot.
const MARK_TOP = 3;
const MARK_LENGTH = 6;
// A tap from `MARK_ABOVE` px above the bottom of the plot to `MARK_REACH` px
// below it picks the nearest mark first, so a finger finds one.
const MARK_ABOVE = 4;
const MARK_REACH = MARK_TOP + MARK_LENGTH + 8;

// A mark for each of `days` (numbers), with `className` for its color.
function dayMarks(days, x, floor, className) {
  return days.map(day => {
    const xx = coord(x(day));
    return svg("line", { class: className, x1: xx, x2: xx, y1: floor + MARK_TOP, y2: floor + MARK_TOP + MARK_LENGTH });
  });
}

// How far from a point, in px, a pointer can be and still pick it, at least:
// a little for a mouse, a fingertip's error for touch and pens.
const reachOf = pointerType => pointerType === "mouse" ? 8 : 20;

// Days count from 1970-01-01, a Thursday. The day of the week of `day`, from 0
// for Sunday to 6 for Saturday.
export const weekdayOf = day => ((day + 4) % 7 + 7) % 7;
const WEEKDAY_LETTERS = "SMTWTFS";
// 1970-01-05, the first Monday, which thinned weekly dates count from.
const FIRST_MONDAY = 4;

// The weekends from `start` to `end` (days), as [first, last] day pairs: a
// Saturday and its Sunday, or only one of them at either end.
export function weekends(start, end) {
  const spans = [];
  for (let saturday = start - (weekdayOf(start) + 1) % 7; saturday <= end; saturday += 7) {
    const first = Math.max(start, saturday);
    const last = Math.min(end, saturday + 1);
    if (first <= last) spans.push([first, last]);
  }
  return spans;
}

// Spans up to this many days get their dates by week, and longer ones by month.
const WEEK_DATES_DAYS = 62;
// How many months apart the dates of a longer span can be: from every month,
// through 6 and 12 (once a year), to once a decade.
const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60, 120];

// The dates along the bottom of a chart from `start` to `end` (days), at most
// `maxTicks` of them, as { by, ticks: [{ day, label }] }. Up to two months go
// `by` "weeks": Mondays, labelled "Nov 16". Longer spans go by "months": the
// 1st, labelled "Nov", or "Jan 2027" for a January, or by "years": January 1,
// labelled "2027". Thinned dates keep to the calendar, every other Monday
// counted from a fixed one, or months that divide by the step (Jan, Apr, Jul
// and Oct for every 3), so they stay put as the range moves day by day. A short
// span without a Monday goes `by` "days", with its first and last days.
export function calendarTicks(start, end, maxTicks) {
  const most = Math.max(1, maxTicks);
  if (end - start <= WEEK_DATES_DAYS) {
    const mondays = [];
    for (let day = start + (8 - weekdayOf(start)) % 7; day <= end; day += 7) mondays.push(day);
    if (!mondays.length) {
      return { by: "days", ticks: (end > start ? [start, end] : [start]).map(day => ({ day, label: prettyDate(dateOf(day)) })) };
    }
    let picked = mondays;
    for (let every = 2; picked.length > most; every *= 2) {
      picked = mondays.filter(day => (day - FIRST_MONDAY) / 7 % every === 0);
      if (!picked.length) picked = mondays.slice(0, 1);
    }
    return { by: "weeks", ticks: picked.map(day => ({ day, label: prettyDate(dateOf(day)) })) };
  }
  // Each month by its count from year 0, so January is a multiple of 12.
  const [year, month] = dateOf(start).split("-").map(Number);
  const firsts = [];
  for (let index = year * 12 + month - 1; ; index++) {
    const date = Math.floor(index / 12) + "-" + String(index % 12 + 1).padStart(2, "0") + "-01";
    const day = dayOf(date);
    if (day > end) break;
    if (day >= start) firsts.push({ index, day, date });
  }
  let step = MONTH_STEPS[0];
  let picked = firsts;
  for (step of MONTH_STEPS) {
    picked = firsts.filter(first => first.index % step === 0);
    if (picked.length && picked.length <= most) break;
  }
  if (!picked.length) picked = firsts.slice(0, 1);
  const years = step >= 12;
  return {
    by: years ? "years" : "months",
    ticks: picked.map(({ index, day, date }) => ({
      day,
      label: years ? date.slice(0, 4) : prettyDate(date, index % 12 === 0 ? "monthYear" : "monthShort")
    }))
  };
}

// How many dates fit along a plot `plotWidth` px wide: one every 64 px or so,
// which clears the widest label, "Jan 2027", and no more than 8.
const maxTicksFor = plotWidth => Math.min(8, Math.max(2, Math.floor(plotWidth / 64) + 1));

// Date labels, centred under their days at `y` px but kept inside the chart's
// `width`, with a faint gridline up through the plot from each. The first and
// last days of a short span (`by` "days") get no gridline.
function dateLabels(fragment, { by, ticks }, axes, width, y) {
  const { x, ceiling, floor } = axes;
  for (const { day, label } of ticks) {
    const xx = x(day);
    if (by !== "days") fragment.append(svg("line", { class: "grid-v", x1: coord(xx) + .5, x2: coord(xx) + .5, y1: ceiling - 8, y2: floor }));
    // About 7 px a character at the labels' size.
    const half = label.length * 3.6;
    fragment.append(svg("text", { x: coord(Math.max(half, Math.min(width - half, xx))), y, "text-anchor": "middle" }, label));
  }
}

// Weekends are shaded while each day is at least this many px wide.
const WEEKEND_MIN_PX = 4;
// Each day gets its weekday's initial, with the dates under them, on spans up
// to this many days while each day is at least `LETTER_MIN_PX` px wide.
const LETTER_DAYS = 21;
const LETTER_MIN_PX = 12;
// The lines from weigh-ins to the average show while weigh-ins are, at the
// median, at least this many px apart.
const STEM_MIN_PX = 5;

// Whether there's room for a line from each weigh-in to the average: whether
// the median gap between weigh-ins on `days` (in order) is `STEM_MIN_PX` px or
// more, at `dayWidth` px a day. So daily weigh-ins get them on short ranges,
// and weekly ones on longer ranges too.
export function roomForStems(days, dayWidth) {
  if (days.length < 2) return true;
  const gaps = days.slice(1).map((day, i) => day - days[i]).sort((a, b) => a - b);
  return gaps[Math.floor((gaps.length - 1) / 2)] * dayWidth >= STEM_MIN_PX;
}

// What both charts share: an SVG in a wrapper that redraws when it resizes, and
// a tooltip for one point at a time, picked with a pointer or the arrow keys.
// Subclasses draw, set `points`, `axes` (with `start` and `end` days) and
// `cursor`, pick the point under a pointer, and show a point's tooltip.
//
// A mouse inspects as it hovers, and the tooltip goes when it leaves. A finger
// or a pen inspects where it goes down and as it drags sideways, and the
// tooltip stays after it lifts, until a tap elsewhere. The wrapper's
// `touch-action: pan-y` leaves vertical swipes to scroll the page: the browser
// then cancels the pointer, and the tooltip stays as it was.
class Chart {
  // `cover` is an element fixed over the bottom of the screen, such as the log
  // bar on a phone, that the tooltip keeps clear of.
  constructor(ids) {
    this.wrap = document.getElementById(ids.wrap);
    this.canvas = document.getElementById(ids.canvas);
    this.tooltip = document.getElementById(ids.tooltip);
    this.empty = document.getElementById(ids.empty);
    this.announce = document.getElementById(ids.announce);
    this.cover = ids.cover ? document.getElementById(ids.cover) : null;
    this.points = [];
    this.active = null;
    this.drag = null; // The id of the finger or pen moving through the points, while it's down.
    this.wrap.addEventListener("pointerdown", event => {
      if (!event.isPrimary) return;
      if (event.pointerType !== "mouse") {
        this.drag = event.pointerId;
        // The drag stays with the chart when the finger strays off it.
        this.wrap.setPointerCapture(event.pointerId);
      }
      this.inspectPointer(event, false);
    });
    this.wrap.addEventListener("pointermove", event => {
      if (!event.isPrimary) return;
      if (event.pointerId === this.drag) this.inspectPointer(event, true);
      else if (event.pointerType !== "touch") this.inspectPointer(event, false);
    });
    for (const type of ["pointerup", "pointercancel"]) {
      this.wrap.addEventListener(type, event => {
        if (event.pointerId === this.drag) this.drag = null;
      });
    }
    // Touch and pen pointers leave as they lift, so only a mouse hides it.
    this.wrap.addEventListener("pointerleave", event => {
      if (event.pointerType === "mouse") this.hideTooltip();
    });
    this.wrap.addEventListener("blur", () => this.hideTooltip());
    // A tooltip that stays as the page scrolls keeps clear of the cover.
    addEventListener("scroll", () => {
      if (this.placed && !this.tooltip.hidden) this.placeTooltip(...this.placed);
    }, { passive: true });
    this.wrap.addEventListener("keydown", event => this.inspectKey(event));
    document.addEventListener("pointerdown", event => {
      if (!this.wrap.contains(event.target)) this.hideTooltip();
    });
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.wrap);
  }

  inspectKey(event) {
    if (!this.points.length) return;
    const lastIndex = this.points.length - 1;
    // With nothing selected, either arrow starts on the latest point, or on
    // today when the points go on past it.
    const step = delta => this.active === null ? this.home ?? lastIndex : Math.max(0, Math.min(lastIndex, this.active + delta));
    const keys = { ArrowLeft: step(-1), ArrowRight: step(1), Home: 0, End: lastIndex };
    if (event.key === "Escape") return this.hideTooltip();
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    this.showTooltip(keys[event.key], true);
  }

  // The day, with a fraction, at `xx` px across the chart.
  dayAt(xx) {
    const { left, right, start, end } = this.axes;
    return start + (xx - left) / (right - left) * (end - start);
  }

  // Shows the point under a pointer, or hides the tooltip when there's none.
  // A drag keeps the last point when there's none, so it never flickers off.
  inspectPointer(event, dragging) {
    if (!this.points.length) return;
    const bounds = this.wrap.getBoundingClientRect();
    const index = this.pointAt(event.clientX - bounds.left, event.clientY - bounds.top, dragging, reachOf(event.pointerType));
    if (index >= 0) this.showTooltip(index, false);
    else if (!dragging) this.hideTooltip();
  }

  // Beside the point at `xx`, on whichever side has room, centered on `yy`.
  placeTooltip(xx, yy) {
    this.placed = [xx, yy];
    this.tooltip.hidden = false;
    const tipWidth = this.tooltip.offsetWidth;
    const tipHeight = this.tooltip.offsetHeight;
    this.tooltip.style.left = Math.max(0, Math.min(this.wrap.clientWidth - tipWidth, xx + tipWidth + 14 < this.wrap.clientWidth ? xx + 14 : xx - tipWidth - 14)) + "px";
    let top = Math.max(0, Math.min(this.axes.floor - tipHeight, yy - tipHeight / 2));
    // When the chart runs under the cover or off the bottom of the screen, the
    // tooltip moves up to stay in sight, over the legend if need be, but not
    // off the top of the screen.
    const screen = document.documentElement.clientHeight;
    const cover = this.cover?.getBoundingClientRect();
    const wrapTop = this.wrap.getBoundingClientRect().top;
    const bottom = (cover?.height ? Math.min(screen, cover.top) : screen) - 8 - wrapTop;
    if (top + tipHeight > bottom) top = Math.max(bottom - tipHeight, -wrapTop);
    this.tooltip.style.top = top + "px";
  }

  hideTooltip() {
    this.active = null;
    this.tooltip.hidden = true;
    this.cursor?.setAttribute("visibility", "hidden");
  }
}

export class TrendChart extends Chart {
  // `cover` is the id of an element the tooltip keeps clear of (see Chart).
  constructor({ cover } = {}) {
    super({ wrap: "chart-wrap", canvas: "trend-chart", tooltip: "chart-tooltip", empty: "chart-empty", announce: "chart-announce", cover });
    this.noteKey = document.getElementById("legend-note");
    this.weekendKey = document.getElementById("legend-weekend");
    this.noted = []; // The points with a note, which have a mark under the plot.
  }

  // `goal` is the goal weight in kg, or null without one. The chart plots in
  // `unit`, with stones on a scale of pounds. `forecast` is the trend forecast
  // from the last weigh-in (forecastTrend in model.mjs), or null to show none.
  update(trend, range, today, goal = null, unit = "kg", forecast = null) {
    this.trend = trend;
    this.range = range;
    this.today = today;
    this.goal = Number.isFinite(goal) ? goal : null;
    this.unit = unit;
    this.forecast = forecast;
    this.draw();
  }

  draw() {
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;
    if (!this.trend || !width || !height) return;
    this.hideTooltip();
    this.canvas.replaceChildren();
    this.canvas.setAttribute("viewBox", "0 0 " + width + " " + height);
    const today = dayOf(this.today);
    const start = rangeStart(this.trend, this.range, this.today);
    let points = this.trend.days.filter(point => point.day >= start && point.day <= today);
    // The forecast goes on from the last weigh-in, so it takes the place of
    // the days after it, which hold that weigh-in's average.
    const from = this.forecast ? dayOf(this.forecast.from) : null;
    const ahead = points.some(point => point.day === from && point.weight !== null) ? this.forecast.points : [];
    if (ahead.length) points = points.filter(point => point.day <= from);
    this.points = points;
    this.home = null;
    this.noted = points.filter(point => point.note);
    this.noteKey.hidden = !this.noted.length;
    this.weekendKey.hidden = true;
    this.empty.hidden = points.length > 0;
    this.wrap.tabIndex = points.length ? 0 : -1;
    if (!points.length) {
      this.empty.textContent = this.trend.readings.length ? "No trend data in this range. Choose All to see your history." : "Log your first weight to see your trend.";
      this.canvas.setAttribute("aria-label", this.empty.textContent);
      return;
    }

    // The line's end dot and value go on the last weigh-in, not on the days
    // after it, which only hold its average. Null when none is in range.
    const reading = points.findLast(point => point.weight !== null) ?? null;
    const end = ahead.at(-1)?.day ?? today;
    const compact = width < 480;
    const unit = this.unit;
    const stones = unit === "st";
    // The scale is in kg or pounds; `y` takes kg.
    const scale = unit === "kg" ? 1 : 1 / KG_PER_LB;
    const goal = this.goal;
    // The band stays on screen too.
    const { bottom, top, step } = yDomain([
      ...points.map(p => ({ average: p.average * scale, weight: p.weight === null ? null : p.weight * scale })),
      ...ahead.map(p => ({ average: p.low * scale, weight: p.high * scale }))
    ], goal === null ? null : goal * scale, stones ? STONE_STEPS : null);
    // The value at the end of the line: the last weigh-in's average, or with a
    // forecast, its last day's.
    const labelled = ahead.at(-1) ?? reading;
    const endLabel = labelled ? lineLabel(labelled.average, unit) : "";
    const goalLabel = goal === null ? "" : lineLabel(goal, unit);
    const ticks = [];
    for (let tick = Math.ceil((bottom - 1e-8) / step) * step; tick <= top + 1e-8; tick += step) {
      ticks.push({ value: tick, label: stones ? stoneTick(tick) : String(Number(tick.toFixed(2))) });
    }
    const left = Math.max(compact ? 30 : 38, Math.max(...ticks.map(tick => textWidth(tick.label, 8, 3.5))) + 14);
    const right = width - (Math.max(textWidth(endLabel, 8.5), textWidth(goalLabel, 8.5)) + 18);
    const dayWidth = (right - left) / Math.max(1, end - start);
    // A short span gets a row of weekday initials over its dates, which takes
    // a little more room under the plot.
    const letters = end - start <= LETTER_DAYS && dayWidth >= LETTER_MIN_PX;
    const ceiling = 24;
    const floor = height - (letters ? 48 : 30);
    const x = day => start === end ? (left + right) / 2 : left + (day - start) / (end - start) * (right - left);
    const y = kg => floor - (kg * scale - bottom) / (top - bottom) * (floor - ceiling);
    this.axes = { start, end, left, right, ceiling, floor, x, y };
    const fragment = document.createDocumentFragment();

    // Weekends are a faint wash under everything else, from the middle of
    // Friday to the middle of Monday, within the plot.
    if (dayWidth >= WEEKEND_MIN_PX) {
      for (const [first, last] of weekends(start, end)) {
        const shadeStart = Math.max(left, x(first - .5));
        const shadeEnd = Math.min(right, x(last + .5));
        fragment.append(svg("rect", { class: "weekend", x: coord(shadeStart), y: ceiling - 8, width: coord(shadeEnd - shadeStart), height: floor - ceiling + 8 }));
      }
      this.weekendKey.hidden = false;
    }

    // Stone labels name their own units.
    if (!stones) fragment.append(svg("text", { x: left - 12, y: 12, "text-anchor": "end" }, unit));
    for (const tick of ticks) {
      const yy = coord(y(tick.value / scale)) + .5;
      fragment.append(
        svg("line", { class: "grid", x1: left, x2: width, y1: yy, y2: yy }),
        svg("text", { x: left - 12, y: yy + 4, "text-anchor": "end" }, tick.label)
      );
    }
    const dates = calendarTicks(start, end, maxTicksFor(right - left));
    dateLabels(fragment, dates, this.axes, width, height - 6);
    if (letters) {
      for (let day = start; day <= end; day++) {
        fragment.append(svg("text", { class: "weekday", x: coord(x(day)), y: height - 26, "text-anchor": "middle" }, WEEKDAY_LETTERS[weekdayOf(day)]));
      }
    }
    fragment.append(...dayMarks(this.noted.map(p => p.day), x, floor, "note-mark"));

    // The forecast's likely range is a band under everything else, from a
    // point at the last weigh-in's average to its widest on the last day. A
    // hairline marks the last weigh-in, where the forecast begins.
    if (ahead.length) {
      const fromX = coord(x(from)) + .5;
      const upper = ahead.map(p => "L" + coord(x(p.day)) + " " + coord(y(p.high)));
      const lower = ahead.map(p => "L" + coord(x(p.day)) + " " + coord(y(p.low))).reverse();
      fragment.append(
        svg("path", { class: "band", d: "M" + coord(x(from)) + " " + coord(y(reading.average)) + " " + upper.join(" ") + " " + lower.join(" ") + " Z" }),
        svg("line", { class: "today-line", x1: fromX, x2: fromX, y1: ceiling - 8, y2: floor }),
        // Over the forecast, or before it when a long history leaves it too narrow.
        width - fromX >= 62 ? svg("text", { class: "forecast-title", x: fromX + 6, y: 12 }, "Forecast")
          : svg("text", { class: "forecast-title", x: fromX - 6, y: 12, "text-anchor": "end" }, "Forecast")
      );
    }

    // The goal is a dashed hairline under the data, ending with its value.
    if (goal !== null) {
      const goalY = coord(y(goal)) + .5;
      fragment.append(svg("line", { class: "goal", x1: left, x2: coord(right), y1: goalY, y2: goalY }));
    }

    // Daily weigh-ins sit underneath; the average line is the figure. When
    // there's room, a thin line joins each to that day's average, so how far
    // a day strays from the average shows at a glance.
    const readings = points.filter(p => p.weight !== null);
    const count = readings.length;
    if (roomForStems(readings.map(p => p.day), dayWidth)) {
      for (const p of readings) {
        const xx = coord(x(p.day));
        fragment.append(svg("line", { class: "stem", x1: xx, x2: xx, y1: coord(y(p.average)), y2: coord(y(p.weight)) }));
      }
    }
    const radius = count > 160 ? 2.5 : compact ? 3.5 : 4;
    for (const p of points) {
      if (p.weight !== null) fragment.append(svg("circle", { class: "dot", cx: coord(x(p.day)), cy: coord(y(p.weight)), r: radius }));
    }

    // The line breaks where a day has no average, and is thin where it rests
    // on few weigh-ins or holds after the last one (see lineParts).
    const parts = lineParts(points);
    for (const part of parts) {
      if (part.points.length === 1) {
        const [p] = part.points;
        fragment.append(svg("circle", { class: part.thin ? "avg-single thin" : "avg-single", cx: coord(x(p.day)), cy: coord(y(p.average)), r: 3 }));
        continue;
      }
      const path = part.points.map((p, i) => (i ? "L" : "M") + coord(x(p.day)) + " " + coord(y(p.average))).join(" ");
      fragment.append(svg("path", { class: part.thin ? "avg-thin" : "avg", d: path }));
    }

    // The line's end dot sits on the last weigh-in. Its value goes beside it,
    // or above it when the line holds on past it, so the two don't cross.
    // A forecast is a dotted line on from the dot, ending in an open dot with
    // its value. The last weigh-in's value then goes unlabelled: it's the
    // figure at the top of the page.
    const held = !ahead.length && reading !== null && reading !== points.at(-1);
    let endY = null; // The middle of the end value's label.
    if (reading) {
      const lastX = x(reading.day);
      const lastY = y(reading.average);
      fragment.append(svg("circle", { class: "end-dot", cx: coord(lastX), cy: coord(lastY), r: 5 }));
      if (ahead.length) {
        const endX = x(labelled.day);
        endY = y(labelled.average);
        fragment.append(
          svg("path", { class: "forecast", d: "M" + coord(lastX) + " " + coord(lastY) + " L" + coord(endX) + " " + coord(endY) }),
          svg("circle", { class: "forecast-dot", cx: coord(endX), cy: coord(endY), r: 4 }),
          svg("text", { class: "forecast-label", x: coord(endX + 11), y: coord(endY + 5) }, endLabel)
        );
      } else {
        endY = held ? lastY - 14 : lastY;
        fragment.append(svg("text", { class: "end-label", x: coord(lastX + 11), y: coord(endY + 5) }, endLabel));
      }
    }
    if (goal !== null) {
      // Both labels sit at the right edge when the line reaches it, so keep them apart.
      const shared = endY !== null && x(labelled.day) > right - endLabel.length * 8.5;
      const labelY = shared ? separateLabel(y(goal), endY, 17, ceiling - 12, floor + 6) : y(goal);
      fragment.append(svg("text", { class: "goal-label", x: coord(right + 11), y: coord(labelY + 4) }, goalLabel));
    }
    this.cursor = svg("g", { visibility: "hidden", "pointer-events": "none" });
    fragment.append(this.cursor);
    this.canvas.append(fragment);
    // The forecast's days can be read like the others, after the last
    // weigh-in's. The arrow keys still start on today.
    if (ahead.length) {
      this.points = points.concat(ahead.map(p => ({ ...p, forecast: true })));
      this.home = nearestIndex(this.points, today);
    }
    const final = ahead.at(-1);
    this.canvas.setAttribute("aria-label", "Daily weights and 10-day moving averages, " + prettyDate(dateOf(start), "full") + " through " + prettyDate(this.today, "full") + "." +
      (reading ? " Last weigh-in " + prettyDate(reading.date, "full") + ", with a 10-day average of " + spokenWeight(reading.average, unit) + "." : "") +
      (parts.some(part => part.thin) ? " The line is dashed where it rests on fewer than " + THIN_COUNT + " weigh-ins, or holds the last weigh-in’s average after it." : "") +
      (final ? " Forecast through " + prettyDate(final.date, "full") + " if your weekly trend holds: about " + spokenWeight(final.average, unit) + ", likely " + spokenRange(final.low, final.high, unit) + "." : "") +
      (goal === null ? "" : " Goal " + spokenWeight(goal, unit) + ".") +
      (this.noted.length ? " Days with notes are marked below the chart." : ""));
  }

  // The index of the point at (`xx`, `yy`) px, or -1 for none: the nearest day
  // with a point, if it's within `reach` px or half a day. At the bottom of the
  // plot and in the strip under it, the nearest mark comes first. A drag goes
  // by `xx` alone, to the nearest point however far, so it moves across gaps
  // in the line.
  pointAt(xx, yy, dragging, reach) {
    const { left, right, start, end, ceiling, floor, x } = this.axes;
    const day = this.dayAt(xx);
    if (dragging) return nearestIndex(this.points, day);
    if (xx < left - 5 || xx > right + 5 || yy < ceiling - 12 || yy > floor + MARK_REACH) return -1;
    const near = point => Math.abs(x(point.day) - xx) <= Math.max(reach, (right - left) / (end - start) / 2);
    const mark = yy > floor - MARK_ABOVE ? this.noted[nearestIndex(this.noted, day)] : null;
    if (mark && near(mark)) return this.points.indexOf(mark);
    const index = nearestIndex(this.points, day);
    return near(this.points[index]) ? index : -1;
  }

  showTooltip(index, announce) {
    const point = this.points[index];
    const { x, y, ceiling, floor } = this.axes;
    this.active = index;
    const xx = coord(x(point.day));
    this.cursor.replaceChildren(svg("line", { class: "crosshair", x1: xx + .5, x2: xx + .5, y1: ceiling - 8, y2: floor }));
    const heading = prettyDate(point.date, "full");
    if (point.forecast) {
      this.cursor.append(svg("circle", { class: "cursor-forecast", cx: xx, cy: coord(y(point.average)), r: 4.5 }));
      this.cursor.setAttribute("visibility", "visible");
      this.tooltip.innerHTML = "<strong>" + heading + "</strong>" +
        '<div class="tip-row"><i class="key-forecast"></i><b>' + formatWeight(point.average, this.unit) + "</b>forecast average</div>" +
        '<div class="tip-detail">Likely ' + formatRange(point.low, point.high, this.unit) + "</div>";
      this.placeTooltip(xx, y(point.average));
      if (announce) {
        this.announce.textContent = heading + ". Forecast 10-day average " + spokenWeight(point.average, this.unit) + ", likely " + spokenRange(point.low, point.high, this.unit) + ".";
      }
      return;
    }
    if (point.weight !== null) this.cursor.append(svg("circle", { class: "cursor-dot", cx: xx, cy: coord(y(point.weight)), r: 4.5 }));
    this.cursor.append(svg("circle", { class: "cursor-avg", cx: xx, cy: coord(y(point.average)), r: 5 }));
    this.cursor.setAttribute("visibility", "visible");
    const daily = point.weight === null ? null : formatWeight(point.weight, this.unit);
    const mean = formatWeight(point.average, this.unit);
    // A day without a weigh-in keeps the last weigh-in's average (see calculateTrend).
    const asOf = point.weight === null ? dateBeside(point.asOf, point.date) : null;
    this.tooltip.innerHTML = "<strong>" + heading + "</strong>" +
      '<div class="tip-row"><i class="key-line"></i><b>' + mean + "</b>10-day average</div>" +
      '<div class="tip-row"><i class="key-dot"></i>' + (daily ? "<b>" + daily + "</b>weigh-in" : "No weigh-in · average as of " + asOf) + "</div>";
    if (point.note) {
      const note = document.createElement("p");
      note.className = "tip-note";
      note.textContent = point.note;
      this.tooltip.append(note);
    }
    this.placeTooltip(xx, y(point.average));
    if (announce) {
      const weighIn = point.weight === null ? "No weigh-in, average as of " + asOf + "." : "Weigh-in " + spokenWeight(point.weight, this.unit) + ".";
      this.announce.textContent = heading + ". 10-day average " + spokenWeight(point.average, this.unit) + ". " + weighIn + (point.note ? " Note: " + point.note : "");
    }
  }
}

// Body fat from occasional waist measurements: a point for each estimate,
// joined by a line, from the first through today. It is drawn in ink, not the
// accent, so it stays quieter than the weight trend above it.
export class BodyFatChart extends Chart {
  // `cover` is the id of an element the tooltip keeps clear of (see Chart).
  constructor({ cover } = {}) {
    super({ wrap: "fat-chart-wrap", canvas: "fat-chart", tooltip: "fat-tooltip", empty: "fat-chart-empty", announce: "fat-announce", cover });
  }

  // `estimates` are points from bodyFatHistory with a body fat estimate.
  update(estimates, today, units) {
    this.estimates = estimates;
    this.today = today;
    this.units = units;
    this.draw();
  }

  draw() {
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;
    if (!this.estimates || !width || !height) return;
    this.hideTooltip();
    this.canvas.replaceChildren();
    this.canvas.setAttribute("viewBox", "0 0 " + width + " " + height);
    this.points = this.estimates;
    this.empty.hidden = this.points.length > 0;
    this.wrap.tabIndex = this.points.length ? 0 : -1;
    if (!this.points.length) {
      this.empty.textContent = "Your body fat shows here once a waist measurement has a weigh-in in the 10 days up to it.";
      this.canvas.setAttribute("aria-label", this.empty.textContent);
      return;
    }

    const compact = width < 480;
    const first = this.points[0];
    const last = this.points.at(-1);
    const start = first.day;
    const end = Math.max(dayOf(this.today), last.day);
    // At least a point either side, so small changes don't look like big ones.
    const { bottom, top, step } = yDomain(this.points.map(p => ({ average: p.bodyFat, weight: null })), null, null, 1);
    const endLabel = oneDecimal(last.bodyFat) + "%";
    const ticks = [];
    for (let tick = Math.ceil((bottom - 1e-8) / step) * step; tick <= top + 1e-8; tick += step) ticks.push(String(Number(tick.toFixed(2))));
    const left = Math.max(compact ? 30 : 38, Math.max(...ticks.map(label => textWidth(label, 8, 3.5))) + 14);
    // The "%" is wider than the letters textWidth allows for.
    const right = width - (textWidth(endLabel, 8.5) + 24);
    const ceiling = 24;
    const floor = height - 30;
    const x = day => start === end ? (left + right) / 2 : left + (day - start) / (end - start) * (right - left);
    const y = percent => floor - (percent - bottom) / (top - bottom) * (floor - ceiling);
    this.axes = { start, end, left, right, ceiling, floor, x, y };
    const fragment = document.createDocumentFragment();

    fragment.append(svg("text", { x: left - 12, y: 12, "text-anchor": "end" }, "%"));
    for (const label of ticks) {
      const yy = coord(y(Number(label))) + .5;
      fragment.append(
        svg("line", { class: "grid", x1: left, x2: width, y1: yy, y2: yy }),
        svg("text", { x: left - 12, y: yy + 4, "text-anchor": "end" }, label)
      );
    }
    dateLabels(fragment, calendarTicks(start, end, maxTicksFor(right - left)), this.axes, width, height - 6);

    if (this.points.length > 1) {
      fragment.append(svg("path", { class: "fat-line", d: this.points.map((p, i) => (i ? "L" : "M") + coord(x(p.day)) + " " + coord(y(p.bodyFat))).join(" ") }));
    }
    for (const p of this.points.slice(0, -1)) fragment.append(svg("circle", { class: "fat-dot", cx: coord(x(p.day)), cy: coord(y(p.bodyFat)), r: compact ? 3.5 : 4 }));
    const lastX = x(last.day);
    const lastY = y(last.bodyFat);
    fragment.append(
      svg("circle", { class: "end-dot", cx: coord(lastX), cy: coord(lastY), r: 5 }),
      svg("text", { class: "end-label", x: coord(lastX + 11), y: coord(lastY + 5) }, endLabel)
    );
    this.cursor = svg("g", { visibility: "hidden", "pointer-events": "none" });
    fragment.append(this.cursor);
    this.canvas.append(fragment);
    const count = this.points.length;
    this.canvas.setAttribute("aria-label", "Body fat estimates from " + count + (count === 1 ? " waist measurement" : " waist measurements") + ", " +
      prettyDate(first.date, "full") + " through " + prettyDate(dateOf(end), "full") + ". Latest " + oneDecimal(last.bodyFat) + " percent on " + prettyDate(last.date, "full") + ".");
  }

  // Measurements are far apart, so a pointer on the plot picks the nearest one.
  pointAt(xx, yy, dragging) {
    const { left, right, ceiling, floor } = this.axes;
    if (!dragging && (xx < left - 12 || xx > right + 12 || yy < ceiling - 12 || yy > floor + 5)) return -1;
    return nearestIndex(this.points, this.dayAt(xx));
  }

  showTooltip(index, announce) {
    const point = this.points[index];
    const { x, y, ceiling, floor } = this.axes;
    this.active = index;
    const xx = coord(x(point.day));
    this.cursor.replaceChildren(
      svg("line", { class: "crosshair", x1: xx + .5, x2: xx + .5, y1: ceiling - 8, y2: floor }),
      svg("circle", { class: "cursor-dot", cx: xx, cy: coord(y(point.bodyFat)), r: 5 })
    );
    this.cursor.setAttribute("visibility", "visible");
    const heading = prettyDate(point.date, "full");
    const lengthUnit = this.units.height;
    this.tooltip.innerHTML = "<strong>" + heading + "</strong>" +
      '<div class="tip-row"><b>' + oneDecimal(point.bodyFat) + "%</b>body fat</div>" +
      '<div class="tip-row"><b>' + formatWaist(point.waist, lengthUnit) + "</b>waist</div>" +
      '<div class="tip-row"><b>' + formatWeight(point.weight, this.units.weight) + "</b>10-day average</div>";
    this.placeTooltip(xx, y(point.bodyFat));
    if (announce) {
      this.announce.textContent = heading + ". Body fat " + oneDecimal(point.bodyFat) + " percent. Waist " + spokenWaist(point.waist, lengthUnit) +
        ". 10-day average " + spokenWeight(point.weight, this.units.weight) + ".";
    }
  }
}
