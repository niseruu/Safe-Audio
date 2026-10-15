const test = require('node:test');
const assert = require('node:assert');
const SA = require('../curves.js');

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('linear curve reproduces the reference worked example', () => {
  // 100 dB/mW, 32 ohm, 2 V RMS, 70% linear => about 117.9 dB SPL, about 14 s
  const r = SA.compute({ sens: 100, unit: 'mw', z: 32, vmax: 2, curve: 'linear', v: 0.7 });
  near(r.spl, 117.9);
  assert.ok(Math.abs(SA.safeSeconds(r.spl, 'niosh') - 14) < 1);
});

test('linux curve is cubic (60 log10)', () => {
  near(SA.attenuationDb('linux', 0.5), -18.06);
  near(SA.attenuationDb('linux', 1), 0);
});

test('windows approximation is 40 log10', () => {
  near(SA.attenuationDb('windows', 0.5), -12.04);
});

test('android interpolates the AOSP headset table', () => {
  near(SA.attenuationDb('android', 0.33), -33.5);
  near(SA.attenuationDb('android', 0.66), -17);
  near(SA.attenuationDb('android', 1), 0);
  assert.strictEqual(SA.attenuationDb('android', 0), -Infinity);
});

test('apple approximation hits 0 dB at max and about -30 dB at half', () => {
  near(SA.attenuationDb('apple', 1), 0);
  near(SA.attenuationDb('apple', 0.5), -30.2, 0.3);
});

test('alsa and generic are linear in dB over their range', () => {
  near(SA.attenuationDb('alsa', 0.5, { range: 50 }), -25);
  near(SA.attenuationDb('generic', 0.5, { range: 60 }), -30);
  near(SA.attenuationDb('generic', 0.5, { range: 40 }), -20);
});

test('every curve is silent at zero and 0 dB at max', () => {
  for (const id of SA.ORDER) {
    assert.strictEqual(SA.attenuationDb(id, 0), -Infinity, id);
    near(SA.attenuationDb(id, 1), 0, 1e-9);
  }
});

test('every curve is monotonic', () => {
  for (const id of SA.ORDER) {
    let prev = -Infinity;
    for (let i = 1; i <= 100; i++) {
      const d = SA.attenuationDb(id, i / 100);
      assert.ok(d >= prev - 1e-9, `${id} at ${i}`);
      prev = d;
    }
  }
});

test('dB/V converts to dB/mW using impedance', () => {
  // 1 V into 32 ohm is 31.25 mW => +14.95 dB over 1 mW
  near(SA.sensitivityPerMw(115, 'v', 32), 115 - 14.95);
  near(SA.sensitivityPerMw(100, 'mw', 32), 100);
});

test('NIOSH safe time: 85 dB for 8 h, halving every 3 dB', () => {
  assert.strictEqual(SA.safeSeconds(85, 'niosh'), 28800);
  near(SA.safeSeconds(88, 'niosh'), 14400, 1);
  near(SA.safeSeconds(91, 'niosh'), 7200, 1);
});

test('WHO safe time: 80 dB for 8 h, halving every 3 dB', () => {
  assert.strictEqual(SA.safeSeconds(80, 'who'), 28800);
  near(SA.safeSeconds(83, 'who'), 14400, 1);
  near(SA.safeSeconds(86, 'who'), 7200, 1);
  near(SA.safeSeconds(89, 'who'), 3600, 1);
  near(SA.safeSeconds(92, 'who'), 1800, 1);
  near(SA.safeSeconds(95, 'who'), 900, 1);
});

test('WHO is the default and is stricter than NIOSH', () => {
  assert.strictEqual(SA.safeSeconds(85), SA.safeSeconds(85, 'who'));
  assert.ok(SA.safeSeconds(85, 'who') < SA.safeSeconds(85, 'niosh'));
});

test('70 dB and below is unlimited on both standards', () => {
  assert.strictEqual(SA.safeSeconds(70, 'who'), Infinity);
  assert.strictEqual(SA.safeSeconds(55, 'niosh'), Infinity);
  assert.ok(isFinite(SA.safeSeconds(71, 'who')));
});

test('risk runs 0 (green) to 1 (red) and moves with the standard', () => {
  assert.strictEqual(SA.risk(60, 'who'), 0);
  assert.strictEqual(SA.risk(70, 'who'), 0);
  assert.strictEqual(SA.risk(95, 'who'), 1);
  assert.strictEqual(SA.risk(120, 'who'), 1);
  assert.ok(SA.risk(85, 'who') > SA.risk(85, 'niosh'));
  let prev = -1;
  for (let l = 60; l <= 110; l++) { const r = SA.risk(l, 'who'); assert.ok(r >= prev); prev = r; }
});

test('tiers follow the chosen limit', () => {
  assert.strictEqual(SA.tier(65, 'who').n, 1);
  assert.strictEqual(SA.tier(80, 'who').n, 2);
  assert.strictEqual(SA.tier(85, 'who').n, 3);
  assert.strictEqual(SA.tier(85, 'niosh').n, 2);
  assert.strictEqual(SA.tier(100, 'who').n, 5);
  assert.strictEqual(SA.tier(100, 'niosh').n, 4);
});

test('mute gives no level', () => {
  const r = SA.compute({ sens: 100, unit: 'mw', z: 32, vmax: 1, curve: 'linux', v: 0 });
  assert.strictEqual(r.spl, -Infinity);
  assert.strictEqual(SA.tier(r.spl).n, 0);
});

test('offset (content plus EQ preamp) shifts the level by the same number of dB', () => {
  const base = { sens: 100, unit: 'mw', z: 32, vmax: 1, curve: 'linux', v: 0.5 };
  const a = SA.compute(base).spl;
  near(SA.compute({ ...base, offset: -6 }).spl, a - 6, 1e-9);
  near(SA.compute({ ...base, offset: -12 + 3 }).spl, a - 9, 1e-9);
});

test('volumeFromDb is the inverse of attenuationDb on every curve', () => {
  const opts = { range: 60 };
  for (const id of SA.ORDER) {
    for (let i = 5; i <= 100; i += 5) {
      const v = i / 100;
      const db = SA.attenuationDb(id, v, opts);
      if (db < -80) continue;
      near(SA.volumeFromDb(id, db, opts), v, 1e-6);
    }
  }
});

test('volumeFromDb: 0 dB is max, the floor is mute, and values clamp to 0..1', () => {
  assert.strictEqual(SA.volumeFromDb('linux', 0, {}, -80), 1);
  assert.strictEqual(SA.volumeFromDb('linux', 3, {}, -80), 1);
  assert.strictEqual(SA.volumeFromDb('linux', -80, {}, -80), 0);
  assert.strictEqual(SA.volumeFromDb('generic', -60, { range: 60 }, -60), 0);
  near(SA.volumeFromDb('generic', -30, { range: 60 }, -60), 0.5, 1e-9);
  const lo = SA.volumeFromDb('android', -70, {}, -80);
  assert.ok(lo >= 0 && lo <= 0.011, String(lo));
});

test('loudestPositionAtOrBelow never lands louder than the target, and is the loudest that does not', () => {
  const opts = { range: 60 };
  for (const id of SA.ORDER) {
    const n = SA.CURVES[id].steps || 100;
    for (let target = -2; target >= -70; target -= 1.7) {
      const r = SA.loudestPositionAtOrBelow(id, target, opts);
      const att = SA.attenuationDb(id, r.pos, opts);
      assert.ok(att <= target + 1e-6, `${id} ${target}: lands at ${att}`);
      if (r.pos < 1) {
        const next = SA.attenuationDb(id, r.pos + 1 / n, opts);
        assert.ok(next > target - 1e-6, `${id} ${target}: could be louder (${next})`);
      }
      assert.strictEqual(r.step === null, !SA.CURVES[id].steps);
    }
  }
});

test('loudestPositionAtOrBelow: at or above 0 dB is max volume, and an unreachable target is mute', () => {
  assert.strictEqual(SA.loudestPositionAtOrBelow('linux', 0).pos, 1);
  assert.strictEqual(SA.loudestPositionAtOrBelow('android', 5).step, 15);
  assert.strictEqual(SA.loudestPositionAtOrBelow('generic', -80, { range: 60 }).pos, 0);
  assert.strictEqual(SA.loudestPositionAtOrBelow('android', -60).step, 0);
});

test('Android: the old nearest-step rounding could land louder than the target; this does not', () => {
  // top level 114.95 dB, target 80 dB for 8 h => -34.95 dB
  const r = SA.loudestPositionAtOrBelow('android', 80 - 114.95);
  assert.ok(SA.attenuationDb('android', r.pos) <= 80 - 114.95 + 1e-6);
});
