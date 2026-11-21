import { dateOf, dayOf, oneDecimal, prettyDate } from "./model.mjs";

const NS = "http://www.w3.org/2000/svg";

// Colors live in styles.css (by class), so the chart follows light and dark mode.
function svg(name, attributes = {}, content) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}

const coord = value => Math.round(value * 100) / 100;

function yDomain(points) {
  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    low = Math.min(low, point.average, point.weight ?? Infinity);
    high = Math.max(high, point.average, point.weight ?? -Infinity);
  }
  const pad = Math.max(.25, (high - low) * .11);
  const bottom = Math.max(0, low - pad);
  const top = high + pad;
  const target = (top - bottom) / 4;
  const power = 10 ** Math.floor(Math.log10(target));
  const factors = [1, 2, 2.5, 5, 10];
  const step = factors.reduce((best, n) => Math.abs(n - target / power) < Math.abs(best - target / power) ? n : best) * power;
  return { bottom, top, step };
}

export class TrendChart {
  constructor() {
    this.wrap = document.getElementById("chart-wrap");
    this.canvas = document.getElementById("trend-chart");
    this.tooltip = document.getElementById("chart-tooltip");
    this.empty = document.getElementById("chart-empty");
    this.announce = document.getElementById("chart-announce");
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

  update(trend, range, today) {
    this.trend = trend;
    this.range = range;
    this.today = today;
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
    const { bottom, top, step } = yDomain(this.points);
    const last = this.points.at(-1);
    const endLabel = oneDecimal(last.average);
    const left = Math.max(compact ? 30 : 38, String(Math.floor(top)).length * 8 + 14);
    const right = width - (endLabel.length * 8.5 + 18);
    const ceiling = 24;
    const floor = height - 30;
    const x = day => start === end ? (left + right) / 2 : left + (day - start) / (end - start) * (right - left);
    const y = value => floor - (value - bottom) / (top - bottom) * (floor - ceiling);
    this.axes = { start, end, left, right, ceiling, floor, x, y };
    const fragment = document.createDocumentFragment();

    fragment.append(svg("text", { x: left - 12, y: 12, "text-anchor": "end" }, "kg"));
    for (let tick = Math.ceil((bottom - 1e-8) / step) * step; tick <= top + 1e-8; tick += step) {
      const yy = coord(y(tick)) + .5;
      fragment.append(
        svg("line", { class: "grid", x1: left, x2: width, y1: yy, y2: yy }),
        svg("text", { x: left - 12, y: yy + 4, "text-anchor": "end" }, String(Number(tick.toFixed(2))))
      );
    }
    const tickCount = Math.min(end - start + 1, width < 360 ? 3 : compact ? 4 : width < 680 ? 5 : 7);
    for (let n = 0; n < tickCount; n++) {
      const day = tickCount === 1 ? start : start + Math.round(n / (tickCount - 1) * (end - start));
      const anchor = tickCount > 1 && n === 0 ? "start" : tickCount > 1 && n === tickCount - 1 ? "end" : "middle";
      const label = prettyDate(dateOf(day), end - start > 365 ? "monthYear" : "short");
      fragment.append(svg("text", { x: coord(x(day)), y: height - 6, "text-anchor": anchor }, label));
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
    this.cursor = svg("g", { visibility: "hidden", "pointer-events": "none" });
    fragment.append(this.cursor);
    this.canvas.append(fragment);
    this.canvas.setAttribute("aria-label", "Daily weights and 14-day moving averages, " + prettyDate(dateOf(start), "full") + " through " + prettyDate(this.today, "full") + ". Last plotted average " + endLabel + " kilograms.");
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
    const daily = point.weight === null ? null : oneDecimal(point.weight) + " kg";
    const mean = oneDecimal(point.average) + " kg";
    this.tooltip.innerHTML = "<strong>" + heading + "</strong>" +
      '<div class="tip-row"><i class="key-line"></i><b>' + mean + "</b>14-day average</div>" +
      '<div class="tip-row"><i class="key-dot"></i>' + (daily ? "<b>" + daily + "</b>weigh-in" : "No weigh-in") + "</div>";
    this.tooltip.hidden = false;
    const tipWidth = this.tooltip.offsetWidth;
    this.tooltip.style.left = Math.max(0, Math.min(this.wrap.clientWidth - tipWidth, xx + tipWidth + 14 < this.wrap.clientWidth ? xx + 14 : xx - tipWidth - 14)) + "px";
    this.tooltip.style.top = Math.max(0, Math.min(floor - this.tooltip.offsetHeight, y(point.average) - this.tooltip.offsetHeight / 2)) + "px";
    if (announce) this.announce.textContent = heading + ". 14-day average " + mean + ". " + (daily ? "Weigh-in " + daily + "." : "No weigh-in.");
  }

  hideTooltip() {
    this.active = null;
    this.tooltip.hidden = true;
    this.cursor?.setAttribute("visibility", "hidden");
  }
}
