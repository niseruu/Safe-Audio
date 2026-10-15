(function () {
  'use strict';

  var SA = window.SafeAudio;
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';

  /* Illustrative archetypes, not specific products. Check your own spec sheet. */
  var HEADPHONES = [
    { id: 'custom', label: 'Custom' },
    { id: 'iem', label: 'Typical IEM (110 dB/mW, 16 Ω)', s: 110, u: 'mw', z: 16 },
    { id: 'closed', label: 'Typical closed-back (100 dB/mW, 32 Ω)', s: 100, u: 'mw', z: 32 },
    { id: 'planar', label: 'Typical planar (92 dB/mW, 50 Ω)', s: 92, u: 'mw', z: 50 },
    { id: 'hiz', label: 'High-impedance dynamic (96 dB/mW, 250 Ω)', s: 96, u: 'mw', z: 250 }
  ];
  var SOURCES = [
    { id: 'custom', label: 'Custom' },
    { id: 'phone', label: 'Phone headphone output (about 0.5 V)', v: 0.5 },
    { id: 'dongle', label: 'USB-C dongle (about 1 V)', v: 1 },
    { id: 'laptop', label: 'Laptop headphone jack (about 1.5 V)', v: 1.5 },
    { id: 'amp', label: 'Desktop DAC/amp (about 2 V)', v: 2 },
    { id: 'power', label: 'Powerful headphone amp (about 4 V)', v: 4 }
  ];

  var state = {
    sens: 100, unit: 'mw', z: 32, vmax: 1, curve: 'linux',
    pos: 0.5, range: 60, offset: 0, hp: 'closed', src: 'dongle'
  };

  /* ---------- Setup ---------- */
  function fillSelect(el, list) {
    list.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.label; el.appendChild(opt);
    });
  }
  fillSelect($('hp-preset'), HEADPHONES);
  fillSelect($('src-preset'), SOURCES);

  var curveBox = $('curve-buttons');
  SA.ORDER.forEach(function (id) {
    var c = SA.CURVES[id];
    var b = document.createElement('button');
    b.type = 'button'; b.dataset.curve = id;
    b.innerHTML = c.label + '<small>' + c.where + '</small>';
    curveBox.appendChild(b);
  });

  /* ---------- Persistence of setup in the URL hash ---------- */
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('=') === -1) return;
    var p = new URLSearchParams(h);
    var num = function (k, lo, hi) {
      var v = parseFloat(p.get(k));
      return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
    };
    var s;
    if ((s = num('s', 40, 140)) !== null) state.sens = s;
    if (p.get('u') === 'v' || p.get('u') === 'mw') state.unit = p.get('u');
    if ((s = num('z', 1, 2000)) !== null) state.z = s;
    if ((s = num('vm', 0.05, 20)) !== null) state.vmax = s;
    if (SA.CURVES[p.get('c')]) state.curve = p.get('c');
    if ((s = num('p', 0, 1)) !== null) state.pos = s;
    if ((s = num('r', 10, 120)) !== null) state.range = s;
    if ((s = num('o', -30, 0)) !== null) state.offset = s;
    state.hp = 'custom'; state.src = 'custom';
  }
  function writeHash() {
    var p = new URLSearchParams({
      s: state.sens, u: state.unit, z: state.z, vm: state.vmax, c: state.curve,
      p: state.pos.toFixed(3), r: state.range, o: state.offset
    });
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignore */ }
  }

  /* ---------- Formatting ---------- */
  function fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    if (sec > 86400) return 'More than 24 h';
    if (sec < 10) return sec.toFixed(1) + ' s';
    if (sec < 60) return Math.round(sec) + ' s';
    if (sec < 3600) {
      var m = Math.floor(sec / 60), s = Math.round(sec % 60);
      return m + ' min' + (s ? ' ' + s + ' s' : '');
    }
    var h = Math.floor(sec / 3600), mm = Math.round((sec % 3600) / 60);
    if (mm === 60) { h += 1; mm = 0; }
    return h + ' h' + (mm ? ' ' + mm + ' min' : '');
  }
  function fmtShort(sec) {
    if (sec >= 3600) return (sec / 3600) + ' h';
    if (sec >= 60) return (sec / 60) + ' min';
    return sec + ' s';
  }
  var fmt1 = function (x) { return isFinite(x) ? x.toFixed(1) : '—'; };

  /* ---------- Listening log ---------- */
  var LOG_KEY = 'safe-audio:log';
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function loadLog() {
    try {
      var raw = JSON.parse(localStorage.getItem(LOG_KEY));
      if (raw && raw.date === today() && Array.isArray(raw.entries)) return raw;
    } catch (e) { /* ignore */ }
    return { date: today(), entries: [] };
  }
  function saveLog(log) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { /* ignore */ }
  }
  var log = loadLog();

  function dosePct() {
    var total = 0;
    log.entries.forEach(function (e) { total += (e.min * 60) / SA.safeSeconds(e.spl); });
    return total * 100;
  }

  /* ---------- Calculation ---------- */
  function currentCurve() { return SA.CURVES[state.curve]; }
  function sliderMax() { return currentCurve().steps || 100; }

  function calc(pos, curve) {
    return SA.compute({
      sens: state.sens, unit: state.unit, z: state.z, vmax: state.vmax,
      curve: curve || state.curve, v: pos, range: state.range, offset: state.offset
    });
  }

  /* ---------- SVG helpers ---------- */
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }

  /* ---------- Chart: level vs slider, one line per curve ---------- */
  var CURVE_DASH = { linear: '2 5', linux: '', windows: '8 4', android: '', apple: '3 3', generic: '10 3 2 3' };
  var CURVE_GREY = { linear: '#9a9a96', linux: '#444541', windows: '#6f706d', android: '#444541', apple: '#6f706d', generic: '#9a9a96' };

  function drawCurveChart(spl100) {
    var svg = $('curve-chart');
    svg.textContent = '';
    var W = 760, H = 380, L = 54, R = 96, T = 16, B = 44;
    var pw = W - L - R, ph = H - T - B;

    var yMax = Math.ceil((spl100 + 3) / 10) * 10;
    var yMin = Math.max(0, yMax - 90);
    var x = function (v) { return L + v * pw; };
    var y = function (s) { return T + (1 - (Math.min(yMax, Math.max(yMin, s)) - yMin) / (yMax - yMin)) * ph; };

    var clip = el('clipPath', { id: 'plot-clip' }, svg);
    el('rect', { x: L, y: T, width: pw, height: ph }, clip);

    // danger zone above 100 dB, caution 85-100
    if (yMax > 100) el('rect', { x: L, y: y(yMax), width: pw, height: y(100) - y(yMax), fill: '#d6342b', opacity: .1 }, svg);
    if (yMax > 85) el('rect', { x: L, y: y(Math.min(100, yMax)), width: pw, height: y(85) - y(Math.min(100, yMax)), fill: '#fffa00', opacity: .45 }, svg);

    for (var g = Math.ceil(yMin / 10) * 10; g <= yMax; g += 10) {
      el('line', { x1: L, x2: L + pw, y1: y(g), y2: y(g), class: 'grid' }, svg);
      text(svg, L - 8, y(g) + 4, g, { 'text-anchor': 'end', class: 'tick' });
    }
    for (var q = 0; q <= 100; q += 25) {
      el('line', { x1: x(q / 100), x2: x(q / 100), y1: T, y2: T + ph, class: 'grid' }, svg);
      text(svg, x(q / 100), T + ph + 18, q + '%', { 'text-anchor': 'middle', class: 'tick' });
    }
    el('rect', { x: L, y: T, width: pw, height: ph, fill: 'none', stroke: '#191919' }, svg);
    el('line', { x1: L, x2: L + pw, y1: y(85), y2: y(85), stroke: '#191919', 'stroke-width': 1.5, 'stroke-dasharray': '6 3' }, svg);
    text(svg, L + 6, y(85) - 5, '85 dB for 8 h', { 'font-weight': 700 });

    text(svg, L + pw / 2, H - 6, 'Slider position', { 'text-anchor': 'middle', class: 'axis-title' });
    var yt = text(svg, 14, T + ph / 2, 'dB SPL', { 'text-anchor': 'middle', class: 'axis-title', transform: 'rotate(-90 14 ' + (T + ph / 2) + ')' });
    void yt;

    var group = el('g', { 'clip-path': 'url(#plot-clip)', fill: 'none' }, svg);
    var labels = [];
    SA.ORDER.forEach(function (id) {
      if (id === state.curve) return;
      var curve = SA.CURVES[id];
      var pts = [];
      for (var i = 1; i <= 200; i++) {
        var v = i / 200;
        pts.push(x(v).toFixed(1) + ',' + y(calc(v, id).spl).toFixed(1));
      }
      el('polyline', { points: pts.join(' '), stroke: CURVE_GREY[id], 'stroke-width': 1.6, 'stroke-dasharray': CURVE_DASH[id] }, group);
      labels.push({ id: id, y: y(calc(0.999, id).spl) });
    });
    // selected curve on top, with quantised steps drawn as dots
    var sel = currentCurve();
    var spts = [];
    for (var j = 1; j <= 200; j++) {
      var vv = j / 200;
      spts.push(x(vv).toFixed(1) + ',' + y(calc(vv).spl).toFixed(1));
    }
    el('polyline', { points: spts.join(' '), stroke: '#191919', 'stroke-width': 4 }, group);
    if (sel.steps) {
      for (var k = 1; k <= sel.steps; k++) {
        el('circle', { cx: x(k / sel.steps), cy: y(calc(k / sel.steps).spl), r: 3, fill: '#fffa00', stroke: '#191919' }, group);
      }
    }

    // end-of-line labels (all curves meet at 100%, so stack them to the right)
    var order = SA.ORDER.slice();
    order.forEach(function (id, idx) {
      var yy = T + 10 + idx * 16;
      var isSel = id === state.curve;
      el('line', { x1: L + pw + 12, x2: L + pw + 30, y1: yy - 4, y2: yy - 4, stroke: isSel ? '#191919' : CURVE_GREY[id], 'stroke-width': isSel ? 4 : 1.6, 'stroke-dasharray': isSel ? '' : CURVE_DASH[id] }, svg);
      text(svg, L + pw + 36, yy, SA.CURVES[id].label, { 'font-weight': isSel ? 700 : 400 });
    });

    // current position marker
    var cur = calc(state.pos);
    if (isFinite(cur.spl)) {
      el('line', { x1: x(state.pos), x2: x(state.pos), y1: T, y2: T + ph, stroke: '#191919', 'stroke-width': 1 }, svg);
      el('circle', { cx: x(state.pos), cy: y(cur.spl), r: 7, fill: '#fffa00', stroke: '#191919', 'stroke-width': 2 }, svg);
    }
    svg.setAttribute('aria-label', 'Level against slider position for each curve. At ' + Math.round(state.pos * 100) +
      '% on the ' + sel.label + ' curve the level is ' + fmt1(cur.spl) + ' dB SPL.');
  }

  /* ---------- Chart: safe time vs level ---------- */
  function drawTimeChart(spl) {
    var svg = $('time-chart');
    svg.textContent = '';
    var W = 760, H = 380, L = 64, R = 20, T = 16, B = 44;
    var pw = W - L - R, ph = H - T - B;
    var xMin = 70, xMax = 120, yMinLog = 0, yMaxLog = Math.log10(86400);
    var x = function (s) { return L + ((Math.min(xMax, Math.max(xMin, s)) - xMin) / (xMax - xMin)) * pw; };
    var y = function (sec) { return T + (1 - (Math.log10(Math.max(1, Math.min(86400, sec))) - yMinLog) / (yMaxLog - yMinLog)) * ph; };

    el('rect', { x: x(70), y: T, width: x(85) - x(70), height: ph, fill: '#e8eae7' }, svg);
    el('rect', { x: x(85), y: T, width: x(100) - x(85), height: ph, fill: '#fffa00', opacity: .45 }, svg);
    el('rect', { x: x(100), y: T, width: x(120) - x(100), height: ph, fill: '#d6342b', opacity: .12 }, svg);

    [[1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h'], [28800, '8 h'], [86400, '24 h']].forEach(function (t) {
      el('line', { x1: L, x2: L + pw, y1: y(t[0]), y2: y(t[0]), class: 'grid' }, svg);
      text(svg, L - 8, y(t[0]) + 4, t[1], { 'text-anchor': 'end', class: 'tick' });
    });
    for (var g = 70; g <= 120; g += 10) {
      el('line', { x1: x(g), x2: x(g), y1: T, y2: T + ph, class: 'grid' }, svg);
      text(svg, x(g), T + ph + 18, g, { 'text-anchor': 'middle', class: 'tick' });
    }
    el('rect', { x: L, y: T, width: pw, height: ph, fill: 'none', stroke: '#191919' }, svg);
    text(svg, x(77.5), T + 18, 'SAFE', { 'text-anchor': 'middle', class: 'axis-title' });
    text(svg, x(92.5), T + 18, 'CAUTION', { 'text-anchor': 'middle', class: 'axis-title' });
    text(svg, x(110), T + 18, 'DANGER', { 'text-anchor': 'middle', class: 'axis-title' });
    text(svg, L + pw / 2, H - 6, 'Level (dB SPL)', { 'text-anchor': 'middle', class: 'axis-title' });
    text(svg, 12, T + ph / 2, 'Safe time per day', { 'text-anchor': 'middle', class: 'axis-title', transform: 'rotate(-90 12 ' + (T + ph / 2) + ')' });

    var pts = [];
    for (var s = xMin; s <= xMax; s += 0.5) pts.push(x(s).toFixed(1) + ',' + y(SA.safeSeconds(s)).toFixed(1));
    el('polyline', { points: pts.join(' '), fill: 'none', stroke: '#191919', 'stroke-width': 3 }, svg);

    if (isFinite(spl)) {
      var cx = x(spl), cy = y(SA.safeSeconds(spl));
      el('line', { x1: cx, x2: cx, y1: T, y2: T + ph, stroke: '#191919', 'stroke-dasharray': '4 3' }, svg);
      el('circle', { cx: cx, cy: cy, r: 8, fill: '#fffa00', stroke: '#191919', 'stroke-width': 2 }, svg);
    }
    svg.setAttribute('aria-label', 'Safe daily listening time against level. At ' + fmt1(spl) + ' dB the safe time is ' + fmtTime(SA.safeSeconds(spl)) + '.');
  }

  /* ---------- Limits table ---------- */
  var TABLE_LEVELS = [82, 85, 88, 91, 94, 97, 100, 103, 106, 109, 112, 115, 118];
  function drawTable(spl) {
    var body = $('limit-table');
    body.textContent = '';
    var cur = null;
    if (isFinite(spl)) {
      TABLE_LEVELS.forEach(function (l) { if (l <= spl && (cur === null || l > cur)) cur = l; });
    }
    TABLE_LEVELS.forEach(function (l) {
      var tr = document.createElement('tr');
      if (l === cur) tr.className = 'is-current';
      var a = document.createElement('td'); a.textContent = l + ' dB';
      var b = document.createElement('td'); b.textContent = fmtTime(SA.safeSeconds(l));
      tr.appendChild(a); tr.appendChild(b); body.appendChild(tr);
    });
  }

  /* ---------- Render ---------- */
  function render() {
    var curve = currentCurve();
    var r = calc(state.pos);

    // slider sync
    var max = sliderMax();
    var slider = $('slider');
    slider.max = max;
    slider.value = Math.round(state.pos * max);
    $('slider-out').textContent = Math.round(state.pos * 100) + '%' + (curve.steps ? ' (step ' + Math.round(state.pos * max) + ' of ' + max + ')' : '');

    $('range-field').hidden = !curve.hasRange;
    Array.prototype.forEach.call(curveBox.children, function (b) {
      var on = b.dataset.curve === state.curve;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-unit]'), function (b) {
      var on = b.dataset.unit === state.unit;
      b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on);
    });

    // readout
    var t = SA.tier(r.spl);
    $('spl').textContent = isFinite(r.spl) ? r.spl.toFixed(1) : '—';
    var chip = $('tier-chip');
    chip.className = 'chip tier-' + t.n;
    chip.textContent = t.n ? 'Tier ' + t.n + ' / 5' : 'Muted';
    $('tier-text').textContent = t.name;
    $('safe-time').textContent = isFinite(r.spl) ? fmtTime(SA.safeSeconds(r.spl)) : 'Unlimited';
    $('att').textContent = isFinite(r.attenuation) ? r.attenuation.toFixed(1) + ' dB' : 'Muted';
    $('volts').textContent = r.volts >= 0.1 ? r.volts.toFixed(2) + ' V' : (r.volts * 1000).toFixed(1) + ' mV';
    $('power').textContent = r.powerMw >= 1 ? r.powerMw.toFixed(1) + ' mW' : r.powerMw.toFixed(3) + ' mW';

    $('curve-note').textContent = curve.note + (curve.approx ? ' (Approximation.)' : '');

    var full = calc(1);
    drawCurveChart(full.spl);
    drawTimeChart(r.spl);
    drawTable(r.spl);
    renderDose();
    writeHash();
  }

  function renderDose() {
    var pct = dosePct();
    $('dose-pct').textContent = (pct < 10 ? pct.toFixed(1) : Math.round(pct)) + '%';
    $('dose-text').textContent = pct >= 100 ? 'over the daily allowance' : pct >= 85 ? 'caution, nearly at the limit' : 'of the daily allowance';
    var fill = $('dose-fill');
    fill.style.width = Math.min(100, pct) + '%';
    fill.className = pct >= 100 ? 'is-over' : pct >= 85 ? 'is-caution' : '';
    var bar = $('dose-bar');
    bar.setAttribute('aria-valuenow', Math.round(Math.min(100, pct)));
    bar.setAttribute('aria-valuetext', Math.round(pct) + ' percent of the daily allowance');
    $('log-count').textContent = log.entries.length ? log.entries.length + ' session' + (log.entries.length > 1 ? 's' : '') + ' today' : 'Nothing logged today';
  }

  /* ---------- Events ---------- */
  function readNumber(input, lo, hi, fallback) {
    var v = parseFloat(input.value);
    return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  }

  $('hp-preset').addEventListener('change', function (e) {
    var p = HEADPHONES.filter(function (h) { return h.id === e.target.value; })[0];
    state.hp = p.id;
    if (p.s) { state.sens = p.s; state.unit = p.u; state.z = p.z; $('sens').value = p.s; $('imp').value = p.z; }
    render();
  });
  $('src-preset').addEventListener('change', function (e) {
    var p = SOURCES.filter(function (s) { return s.id === e.target.value; })[0];
    state.src = p.id;
    if (p.v) { state.vmax = p.v; $('vmax').value = p.v; }
    render();
  });
  $('sens').addEventListener('input', function (e) {
    state.sens = readNumber(e.target, 40, 140, state.sens); $('hp-preset').value = 'custom'; render();
  });
  $('imp').addEventListener('input', function (e) {
    state.z = readNumber(e.target, 1, 2000, state.z); $('hp-preset').value = 'custom'; render();
  });
  $('vmax').addEventListener('input', function (e) {
    state.vmax = readNumber(e.target, 0.05, 20, state.vmax); $('src-preset').value = 'custom'; render();
  });
  $('range').addEventListener('input', function (e) {
    state.range = readNumber(e.target, 10, 120, state.range); render();
  });
  $('content').addEventListener('change', function (e) { state.offset = parseFloat(e.target.value); render(); });
  $('slider').addEventListener('input', function (e) {
    state.pos = parseFloat(e.target.value) / sliderMax(); render();
  });
  curveBox.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.curve = b.dataset.curve;
    var steps = currentCurve().steps;
    if (steps) state.pos = Math.round(state.pos * steps) / steps;
    render();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.unit && b.dataset.unit !== state.unit) {
      // keep the spec-sheet number meaningful when switching units
      var perMw = SA.sensitivityPerMw(state.sens, state.unit, state.z);
      state.unit = b.dataset.unit;
      state.sens = state.unit === 'mw' ? perMw : perMw + 10 * Math.log10(1000 / state.z);
      state.sens = Math.round(state.sens * 10) / 10;
      $('sens').value = state.sens;
      render();
    } else if (b.dataset.pos) {
      var c = currentCurve();
      state.pos = c.steps ? Math.round(parseFloat(b.dataset.pos) * c.steps) / c.steps : parseFloat(b.dataset.pos);
      render();
    } else if (b.dataset.add) {
      $('minutes').value = b.dataset.add; addEntry(parseFloat(b.dataset.add));
    }
  });

  function addEntry(min) {
    var r = calc(state.pos);
    if (!isFinite(r.spl)) return;
    if (log.date !== today()) log = { date: today(), entries: [] };
    log.entries.push({ min: min, spl: Math.round(r.spl * 10) / 10 });
    saveLog(log); renderDose();
  }
  $('add').addEventListener('click', function () {
    var m = readNumber($('minutes'), 1, 1440, 30);
    addEntry(m);
  });
  $('undo').addEventListener('click', function () { log.entries.pop(); saveLog(log); renderDose(); });
  $('reset').addEventListener('click', function () { log = { date: today(), entries: [] }; saveLog(log); renderDose(); });

  $('share').addEventListener('click', function () {
    var status = $('share-status');
    var done = function (ok) { status.textContent = ok ? 'Link copied.' : 'Copy the address bar to share this setup.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(location.href).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  });

  /* ---------- Init ---------- */
  readHash();
  var hpMatch = HEADPHONES.filter(function (h) { return h.s === state.sens && h.u === state.unit && h.z === state.z; })[0];
  var srcMatch = SOURCES.filter(function (s) { return s.v === state.vmax; })[0];
  if (!location.hash) {
    // first visit defaults: closed-back headphone from a dongle
    var d = HEADPHONES.filter(function (h) { return h.id === 'closed'; })[0];
    state.sens = d.s; state.unit = d.u; state.z = d.z; state.vmax = 1; state.hp = 'closed'; state.src = 'dongle';
  } else {
    state.hp = hpMatch ? hpMatch.id : 'custom';
    state.src = srcMatch ? srcMatch.id : 'custom';
  }
  $('hp-preset').value = state.hp;
  $('src-preset').value = state.src;
  $('sens').value = state.sens;
  $('imp').value = state.z;
  $('vmax').value = state.vmax;
  $('range').value = state.range;
  $('content').value = String(state.offset);
  if ($('content').value !== String(state.offset)) { $('content').value = '0'; state.offset = 0; }
  render();
})();
