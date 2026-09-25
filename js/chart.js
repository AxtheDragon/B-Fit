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
