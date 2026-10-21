/* Volume curves and safe-listening maths. Pure functions, no DOM, so they can be tested in Node. */
(function (root) {
  'use strict';

  var clamp = function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); };

  /* The dB range a curve was given, or its default. */
  function rangeOf(opts, fallback) { return opts && opts.range > 0 ? opts.range : fallback; }

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

  /*
   * AOSP DEFAULT_MEDIA_VOLUME_CURVE: [curve index, dB]. STREAM_MUSIC uses it for every device
   * category except hearing aids (audio_policy_volumes.xml, default_volume_tables.xml).
   */
  var ANDROID_MEDIA = [[1, -58], [20, -40], [60, -17], [100, 0]];
  var ANDROID_STEPS = 15;
  /* AudioPolicy's VolumeCurve::volIndexToDb: integer curve index = 100 * step / steps, then linear in dB. */
  function androidStepDb(step) {
    if (step <= 0) return -Infinity;
    return interpolate(ANDROID_MEDIA, Math.floor(100 * step / ANDROID_STEPS));
  }

  /*
   * Each curve returns the attenuation in dB (<= 0) for a slider position v in [0, 1].
   * v = 0 is always mute (-Infinity).
   */
  var CURVES = {
    linear: {
      id: 'linear', label: 'Linear', where: 'Naive model', steps: null, approx: false,
      db: function (v) { return v <= 0 ? -Infinity : 20 * Math.log10(v); },
      vol: function (db) { return Math.pow(10, db / 20); },
      note: 'Output voltage is simply slider × max voltage. This is what a naive calculator assumes. No mainstream operating system uses it, and it makes the slider look far louder at the bottom than it really is.'
    },
    linux: {
      id: 'linux', label: 'Linux', where: 'PulseAudio / PipeWire', steps: null, approx: false,
      db: function (v) { return v <= 0 ? -Infinity : 60 * Math.log10(v); },
      vol: function (db) { return Math.pow(10, db / 60); },
      note: 'PulseAudio and PipeWire map the slider percentage to amplitude with a cubic curve (amplitude = percent³), which is 60·log10(percent) dB. 50% is −18 dB. Raw ALSA mixers can instead expose the hardware dB scale directly.'
    },
    windows: {
      id: 'windows', label: 'Windows', where: 'Master volume, 1.75 taper', steps: null, approx: true, hasRange: true, defaultRange: 63.5,
      db: function (v, opts) {
        if (v <= 0) return -Infinity;
        var a = Math.pow(10, -rangeOf(opts, 63.5) / 35);
        return 35 * Math.log10(a + (1 - a) * v);
      },
      vol: function (db, opts) {
        var a = Math.pow(10, -rangeOf(opts, 63.5) / 35);
        return (Math.pow(10, db / 35) - a) / (1 - a);
      },
      note: 'Microsoft does not publish this curve. This models a 1.75-power taper from the device\'s minimum dB to 0 dB: 35 · log10(a + (1 − a) · slider), with a = 10^(minimum ÷ 35). It matches the one public measurement found (−10.3047 dB at 50% on a −63.5 dB device).'
    },
    android: {
      id: 'android', label: 'Android', where: 'AOSP music curve', steps: ANDROID_STEPS, approx: true,
      db: function (v) { return androidStepDb(Math.round(v * ANDROID_STEPS)); },
      vol: function (db) {
        var swapped = ANDROID_MEDIA.map(function (pt) { return [pt[1], pt[0]]; });
        return interpolate(swapped, db) / 100;
      },
      note: 'Android music volume has 15 steps by default, and each step goes through the AOSP media curve: index 1 is −58 dB, 20 is −40 dB, 60 is −17 dB and 100 is 0 dB, linear in dB between them, with step 0 muting. Wired, USB and Bluetooth-headset music all use it. Phone makers can change the steps or the table, and Bluetooth headphones with absolute volume apply their own curve instead.'
    },
    apple: {
      id: 'apple', label: 'Apple', where: 'iOS / macOS', steps: 16, approx: true,
      db: function (v) {
        if (v <= 0) return -Infinity;
        return 20 * Math.log10((Math.pow(10, 3 * v) - 1) / 999);
      },
      vol: function (db) { return Math.log10(999 * Math.pow(10, db / 20) + 1) / 3; },
      note: 'iOS and macOS use 16 volume steps with an exponential taper. Apple does not publish the gain table, so this is an approximation: amplitude = (10^(3·v) − 1) ÷ 999, giving about −30 dB at step 8 of 16.'
    },
    alsa: {
      id: 'alsa', label: 'Linux driver', where: 'ALSA, driver specific', steps: null, approx: false, hasRange: true, defaultRange: 60,
      db: function (v, opts) {
        var range = opts && opts.range > 0 ? opts.range : 60;
        return v <= 0 ? -Infinity : -range * (1 - v);
      },
      vol: function (db, opts) { return 1 + db / (opts && opts.range > 0 ? opts.range : 60); },
      note: 'ALSA exposes each driver\'s own hardware dB scale, and the slider is linear in dB between the control\'s minimum and 0 dB. The range depends on the codec or DAC. alsamixer\'s percentage is not always linear in dB, so this models the raw dB scale.'
    },
    generic: {
      id: 'generic', label: 'Custom dB', where: 'Any other device', steps: null, approx: false, hasRange: true, defaultRange: 60,
      db: function (v, opts) {
        var range = opts && opts.range > 0 ? opts.range : 60;
        return v <= 0 ? -Infinity : -range * (1 - v);
      },
      vol: function (db, opts) { return 1 + db / (opts && opts.range > 0 ? opts.range : 60); },
      note: 'For anything else, such as a hardware knob or a player with its own volume scale: the slider is linear in decibels, 100% is 0 dB and 0% is the range below it. Enter the range that matches your device.'
    }
  };

  var ORDER = ['linear', 'windows', 'android', 'apple', 'linux', 'alsa', 'generic'];

  function attenuationDb(curveId, v, opts) {
    return CURVES[curveId].db(clamp(v, 0, 1), opts);
  }

  /*
   * Inverse of attenuationDb: the slider position (0 to 1) that gives `db`.
   * `floorDb` is the bottom of the dB slider; anything at or below it is mute.
   */
  function volumeFromDb(curveId, db, opts, floorDb) {
    if (db >= 0) return 1;
    if (floorDb !== undefined && db <= floorDb) return 0;
    return clamp(CURVES[curveId].vol(db, opts), 0, 1);
  }

  /*
   * The loudest slider position that is never louder than `db` attenuation.
   * Stepped curves snap down to a real step, continuous ones to a whole percent.
   * Returns { pos, step }, where step is the step number on stepped curves, else null.
   */
  function loudestPositionAtOrBelow(curveId, db, opts) {
    var curve = CURVES[curveId];
    if (db >= 0) return { pos: 1, step: curve.steps || null };
    if (curve.steps) {
      // walk down from the top step to the first one that is quiet enough
      for (var k = curve.steps; k > 0; k--) {
        if (curve.db(k / curve.steps, opts) <= db + 1e-9) return { pos: k / curve.steps, step: k };
      }
      return { pos: 0, step: 0 };
    }
    var floor = curve.hasRange ? -rangeOf(opts, curve.defaultRange || 60) : -Infinity;
    var v = volumeFromDb(curveId, db, opts, floor);
    var n = curve.steps || 100;
    var k = Math.floor(v * n + 1e-9);
    return { pos: k / n, step: curve.steps ? k : null };
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

  /*
   * Daily exposure limits. Both halve the allowed time for every 3 dB above the reference level.
   *  who:   80 dBA for 8 h a day (the WHO/ITU 40 h a week, spread over five days)
   *  niosh: 85 dBA for 8 h
   * At or below UNLIMITED_DB (the EPA lifetime level) there is no time limit.
   */
  var STANDARDS = {
    who: { id: 'who', label: 'WHO / ITU', ref: 80, note: '80 dB for 40 h a week, which is 8 h a day on five days' },
    niosh: { id: 'niosh', label: 'NIOSH', ref: 85, note: '85 dB for 8 h a day' }
  };
  var UNLIMITED_DB = 70;

  function standardOf(std) { return STANDARDS[std] || STANDARDS.who; }

  /* Safe listening time in seconds per day, or Infinity when there is no limit. */
  function safeSeconds(spl, std) {
    if (spl <= UNLIMITED_DB) return Infinity;
    return 8 * 3600 / Math.pow(2, (spl - standardOf(std).ref) / 3);
  }

  function tier(spl, std) {
    if (!isFinite(spl)) return { n: 0, name: 'Muted' };
    var ref = standardOf(std).ref;
    if (spl <= UNLIMITED_DB) return { n: 1, name: 'Safe all day' };
    if (spl <= ref) return { n: 2, name: 'Within the daily limit' };
    if (spl <= ref + 9) return { n: 3, name: 'Caution' };
    if (spl <= ref + 15) return { n: 4, name: 'High' };
    return { n: 5, name: 'Danger' };
  }

  /* 0 (safe, green) to 1 (dangerous, red). Green up to UNLIMITED_DB, red at 15 dB over the limit. */
  function risk(spl, std) {
    if (!isFinite(spl)) return 0;
    return clamp((spl - UNLIMITED_DB) / (standardOf(std).ref + 15 - UNLIMITED_DB), 0, 1);
  }

  var api = {
    CURVES: CURVES, ORDER: ORDER, ANDROID_MEDIA: ANDROID_MEDIA,
    attenuationDb: attenuationDb, volumeFromDb: volumeFromDb, loudestPositionAtOrBelow: loudestPositionAtOrBelow, sensitivityPerMw: sensitivityPerMw,
    compute: compute, safeSeconds: safeSeconds, tier: tier, risk: risk, standardOf: standardOf,
    STANDARDS: STANDARDS, UNLIMITED_DB: UNLIMITED_DB, clamp: clamp
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SafeAudio = api;
})(typeof window !== 'undefined' ? window : this);
