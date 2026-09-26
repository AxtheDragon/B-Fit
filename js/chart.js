/*
 * Minimal responsive line chart (SVG, no library) for progress over time.
 * One series per chart; tap or hover shows the value of the nearest point.
 * The chart redraws itself whenever its width changes (ResizeObserver),
 * so text stays the same size on every screen.
 */
import { formatDate, parseISODate } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 170;
const PAD = { top: 14, right: 12, bottom: 26, left: 40 };

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Round axis range to "nice" numbers and return 3–5 tick values. */
function niceTicks(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / 3;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/**
 * @param {string} title  e.g. "Top weight"
 * @param {string} unit   e.g. "kg"
 * @param {{date: string, value: number}[]} points  sorted by date ascending
 */
export function lineChart(title, unit, points) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const heading = document.createElement('div');
  heading.className = 'chart-title';
  heading.textContent = unit ? `${title} (${unit})` : title;
  const plot = document.createElement('div');
  plot.style.position = 'relative';
  wrap.append(heading, plot);

  let lastWidth = 0;
  new ResizeObserver(() => {
    const width = plot.clientWidth;
    if (width && width !== lastWidth) { lastWidth = width; draw(plot, width, unit, points); }
  }).observe(plot);
  return wrap;
}

function draw(plot, width, unit, points) {
  const times = points.map((p) => parseISODate(p.date).getTime());
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (t) => (tMax === tMin ? PAD.left + innerW / 2 : PAD.left + ((t - tMin) / (tMax - tMin)) * innerW);
  const y = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, role: 'img' });
  svg.setAttribute('aria-label', `Chart of ${points.length} values, from ${values[0]} to ${values[values.length - 1]} ${unit}`);

  // Horizontal grid lines with value labels
  for (const t of ticks) {
    svg.append(svgEl('line', { class: 'grid', x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t) }));
    const label = svgEl('text', { class: 'axis-label', x: PAD.left - 6, y: y(t) + 4, 'text-anchor': 'end' });
    label.textContent = t;
    svg.append(label);
  }

  // First and last date under the x axis
  const dateLabel = (i, anchor) => {
    const text = svgEl('text', { class: 'axis-label', x: x(times[i]), y: HEIGHT - 6, 'text-anchor': anchor });
    text.textContent = formatDate(points[i].date, { day: 'numeric', month: 'short' });
    svg.append(text);
  };
  dateLabel(0, points.length === 1 ? 'middle' : 'start');
  if (points.length > 1) dateLabel(points.length - 1, 'end');

  // The line and its points
  const coords = points.map((p, i) => [x(times[i]), y(p.value)]);
  svg.append(svgEl('polyline', { class: 'line', points: coords.map((c) => c.join(',')).join(' ') }));
  const crosshair = svgEl('line', { class: 'crosshair', y1: PAD.top, y2: PAD.top + innerH, visibility: 'hidden' });
  svg.append(crosshair);
  const dots = coords.map(([cx, cy]) => {
    const dot = svgEl('circle', { class: 'dot', cx, cy, r: 4 });
    svg.append(dot);
    return dot;
  });

  // Tooltip: nearest point to the finger / mouse
  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  let active = -1;
  const show = (event) => {
    const rect = svg.getBoundingClientRect();
    const px = event.clientX - rect.left;
    let best = 0;
    coords.forEach(([cx], i) => { if (Math.abs(cx - px) < Math.abs(coords[best][0] - px)) best = i; });
    if (active >= 0) dots[active].classList.remove('active');
    active = best;
    dots[best].classList.add('active');
    const [cx, cy] = coords[best];
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    crosshair.setAttribute('visibility', 'visible');
    tip.textContent = `${formatDate(points[best].date, { day: 'numeric', month: 'short', year: 'numeric' })}: ${points[best].value} ${unit}`;
    tip.classList.remove('hidden');
    // Keep the tooltip inside the chart horizontally.
    tip.style.left = `${Math.min(Math.max(cx, 70), width - 70)}px`;
    tip.style.top = `${Math.max(cy - 34, 0)}px`;
  };
  const hide = () => {
    tip.classList.add('hidden');
    crosshair.setAttribute('visibility', 'hidden');
    if (active >= 0) dots[active].classList.remove('active');
    active = -1;
  };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });

  plot.replaceChildren(svg, tip);
}

/* ---------- Bar chart ---------- */

/**
 * Responsive bar chart, one series (e.g. workouts per week).
 * @param {string} title
 * @param {{label: string, tip: string, value: number}[]} bars  in display order
 *        `label` is the short x-axis label, `tip` the longer text for the tooltip.
 */
export function barChart(title, bars) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const heading = document.createElement('div');
  heading.className = 'chart-title';
  heading.textContent = title;
  const plot = document.createElement('div');
  plot.style.position = 'relative';
  wrap.append(heading, plot);

  let lastWidth = 0;
  new ResizeObserver(() => {
    const width = plot.clientWidth;
    if (width && width !== lastWidth) { lastWidth = width; drawBars(plot, width, bars); }
  }).observe(plot);
  return wrap;
}

/** Path for a bar with rounded top corners, anchored flat on the baseline. */
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function drawBars(plot, width, bars) {
  const PADB = { top: 14, right: 8, bottom: 26, left: 32 };
  const innerW = width - PADB.left - PADB.right;
  const innerH = HEIGHT - PADB.top - PADB.bottom;
  const maxValue = Math.max(1, ...bars.map((b) => b.value));
  // Whole-number ticks (counts of workouts)
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const yMax = Math.ceil(maxValue / step) * step;
  const y = (v) => PADB.top + innerH - (v / yMax) * innerH;
  const slot = innerW / bars.length;
  const barW = Math.max(2, slot - 2); // 2px gap between bars

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, role: 'img' });
  svg.setAttribute('aria-label', bars.map((b) => `${b.tip}: ${b.value}`).join(', '));

  for (let v = 0; v <= yMax; v += step) {
    svg.append(svgEl('line', { class: 'grid', x1: PADB.left, x2: width - PADB.right, y1: y(v), y2: y(v) }));
    const label = svgEl('text', { class: 'axis-label', x: PADB.left - 6, y: y(v) + 4, 'text-anchor': 'end' });
    label.textContent = v;
    svg.append(label);
  }

  // Only every n-th x label, so they never overlap (~48px per label).
  const every = Math.ceil(bars.length / Math.max(1, Math.floor(innerW / 48)));
  const rects = bars.map((b, i) => {
    const x = PADB.left + i * slot + (slot - barW) / 2;
    if (i % every === 0) {
      const label = svgEl('text', { class: 'axis-label', x: x + barW / 2, y: HEIGHT - 6, 'text-anchor': 'middle' });
      label.textContent = b.label;
      svg.append(label);
    }
    if (b.value <= 0) return null;
    const bar = svgEl('path', { class: 'bar', d: barPath(x, y(b.value), barW, y(0) - y(b.value)) });
    svg.append(bar);
    return bar;
  });

  // Tooltip for the bar under the finger / mouse (hit area = whole column).
  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  let active = null;
  const show = (event) => {
    const px = event.clientX - svg.getBoundingClientRect().left;
    const i = Math.min(bars.length - 1, Math.max(0, Math.floor((px - PADB.left) / slot)));
    active?.classList.remove('active');
    active = rects[i];
    active?.classList.add('active');
    const cx = PADB.left + i * slot + slot / 2;
    tip.textContent = `${bars[i].tip}: ${bars[i].value}`;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(Math.max(cx, 80), width - 80)}px`;
    tip.style.top = `${Math.max(y(bars[i].value) - 34, 0)}px`;
  };
  const hide = () => { tip.classList.add('hidden'); active?.classList.remove('active'); active = null; };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });

  plot.replaceChildren(svg, tip);
}
