import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_SKY_COLOR,
  DEFAULT_DAY_LENGTH_SECONDS,
  DEFAULT_TIME_OF_DAY,
  REFERENCE_LIGHT_DIRECTION,
  advanceTimeOfDay,
  formatTimeOfDay,
  isNightTime,
  partOfDay,
  skyStateAt,
  wrapHours,
  type SkyState,
} from './dayNight';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const length = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);

/** Every number in a sky state, flattened (time left out). */
function numbers(s: SkyState): number[] {
  return [
    ...s.skyColor, ...s.sunDirection, ...s.lightDirection, ...s.sunColor, s.sunIntensity,
    ...s.ambientTint, s.ambientIntensity, s.night, s.lampGlow, s.daylight,
  ];
}

function maxDiff(a: SkyState, b: SkyState): number {
  const na = numbers(a);
  const nb = numbers(b);
  return Math.max(...na.map((v, i) => Math.abs(v - nb[i])));
}

describe('dayNight', () => {
  test('wrapHours keeps time in [0, 24)', () => {
    assert.equal(wrapHours(0), 0);
    assert.equal(wrapHours(24), 0);
    assert.equal(wrapHours(25.5), 1.5);
    assert.equal(wrapHours(-1), 23);
    assert.equal(wrapHours(-49), 23);
    assert.equal(wrapHours(NaN), DEFAULT_TIME_OF_DAY);
    const tiny = wrapHours(-1e-17);
    assert.ok(tiny >= 0 && tiny < 24);
  });

  test('the default time is neutral: it leaves a lighting preset untouched', () => {
    const s = skyStateAt(DEFAULT_TIME_OF_DAY);
    assert.deepEqual(s.skyColor, DAY_SKY_COLOR);
    assert.deepEqual(s.sunColor, [1, 1, 1]);
    assert.deepEqual(s.ambientTint, [1, 1, 1]);
    assert.equal(s.sunIntensity, 1);
    assert.equal(s.ambientIntensity, 1);
    assert.equal(s.night, 0);
    assert.equal(s.lampGlow, 0);
    assert.equal(s.daylight, 1);
    s.lightDirection.forEach((v, i) => assert.ok(close(v, REFERENCE_LIGHT_DIRECTION[i])));
  });

  test('noon is the brightest time of day', () => {
    const noon = skyStateAt(12);
    for (let t = 0; t < 24; t += 0.25) {
      const s = skyStateAt(t);
      assert.ok(s.sunIntensity <= noon.sunIntensity, `sun at ${t}`);
      assert.ok(s.ambientIntensity <= noon.ambientIntensity, `ambient at ${t}`);
      assert.ok(s.sunDirection[1] <= noon.sunDirection[1] + 1e-9, `sun height at ${t}`);
    }
    assert.ok(skyStateAt(0).sunIntensity < 0.5 * noon.sunIntensity);
    assert.ok(skyStateAt(0).ambientIntensity < 0.5 * noon.ambientIntensity);
  });

  test('night is dark and blue, with the sun below the horizon', () => {
    for (const t of [21, 23.5, 0, 2, 4]) {
      const s = skyStateAt(t);
      assert.equal(s.night, 1, `night at ${t}`);
      assert.equal(s.daylight, 0);
      assert.ok(s.sunDirection[1] < 0, `sun down at ${t}`);
      assert.ok(s.skyColor[2] > s.skyColor[0], 'night sky is blue');
      assert.ok(s.sunColor[2] > s.sunColor[0], 'moonlight is cool');
    }
    assert.ok(skyStateAt(18).sunColor[0] > skyStateAt(18).sunColor[2], 'sunset light is warm');
    assert.equal(isNightTime(23), true);
    assert.equal(isNightTime(12), false);
  });

  test('lamps are on at night, off by day, and ramp smoothly', () => {
    for (const t of [19, 21, 0, 3, 5.5]) assert.equal(skyStateAt(t).lampGlow, 1, `on at ${t}`);
    for (const t of [7, 9, 12, 15, 17.5]) assert.equal(skyStateAt(t).lampGlow, 0, `off at ${t}`);
    const dusk = skyStateAt(18.25).lampGlow;
    assert.ok(dusk > 0 && dusk < 1);
    const dawn = skyStateAt(6.25).lampGlow;
    assert.ok(dawn > 0 && dawn < 1);
    // Coming on through dusk: never dims.
    let last = 0;
    for (let t = 17; t <= 20; t += 0.05) {
      const g = skyStateAt(t).lampGlow;
      assert.ok(g >= last - 1e-12);
      last = g;
    }
  });

  test('is continuous across midnight', () => {
    assert.ok(maxDiff(skyStateAt(23.9999), skyStateAt(0.0001)) < 1e-3);
    assert.deepEqual(numbers(skyStateAt(24)), numbers(skyStateAt(0)));
    assert.deepEqual(numbers(skyStateAt(-3)), numbers(skyStateAt(21)));
  });

  test('colors and intensities never jump during the day', () => {
    const step = 1 / 60; // one minute
    for (let t = 0; t < 24; t += step) {
      const a = skyStateAt(t);
      const b = skyStateAt(t + step);
      const colors = (s: SkyState) => [...s.skyColor, ...s.sunColor, s.sunIntensity, ...s.ambientTint, s.ambientIntensity, s.night, s.lampGlow];
      const ca = colors(a);
      const cb = colors(b);
      ca.forEach((v, i) => assert.ok(Math.abs(v - cb[i]) < 0.03, `value ${i} jumps at ${t}`));
    }
  });

  test('directions are unit vectors and the key light stays above the horizon', () => {
    for (let t = 0; t < 24; t += 0.1) {
      const s = skyStateAt(t);
      assert.ok(close(length(s.sunDirection), 1, 1e-9));
      assert.ok(close(length(s.lightDirection), 1, 1e-9));
      assert.ok(s.lightDirection[1] > 0.15, `light height at ${t}`);
      for (const c of [...s.skyColor, ...s.sunColor, ...s.ambientTint]) assert.ok(c >= 0 && c <= 1);
    }
    // The key light is nearly out when it swaps between sun and moon.
    assert.ok(skyStateAt(6).sunIntensity < 0.1);
    assert.ok(skyStateAt(18).sunIntensity < 0.1);
  });

  test('advanceTimeOfDay moves a full day in the day length and wraps at 24', () => {
    assert.equal(advanceTimeOfDay(12, 0), 12);
    assert.ok(close(advanceTimeOfDay(12, DEFAULT_DAY_LENGTH_SECONDS / 24), 13));
    assert.ok(close(advanceTimeOfDay(0, 60, 240), 6));
    assert.ok(close(advanceTimeOfDay(23, 20, 240), 1));
    assert.ok(close(advanceTimeOfDay(5, 240, 240), 5, 1e-9));
    const t = advanceTimeOfDay(23.99, 1000, 7);
    assert.ok(t >= 0 && t < 24);
    // Bad input: stay put rather than produce NaN.
    assert.equal(advanceTimeOfDay(8, 1, 0), 8);
    assert.equal(advanceTimeOfDay(8, NaN), 8);
  });

  test('formatTimeOfDay gives friendly clock labels', () => {
    assert.equal(formatTimeOfDay(12), 'Noon');
    assert.equal(formatTimeOfDay(0), 'Midnight');
    assert.equal(formatTimeOfDay(23.99), 'Midnight');
    assert.equal(formatTimeOfDay(18.5), '6:30 pm');
    assert.equal(formatTimeOfDay(6.25), '6:15 am');
    assert.equal(formatTimeOfDay(0.5), '12:30 am');
    assert.equal(formatTimeOfDay(12.5), '12:30 pm');
    assert.equal(formatTimeOfDay(9.02), '9:00 am');
    assert.equal(formatTimeOfDay(36), 'Noon');
  });

  test('partOfDay names the stretch of the day', () => {
    assert.equal(partOfDay(0), 'Night');
    assert.equal(partOfDay(6), 'Dawn');
    assert.equal(partOfDay(9), 'Morning');
    assert.equal(partOfDay(12), 'Midday');
    assert.equal(partOfDay(15), 'Afternoon');
    assert.equal(partOfDay(18), 'Dusk');
    assert.equal(partOfDay(20), 'Evening');
    assert.equal(partOfDay(23), 'Night');
  });
});
