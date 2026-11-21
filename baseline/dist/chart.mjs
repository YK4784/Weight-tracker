import { dateOf, dayOf, oneDecimal, prettyDate } from "./model.mjs";

const NS = "http://www.w3.org/2000/svg";
const GREEN = "#397355";
const ORANGE = "#bd784a";

function svg(name, attributes = {}, content) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}

const coord = value => Math.round(value * 100) / 100;

export function drawMiniatures(trend, height) {
  const average = document.getElementById("avg-mini");
  const weight = document.getElementById("weight-mini");
  const ruler = document.getElementById("height-mini");
  average.replaceChildren();
  weight.replaceChildren();
  ruler.replaceChildren();

  const last = trend.days.at(-1);
  const window = last ? trend.days.filter(point => point.day > last.day - 30) : [];
  if (window.length && trend.current) {
    const values = window.map(point => point.average);
    const low = Math.min(...values);
    const span = Math.max(.3, Math.max(...values) - low);
    const start = window[0].day;
    const x = day => 5 + (day - start) / Math.max(1, last.day - start) * 101;
    const y = value => 37 - (value - low) / span * 26;
    let previous;
    let path = "";
    for (const point of window) {
      path += (previous?.day === point.day - 1 ? " L" : " M") + coord(x(point.day)) + " " + coord(y(point.average));
      previous = point;
    }
    average.append(
      svg("path", { d: "M3 42H109", stroke: "#789a7f", opacity: .65, "stroke-dasharray": "2 4", fill: "none" }),
      svg("path", { d: path, stroke: "#c4e8aa", fill: "none", "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round" }),
      svg("circle", { cx: x(last.day), cy: y(last.average), r: 3.1, fill: "#d6efbc" })
    );
  }

  const recent = trend.readings.slice(-14);
  if (recent.length) {
    const values = recent.map(point => point.weight);
    const low = Math.min(...values);
    const span = Math.max(.3, Math.max(...values) - low);
    const step = 106 / Math.max(14, recent.length);
    recent.forEach((point, index) => {
      const bar = 10 + (point.weight - low) / span * 26;
      weight.append(svg("rect", {
        x: coord(3 + (14 - recent.length + index) * step), y: coord(42 - bar),
        width: coord(step - 2.5), height: coord(bar), rx: 1.7,
        fill: index === recent.length - 1 ? "#b57046" : "#e4c7b1"
      }));
    });
  }

  if (height) {
    const min = Math.max(0, Math.floor((height - 20) / 10) * 10);
    const max = min + 50;
    for (let n = 0; n <= 20; n++) {
      const x = 6 + n * 5;
      ruler.append(svg("line", { x1: x, x2: x, y1: n % 5 === 0 ? 18 : n % 2 === 0 ? 23 : 26, y2: 32, stroke: "#a7b5a7", "stroke-width": 1.2 }));
    }
    const pointer = 6 + (height - min) * 2;
    ruler.append(
      svg("line", { x1: 6, x2: 106, y1: 32, y2: 32, stroke: "#b9c6b8" }),
      svg("path", { d: "M" + (pointer - 3.8) + " 9h7.6l-3.8 5z", fill: GREEN }),
      svg("line", { x1: pointer, x2: pointer, y1: 16, y2: 32, stroke: GREEN, "stroke-width": 2 }),
      svg("text", { x: 4, y: 46, fill: "#66756a", "font-size": 12 }, min),
      svg("text", { x: 109, y: 46, fill: "#66756a", "font-size": 12, "text-anchor": "end" }, max)
    );
  }
}

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

    const compact = width < 420;
    const { bottom, top, step } = yDomain(this.points);
    const maxLabelLength = String(Math.floor(top)).length;
    const left = Math.max(compact ? 30 : 37, maxLabelLength * 8 + 10);
    const right = width - (compact ? 40 : 46);
    const ceiling = 17;
    const floor = height - 29;
    const x = day => start === end ? (left + right) / 2 : left + (day - start) / (end - start) * (right - left);
    const y = value => floor - (value - bottom) / (top - bottom) * (floor - ceiling);
    this.axes = { start, end, left, right, ceiling, floor, x, y };
    const fragment = document.createDocumentFragment();
    const gradient = svg("linearGradient", { id: "trend-fill", x1: 0, y1: 0, x2: 0, y2: 1, gradientUnits: "objectBoundingBox" });
    gradient.append(svg("stop", { offset: "0%", "stop-color": "#98b99a", "stop-opacity": .18 }), svg("stop", { offset: "100%", "stop-color": "#c9d9c4", "stop-opacity": .025 }));
    const defs = svg("defs");
    defs.append(gradient);
    fragment.append(defs);
    fragment.append(svg("text", { x: 0, y: 10 }, "kg"));
    for (let tick = Math.ceil((bottom - 1e-8) / step) * step; tick <= top + 1e-8; tick += step) {
      const label = String(Number(tick.toFixed(2)));
      const yy = coord(y(tick));
      fragment.append(
        svg("line", { x1: left, x2: right + 2, y1: yy, y2: yy, stroke: "#e0e6df", "stroke-dasharray": "3 4" }),
        svg("text", { x: left - 9, y: yy + 4, "text-anchor": "end" }, label)
      );
    }
    const tickCount = Math.min(end - start + 1, width < 340 ? 3 : compact ? 4 : width < 530 ? 5 : 6);
    for (let n = 0; n < tickCount; n++) {
      const day = tickCount === 1 ? start : start + Math.round(n / (tickCount - 1) * (end - start));
      const label = prettyDate(dateOf(day), end - start > 365 ? "monthYear" : "short");
      fragment.append(svg("text", { x: coord(x(day)), y: height - 5, "text-anchor": "middle" }, label));
    }

    // Break the line where the trailing window contains no measurements.
    const sections = [];
    for (const point of this.points) {
      const section = sections.at(-1);
      if (section && section.at(-1).day === point.day - 1) section.push(point);
      else sections.push([point]);
    }
    for (const section of sections) {
      const path = section.map((p, i) => (i ? "L" : "M") + coord(x(p.day)) + " " + coord(y(p.average))).join(" ");
      if (section.length > 1) {
        const area = path + " L" + coord(x(section.at(-1).day)) + " " + floor + " L" + coord(x(section[0].day)) + " " + floor + " Z";
        fragment.append(svg("path", { d: area, fill: "url(#trend-fill)" }));
      }
      fragment.append(svg("path", { d: path, fill: "none", stroke: GREEN, "stroke-width": 2.8, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      if (section.length === 1) fragment.append(svg("circle", { cx: x(section[0].day), cy: y(section[0].average), r: 4.5, fill: GREEN }));
    }
    const last = this.points.at(-1);
    const lastX = x(last.day);
    const lastY = y(last.average);
    fragment.append(svg("circle", { cx: lastX, cy: lastY, r: 4.2, fill: "white", stroke: GREEN, "stroke-width": 2.2 }));
    const count = this.points.filter(p => p.weight !== null).length;
    for (const p of this.points) {
      if (p.weight !== null) fragment.append(svg("circle", { cx: coord(x(p.day)), cy: coord(y(p.weight)), r: count > 160 ? 2 : compact ? 2.8 : 3.6, fill: ORANGE, stroke: "white", "stroke-width": .75 }));
    }
    const label = oneDecimal(last.average);
    const labelWidth = Math.max(33, label.length * 6.8 + 9);
    const tagX = Math.min(width - labelWidth, lastX + 7);
    fragment.append(
      svg("rect", { x: tagX, y: lastY - 10, width: labelWidth, height: 20, rx: 5, fill: GREEN }),
      svg("text", { class: "end-label", x: tagX + labelWidth / 2, y: lastY + 4, "text-anchor": "middle" }, label)
    );
    this.cursor = svg("g", { visibility: "hidden", "pointer-events": "none" });
    fragment.append(this.cursor);
    this.canvas.append(fragment);
    this.canvas.setAttribute("aria-label", "Daily weights and 14-day moving averages, " + prettyDate(dateOf(start), "full") + " through " + prettyDate(this.today, "full") + ". Last plotted average " + label + " kilograms.");
  }

  inspectPointer(event) {
    if (!this.points.length) return;
    const bounds = this.wrap.getBoundingClientRect();
    const { left, right, start, end, floor, ceiling } = this.axes;
    const xx = event.clientX - bounds.left;
    const yy = event.clientY - bounds.top;
    if (xx < left - 5 || xx > right + 5 || yy < ceiling - 8 || yy > floor + 5) return this.hideTooltip();
    const day = start + Math.round(Math.max(0, Math.min(1, (xx - left) / (right - left))) * (end - start));
    const index = this.points.findIndex(p => p.day === day);
    if (index < 0) return this.hideTooltip();
    this.showTooltip(index, false);
  }

  inspectKey(event) {
    if (!this.points.length) return;
    const lastIndex = this.points.length - 1;
    const current = this.active ?? lastIndex;
    const keys = { ArrowLeft: Math.max(0, current - 1), ArrowRight: Math.min(lastIndex, current + 1), Home: 0, End: lastIndex };
    if (event.key === "Escape") return this.hideTooltip();
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    this.showTooltip(keys[event.key], true);
  }

  showTooltip(index, announce) {
    const point = this.points[index];
    const { x, y, ceiling, floor } = this.axes;
    this.active = index;
    const xx = x(point.day);
    this.cursor.replaceChildren(
      svg("line", { x1: xx, x2: xx, y1: ceiling, y2: floor, stroke: "#7e9482", "stroke-dasharray": "3 3" }),
      svg("circle", { cx: xx, cy: y(point.average), r: 4.5, fill: "white", stroke: GREEN, "stroke-width": 2 })
    );
    if (point.weight !== null) this.cursor.append(svg("circle", { cx: xx, cy: y(point.weight), r: 4, fill: ORANGE, stroke: "white", "stroke-width": 1 }));
    this.cursor.setAttribute("visibility", "visible");
    const heading = prettyDate(point.date, "full");
    const daily = point.weight === null ? "No entry" : oneDecimal(point.weight) + " kg";
    const mean = oneDecimal(point.average) + " kg";
    this.tooltip.innerHTML = "<strong>" + heading + "</strong><div>Daily weight<b>" + daily + "</b></div><div>14-day average<b>" + mean + "</b></div>";
    this.tooltip.hidden = false;
    const tipWidth = this.tooltip.offsetWidth;
    this.tooltip.style.left = Math.max(0, Math.min(this.wrap.clientWidth - tipWidth, xx + tipWidth + 10 < this.wrap.clientWidth ? xx + 10 : xx - tipWidth - 10)) + "px";
    this.tooltip.style.top = Math.max(0, Math.min(floor - this.tooltip.offsetHeight, y(point.average) - this.tooltip.offsetHeight / 2)) + "px";
    if (announce) this.announce.textContent = heading + ". Daily weight " + daily + ". 14-day average " + mean + ".";
  }

  hideTooltip() {
    this.active = null;
    this.tooltip.hidden = true;
    this.cursor?.setAttribute("visibility", "hidden");
  }
}
