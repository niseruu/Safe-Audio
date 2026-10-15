const test = require('node:test');
const assert = require('node:assert');
const SA = require('../curves.js');

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('linear curve reproduces the reference worked example', () => {
  // 100 dB/mW, 32 ohm, 2 V RMS, 70% linear => about 117.9 dB SPL, about 14 s
  const r = SA.compute({ sens: 100, unit: 'mw', z: 32, vmax: 2, curve: 'linear', v: 0.7 });
  near(r.spl, 117.9);
  assert.ok(Math.abs(SA.safeSeconds(r.spl) - 14) < 1);
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

test('NIOSH safe time', () => {
  assert.strictEqual(SA.safeSeconds(85), 28800);
  near(SA.safeSeconds(88), 14400, 1);
  near(SA.safeSeconds(91), 7200, 1);
});

test('mute gives no level', () => {
  const r = SA.compute({ sens: 100, unit: 'mw', z: 32, vmax: 1, curve: 'linux', v: 0 });
  assert.strictEqual(r.spl, -Infinity);
  assert.strictEqual(SA.tier(r.spl).n, 0);
});
