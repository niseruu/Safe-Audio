(function () {
  'use strict';

  var SA = window.SafeAudio;
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';

  var state = {
    sens: 100, unit: 'mw', z: 32, srcMode: 'v', vout: 1, pmw: 30, load: 32,
    curve: 'linux', pos: 0.5, ranges: { windows: 63.5, alsa: 60, generic: 60 }, offset: -12, preamp: 0, std: 'who'
  };

  /* dB range below max for the curves that have one (Windows minimum, ALSA, custom). */
  function rangeFor(id) { return state.ranges[id] || 60; }

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
    if ((s = num('r', 10, 130)) !== null) { state.ranges.alsa = s; state.ranges.generic = s; }
    if ((s = num('rw', 10, 130)) !== null) state.ranges.windows = s;
    if ((s = num('ra', 10, 130)) !== null) state.ranges.alsa = s;
    if ((s = num('rg', 10, 130)) !== null) state.ranges.generic = s;
    if ((s = num('o', -30, 0)) !== null) state.offset = s;
    if ((s = num('pa', -30, 20)) !== null) state.preamp = s;
    if (SA.STANDARDS[p.get('std')]) state.std = p.get('std');
  }
  function writeHash() {
    var p = new URLSearchParams({
      s: state.sens, u: state.unit, z: state.z, vm: state.vout, sm: state.srcMode, pm: state.pmw, ld: state.load,
      c: state.curve, p: state.pos.toFixed(3), rw: state.ranges.windows, ra: state.ranges.alsa, rg: state.ranges.generic, o: state.offset, pa: state.preamp, std: state.std
    });
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignore */ }
  }

  /* ---------- Formatting ---------- */
  function fmtTime(sec) {
    if (sec === Infinity) return 'Unlimited';
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
  /* Green when safe all day, through amber, to red at 15 dB over the daily limit. Small text is drawn darker for contrast. */
  function levelColor(spl, small) {
    if (!isFinite(spl)) return '';
    return 'hsl(' + Math.round(135 * (1 - SA.risk(spl, state.std))) + ', 85%, ' + (small ? 25 : 31) + '%)';
  }
  var HOURS = { all: Infinity, '8': 28800, '4': 14400, '2': 7200, '1': 3600, '0.5': 1800 };
  /* Level you can listen at for `secs` a day. */
  function levelForSeconds(secs) {
    return secs === Infinity ? SA.UNLIMITED_DB : SA.standardOf(state.std).ref + 3 * Math.log2(28800 / secs);
  }
  /* Loudest volume position that stays within the limit for `secs` a day, never louder than the target. */
  function positionForSeconds(secs) {
    var target = levelForSeconds(secs);
    var top = calc(1).spl;
    if (target >= top) return { pos: 1, level: target, any: true };
    var r = SA.loudestPositionAtOrBelow(state.curve, target - top, { range: rangeFor(state.curve) });
    return { pos: r.pos, step: r.step, level: target, any: false };
  }
  var fmt1 = function (x) { return isFinite(x) ? x.toFixed(1) : '—'; };

  function currentCurve() { return SA.CURVES[state.curve]; }
  function sliderMax() { return currentCurve().steps || 100; }
  /* The level slider runs from 0 dB SPL up to the level at 100% volume. */
  function splMax() { return Math.max(calc(1).spl, 1); }

  /* Set the volume from a target level, snapping to the device's steps if it has them. */
  function setPosFromSpl(spl) {
    var top = calc(1).spl;
    if (spl <= 0) { state.pos = 0; return; }
    var floor = currentCurve().hasRange ? -rangeFor(state.curve) : -Infinity;
    var v = SA.volumeFromDb(state.curve, spl - top, { range: rangeFor(state.curve) }, floor);
    var steps = currentCurve().steps;
    state.pos = steps ? Math.round(v * steps) / steps : v;
  }

  function calc(pos, curve) {
    return SA.compute({
      sens: state.sens, unit: state.unit, z: state.z, vmax: getVmax(),
      curve: curve || state.curve, v: pos, range: rangeFor(curve || state.curve), offset: state.offset + state.preamp
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
    var W = Math.max(280, Math.round(svg.getBoundingClientRect().width || 520));
    var H = Math.round(Math.min(340, Math.max(230, W * 0.64)));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var L = 46, R = 108, T = 8, B = 34;
    var pw = W - L - R, ph = H - T - B;
    var yMax = Math.ceil((spl100 + 3) / 10) * 10;
    var yMin = Math.max(0, yMax - 90);
    var x = function (v) { return L + v * pw; };
    var y = function (s) { return T + (1 - (Math.min(yMax, Math.max(yMin, s)) - yMin) / (yMax - yMin)) * ph; };

    var clip = el('clipPath', { id: 'plot-clip' }, svg);
    el('rect', { x: L, y: T, width: pw, height: ph }, clip);

    var ref = SA.standardOf(state.std).ref, hi = ref + 15;
    if (yMax > hi) el('rect', { x: L, y: y(yMax), width: pw, height: y(hi) - y(yMax), fill: '#d6342b', opacity: .12 }, svg);
    if (yMax > ref) el('rect', { x: L, y: y(Math.min(hi, yMax)), width: pw, height: y(ref) - y(Math.min(hi, yMax)), fill: '#fffa00', opacity: .6 }, svg);

    for (var g = Math.ceil(yMin / 10) * 10; g <= yMax; g += 10) {
      el('line', { x1: L, x2: L + pw, y1: y(g), y2: y(g), class: 'grid' }, svg);
      text(svg, L - 5, y(g) + 3, g, { 'text-anchor': 'end', class: 'tick' });
    }
    for (var q = 0; q <= 100; q += 25) {
      el('line', { x1: x(q / 100), x2: x(q / 100), y1: T, y2: T + ph, class: 'grid' }, svg);
      text(svg, x(q / 100), T + ph + 15, q + '%', { 'text-anchor': 'middle', class: 'tick' });
    }
    el('rect', { x: L, y: T, width: pw, height: ph, fill: 'none', stroke: '#191919', 'stroke-width': 1.5 }, svg);
    el('line', { x1: L, x2: L + pw, y1: y(ref), y2: y(ref), stroke: '#191919', 'stroke-width': 1.2, 'stroke-dasharray': '5 3' }, svg);
    text(svg, L + 5, y(ref) - 4, ref + ' dB: 8 h limit', { 'font-weight': 700 });
    text(svg, L + pw / 2, H - 5, 'Slider position', { 'text-anchor': 'middle', class: 'axis-title' });
    text(svg, 10, T + ph / 2, 'dB SPL', { 'text-anchor': 'middle', class: 'axis-title', transform: 'rotate(-90 10 ' + (T + ph / 2) + ')' });

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
      var yy = T + 12 + idx * 20;
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
    var top = splMax();
    var splSlider = $('spl-slider');
    splSlider.min = 0;
    splSlider.max = top;
    splSlider.value = isFinite(r.spl) ? Math.min(Math.max(r.spl, 0), top) : 0;
    $('spl-out').textContent = isFinite(r.spl) ? r.spl.toFixed(1) + ' dB' : 'Muted';
    $('spl-max-label').textContent = top.toFixed(1) + ' dB max';
    Array.prototype.forEach.call(document.querySelectorAll('[data-hours]'), function (btn) {
      var secs = HOURS[btn.dataset.hours];
      var t = positionForSeconds(secs);
      var where = t.any ? 'any volume'
        : t.pos === 0 ? 'mute only'
        : '≤ ' + (t.step !== null ? 'step ' + t.step + '/' + curve.steps : Math.round(t.pos * 100) + '%');
      btn.lastElementChild.textContent = (secs === Infinity ? '≤ 70 dB' : '≤ ' + Math.round(t.level) + ' dB') + ' · ' + where;
      btn.classList.toggle('is-active', Math.abs(state.pos - t.pos) < 1e-9);
    });
    setPressed(document.querySelectorAll('[data-std]'), function (b) { return b.dataset.std === state.std; });
    $('slider-out').textContent = Math.round(state.pos * 100) + '%' + (curve.steps ? ' (step ' + Math.round(state.pos * max) + ' of ' + max + ')' : '');

    $('range-field').hidden = !curve.hasRange;
    $('range-help').textContent = state.curve === 'alsa'
      ? 'Run "amixer -c 0 contents" in a terminal, find your playback control and read dBscale-min. Enter it without the minus sign.'
      : state.curve === 'windows'
        ? 'Your audio device\'s minimum volume in dB, without the minus sign (it varies by driver). 63.5 comes from one Windows 11 device, so keep it if unsure.'
        : 'Check your device manual for its volume range in dB. 60 is common.';
    $('imp-row').hidden = state.unit !== 'mw';
    $('sens-note').textContent = state.unit === 'mw'
      ? 'Same as ' + (state.sens + 10 * Math.log10(1000 / state.z)).toFixed(1) + ' dB/V at ' + state.z + ' Ω.'
      : 'In dB/V the level depends only on the voltage, so impedance is not needed.';
    $('vout-field').hidden = state.srcMode !== 'v';
    $('pout-field').hidden = state.srcMode !== 'mw';
    $('derived-v').textContent = state.srcMode === 'mw'
      ? 'Works out to ' + getVmax().toFixed(2) + ' V RMS at full volume.' : '';

    setPressed(curveBox.children, function (b) { return b.dataset.curve === state.curve; });
    setPressed(document.querySelectorAll('[data-unit]'), function (b) { return b.dataset.unit === state.unit; });
    setPressed(document.querySelectorAll('[data-srcmode]'), function (b) { return b.dataset.srcmode === state.srcMode; });

    var t = SA.tier(r.spl, state.std);
    $('spl').textContent = isFinite(r.spl) ? r.spl.toFixed(1) : '—';
    var chip = $('tier-chip');
    chip.className = 'chip tier-' + t.n;
    chip.textContent = t.n ? 'Tier ' + t.n + ' / 5' : 'Muted';
    $('tier-text').textContent = t.name;
    $('safe-time').textContent = isFinite(r.spl) ? fmtTime(SA.safeSeconds(r.spl, state.std)) : 'Unlimited';
    $('spl').style.color = levelColor(r.spl);
    $('spl-out').style.color = levelColor(r.spl, true);
    $('limit-note').textContent = SA.standardOf(state.std).note + '.';
    var liveText = isFinite(r.spl) ? r.spl.toFixed(1) + ' decibels, ' + t.name + ', safe for ' + fmtTime(SA.safeSeconds(r.spl, state.std)) + ' a day' : 'Muted';
    var live = $('live');
    if (live.textContent !== liveText) live.textContent = liveText;
    $('att').textContent = isFinite(r.attenuation) ? r.attenuation.toFixed(1) + ' dB' : 'Muted';
    var adj = state.offset + state.preamp;
    $('adj').textContent = (adj > 0 ? '+' : adj < 0 ? '−' : '') + Math.abs(adj).toFixed(1) + ' dB';
    var full = calc(1).spl;
    $('spl-max').textContent = isFinite(full) ? full.toFixed(1) + ' dB' : '—';
    $('volts').textContent = r.volts >= 0.1 ? r.volts.toFixed(2) + ' V' : (r.volts * 1000).toFixed(1) + ' mV';
    $('power').textContent = state.unit !== 'mw' ? '—' : r.powerMw >= 1 ? r.powerMw.toFixed(1) + ' mW' : r.powerMw.toFixed(3) + ' mW';
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
  $('range').addEventListener('input', function (e) {
    state.ranges[state.curve] = readNumber(e.target, 10, 130, rangeFor(state.curve));
    render();
  });
  bindNumber('preamp', 'preamp', -30, 20);

  $('content').addEventListener('change', function (e) { state.offset = parseFloat(e.target.value); render(); });
  $('spl-slider').addEventListener('input', function (e) { setPosFromSpl(parseFloat(e.target.value)); render(); });
  $('slider').addEventListener('input', function (e) { state.pos = parseFloat(e.target.value) / sliderMax(); render(); });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.curve) {
      state.curve = b.dataset.curve;
      $('range').value = rangeFor(state.curve);
      var steps = currentCurve().steps;
      if (steps) state.pos = Math.round(state.pos * steps) / steps;
      render();
    } else if (b.dataset.unit && b.dataset.unit !== state.unit) {
      state.unit = b.dataset.unit;
      render();
    } else if (b.dataset.srcmode && b.dataset.srcmode !== state.srcMode) {
      state.srcMode = b.dataset.srcmode; render();
    } else if (b.dataset.std) {
      state.std = b.dataset.std; render();
    } else if (b.dataset.hours) {
      state.pos = positionForSeconds(HOURS[b.dataset.hours]).pos;
      render();
      b.focus();
    }
  });

  $('share').addEventListener('click', function () {
    var status = $('share-status');
    var done = function (ok) { status.textContent = ok ? 'Link copied' : 'Copy the address bar to share'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(location.href).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { drawChart(calc(1).spl); }, 120);
  });

  /* ---------- Init ---------- */
  readHash();
  $('sens').value = state.sens;
  $('imp').value = state.z;
  $('vmax').value = state.vout;
  $('pmw').value = state.pmw;
  $('load').value = state.load;
  $('range').value = rangeFor(state.curve);
  $('preamp').value = state.preamp;
  $('content').value = String(state.offset);
  if ($('content').value !== String(state.offset)) { $('content').value = '0'; state.offset = 0; }
  render();
})();
