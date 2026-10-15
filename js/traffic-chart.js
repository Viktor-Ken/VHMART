// Admin traffic chart: plain HTML and CSS (see "Admin traffic chart" in css/main.css).
import { londonDay, shiftDay } from './analytics.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function parts(key) { const [y, m, d] = key.split('-').map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
function dayLabel(key) { const p = parts(key); return `${WEEKDAYS[p.dow]} ${p.d} ${MONTHS[p.m - 1]}`; }
function shortDate(key) { const p = parts(key); return `${p.d} ${MONTHS[p.m - 1]}`; }
function mondayOf(key) { const p = parts(key); return shiftDay(key, -((p.dow + 6) % 7)); }

// 7 days: one bar per day, labelled with the weekday and date.
// 30 days: one bar per day, with the week starts (Mondays) labelled and divided.
// 90 days: one bar per week, because 90 thin bars cannot be read.
function buckets(series) {
  if (series.length <= 7) {
    return series.map((r) => ({ views: r.views, visitors: r.visitors, label: `${WEEKDAYS[parts(r.day).dow]}`, sub: String(parts(r.day).d), tip: dayLabel(r.day), today: r.day === londonDay() }));
  }
  if (series.length <= 31) {
    return series.map((r) => { const p = parts(r.day); const monday = p.dow === 1; return { views: r.views, visitors: r.visitors, label: monday ? `${p.d} ${MONTHS[p.m - 1]}` : '', sub: '', tip: dayLabel(r.day), weekStart: monday, today: r.day === londonDay() }; });
  }
  const weeks = new Map();
  series.forEach((r) => {
    const key = mondayOf(r.day);
    const w = weeks.get(key) || { views: 0, visitors: 0, label: String(parts(key).d), sub: MONTHS[parts(key).m - 1], tip: `Week of ${shortDate(key)}`, today: false };
    w.views += r.views; w.visitors += r.visitors; if (r.day === londonDay()) w.today = true;
    weeks.set(key, w);
  });
  return Array.from(weeks.values());
}

function niceMax(value) {
  if (value <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }

export function barChart(series, root = document.querySelector('#chart')) {
  root.replaceChildren();
  if (!series.length) { root.append(el('p', 'empty', 'No traffic recorded yet.')); return; }
  const rows = buckets(series);
  const max = niceMax(rows.reduce((m, r) => Math.max(m, r.views, r.visitors), 0));
  const unit = series.length > 31 ? 'week' : 'day';

  const legend = el('p', 'chart-legend');
  const k1 = el('span', 'chart-key'); k1.append(el('i', 'chart-swatch chart-swatch--bar'), document.createTextNode(`Page views per ${unit}`));
  const k2 = el('span', 'chart-key'); k2.append(el('i', 'chart-swatch chart-swatch--dot'), document.createTextNode(`Visitors per ${unit}`));
  legend.append(k1, k2);

  const frame = el('div', 'chart-frame');
  const axis = el('div', 'chart-axis');
  const plot = el('div', 'chart-plot');
  [1, 0.75, 0.5, 0.25, 0].forEach((f) => {
    const y = el('span', 'chart-ytick', String(Math.round(max * f)));
    y.style.bottom = `${f * 100}%`;
    axis.append(y);
    const line = el('div', 'chart-grid'); line.style.bottom = `${f * 100}%`; plot.append(line);
  });
  const cols = el('div', 'chart-cols');
  cols.style.setProperty('--n', rows.length);
  const tip = el('div', 'chart-tip'); tip.hidden = true;
  const showTip = (col, row) => {
    tip.replaceChildren(el('strong', null, row.tip + (row.today ? ' (today)' : '')), el('span', null, `${row.views} page view${row.views === 1 ? '' : 's'}`), el('span', null, `${row.visitors} visitor${row.visitors === 1 ? '' : 's'}`));
    tip.hidden = false;
    const box = frame.getBoundingClientRect(), c = col.getBoundingClientRect();
    const x = c.left - box.left + c.width / 2;
    tip.style.left = `${Math.min(Math.max(x, 70), box.width - 70)}px`;
  };
  rows.forEach((row) => {
    const col = el('div', 'chart-col' + (row.weekStart ? ' chart-col--week' : '') + (row.today ? ' chart-col--today' : ''));
    col.tabIndex = 0;
    col.setAttribute('aria-label', `${row.tip}: ${row.views} page views, ${row.visitors} visitors`);
    const bar = el('div', 'chart-bar'); bar.style.height = `${(row.views / max) * 100}%`;
    if (row.views > 0) bar.style.minHeight = '3px';
    const dot = el('div', 'chart-dot'); dot.style.bottom = `${(row.visitors / max) * 100}%`;
    if (row.visitors === 0) dot.hidden = true;
    col.append(bar, dot);
    col.addEventListener('pointerenter', () => showTip(col, row));
    col.addEventListener('focus', () => showTip(col, row));
    col.addEventListener('click', () => showTip(col, row));
    cols.append(col);
  });
  plot.addEventListener('pointerleave', () => { tip.hidden = true; });
  plot.append(cols);

  const labels = el('div', 'chart-labels');
  labels.style.setProperty('--n', rows.length);
  rows.forEach((row) => {
    const cell = el('div', 'chart-label' + (series.length > 31 && (rows.length - 1 - rows.indexOf(row)) % 2 === 1 ? ' chart-label--alt' : '') + (row.weekStart ? ' chart-label--week' : '') + (row.today ? ' chart-label--today' : ''));
    if (row.label) cell.append(el('span', null, row.label));
    if (row.sub) cell.append(el('span', 'chart-label__sub', row.sub));
    labels.append(cell);
  });

  const grid = el('div', 'chart-body');
  grid.append(axis, plot);
  const under = el('div', 'chart-under'); under.append(el('span'), labels);
  frame.append(grid, under, tip);
  const note = el('p', 'chart-note', series.length > 31 ? 'Each bar is one week (Monday to Sunday). Tap or hover a bar for its numbers.' : series.length > 7 ? 'Each bar is one day. The labelled bars are Mondays, the start of each week. Tap or hover a bar for its numbers.' : 'Tap or hover a bar for its numbers.');
  const table = el('details', 'chart-table');
  table.append(el('summary', null, 'Show as a table'));
  const t = el('table'); const head = el('tr'); ['When', 'Page views', 'Visitors'].forEach((h) => head.append(el('th', null, h))); t.append(head);
  rows.slice().reverse().forEach((r) => { const tr = el('tr'); [r.tip + (r.today ? ' (today)' : ''), r.views, r.visitors].forEach((v) => tr.append(el('td', null, String(v)))); t.append(tr); });
  table.append(t);
  root.append(legend, frame, note, table);
}

