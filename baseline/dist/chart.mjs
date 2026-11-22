import { KG_PER_LB, dateOf, dayOf, formatWaist, formatWeight, oneDecimal, prettyDate, spokenWaist, spokenWeight, weightParts } from "./model.mjs";

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

// Date labels along the bottom, from `start` to `end` (days).
function dateTicks(fragment, start, end, x, width, height) {
  const compact = width < 480;
  const tickCount = Math.min(end - start + 1, width < 360 ? 3 : compact ? 4 : width < 680 ? 5 : 7);
  for (let n = 0; n < tickCount; n++) {
    const day = tickCount === 1 ? start : start + Math.round(n / (tickCount - 1) * (end - start));
    const anchor = tickCount > 1 && n === 0 ? "start" : tickCount > 1 && n === tickCount - 1 ? "end" : "middle";
    const label = prettyDate(dateOf(day), end - start > 365 ? "monthYear" : "short");
    fragment.append(svg("text", { x: coord(x(day)), y: height - 6, "text-anchor": anchor }, label));
  }
}

// What both charts share: an SVG in a wrapper that redraws when it resizes, and
// a tooltip for one point at a time, picked with a pointer or the arrow keys.
// Subclasses draw, set `points`, `axes` and `cursor`, and show a point's tooltip.
class Chart {
  constructor(ids) {
    this.wrap = document.getElementById(ids.wrap);
    this.canvas = document.getElementById(ids.canvas);
    this.tooltip = document.getElementById(ids.tooltip);
    this.empty = document.getElementById(ids.empty);
    this.announce = document.getElementById(ids.announce);
    this.points = [];
    this.active = null;
    this.wrap.addEventListener("pointermove", event => {
      if (event.pointerType !== "touch") this.inspectPointer(event);
    });
    this.wrap.addEventListener("pointerdown", event => this.inspectPointer(event));
    this.wrap.addEventListener("pointerleave", () => this.hideTooltip());
    this.wrap.addEventListener("blur", () => this.hideTooltip());
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
    // With nothing selected, either arrow starts on the latest point.
    const step = delta => this.active === null ? lastIndex : Math.max(0, Math.min(lastIndex, this.active + delta));
    const keys = { ArrowLeft: step(-1), ArrowRight: step(1), Home: 0, End: lastIndex };
    if (event.key === "Escape") return this.hideTooltip();
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    this.showTooltip(keys[event.key], true);
  }

  // Beside the point at `xx`, on whichever side has room, centered on `yy`.
  placeTooltip(xx, yy) {
    this.tooltip.hidden = false;
    const tipWidth = this.tooltip.offsetWidth;
    this.tooltip.style.left = Math.max(0, Math.min(this.wrap.clientWidth - tipWidth, xx + tipWidth + 14 < this.wrap.clientWidth ? xx + 14 : xx - tipWidth - 14)) + "px";
    this.tooltip.style.top = Math.max(0, Math.min(this.axes.floor - this.tooltip.offsetHeight, yy - this.tooltip.offsetHeight / 2)) + "px";
  }

  hideTooltip() {
    this.active = null;
    this.tooltip.hidden = true;
    this.cursor?.setAttribute("visibility", "hidden");
  }
}

export class TrendChart extends Chart {
  constructor() {
    super({ wrap: "chart-wrap", canvas: "trend-chart", tooltip: "chart-tooltip", empty: "chart-empty", announce: "chart-announce" });
  }

  // `goal` is the goal weight in kg, or null without one. The chart plots in
  // `unit`, with stones on a scale of pounds.
  update(trend, range, today, goal = null, unit = "kg") {
    this.trend = trend;
    this.range = range;
    this.today = today;
    this.goal = Number.isFinite(goal) ? goal : null;
    this.unit = unit;
    this.draw();
  }

  draw() {
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;
    if (!this.trend || !width || !height) return;
    this.hideTooltip();
    this.canvas.replaceChildren();
    this.canvas.setAttribute("viewBox", "0 0 " + width + " " + height);
    const end = dayOf(this.today);
    const firstDay = this.trend.days[0]?.day ?? end;
    const start = this.range === "all" ? firstDay : Math.max(firstDay, end - Number(this.range) + 1);
    this.points = this.trend.days.filter(point => point.day >= start && point.day <= end);
    this.empty.hidden = this.points.length > 0;
    this.wrap.tabIndex = this.points.length ? 0 : -1;
    if (!this.points.length) {
      this.empty.textContent = this.trend.readings.length ? "No trend data in this range. Choose All to see your history." : "Log your first weight to see your trend.";
      this.canvas.setAttribute("aria-label", this.empty.textContent);
      return;
    }

    const compact = width < 480;
    const unit = this.unit;
    const stones = unit === "st";
    // The scale is in kg or pounds; `y` takes kg.
    const scale = unit === "kg" ? 1 : 1 / KG_PER_LB;
    const goal = this.goal;
    const { bottom, top, step } = yDomain(this.points.map(p => ({ average: p.average * scale, weight: p.weight === null ? null : p.weight * scale })),
      goal === null ? null : goal * scale, stones ? STONE_STEPS : null);
    const last = this.points.at(-1);
    const endLabel = lineLabel(last.average, unit);
    const goalLabel = goal === null ? "" : lineLabel(goal, unit);
    const ticks = [];
    for (let tick = Math.ceil((bottom - 1e-8) / step) * step; tick <= top + 1e-8; tick += step) {
      ticks.push({ value: tick, label: stones ? stoneTick(tick) : String(Number(tick.toFixed(2))) });
    }
    const left = Math.max(compact ? 30 : 38, Math.max(...ticks.map(tick => textWidth(tick.label, 8, 3.5))) + 14);
    const right = width - (Math.max(textWidth(endLabel, 8.5), textWidth(goalLabel, 8.5)) + 18);
    const ceiling = 24;
    const floor = height - 30;
    const x = day => start === end ? (left + right) / 2 : left + (day - start) / (end - start) * (right - left);
    const y = kg => floor - (kg * scale - bottom) / (top - bottom) * (floor - ceiling);
    this.axes = { start, end, left, right, ceiling, floor, x, y };
    const fragment = document.createDocumentFragment();

    // Stone labels name their own units.
    if (!stones) fragment.append(svg("text", { x: left - 12, y: 12, "text-anchor": "end" }, unit));
    for (const tick of ticks) {
      const yy = coord(y(tick.value / scale)) + .5;
      fragment.append(
        svg("line", { class: "grid", x1: left, x2: width, y1: yy, y2: yy }),
        svg("text", { x: left - 12, y: yy + 4, "text-anchor": "end" }, tick.label)
      );
    }
    dateTicks(fragment, start, end, x, width, height);

    // The goal is a dashed hairline under the data, ending with its value.
    if (goal !== null) {
      const goalY = coord(y(goal)) + .5;
      fragment.append(svg("line", { class: "goal", x1: left, x2: coord(right), y1: goalY, y2: goalY }));
    }

    // Daily weigh-ins sit underneath; the average line is the figure.
    const count = this.points.filter(p => p.weight !== null).length;
    const radius = count > 160 ? 2.5 : compact ? 3.5 : 4;
    for (const p of this.points) {
      if (p.weight !== null) fragment.append(svg("circle", { class: "dot", cx: coord(x(p.day)), cy: coord(y(p.weight)), r: radius }));
    }

    // Break the line where the trailing window contains no measurements.
    const sections = [];
    for (const point of this.points) {
      const section = sections.at(-1);
      if (section && section.at(-1).day === point.day - 1) section.push(point);
      else sections.push([point]);
    }
    for (const section of sections) {
      if (section.length === 1) {
        fragment.append(svg("circle", { class: "avg-single", cx: coord(x(section[0].day)), cy: coord(y(section[0].average)), r: 3 }));
        continue;
      }
      const path = section.map((p, i) => (i ? "L" : "M") + coord(x(p.day)) + " " + coord(y(p.average))).join(" ");
      fragment.append(svg("path", { class: "avg", d: path }));
    }

    const lastX = x(last.day);
    const lastY = y(last.average);
    fragment.append(
      svg("circle", { class: "end-dot", cx: coord(lastX), cy: coord(lastY), r: 5 }),
      svg("text", { class: "end-label", x: coord(lastX + 11), y: coord(lastY + 5) }, endLabel)
    );
    if (goal !== null) {
      // Both labels sit at the right edge when the line reaches it, so keep them apart.
      const shared = lastX > right - endLabel.length * 8.5;
      const labelY = shared ? separateLabel(y(goal), lastY, 17, ceiling - 12, floor + 6) : y(goal);
      fragment.append(svg("text", { class: "goal-label", x: coord(right + 11), y: coord(labelY + 4) }, goalLabel));
    }
    this.cursor = svg("g", { visibility: "hidden", "pointer-events": "none" });
    fragment.append(this.cursor);
    this.canvas.append(fragment);
    this.canvas.setAttribute("aria-label", "Daily weights and 14-day moving averages, " + prettyDate(dateOf(start), "full") + " through " + prettyDate(this.today, "full") + ". Last plotted average " + spokenWeight(last.average, unit) + "." + (goal === null ? "" : " Goal " + spokenWeight(goal, unit) + "."));
  }

  inspectPointer(event) {
    if (!this.points.length) return;
    const bounds = this.wrap.getBoundingClientRect();
    const { left, right, start, end, floor, ceiling } = this.axes;
    const xx = event.clientX - bounds.left;
    const yy = event.clientY - bounds.top;
    if (xx < left - 5 || xx > right + 5 || yy < ceiling - 12 || yy > floor + 5) return this.hideTooltip();
    const day = start + Math.round(Math.max(0, Math.min(1, (xx - left) / (right - left))) * (end - start));
    const index = this.points.findIndex(p => p.day === day);
    if (index < 0) return this.hideTooltip();
    this.showTooltip(index, false);
  }

  showTooltip(index, announce) {
    const point = this.points[index];
    const { x, y, ceiling, floor } = this.axes;
    this.active = index;
    const xx = coord(x(point.day));
    this.cursor.replaceChildren(svg("line", { class: "crosshair", x1: xx + .5, x2: xx + .5, y1: ceiling - 8, y2: floor }));
    if (point.weight !== null) this.cursor.append(svg("circle", { class: "cursor-dot", cx: xx, cy: coord(y(point.weight)), r: 4.5 }));
    this.cursor.append(svg("circle", { class: "cursor-avg", cx: xx, cy: coord(y(point.average)), r: 5 }));
    this.cursor.setAttribute("visibility", "visible");
    const heading = prettyDate(point.date, "full");
    const daily = point.weight === null ? null : formatWeight(point.weight, this.unit);
    const mean = formatWeight(point.average, this.unit);
    this.tooltip.innerHTML = "<strong>" + heading + "</strong>" +
      '<div class="tip-row"><i class="key-line"></i><b>' + mean + "</b>14-day average</div>" +
      '<div class="tip-row"><i class="key-dot"></i>' + (daily ? "<b>" + daily + "</b>weigh-in" : "No weigh-in") + "</div>";
    if (point.note) {
      const note = document.createElement("p");
      note.className = "tip-note";
      note.textContent = point.note;
      this.tooltip.append(note);
    }
    this.placeTooltip(xx, y(point.average));
    if (announce) {
      const weighIn = point.weight === null ? "No weigh-in." : "Weigh-in " + spokenWeight(point.weight, this.unit) + ".";
      this.announce.textContent = heading + ". 14-day average " + spokenWeight(point.average, this.unit) + ". " + weighIn + (point.note ? " Note: " + point.note : "");
    }
  }
}

// Body fat from occasional waist measurements: a point for each estimate,
// joined by a line, from the first through today. It is drawn in ink, not the
// accent, so it stays quieter than the weight trend above it.
export class BodyFatChart extends Chart {
  constructor() {
    super({ wrap: "fat-chart-wrap", canvas: "fat-chart", tooltip: "fat-tooltip", empty: "fat-chart-empty", announce: "fat-announce" });
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
      this.empty.textContent = "Your body fat shows here once a waist measurement has a weigh-in in the 14 days up to it.";
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
    this.axes = { left, right, ceiling, floor, x, y };
    const fragment = document.createDocumentFragment();

    fragment.append(svg("text", { x: left - 12, y: 12, "text-anchor": "end" }, "%"));
    for (const label of ticks) {
      const yy = coord(y(Number(label))) + .5;
      fragment.append(
        svg("line", { class: "grid", x1: left, x2: width, y1: yy, y2: yy }),
        svg("text", { x: left - 12, y: yy + 4, "text-anchor": "end" }, label)
      );
    }
    dateTicks(fragment, start, end, x, width, height);

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

  // Measurements are far apart, so the pointer picks the nearest one.
  inspectPointer(event) {
    if (!this.points.length) return;
    const bounds = this.wrap.getBoundingClientRect();
    const { left, right, ceiling, floor, x } = this.axes;
    const xx = event.clientX - bounds.left;
    const yy = event.clientY - bounds.top;
    if (xx < left - 12 || xx > right + 12 || yy < ceiling - 12 || yy > floor + 5) return this.hideTooltip();
    let index = 0;
    this.points.forEach((point, i) => {
      if (Math.abs(x(point.day) - xx) < Math.abs(x(this.points[index].day) - xx)) index = i;
    });
    this.showTooltip(index, false);
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
      '<div class="tip-row"><b>' + formatWeight(point.weight, this.units.weight) + "</b>14-day average</div>";
    this.placeTooltip(xx, y(point.bodyFat));
    if (announce) {
      this.announce.textContent = heading + ". Body fat " + oneDecimal(point.bodyFat) + " percent. Waist " + spokenWaist(point.waist, lengthUnit) +
        ". 14-day average " + spokenWeight(point.weight, this.units.weight) + ".";
    }
  }
}
