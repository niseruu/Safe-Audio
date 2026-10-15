/* Volume curves and safe-listening maths. Pure functions, no DOM, so they can be tested in Node. */
(function (root) {
  'use strict';

  var clamp = function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); };

  /* Piecewise-linear interpolation of [x, y] points, clamped at both ends. */
  function interpolate(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (var i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        var a = points[i - 1], b = points[i];
        return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
      }
    }
    return points[points.length - 1][1];
  }

  /* AOSP default headset media curve: [volume index %, dB]. */
  var ANDROID_HEADSET = [[1, -49.5], [33, -33.5], [66, -17], [100, 0]];

  /*
   * Each curve returns the attenuation in dB (<= 0) for a slider position v in [0, 1].
   * v = 0 is always mute (-Infinity).
   */
  var CURVES = {
    linear: {
      id: 'linear', label: 'Linear', where: 'Naive model', steps: null, approx: false,
      db: function (v) { return v <= 0 ? -Infinity : 20 * Math.log10(v); },
      note: 'Output voltage is simply slider × max voltage. This is what a naive calculator assumes. No mainstream operating system uses it, and it makes the slider look far louder at the bottom than it really is.'
    },
    linux: {
      id: 'linux', label: 'Linux', where: 'PulseAudio / PipeWire', steps: null, approx: false,
      db: function (v) { return v <= 0 ? -Infinity : 60 * Math.log10(v); },
      note: 'PulseAudio and PipeWire map the slider percentage to amplitude with a cubic curve (amplitude = percent³), which is 60·log10(percent) dB. 50% is −18 dB. Raw ALSA mixers can instead expose the hardware dB scale directly.'
    },
    windows: {
      id: 'windows', label: 'Windows', where: 'Master volume scalar', steps: null, approx: true,
      db: function (v) { return v <= 0 ? -Infinity : 40 * Math.log10(v); },
      note: 'Windows exposes an audio-taper scalar that is not linear in amplitude. Microsoft does not publish the exact curve and it varies with the driver, so this uses amplitude = scalar², which is 40·log10(scalar) dB. 50% is −12 dB. Treat it as an approximation.'
    },
    android: {
      id: 'android', label: 'Android', where: 'AOSP headset curve', steps: 15, approx: true,
      db: function (v) { return v <= 0 ? -Infinity : interpolate(ANDROID_HEADSET, v * 100); },
      note: 'Android music volume has 15 steps, and the framework maps each step to a gain with a table of control points. This uses the AOSP default headset curve (1% → −49.5 dB, 33% → −33.5 dB, 66% → −17 dB, 100% → 0 dB). Manufacturers often change the table, so real devices differ.'
    },
    apple: {
      id: 'apple', label: 'Apple', where: 'iOS / macOS', steps: 16, approx: true,
      db: function (v) {
        if (v <= 0) return -Infinity;
        return 20 * Math.log10((Math.pow(10, 3 * v) - 1) / 999);
      },
      note: 'iOS and macOS use 16 volume steps with an exponential taper. Apple does not publish the gain table, so this is an approximation: amplitude = (10^(3·v) − 1) ÷ 999, giving about −30 dB at step 8 of 16.'
    },
    generic: {
      id: 'generic', label: 'Generic dB', where: 'Straight dB scale', steps: null, approx: false, hasRange: true,
      db: function (v, opts) {
        var range = opts && opts.range > 0 ? opts.range : 60;
        return v <= 0 ? -Infinity : -range * (1 - v);
      },
      note: 'The slider is linear in decibels: 100% is 0 dB and 0% is the range below it. Hardware volume knobs and many pro-audio interfaces behave like this. Set the range to match your device.'
    }
  };

  var ORDER = ['linear', 'linux', 'windows', 'android', 'apple', 'generic'];

  function attenuationDb(curveId, v, opts) {
    return CURVES[curveId].db(clamp(v, 0, 1), opts);
  }

  /* Convert a sensitivity figure to dB SPL per mW. */
  function sensitivityPerMw(sens, unit, impedance) {
    if (unit === 'mw') return sens;
    // dB/V at 1 V delivers 1000/Z mW
    return sens - 10 * Math.log10(1000 / impedance);
  }

  /*
   * p: { sens, unit ('mw'|'v'), z, vmax, curve, v, range, offset }
   * Returns the chain of numbers so the UI can show its working.
   */
  function compute(p) {
    var att = attenuationDb(p.curve, p.v, { range: p.range });
    var sensMw = sensitivityPerMw(p.sens, p.unit, p.z);
    var gain = att === -Infinity ? 0 : Math.pow(10, att / 20);
    var volts = p.vmax * gain;
    var powerMw = (volts * volts / p.z) * 1000;
    var spl = powerMw > 0 ? sensMw + 10 * Math.log10(powerMw) + (p.offset || 0) : -Infinity;
    return { attenuation: att, sensMw: sensMw, gain: gain, volts: volts, powerMw: powerMw, spl: spl };
  }

  /* NIOSH: 85 dBA for 8 h, halving every 3 dB. Returns seconds. */
  function safeSeconds(spl) {
    return 8 * 3600 / Math.pow(2, (spl - 85) / 3);
  }

  function tier(spl) {
    if (!isFinite(spl)) return { n: 0, name: 'Muted' };
    if (spl <= 80) return { n: 1, name: 'Comfortable' };
    if (spl <= 85) return { n: 2, name: 'At the limit' };
    if (spl <= 94) return { n: 3, name: 'Caution' };
    if (spl <= 100) return { n: 4, name: 'High' };
    return { n: 5, name: 'Danger' };
  }

  var api = {
    CURVES: CURVES, ORDER: ORDER, ANDROID_HEADSET: ANDROID_HEADSET,
    attenuationDb: attenuationDb, sensitivityPerMw: sensitivityPerMw,
    compute: compute, safeSeconds: safeSeconds, tier: tier, clamp: clamp
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SafeAudio = api;
})(typeof window !== 'undefined' ? window : this);
