(function () {
  'use strict';

  var SA = window.SafeAudio;
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';

  var state = {
    sens: 100, unit: 'mw', z: 32, srcMode: 'v', vout: 1, pmw: 30, load: 32,
    curve: 'linux', pos: 0.5, range: 60, offset: 0
  };

  /* Max RMS voltage at 100% volume, from whichever form the spec sheet used. */
  function getVmax() {
    return state.srcMode === 'v' ? state.vout : Math.sqrt((state.pmw / 1000) * state.load);
  }

  var curveBox = $('curve-buttons');
  SA.ORDER.forEach(function (id) {
    var c = SA.CURVES[id];
    var b = document.createElement('button');
    b.type = 'button'; b.dataset.curve = id;
    b.innerHTML = c.label + '<small>' + c.where + '</small>';
    curveBox.appendChild(b);
  });

  /* ---------- Setup stored in the URL hash, so a copied link restores it ---------- */
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
    if ((s = num('vm', 0.05, 20)) !== null) state.vout = s;
    if (p.get('sm') === 'mw' || p.get('sm') === 'v') state.srcMode = p.get('sm');
    if ((s = num('pm', 0.1, 5000)) !== null) state.pmw = s;
    if ((s = num('ld', 1, 2000)) !== null) state.load = s;
    if (SA.CURVES[p.get('c')]) state.curve = p.get('c');
    if ((s = num('p', 0, 1)) !== null) state.pos = s;
    if ((s = num('r', 10, 120)) !== null) state.range = s;
    if ((s = num('o', -30, 0)) !== null) state.offset = s;
  }
  function writeHash() {
    var p = new URLSearchParams({
      s: state.sens, u: state.unit, z: state.z, vm: state.vout, sm: state.srcMode, pm: state.pmw, ld: state.load,
      c: state.curve, p: state.pos.toFixed(3), r: state.range, o: state.offset
    });
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignore */ }
  }

  /* ---------- Formatting ---------- */
  function fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    if (sec > 86400) return 'Over 24 h';
    if (sec < 10) return sec.toFixed(1) + ' s';
    if (sec < 60) return Math.round(sec) + ' s';
    if (sec < 3600) {
      var m = Math.floor(sec / 60), s = Math.round(sec % 60);
      if (s === 60) { m += 1; s = 0; }
      return m + ' min' + (s ? ' ' + s + ' s' : '');
    }
    var h = Math.floor(sec / 3600), mm = Math.round((sec % 3600) / 60);
    if (mm === 60) { h += 1; mm = 0; }
    return h + ' h' + (mm ? ' ' + mm + ' min' : '');
  }
  var fmt1 = function (x) { return isFinite(x) ? x.toFixed(1) : '—'; };

  function currentCurve() { return SA.CURVES[state.curve]; }
  function sliderMax() { return currentCurve().steps || 100; }

  function calc(pos, curve) {
    return SA.compute({
      sens: state.sens, unit: state.unit, z: state.z, vmax: getVmax(),
      curve: curve || state.curve, v: pos, range: state.range, offset: state.offset
    });
  }

  /* ---------- Chart: level vs slider position, one line per curve ---------- */
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

  var CURVE_DASH = { linear: '2 4', windows: '7 3', android: '', apple: '3 3', linux: '', alsa: '5 2 2 2', generic: '9 3 2 3' };
  var CURVE_GREY = { linear: '#9a9a96', windows: '#6f706d', android: '#444541', apple: '#6f706d', linux: '#444541', alsa: '#6f706d', generic: '#9a9a96' };

  function drawChart(spl100) {
    var svg = $('curve-chart');
    svg.textContent = '';
    var W = 520, H = 270, L = 38, R = 106, T = 8, B = 34;
    var pw = W - L - R, ph = H - T - B;
    var yMax = Math.ceil((spl100 + 3) / 10) * 10;
    var yMin = Math.max(0, yMax - 90);
    var x = function (v) { return L + v * pw; };
    var y = function (s) { return T + (1 - (Math.min(yMax, Math.max(yMin, s)) - yMin) / (yMax - yMin)) * ph; };

    var clip = el('clipPath', { id: 'plot-clip' }, svg);
    el('rect', { x: L, y: T, width: pw, height: ph }, clip);

    if (yMax > 100) el('rect', { x: L, y: y(yMax), width: pw, height: y(100) - y(yMax), fill: '#d6342b', opacity: .12 }, svg);
    if (yMax > 85) el('rect', { x: L, y: y(Math.min(100, yMax)), width: pw, height: y(85) - y(Math.min(100, yMax)), fill: '#fffa00', opacity: .6 }, svg);

    for (var g = Math.ceil(yMin / 10) * 10; g <= yMax; g += 10) {
      el('line', { x1: L, x2: L + pw, y1: y(g), y2: y(g), class: 'grid' }, svg);
      text(svg, L - 5, y(g) + 3, g, { 'text-anchor': 'end', class: 'tick' });
    }
    for (var q = 0; q <= 100; q += 25) {
      el('line', { x1: x(q / 100), x2: x(q / 100), y1: T, y2: T + ph, class: 'grid' }, svg);
      text(svg, x(q / 100), T + ph + 15, q + '%', { 'text-anchor': 'middle', class: 'tick' });
    }
    el('rect', { x: L, y: T, width: pw, height: ph, fill: 'none', stroke: '#191919', 'stroke-width': 1.5 }, svg);
    el('line', { x1: L, x2: L + pw, y1: y(85), y2: y(85), stroke: '#191919', 'stroke-width': 1.2, 'stroke-dasharray': '5 3' }, svg);
    text(svg, L + 5, y(85) - 4, '85 dB: 8 h limit', { 'font-weight': 700 });
    text(svg, L + pw / 2, H - 5, 'Slider position (dB SPL up the side)', { 'text-anchor': 'middle', class: 'axis-title' });

    var group = el('g', { 'clip-path': 'url(#plot-clip)', fill: 'none' }, svg);
    var line = function (id, bold) {
      var pts = [];
      for (var i = 1; i <= 160; i++) pts.push(x(i / 160).toFixed(1) + ',' + y(calc(i / 160, id).spl).toFixed(1));
      el('polyline', {
        points: pts.join(' '), stroke: bold ? '#191919' : CURVE_GREY[id],
        'stroke-width': bold ? 3.5 : 1.4, 'stroke-dasharray': bold ? '' : CURVE_DASH[id]
      }, group);
    };
    SA.ORDER.forEach(function (id) { if (id !== state.curve) line(id, false); });
    line(state.curve, true);

    var sel = currentCurve();
    if (sel.steps) {
      for (var k = 1; k <= sel.steps; k++) {
        el('circle', { cx: x(k / sel.steps), cy: y(calc(k / sel.steps).spl), r: 2.5, fill: '#fffa00', stroke: '#191919' }, group);
      }
    }

    SA.ORDER.forEach(function (id, idx) {
      var yy = T + 12 + idx * 18;
      var isSel = id === state.curve;
      el('line', {
        x1: L + pw + 8, x2: L + pw + 24, y1: yy - 3, y2: yy - 3,
        stroke: isSel ? '#191919' : CURVE_GREY[id], 'stroke-width': isSel ? 3.5 : 1.4, 'stroke-dasharray': isSel ? '' : CURVE_DASH[id]
      }, svg);
      text(svg, L + pw + 30, yy, SA.CURVES[id].label, { 'font-weight': isSel ? 700 : 400 });
    });

    var cur = calc(state.pos);
    if (isFinite(cur.spl)) {
      el('line', { x1: x(state.pos), x2: x(state.pos), y1: T, y2: T + ph, stroke: '#191919', 'stroke-width': 1 }, svg);
      el('circle', { cx: x(state.pos), cy: y(cur.spl), r: 5.5, fill: '#fffa00', stroke: '#191919', 'stroke-width': 2 }, svg);
    }
    svg.setAttribute('aria-label', 'Level against slider position for each curve. At ' + Math.round(state.pos * 100) +
      '% on the ' + sel.label + ' curve the level is ' + fmt1(cur.spl) + ' dB SPL.');
  }

  /* ---------- Render ---------- */
  function setPressed(nodes, on) {
    Array.prototype.forEach.call(nodes, function (b) {
      var active = on(b);
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active);
    });
  }

  function render() {
    var curve = currentCurve();
    var r = calc(state.pos);

    var max = sliderMax();
    var slider = $('slider');
    slider.max = max;
    slider.value = Math.round(state.pos * max);
    $('slider-out').textContent = Math.round(state.pos * 100) + '%' + (curve.steps ? ' (step ' + Math.round(state.pos * max) + ' of ' + max + ')' : '');

    $('range-field').hidden = !curve.hasRange;
    $('range-help').textContent = state.curve === 'alsa'
      ? 'Run "amixer -c 0 contents" in a terminal, find your playback control and read dBscale-min. Enter it without the minus sign.'
      : 'Check your device manual for its volume range in dB. 60 is common.';
    $('vout-field').hidden = state.srcMode !== 'v';
    $('pout-field').hidden = state.srcMode !== 'mw';
    $('derived-v').textContent = state.srcMode === 'mw'
      ? 'Works out to ' + getVmax().toFixed(2) + ' V RMS at full volume.' : '';

    setPressed(curveBox.children, function (b) { return b.dataset.curve === state.curve; });
    setPressed(document.querySelectorAll('[data-unit]'), function (b) { return b.dataset.unit === state.unit; });
    setPressed(document.querySelectorAll('[data-srcmode]'), function (b) { return b.dataset.srcmode === state.srcMode; });

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

    drawChart(calc(1).spl);
    writeHash();
  }

  /* ---------- Events ---------- */
  function readNumber(input, lo, hi, fallback) {
    var v = parseFloat(input.value);
    return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  }
  var bindNumber = function (id, key, lo, hi) {
    $(id).addEventListener('input', function (e) { state[key] = readNumber(e.target, lo, hi, state[key]); render(); });
  };
  bindNumber('sens', 'sens', 40, 140);
  bindNumber('imp', 'z', 1, 2000);
  bindNumber('vmax', 'vout', 0.05, 20);
  bindNumber('pmw', 'pmw', 0.1, 5000);
  bindNumber('load', 'load', 1, 2000);
  bindNumber('range', 'range', 10, 120);

  $('content').addEventListener('change', function (e) { state.offset = parseFloat(e.target.value); render(); });
  $('slider').addEventListener('input', function (e) { state.pos = parseFloat(e.target.value) / sliderMax(); render(); });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.curve) {
      state.curve = b.dataset.curve;
      var steps = currentCurve().steps;
      if (steps) state.pos = Math.round(state.pos * steps) / steps;
      render();
    } else if (b.dataset.unit && b.dataset.unit !== state.unit) {
      // keep the same physical headphone when switching units
      var perMw = SA.sensitivityPerMw(state.sens, state.unit, state.z);
      state.unit = b.dataset.unit;
      state.sens = Math.round((state.unit === 'mw' ? perMw : perMw + 10 * Math.log10(1000 / state.z)) * 10) / 10;
      $('sens').value = state.sens;
      render();
    } else if (b.dataset.srcmode && b.dataset.srcmode !== state.srcMode) {
      state.srcMode = b.dataset.srcmode; render();
    } else if (b.dataset.pos) {
      var c = currentCurve();
      var p = parseFloat(b.dataset.pos);
      state.pos = c.steps ? Math.round(p * c.steps) / c.steps : p;
      render();
    }
  });

  $('share').addEventListener('click', function () {
    var status = $('share-status');
    var done = function (ok) { status.textContent = ok ? 'Link copied' : 'Copy the address bar to share'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(location.href).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  });

  /* ---------- Init ---------- */
  readHash();
  $('sens').value = state.sens;
  $('imp').value = state.z;
  $('vmax').value = state.vout;
  $('pmw').value = state.pmw;
  $('load').value = state.load;
  $('range').value = state.range;
  $('content').value = String(state.offset);
  if ($('content').value !== String(state.offset)) { $('content').value = '0'; state.offset = 0; }
  render();
})();
