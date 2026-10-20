'use strict';
/* ============================================================
   Money — app logic. Reads the finance Sheet through Apps Script (read-only).
   Sections: helpers · data · filters · charts · screens · sheets · events · demo · start
   ============================================================ */
const VERSION = 3;

/* Chart colors: the validated categorical set for dark surfaces (fixed order, never cycled).
   Color follows the category (its position in the Setup list), never its rank in the chart. */
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const REST = '#6b6b72';
const C_INCOME = '#3987e5', C_SPEND = '#d95926', C_PREV = '#898781';
const TYPE_COLOR = { Income: '#3987e5', Savings: '#9085e9', Transfer: '#6b6b72' };

/* ---------- helpers ---------- */
const $ = (s, root) => (root || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parse = s => { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
const fmtD = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const monthKey = s => s.slice(0, 7);
const addMonths = (key, n) => { const p = key.split('-').map(Number); const t = p[0] * 12 + (p[1] - 1) + n; return Math.floor(t / 12) + '-' + pad(t % 12 + 1); };
const dim = key => { const p = key.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); };
const clampDay = (key, day) => key + '-' + pad(Math.min(day, dim(key)));
const mLabel = key => MONTHS[+key.slice(5, 7) - 1];
const mLabelFull = key => mLabel(key) + ' ' + key.slice(0, 4);
const dayLabel = s => { const d = parse(s); return DOW[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
const shortDate = s => { const d = parse(s); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const nf0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const m0 = n => nf0.format(Math.round(n));
const m2 = n => nf2.format(n);
const trim1 = n => String(+n.toFixed(1));
const kfmt = v => v >= 1e6 ? '$' + trim1(v / 1e6) + 'M' : v >= 1e3 ? '$' + trim1(v / 1e3) + 'K' : '$' + trim1(v);
const sumBy = (arr, type) => arr.reduce((s, t) => s + (t.type === type ? t.amount : 0), 0);

function niceScale(max) {
  if (!(max > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { max: top, ticks };
}

/* ---------- state ---------- */
const S = {
  demo: false, data: null, txs: [], cats: new Map(), expenseCats: [], accounts: [], bills: [], today: localToday(),
  tab: 'home', period: { id: 'thisMonth' }, catFilter: new Set(), account: '',
  q: '', type: 'All', sort: 'new', limit: 60, tableView: false, updatedAt: 0, status: ''
};
const PERIODS = [
  { id: 'thisMonth', label: 'This month' }, { id: 'lastMonth', label: 'Last month' },
  { id: '3m', label: 'Last 3 months' }, { id: '6m', label: 'Last 6 months' },
  { id: 'ytd', label: 'Year to date' }, { id: '12m', label: 'Last 12 months' }, { id: 'all', label: 'All time' }
];

function ingest(j) {
  S.data = j;
  S.today = j.today || localToday();
  S.cats = new Map(); S.expenseCats = [];
  (j.categories || []).forEach(c => {
    if (c.group === 'Expense') S.expenseCats.push(c.name);
    S.cats.set(c.name, { group: c.group, target: c.target || 0 });
  });
  S.bills = (j.bills || []).filter(b => b.dueDay >= 1 && b.dueDay <= 31);
  S.txs = (j.transactions || []).map((t, i) => {
    const c = S.cats.get(t.category);
    return { id: i, date: t.date, description: t.description || '', category: t.category, amount: +t.amount || 0, account: t.account || '', notes: t.notes || '', type: c ? c.group : 'Expense' };
  });
  S.accounts = Array.from(new Set(S.txs.map(t => t.account).filter(Boolean))).sort();
  if (S.account && S.accounts.indexOf(S.account) < 0) S.account = '';
}
const catColor = (name, type) => {
  if (type && type !== 'Expense') return TYPE_COLOR[type] || REST;
  const i = S.expenseCats.indexOf(name);
  return i >= 0 && i < PALETTE.length ? PALETTE[i] : REST;
};

/* ---------- periods and filters ---------- */
function periodRange(p) {
  const t = S.today, ym = monthKey(t);
  switch (p.id) {
    case 'thisMonth': return [ym + '-01', t];
    case 'lastMonth': { const pm = addMonths(ym, -1); return [pm + '-01', pm + '-' + dim(pm)]; }
    case '3m': return [addMonths(ym, -2) + '-01', t];
    case '6m': return [addMonths(ym, -5) + '-01', t];
    case '12m': return [addMonths(ym, -11) + '-01', t];
    case 'ytd': return [t.slice(0, 4) + '-01-01', t];
    case 'all': { const ds = S.txs.map(x => x.date).sort(); return [ds[0] || t, t]; }
    default: { const a = p.from || t, b = p.to || t; return a <= b ? [a, b] : [b, a]; }
  }
}
const SPAN = { thisMonth: 1, lastMonth: 1, '3m': 3, '6m': 6, '12m': 12, ytd: 12 };
function prevRange(p, r) {
  if (p.id === 'all') return null;
  const n = diffDays(r[0], r[1]) + 1;
  if (SPAN[p.id]) {
    const pf = addMonths(monthKey(r[0]), -SPAN[p.id]) + '-01';
    return [pf, addDays(pf, n - 1)];
  }
  return [addDays(r[0], -n), addDays(r[0], -1)];
}
const periodLabel = p => p.id === 'custom' ? 'Custom range' : (PERIODS.find(x => x.id === p.id) || PERIODS[0]).label;
const SHORT = { thisMonth: 'This month', lastMonth: 'Last month', '3m': '3 months', '6m': '6 months', ytd: 'Year to date', '12m': '12 months', all: 'All time', custom: 'Custom' };
function rangeText(r) {
  const a = parse(r[0]), b = parse(r[1]);
  const A = MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate(), B = MONTHS[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + b.getUTCFullYear();
  return A + (a.getUTCFullYear() !== b.getUTCFullYear() ? ', ' + a.getUTCFullYear() : '') + ' – ' + B;
}
const passes = t => (!S.catFilter.size || S.catFilter.has(t.category)) && (!S.account || t.account === S.account);
const inR = (t, r) => t.date >= r[0] && t.date <= r[1];
const sel = r => S.txs.filter(t => inR(t, r) && passes(t));
const monthsIn = r => Math.max(1, Math.round((diffDays(r[0], r[1]) + 1) / 30.44));
const monthsBetween = (a, b) => { const out = []; let k = monthKey(a); const end = monthKey(b); while (k <= end && out.length < 600) { out.push(k); k = addMonths(k, 1); } return out; };

/* ---------- tooltip ---------- */
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.classList.remove('hidden');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 14, top = y - h - 14;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 18;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
const hideTip = () => tip.classList.add('hidden');
document.addEventListener('pointerdown', e => { if (!e.target.closest('.chart')) hideTip(); });

/* ---------- charts (plain SVG) ---------- */
function barPath(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return 'M' + x + ',' + (y + h) + 'L' + x + ',' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
    'L' + (x + w - r) + ',' + y + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'L' + (x + w) + ',' + (y + h) + 'Z';
}
/* Grouped columns. series: [{name,color,values}] · labels: category labels · tipFn(i) -> html */
function barsChart(host, labels, series, tipFn) {
  const w = host.clientWidth || 340, h = 190, pad = { l: 38, r: 4, t: 10, b: 24 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, n = labels.length;
  const sc = niceScale(Math.max(0, ...series.flatMap(s => s.values)));
  const y = v => pad.t + ih - v / sc.max * ih;
  const band = iw / n, bw = Math.min(24, (band - 10) / series.length - 2);
  let g = '';
  sc.ticks.forEach(v => { g += '<line class="gl" x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (pad.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + kfmt(v) + '</text>'; });
  labels.forEach((lb, i) => {
    const cx = pad.l + band * (i + .5), total = series.length * bw + (series.length - 1) * 2;
    series.forEach((s, k) => {
      const v = s.values[i], bh = v / sc.max * ih;
      if (bh > 0.5) g += '<path d="' + barPath(cx - total / 2 + k * (bw + 2), y(v), bw, bh, 4) + '" fill="' + s.color + '"/>';
    });
    if (n <= 8 || i % 2 === 0 || i === n - 1) g += '<text class="ax" x="' + cx + '" y="' + (h - 6) + '" text-anchor="middle">' + esc(lb) + '</text>';
    g += '<rect class="hit" data-i="' + i + '" x="' + (cx - band / 2) + '" y="' + pad.t + '" width="' + band + '" height="' + ih + '"/>';
  });
  host.innerHTML = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img">' + g + '</svg>';
  host.querySelectorAll('.hit').forEach(r => {
    const go = e => { showTip(tipFn(+r.dataset.i), e.clientX, e.clientY); };
    r.addEventListener('pointerenter', go); r.addEventListener('pointerdown', go); r.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
  });
}
/* Two cumulative lines with a crosshair. a: current (to its length), b: previous */
function linesChart(host, a, b, labelFn) {
  const w = host.clientWidth || 340, h = 190, pad = { l: 38, r: 44, t: 10, b: 24 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, N = Math.max(a.length, b.length);
  const sc = niceScale(Math.max(0, ...a, ...b));
  const x = i => pad.l + (N <= 1 ? 0 : i / (N - 1) * iw), y = v => pad.t + ih - v / sc.max * ih;
  const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join('');
  let g = '';
  sc.ticks.forEach(v => { g += '<line class="gl" x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (pad.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + kfmt(v) + '</text>'; });
  [0, Math.floor((N - 1) / 2), N - 1].forEach((i, k) => { g += '<text class="ax" x="' + x(i) + '" y="' + (h - 6) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '">' + esc(labelFn(i)) + '</text>'; });
  if (b.length) g += '<path d="' + path(b) + '" fill="none" stroke="' + C_PREV + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  if (a.length) {
    g += '<path d="' + path(a) + ' L' + x(a.length - 1) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + 'Z" fill="' + C_SPEND + '" opacity=".10"/>';
    g += '<path d="' + path(a) + '" fill="none" stroke="' + C_SPEND + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    const ex = x(a.length - 1), ey = y(a[a.length - 1]);
    g += '<circle cx="' + ex + '" cy="' + ey + '" r="5" fill="' + C_SPEND + '" stroke="#151517" stroke-width="2"/>';
    g += '<text class="lbl" x="' + Math.min(ex + 10, w - 2) + '" y="' + (ey + 4) + '" text-anchor="' + (ex + 10 > w - pad.r + 20 ? 'end' : 'start') + '">' + kfmt(a[a.length - 1]) + '</text>';
  }
  g += '<g id="xh" class="hidden"><line class="gl" id="xhl" y1="' + pad.t + '" y2="' + (pad.t + ih) + '"/><circle id="xha" r="4.5" fill="' + C_SPEND + '" stroke="#151517" stroke-width="2"/><circle id="xhb" r="4.5" fill="' + C_PREV + '" stroke="#151517" stroke-width="2"/></g>';
  g += '<rect class="hit" id="xhit" x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '"/>';
  host.innerHTML = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img">' + g + '</svg>';
  const svg = host.firstChild, hit = $('#xhit', host);
  const move = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * w;
    const i = Math.max(0, Math.min(N - 1, Math.round((px - pad.l) / iw * (N - 1))));
    $('#xh', host).classList.remove('hidden');
    const xx = x(i); $('#xhl', host).setAttribute('x1', xx); $('#xhl', host).setAttribute('x2', xx);
    const ca = $('#xha', host), cb = $('#xhb', host);
    if (i < a.length) { ca.setAttribute('cx', xx); ca.setAttribute('cy', y(a[i])); ca.style.display = ''; } else ca.style.display = 'none';
    if (i < b.length) { cb.setAttribute('cx', xx); cb.setAttribute('cy', y(b[i])); cb.style.display = ''; } else cb.style.display = 'none';
    showTip('<b>' + esc(labelFn(i)) + '</b>' +
      (i < a.length ? '<i style="background:' + C_SPEND + '"></i>This period ' + m0(a[i]) + '<br>' : '') +
      (i < b.length ? '<i style="background:' + C_PREV + '"></i>Previous ' + m0(b[i]) : ''), e.clientX, e.clientY);
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hideTip(); $('#xh', host).classList.add('hidden'); } });
}
/* Donut. items: [{name,value,color}] */
function donut(host, items, total, onPick) {
  const size = 280, cx = size / 2, r = 104, sw = 26;
  let g = '', acc = 0;
  const pt = a => [cx + r * Math.sin(a), cx - r * Math.cos(a)];
  items.forEach((it, i) => {
    const frac = it.value / total, a0 = acc * 2 * Math.PI, a1 = (acc + frac) * 2 * Math.PI; acc += frac;
    const gap = frac >= 0.999 ? 0 : Math.min(2 / r, (a1 - a0) / 3);
    const s = a0 + gap / 2, e = a1 - gap / 2;
    let d;
    if (frac >= 0.999) { d = 'M' + cx + ',' + (cx - r) + 'A' + r + ',' + r + ' 0 1 1 ' + (cx - .01) + ',' + (cx - r); }
    else { const p0 = pt(s), p1 = pt(e); d = 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) + 'A' + r + ',' + r + ' 0 ' + (e - s > Math.PI ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2); }
    g += '<path class="seg-arc" data-i="' + i + '" d="' + d + '" fill="none" stroke="' + it.color + '" stroke-width="' + sw + '"/>';
  });
  g += '<text class="ctr-n" x="' + cx + '" y="' + (cx + 4) + '" text-anchor="middle">' + m0(total) + '</text><text class="ctr-l" x="' + cx + '" y="' + (cx + 24) + '" text-anchor="middle">spent</text>';
  host.innerHTML = '<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" role="img">' + g + '</svg>';
  host.querySelectorAll('.seg-arc').forEach(p => {
    const it = items[+p.dataset.i];
    p.addEventListener('pointerenter', e => showTip('<b>' + esc(it.name) + '</b>' + m2(it.value) + ' · ' + Math.round(it.value / total * 100) + '%', e.clientX, e.clientY));
    p.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
    p.addEventListener('click', () => { hideTip(); onPick(it.name); });
  });
}

/* ---------- reusable pieces ---------- */
function filterBar() {
  const cats = S.catFilter.size === 0 ? 'Categories' : S.catFilter.size === 1 ? Array.from(S.catFilter)[0] : S.catFilter.size + ' categories';
  const caret = '<svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  return '<div class="chips filters">' +
    '<button class="chip on" data-act="pickPeriod">' + '<span class="cl">' + esc(SHORT[S.period.id] || 'Period') + '</span>' + caret + '</button>' +
    '<button class="chip' + (S.catFilter.size ? ' on' : '') + '" data-act="pickCats">' + '<span class="cl">' + esc(cats) + '</span>' + caret + '</button>' +
    (S.accounts.length ? '<button class="chip' + (S.account ? ' on' : '') + '" data-act="pickAcct">' + '<span class="cl">' + esc(S.account || 'Accounts') + '</span>' + caret + '</button>' : '') +
    '</div>';
}
function header(title, sub) {
  const ago = S.updatedAt ? Math.max(0, Math.round((Date.now() - S.updatedAt) / 60000)) : null;
  const upd = S.demo ? 'Demo data' : S.status || (ago === null ? '' : ago < 1 ? 'Updated just now' : 'Updated ' + ago + ' min ago');
  return '<div class="cardhead tight" style="margin-bottom:0"><h1 style="margin-bottom:0">' + esc(title) + '</h1>' +
    (S.demo ? '' : '<button class="chip small" data-act="refresh">Refresh</button>') + '</div>' +
    '<div class="homedate">' + esc(sub) + (upd ? ' · ' + esc(upd) : '') + '</div>' +
    (S.demo ? '<div class="banner">Showing demo data. Connect your Sheet to see your own numbers.</div>' : '');
}
const footer = () => '<div class="ver">Version ' + VERSION + (S.demo ? '' : ' · <button data-act="resetKey">Change key</button>') + '</div>';
function deltaPill(cur, prev, upIsBad, label) {
  if (prev == null || prev <= 0) return '<span class="delta">' + (label || '') + '</span>';
  const pct = (cur - prev) / prev, up = pct > 0.005, down = pct < -0.005;
  const cls = up ? (upIsBad ? 'up' : 'down') : down ? (upIsBad ? 'down' : 'up') : '';
  return '<span class="delta"><span class="pill ' + cls + '">' + (up ? '▲' : down ? '▼' : '•') + ' ' + Math.abs(Math.round(pct * 100)) + '%</span> vs previous period</span>';
}
function txRow(t, showCat) {
  const dot = catColor(t.category, t.type);
  const amt = t.type === 'Income' ? '<div class="a in num">+' + m2(t.amount) + '</div>' : '<div class="a ' + (t.type === 'Expense' ? '' : 'dim') + ' num">' + m2(t.amount) + '</div>';
  return '<div class="item"><span class="dot" style="background:' + dot + '"></span><div class="mid"><div class="t">' + esc(t.description || t.category) + '</div>' +
    '<div class="s">' + (showCat ? esc(t.category) + ' · ' : '') + esc(shortDate(t.date)) + (t.account ? ' · ' + esc(t.account) : '') + '</div></div><div class="r">' + amt + '</div></div>';
}

/* ---------- screens ---------- */
function monthlyData() {
  const r = periodRange(S.period);
  let keys = monthsBetween(r[0], r[1]);
  if (keys.length <= 2) { keys = []; let k = monthKey(r[1]); for (let i = 0; i < 6; i++) { keys.unshift(k); k = addMonths(k, -1); } }
  else if (keys.length > 12) keys = keys.slice(-12);
  const f = S.txs.filter(passes);
  const inc = keys.map(k => sumBy(f.filter(t => monthKey(t.date) === k), 'Income'));
  const exp = keys.map(k => sumBy(f.filter(t => monthKey(t.date) === k), 'Expense'));
  return { keys, inc, exp };
}
function cumulative(range, until) {
  const f = S.txs.filter(t => t.type === 'Expense' && passes(t) && inR(t, range));
  const n = diffDays(range[0], until) + 1, out = []; let run = 0;
  for (let i = 0; i < n; i++) { const d = addDays(range[0], i); f.forEach(t => { if (t.date === d) run += t.amount; }); out.push(run); }
  return out;
}

function renderHome() {
  const r = periodRange(S.period), pr = prevRange(S.period, r);
  const cur = sel(r), prev = pr ? sel(pr) : null;
  const spent = sumBy(cur, 'Expense'), inc = sumBy(cur, 'Income'), saved = inc - spent, rate = inc > 0 ? saved / inc : null;
  const days = diffDays(r[0], r[1]) + 1;
  const byCat = new Map(); cur.forEach(t => { if (t.type === 'Expense') byCat.set(t.category, (byCat.get(t.category) || 0) + t.amount); });
  const top = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
  const big = cur.filter(t => t.type === 'Expense').sort((a, b) => b.amount - a.amount)[0];
  const showCum = days <= 93;
  const el = $('#homeView');
  el.innerHTML = header('Home', periodLabel(S.period) + ' · ' + rangeText(r)) + filterBar() +
    '<div class="card hero"><div class="cap">Spent</div><div class="hero-num">' + m0(spent) + '</div>' + deltaPill(spent, prev ? sumBy(prev, 'Expense') : null, true, 'Across the selected period') + '</div>' +
    '<div class="tiles"><div class="tile"><div class="cap">Income</div><div class="v num">' + m0(inc) + '</div></div>' +
    '<div class="tile"><div class="cap">Saved</div><div class="v num">' + (saved < 0 ? '−' : '') + m0(Math.abs(saved)) + '</div></div>' +
    '<div class="tile"><div class="cap">Savings rate</div><div class="v num">' + (rate == null ? '–' : Math.round(rate * 100) + '%') + '</div></div></div>' +
    '<div class="card"><div class="cardhead"><h2>Income vs spending</h2><button class="chip small" data-act="toggleTable">' + (S.tableView ? 'Chart' : 'Table') + '</button></div><div id="barsHost"></div>' +
    '<div class="legend"><span><i style="background:' + C_INCOME + '"></i>Income</span><span><i style="background:' + C_SPEND + '"></i>Spending</span></div></div>' +
    (showCum ? '<div class="card"><div class="cardhead tight"><h2>Spending pace</h2></div><div class="sub" style="margin-bottom:10px">Running total, day by day</div><div id="cumHost"></div>' +
      '<div class="legend"><span><i style="background:' + C_SPEND + '"></i>This period</span>' + (pr ? '<span><i style="background:' + C_PREV + '"></i>Previous</span>' : '') + '</div></div>'
      : '<div class="card"><div class="cardhead tight"><h2>Monthly average</h2></div><div class="hero-num" style="font-size:34px;margin:6px 0 2px">' + m0(spent / monthsIn(r)) + '</div><div class="sub">spent per month over this period</div></div>') +
    '<div class="card"><div class="cardhead"><h2>Top categories</h2><button class="chip small" data-act="tab" data-v="spend">See all</button></div><div class="list">' +
    (top.length ? top.slice(0, 5).map(c => catRow(c[0], c[1], spent, r, false)).join('') : '<div class="empty">No spending in this period.</div>') + '</div></div>' +
    '<div class="card"><div class="cardhead"><h2>Highlights</h2></div><div class="list">' +
    hl('Average per day', m2(spent / days)) + hl('Transactions', String(cur.filter(t => t.type === 'Expense').length)) +
    (big ? hl('Largest purchase', m2(big.amount) + ' · ' + esc(big.description)) : '') + '</div></div>' + footer();
  drawHomeCharts(r, pr, showCum);
}
const hl = (a, b) => '<div class="item"><div class="mid"><div class="t" style="font-weight:500;color:var(--muted);font-size:15px">' + a + '</div></div><div class="r"><div class="a num" style="font-size:15px">' + b + '</div></div></div>';
function drawHomeCharts(r, pr, showCum) {
  const md = monthlyData(), host = $('#barsHost');
  if (S.tableView) {
    host.innerHTML = '<table class="tbl"><tr><th>Month</th><th>Income</th><th>Spending</th><th>Net</th></tr>' +
      md.keys.map((k, i) => '<tr><td>' + mLabelFull(k) + '</td><td>' + m0(md.inc[i]) + '</td><td>' + m0(md.exp[i]) + '</td><td>' + m0(md.inc[i] - md.exp[i]) + '</td></tr>').join('') + '</table>';
  } else {
    barsChart(host, md.keys.map(mLabel), [{ name: 'Income', color: C_INCOME, values: md.inc }, { name: 'Spending', color: C_SPEND, values: md.exp }],
      i => '<b>' + mLabelFull(md.keys[i]) + '</b><i style="background:' + C_INCOME + '"></i>Income ' + m2(md.inc[i]) + '<br><i style="background:' + C_SPEND + '"></i>Spending ' + m2(md.exp[i]) + '<br>Net ' + m2(md.inc[i] - md.exp[i]));
  }
  if (showCum) {
    const until = r[1] < S.today ? r[1] : S.today;
    const a = cumulative(r, until);
    let b = [];
    if (pr) { const pf = S.period.id === 'thisMonth' ? [pr[0], pr[0].slice(0, 7) + '-' + dim(pr[0].slice(0, 7))] : pr; b = cumulative(pf, pf[1]); }
    linesChart($('#cumHost'), a, b, i => shortDate(addDays(r[0], i)));
  }
}

function catRow(name, value, total, r, withBudget) {
  const color = catColor(name, 'Expense'), c = S.cats.get(name) || {};
  let meter = '';
  if (withBudget && c.target > 0) {
    const budget = c.target * monthsIn(r), p = value / budget;
    const fillc = p > 1 ? 'var(--red)' : p >= 0.9 ? 'var(--warn)' : color;
    meter = '<div class="meter"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%;background:' + fillc + '"></i></div>' +
      '<div class="mrow"><span>' + Math.round(p * 100) + '% of ' + m0(budget) + ' budget</span><span>' + (p > 1 ? 'Over by ' + m0(value - budget) : m0(budget - value) + ' left') + '</span></div>';
  }
  return '<div class="item tap" data-act="openCat" data-v="' + esc(name) + '"><span class="dot" style="background:' + color + '"></span><div class="mid"><div class="t">' + esc(name) + '</div>' +
    '<div class="s">' + (total ? Math.round(value / total * 100) + '% of spending' : '') + '</div>' + meter + '</div><div class="r"><div class="a num">' + m2(value) + '</div></div></div>';
}

function renderSpend() {
  const r = periodRange(S.period), cur = sel(r).filter(t => t.type === 'Expense');
  const total = cur.reduce((s, t) => s + t.amount, 0), by = new Map();
  cur.forEach(t => by.set(t.category, (by.get(t.category) || 0) + t.amount));
  const items = Array.from(by.entries()).map(e => ({ name: e[0], value: e[1], color: catColor(e[0], 'Expense') })).sort((a, b) => b.value - a.value);
  $('#spendView').innerHTML = header('Spending', periodLabel(S.period) + ' · ' + rangeText(r)) + filterBar() +
    (items.length
      ? '<div class="card"><div class="donutwrap" id="donutHost"></div><div class="list">' + items.map(it => catRow(it.name, it.value, total, r, true)).join('') + '</div></div>' +
        '<div class="sub" style="text-align:center;padding:0 12px">Tap a category or a slice to see every transaction in it. Budgets are your monthly target × the months in this period.</div>'
      : '<div class="card"><div class="empty">No spending in this period. Try a longer period or clear the filters.</div></div>') + footer();
  if (items.length) donut($('#donutHost'), items, total, openCategory);
}

function renderActivity(keepSearch) {
  const v = $('#activityView');
  if (!keepSearch) {
    v.innerHTML = header('Activity', 'Every transaction') + filterBar() +
      '<div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input id="q" type="search" placeholder="Search description, category, notes" value="' + esc(S.q) + '"></div>' +
      '<div class="chips" id="typeChips"></div><div id="actList"></div>' + footer();
    $('#q').addEventListener('input', e => { S.q = e.target.value; S.limit = 60; renderActivity(true); });
  }
  $('#typeChips').innerHTML = ['All', 'Expense', 'Income', 'Transfer', 'Savings'].map(t => '<button class="chip' + (S.type === t ? ' on' : '') + '" data-act="type" data-v="' + t + '">' + t + '</button>').join('') +
    '<button class="chip" data-act="sort" data-v="' + (S.sort === 'new' ? 'big' : 'new') + '">Sort: ' + (S.sort === 'new' ? 'Newest' : 'Largest') + '</button>';
  const r = periodRange(S.period), q = S.q.trim().toLowerCase();
  let list = sel(r).filter(t => (S.type === 'All' || t.type === S.type) &&
    (!q || (t.description + ' ' + t.category + ' ' + t.notes + ' ' + t.account).toLowerCase().indexOf(q) >= 0));
  list.sort(S.sort === 'new' ? (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id) : (a, b) => b.amount - a.amount);
  const total = list.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
  let html = '<div class="sub" style="margin:0 4px 6px">' + list.length + ' transaction' + (list.length === 1 ? '' : 's') + (total ? ' · ' + m2(total) + ' spent' : '') + '</div>';
  if (!list.length) html += '<div class="card"><div class="empty">Nothing matches. Try clearing the search or the filters.</div></div>';
  const shown = list.slice(0, S.limit);
  if (S.sort === 'new') {
    let day = '', open = false;
    shown.forEach(t => {
      if (t.date !== day) {
        if (open) html += '</div></div>';
        day = t.date; open = true;
        const dt = list.filter(x => x.date === day && x.type === 'Expense').reduce((s, x) => s + x.amount, 0);
        html += '<div class="daytitle"><span>' + dayLabel(day) + '</span><span class="num">' + (dt ? m2(dt) : '') + '</span></div><div class="card" style="padding:6px 16px;margin-bottom:0"><div class="list">';
      }
      html += txRow(t, true);
    });
    if (open) html += '</div></div>';
  } else if (shown.length) html += '<div class="card"><div class="list">' + shown.map(t => txRow(t, true)).join('') + '</div></div>';
  if (list.length > shown.length) html += '<button class="secondary full" style="margin-top:14px" data-act="more">Show more (' + (list.length - shown.length) + ' left)</button>';
  $('#actList').innerHTML = html;
}

/* recurring charges: bills from Setup + merchants that charge about once a month */
function nextBill(day, today) {
  let k = monthKey(today), c = clampDay(k, day);
  if (c < today) { k = addMonths(k, 1); c = clampDay(k, day); }
  return c;
}
function detectRecurring() {
  const groups = new Map();
  S.txs.filter(t => t.type === 'Expense').forEach(t => {
    const key = t.description.toLowerCase().replace(/[#0-9]+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  const out = [], billNames = S.bills.map(b => b.name.toLowerCase());
  groups.forEach((arr, key) => {
    arr.sort((a, b) => a.date < b.date ? -1 : 1);
    if (arr.length < 2 || new Set(arr.map(t => monthKey(t.date))).size < 2) return;
    const gaps = []; for (let i = 1; i < arr.length; i++) gaps.push(diffDays(arr[i - 1].date, arr[i].date));
    const med = median(gaps), last = arr[arr.length - 1];
    if (med < 26 || med > 35 || diffDays(last.date, S.today) > 50) return;
    const amts = arr.map(t => t.amount), mid = median(amts);
    if (amts.some(x => Math.abs(x - mid) > Math.max(2, mid * 0.2))) return;
    if (billNames.some(n => n.indexOf(key) >= 0 || key.indexOf(n) >= 0)) return;
    let k = monthKey(last.date), d = last.date; const day = +last.date.slice(8);
    while (d < S.today) { k = addMonths(k, 1); d = clampDay(k, day); }
    out.push({ name: last.description, amount: median(arr.slice(-3).map(t => t.amount)), date: d, day: day, source: 'Detected', category: last.category });
  });
  return out;
}
function renderUpcoming() {
  const today = S.today;
  const items = S.bills.map(b => ({ name: b.name, amount: b.amount, date: nextBill(b.dueDay, today), day: b.dueDay, source: 'Bill' })).concat(detectRecurring());
  const events = [];
  items.forEach(it => {
    let d = it.date, k = monthKey(d);
    for (let i = 0; i < 3 && diffDays(today, d) <= 45; i++) { events.push({ name: it.name, amount: it.amount, date: d, source: it.source }); k = addMonths(k, 1); d = clampDay(k, it.day); }
  });
  events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount);
  const within = n => events.filter(e => diffDays(today, e.date) <= n).reduce((s, e) => s + e.amount, 0);
  const monthly = items.reduce((s, it) => s + it.amount, 0);
  const rel = d => { const n = diffDays(today, d); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days'; };
  $('#upcomingView').innerHTML = header('Upcoming', 'Bills and recurring charges') +
    '<div class="card hero"><div class="cap">Due in the next 30 days</div><div class="hero-num">' + m0(within(30)) + '</div><span class="delta">' + m0(within(7)) + ' of it in the next 7 days</span></div>' +
    '<div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><div class="cap">Recurring per month</div><div class="v num">' + m0(monthly) + '</div></div>' +
    '<div class="tile"><div class="cap">Per year</div><div class="v num">' + m0(monthly * 12) + '</div></div></div>' +
    '<div class="card"><div class="cardhead"><h2>Coming up</h2></div><div class="list">' +
    (events.length ? events.map(e => '<div class="item"><div class="mid"><div class="t">' + esc(e.name) + '<span class="tag">' + e.source + '</span></div><div class="s">' + esc(shortDate(e.date)) + '</div></div>' +
      '<div class="r"><div class="a num">' + m2(e.amount) + '</div><div class="s"><span class="badge' + (diffDays(today, e.date) <= 3 ? ' soon' : '') + '">' + rel(e.date) + '</span></div></div></div>').join('') :
      '<div class="empty">Nothing coming up. Add recurring bills on the Setup tab of your Sheet.</div>') + '</div></div>' +
    '<div class="card"><div class="cardhead"><h2>All recurring</h2></div><div class="list">' +
    items.slice().sort((a, b) => b.amount - a.amount).map(it => '<div class="item"><div class="mid"><div class="t">' + esc(it.name) + '<span class="tag">' + it.source + '</span></div><div class="s">Monthly, around the ' + it.day + ordinal(it.day) + '</div></div>' +
      '<div class="r"><div class="a num">' + m2(it.amount) + '</div><div class="s num">' + m0(it.amount * 12) + ' / yr</div></div></div>').join('') + '</div>' +
    '<div class="sub" style="margin-top:12px">“Detected” charges are merchants that billed you about once a month. They can be wrong, so treat them as a guide.</div></div>' + footer();
}
const ordinal = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');

/* ---------- bottom sheets ---------- */
function resetSheetStyle() { $('.sheet').style.cssText = ''; $('#sheetWrap .backdrop').style.opacity = ''; }
function openSheet(html, foot) {
  resetSheetStyle();
  const body = $('#sheetBody'), f = $('#sheetFoot');
  body.innerHTML = html; body.classList.toggle('footed', !!foot);
  f.innerHTML = foot || ''; f.classList.toggle('hidden', !foot);
  $('#sheetWrap').classList.remove('hidden'); body.scrollTop = 0;
}
function closeSheet() { $('#sheetWrap').classList.add('hidden'); resetSheetStyle(); hideTip(); }
/* drag the grey handle down to dismiss */
(function sheetDrag() {
  const sheet = $('.sheet'), back = $('#sheetWrap .backdrop'), zone = $('#grabZone');
  let y0 = 0, t0 = 0, dy = 0, on = false;
  zone.addEventListener('pointerdown', e => { on = true; y0 = e.clientY; t0 = e.timeStamp; dy = 0; zone.setPointerCapture(e.pointerId); sheet.style.animation = 'none'; sheet.style.transition = 'none'; });
  zone.addEventListener('pointermove', e => {
    if (!on) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = 'translateY(' + dy + 'px)';
    back.style.opacity = String(Math.max(0, 1 - dy / Math.max(1, sheet.offsetHeight)));
  });
  const end = e => {
    if (!on) return; on = false;
    const v = dy / Math.max(1, e.timeStamp - t0);
    if (dy > 110 || (v > 0.6 && dy > 30)) { sheet.style.transition = 'transform .2s ease-in'; sheet.style.transform = 'translateY(100%)'; back.style.transition = 'opacity .2s'; back.style.opacity = '0'; setTimeout(() => { back.style.transition = ''; closeSheet(); }, 200); }
    else { sheet.style.transition = 'transform .2s ease-out'; sheet.style.transform = ''; back.style.opacity = ''; }
  };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
})();
let pend = { id: 'thisMonth' };
function markPeriod() { document.querySelectorAll('#sheetBody .opt[data-p]').forEach(o => o.classList.toggle('on', o.dataset.p === pend.id)); }
function pickPeriod() {
  const c = S.period, r = periodRange(c);
  pend = { id: c.id };
  openSheet('<h2 style="margin-bottom:6px">Time period</h2>' +
    PERIODS.map(p => '<div class="opt" data-p="' + p.id + '" data-act="setPeriod" data-v="' + p.id + '">' + p.label + '<span class="ck"></span></div>').join('') +
    '<div class="opt" data-p="custom" data-act="setPeriod" data-v="custom">Custom range<span class="ck"></span></div>' +
    '<div class="daterow"><div><label>From</label><input type="date" id="dFrom" value="' + (c.from || r[0]) + '"></div><div><label>To</label><input type="date" id="dTo" value="' + (c.to || r[1]) + '"></div></div>',
    '<button class="full" data-act="applyPeriod">Apply</button>');
  markPeriod();
}
function pickCats() {
  openSheet('<div class="cardhead"><h2>Categories</h2><button class="chip small" data-act="clearCats">Clear</button></div>' +
    (S.data.categories || []).map(c => '<div class="opt' + (S.catFilter.has(c.name) ? ' on' : '') + '" data-act="toggleCat" data-v="' + esc(c.name) + '"><span style="display:flex;align-items:center;gap:10px"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:' + catColor(c.name, c.group) + '"></span>' + esc(c.name) + '</span><span class="ck"></span></div>').join('') +
    '', '<button class="full" data-act="closeSheet">Done</button>');
}
function pickAcct() {
  openSheet('<h2 style="margin-bottom:6px">Account</h2><div class="opt' + (!S.account ? ' on' : '') + '" data-act="setAcct" data-v="">All accounts<span class="ck"></span></div>' +
    S.accounts.map(a => '<div class="opt' + (S.account === a ? ' on' : '') + '" data-act="setAcct" data-v="' + esc(a) + '">' + esc(a) + '<span class="ck"></span></div>').join(''));
}
let drill = { name: '', sort: 'new' };
function openCategory(name, sort) {
  drill = { name: name, sort: sort || drill.sort || 'new' };
  const r = periodRange(S.period), c = S.cats.get(name) || {}, type = c.group || 'Expense';
  const all = S.txs.filter(t => t.category === name && inR(t, r) && (!S.account || t.account === S.account));
  const total = all.reduce((s, t) => s + t.amount, 0), color = catColor(name, type);
  const list = all.slice().sort(drill.sort === 'new' ? (a, b) => a.date < b.date ? 1 : -1 : (a, b) => b.amount - a.amount);
  openSheet('<div class="cardhead tight"><div style="display:flex;align-items:center;gap:10px;min-width:0"><span class="dot" style="width:12px;height:12px;border-radius:50%;background:' + color + ';flex:none"></span><h2 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(name) + '</h2></div><button class="chip small" data-act="closeSheet">Close</button></div>' +
    '<div class="sub" style="margin-bottom:12px">' + periodLabel(S.period) + ' · ' + rangeText(r) + '</div>' +
    '<div class="tiles"><div class="tile"><div class="cap">Total</div><div class="v num">' + m0(total) + '</div></div><div class="tile"><div class="cap">Transactions</div><div class="v num">' + all.length + '</div></div><div class="tile"><div class="cap">Average</div><div class="v num">' + m0(all.length ? total / all.length : 0) + '</div></div></div>' +
    '<div class="card"><div class="cardhead tight"><h2>Over time</h2></div><div id="drillHost"></div></div>' +
    '<div class="cardhead"><h2>All transactions</h2><div class="seg"><button data-act="drillSort" data-v="new" class="' + (drill.sort === 'new' ? 'on' : '') + '">Newest</button><button data-act="drillSort" data-v="big" class="' + (drill.sort === 'big' ? 'on' : '') + '">Largest</button></div></div>' +
    '<div class="card" style="padding:6px 16px"><div class="list">' + (list.length ? list.slice(0, 200).map(t => txRow(t, false)).join('') : '<div class="empty" style="padding:12px 0">No transactions in this period.</div>') + '</div></div>');
  // bars: months when the period spans 2+ months, otherwise weeks
  const keys = monthsBetween(r[0], r[1]); let labels, vals;
  if (keys.length >= 2) { labels = keys.length > 12 ? keys.slice(-12) : keys; vals = labels.map(k => all.filter(t => monthKey(t.date) === k).reduce((s, t) => s + t.amount, 0)); labels = labels.map(mLabel); }
  else { const n = Math.ceil((diffDays(r[0], r[1]) + 1) / 7); labels = []; vals = []; for (let i = 0; i < n; i++) { const a = addDays(r[0], i * 7), b = addDays(r[0], i * 7 + 6); labels.push(shortDate(a)); vals.push(all.filter(t => t.date >= a && t.date <= b).reduce((s, t) => s + t.amount, 0)); } }
  barsChart($('#drillHost'), labels, [{ name: name, color: color, values: vals }], i => '<b>' + esc(labels[i]) + '</b>' + m2(vals[i]));
}

/* ---------- navigation + events ---------- */
function render() {
  if (!S.data) return;
  const t = S.tab;
  ['home', 'spend', 'activity', 'upcoming'].forEach(v => $('#' + v + 'View').classList.toggle('hidden', v !== t));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === t));
  if (t === 'home') renderHome(); else if (t === 'spend') renderSpend(); else if (t === 'activity') renderActivity(false); else renderUpcoming();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v;
  switch (a) {
    case 'tab': S.tab = v; closeSheet(); render(); scrollTo(0, 0); break;
    case 'pickPeriod': pickPeriod(); break;
    case 'pickCats': pickCats(); break;
    case 'pickAcct': pickAcct(); break;
    case 'setPeriod': pend = { id: v }; markPeriod(); break;
    case 'applyPeriod': {
      if (pend.id === 'custom') { const f = $('#dFrom').value, t = $('#dTo').value; if (!f || !t) break; S.period = { id: 'custom', from: f, to: t }; }
      else S.period = { id: pend.id };
      S.limit = 60; closeSheet(); render(); break;
    }
    case 'toggleCat': if (S.catFilter.has(v)) S.catFilter.delete(v); else S.catFilter.add(v); b.classList.toggle('on'); S.limit = 60; render(); break;
    case 'clearCats': S.catFilter.clear(); closeSheet(); render(); break;
    case 'setAcct': S.account = v; S.limit = 60; closeSheet(); render(); break;
    case 'closeSheet': closeSheet(); break;
    case 'openCat': openCategory(v); break;
    case 'drillSort': openCategory(drill.name, v); break;
    case 'toggleTable': S.tableView = !S.tableView; render(); break;
    case 'type': S.type = v; S.limit = 60; renderActivity(true); break;
    case 'sort': S.sort = v; renderActivity(true); break;
    case 'more': S.limit += 60; renderActivity(true); break;
    case 'refresh': refresh(); break;
    case 'resetKey': localStorage.removeItem('fin_key'); localStorage.removeItem('fin_cache'); location.reload(); break;
    case 'saveKey': saveKey(); break;
    case 'demo': location.search = '?demo=1'; break;
  }
});
document.addEventListener('change', e => { if (e.target.id === 'dFrom' || e.target.id === 'dTo') { pend = { id: 'custom' }; markPeriod(); } });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.data && $('#sheetWrap').classList.contains('hidden') && !$('#app').classList.contains('hidden')) render(); }, 150); });

/* ---------- loading ---------- */
const apiUrl = () => CONFIG.API_URL + (CONFIG.API_URL.indexOf('?') < 0 ? '?' : '&') + 'key=' + encodeURIComponent(localStorage.getItem('fin_key') || '');
function showApp() { $('#setupView').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); }
async function refresh() {
  S.status = 'Updating…'; render();
  try {
    const res = await fetch(apiUrl()), j = await res.json();
    if (j.error) throw new Error(j.error);
    localStorage.setItem('fin_cache', JSON.stringify(j));
    S.updatedAt = Date.now(); S.status = ''; ingest(j); showApp();
  } catch (err) {
    if (String(err.message).indexOf('Bad key') >= 0) { localStorage.removeItem('fin_key'); showSetup('That key was not accepted. Enter it again.'); return; }
    S.status = S.data ? 'Offline, showing saved data' : ''; if (S.data) render(); else showSetup('Could not load your data: ' + err.message);
  }
}
function showSetup(msg) { $('#app').classList.add('hidden'); $('#setupView').classList.remove('hidden'); $('#setupMsg').textContent = msg || ''; }
function saveKey() {
  const k = $('#keyInput').value.trim(); if (!k) return;
  localStorage.setItem('fin_key', k); $('#setupMsg').textContent = 'Connecting…'; refresh();
}

/* ---------- demo data (only used when no Sheet is connected) ---------- */
function makeDemo() {
  const today = localToday(); let seed = 7;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const tx = [], add = (d, description, category, amount, account) => { if (d <= today) tx.push({ date: d, description: description, category: category, amount: amount, account: account, notes: '' }); };
  const cur = monthKey(today);
  for (let m = -6; m <= 0; m++) {
    const k = addMonths(cur, m), D = n => clampDay(k, n);
    add(D(5), 'Destiny paycheck', 'Paycheck', 2310.45, 'Checking'); add(D(19), 'Destiny paycheck', 'Paycheck', 2310.45, 'Checking');
    if (rnd() > .4) add(D(12), 'CDL contract pay', 'Paycheck', between(700, 1300), 'Checking');
    if (rnd() > .6) add(D(22), pick(['Logo design', 'Website fix', 'Photo shoot']), 'Freelance', between(250, 600), 'Checking');
    if (rnd() > .5) add(D(10), 'Zelle cashout', 'Cashout', between(30, 120), 'Checking');
    for (let i = 0; i < 9; i++) add(D(1 + Math.floor(rnd() * 28)), pick(['Safeway', 'Trader Joe\'s', 'Chipotle', 'Starbucks', 'Sushi Ro', 'Costco']), 'Food', between(7, 115), 'Credit card');
    for (let i = 0; i < 3; i++) add(D(3 + i * 9), pick(['Chevron', 'Shell']), 'Gas', between(42, 68), 'Credit card');
    for (let i = 0; i < 3; i++) add(D(2 + Math.floor(rnd() * 26)), pick(['Amazon order', 'Target', 'Best Buy', 'Etsy']), 'Shopping', between(18, 160), 'Credit card');
    add(D(1), 'Netflix', 'Subscriptions', 15.49, 'Credit card'); add(D(1), 'Spotify', 'Subscriptions', 11.99, 'Credit card');
    add(D(9), 'iCloud', 'Subscriptions', 2.99, 'Credit card'); add(D(17), 'Adobe CC', 'Subscriptions', 12.49, 'Credit card'); add(D(26), 'Gamma AI', 'Subscriptions', 25, 'Credit card');
    add(D(7), 'Church tithe', 'Tithe', between(40, 75), 'Checking'); add(D(21), 'Church tithe', 'Tithe', between(40, 75), 'Checking');
    add(D(18), pick(['Haircut', 'Car wash', 'Dry cleaning']), 'Other', between(15, 45), 'Cash');
    add(D(26), 'Credit card payment', 'Credit card payment', between(420, 520), 'Checking'); add(D(28), 'Move to savings', 'Savings', 300, 'Checking');
  }
  return {
    ok: true, today: today, generatedAt: new Date().toISOString(),
    categories: [['Paycheck', 'Income', 0], ['Freelance', 'Income', 0], ['Food', 'Expense', 500], ['Gas', 'Expense', 200], ['Shopping', 'Expense', 250], ['Subscriptions', 'Expense', 60], ['Other', 'Expense', 100], ['Savings', 'Savings', 300], ['Credit card payment', 'Transfer', 0], ['Cashout', 'Income', 0], ['Tithe', 'Expense', 100], ['Transfer', 'Transfer', 0]].map(c => ({ name: c[0], group: c[1], target: c[2] })),
    bills: [{ name: 'Gym membership', amount: 40, dueDay: 8 }, { name: 'Phone bill', amount: 65, dueDay: 15 }, { name: 'Car insurance', amount: 120, dueDay: 20 }],
    transactions: tx
  };
}

/* ---------- start ---------- */
(function start() {
  const demo = /[?&]demo=1/.test(location.search);
  const configured = typeof CONFIG !== 'undefined' && CONFIG.API_URL && CONFIG.API_URL.indexOf('PASTE') !== 0;
  if (demo || !configured) {
    if (!demo && !configured) { showSetupUnconfigured(); return; }
    S.demo = true; S.updatedAt = Date.now(); ingest(makeDemo()); showApp(); return;
  }
  if (!localStorage.getItem('fin_key')) { showSetup(''); return; }
  try { const c = JSON.parse(localStorage.getItem('fin_cache') || 'null'); if (c) { ingest(c); showApp(); } } catch (e) { /* ignore a bad cache */ }
  refresh();
})();
function showSetupUnconfigured() {
  $('#setupView').classList.remove('hidden');
  $('#setupView').innerHTML = '<h1>Money</h1><p class="empty">config.js still needs your Apps Script URL. Until then you can look around with demo data.</p><button class="full" data-act="demo">Try it with demo data</button>';
}
