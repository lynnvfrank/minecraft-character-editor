import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { skyStateAt } from './dayNight';
import {
  AUTO_WEATHER_DURATIONS,
  MAX_WEATHER_PARTICLES,
  WEATHER_FADE_SECONDS,
  advanceAutoWeather,
  advanceWeatherLevels,
  applyWeatherToSky,
  easeWeatherLevel,
  isWeatherKind,
  nextAutoWeather,
  nextWeatherMode,
  parseWeatherMode,
  recycleParticle,
  setWeatherLevels,
  weatherLook,
  weatherParticleCount,
  wrapInto,
  type AutoWeather,
  type WeatherKind,
} from './weather';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lum = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const saturation = (c: readonly [number, number, number]) => Math.max(...c) - Math.min(...c);

describe('weather modes', () => {
  test('parse accepts the known modes and falls back to clear', () => {
    assert.equal(parseWeatherMode('rain'), 'rain');
    assert.equal(parseWeatherMode('snow'), 'snow');
    assert.equal(parseWeatherMode('auto'), 'auto');
    for (const bad of [undefined, null, 3, '', 'hail', 'Rain', {}]) assert.equal(parseWeatherMode(bad), 'clear');
    assert.equal(isWeatherKind('auto'), false);
    assert.equal(isWeatherKind('snow'), true);
  });

  test('the cycling button goes round all four', () => {
    const seen = new Set<string>();
    let mode = parseWeatherMode('clear');
    for (let i = 0; i < 4; i++) {
      seen.add(mode);
      mode = nextWeatherMode(mode);
    }
    assert.equal(seen.size, 4);
    assert.equal(mode, 'clear');
  });
});

describe('weather levels', () => {
  test('fade in over a few seconds and back out', () => {
    const levels = { rain: 0, snow: 0 };
    assert.equal(advanceWeatherLevels(levels, 'rain', WEATHER_FADE_SECONDS / 2), true);
    assert.ok(Math.abs(levels.rain - 0.5) < 1e-9);
    advanceWeatherLevels(levels, 'rain', WEATHER_FADE_SECONDS);
    assert.deepEqual(levels, { rain: 1, snow: 0 });
    assert.equal(advanceWeatherLevels(levels, 'rain', 1), false);

    // Rain turns to snow: one falls while the other rises.
    advanceWeatherLevels(levels, 'snow', WEATHER_FADE_SECONDS / 4);
    assert.ok(Math.abs(levels.rain - 0.75) < 1e-9 && Math.abs(levels.snow - 0.25) < 1e-9);
    advanceWeatherLevels(levels, 'clear', 100);
    assert.deepEqual(levels, { rain: 0, snow: 0 });
    assert.equal(advanceWeatherLevels(levels, 'clear', 1), false);
  });

  test('setWeatherLevels jumps; odd deltas are harmless', () => {
    const levels = { rain: 0, snow: 0 };
    assert.equal(setWeatherLevels(levels, 'snow'), true);
    assert.deepEqual(levels, { rain: 0, snow: 1 });
    assert.equal(advanceWeatherLevels(levels, 'snow', -5), false);
    advanceWeatherLevels(levels, 'clear', -5);
    assert.deepEqual(levels, { rain: 0, snow: 1 });
  });

  test('easing is 0 at 0, 1 at 1, monotonic and clamped', () => {
    assert.equal(easeWeatherLevel(0), 0);
    assert.equal(easeWeatherLevel(1), 1);
    assert.equal(easeWeatherLevel(-1), 0);
    assert.equal(easeWeatherLevel(2), 1);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const e = easeWeatherLevel(t);
      assert.ok(e > prev);
      prev = e;
    }
  });
});

describe('weather look', () => {
  test('clear weather leaves the sky state untouched', () => {
    const sky = skyStateAt(15);
    const out = applyWeatherToSky(sky, { rain: 0, snow: 0 });
    assert.equal(out.sky, sky);
    assert.equal(out.fogScale, 1);
    const look = weatherLook({ rain: 0, snow: 0 });
    assert.equal(look.sunScale, 1);
    assert.equal(look.ambientScale, 1);
    assert.equal(look.fogScale, 1);
    assert.equal(look.cloudMix, 0);
    assert.deepEqual(look.sunTint, [1, 1, 1]);
    assert.deepEqual(look.ambientTint, [1, 1, 1]);
  });

  test('rain: dimmer, cooler, greyer, foggier', () => {
    const noon = skyStateAt(12);
    const { sky, fogScale } = applyWeatherToSky(noon, { rain: 1, snow: 0 });
    assert.ok(sky.sunIntensity < noon.sunIntensity * 0.6);
    assert.ok(sky.ambientIntensity < noon.ambientIntensity);
    assert.ok(sky.sunColor[0] < sky.sunColor[2], 'sun is cooler (less red than blue)');
    assert.ok(sky.ambientTint[0] < sky.ambientTint[2]);
    assert.ok(saturation(sky.skyColor) < saturation(noon.skyColor), 'sky is greyer');
    assert.ok(lum(sky.skyColor) < lum(noon.skyColor));
    assert.ok(fogScale < 1 && fogScale > 0.5);
    // Everything else about the time of day is kept.
    assert.equal(sky.lightDirection, noon.lightDirection);
    assert.equal(sky.night, noon.night);
    assert.equal(sky.lampGlow, noon.lampGlow);
  });

  test('snow is brighter and whiter than rain', () => {
    const noon = skyStateAt(12);
    const rain = applyWeatherToSky(noon, { rain: 1, snow: 0 }).sky;
    const snow = applyWeatherToSky(noon, { rain: 0, snow: 1 }).sky;
    assert.ok(snow.sunIntensity > rain.sunIntensity);
    assert.ok(snow.ambientIntensity > rain.ambientIntensity);
    assert.ok(lum(snow.skyColor) > lum(rain.skyColor));
    assert.ok(Math.min(...snow.sunColor) > Math.min(...rain.sunColor));
    assert.ok(snow.sunIntensity < noon.sunIntensity);
  });

  test('half-way levels sit between clear and full', () => {
    const noon = skyStateAt(12);
    const half = applyWeatherToSky(noon, { rain: 0.5, snow: 0 }).sky;
    const full = applyWeatherToSky(noon, { rain: 1, snow: 0 }).sky;
    assert.ok(half.sunIntensity < noon.sunIntensity && half.sunIntensity > full.sunIntensity);
    assert.ok(lum(half.skyColor) < lum(noon.skyColor) && lum(half.skyColor) > lum(full.skyColor));
  });

  test('clouds follow the time of day: night stays dark', () => {
    const night = skyStateAt(0);
    const snowy = applyWeatherToSky(night, { rain: 0, snow: 1 }).sky;
    assert.ok(lum(snowy.skyColor) < 0.2);
    assert.ok(snowy.sunIntensity <= night.sunIntensity);
    for (const c of snowy.skyColor) assert.ok(c >= 0 && c <= 1);
  });
});

describe('auto weather', () => {
  test('every change is a change, with a duration in range', () => {
    const random = seeded(7);
    let state: AutoWeather = advanceAutoWeather(null, 0, random);
    assert.notEqual(state.kind, 'clear', '"Surprise me" opens with some weather');
    for (let i = 0; i < 300; i++) {
      const [min, max] = AUTO_WEATHER_DURATIONS[state.kind];
      assert.ok(state.remaining >= min && state.remaining <= max);
      const next = nextAutoWeather(state.kind, random);
      assert.notEqual(next.kind, state.kind);
      state = next;
    }
  });

  test('mostly clear, sometimes rain, snow less often', () => {
    const random = seeded(99);
    const time: Record<WeatherKind, number> = { clear: 0, rain: 0, snow: 0 };
    let state: AutoWeather | null = null;
    const dt = 1;
    for (let t = 0; t < 200_000; t += dt) {
      state = advanceAutoWeather(state, dt, random);
      time[state.kind] += dt;
    }
    const total = time.clear + time.rain + time.snow;
    assert.ok(time.clear / total > 0.5, `clear ${time.clear / total}`);
    assert.ok(time.rain > time.snow * 1.5, `rain ${time.rain} snow ${time.snow}`);
    assert.ok(time.snow / total > 0.03);
  });

  test('counts down in place and ignores a zero delta', () => {
    const state: AutoWeather = { kind: 'rain', remaining: 10 };
    assert.equal(advanceAutoWeather(state, 4, () => 0.5), state);
    assert.equal(state.remaining, 6);
    assert.equal(advanceAutoWeather(state, 0, () => 0.5), state);
    const next = advanceAutoWeather(state, 6, () => 0.5);
    assert.equal(next.kind, 'clear');
    // A low roll after rain turns it to snow instead.
    assert.equal(nextAutoWeather('rain', () => 0).kind, 'snow');
    assert.equal(nextAutoWeather('clear', () => 0).kind, 'snow');
    assert.equal(nextAutoWeather('clear', () => 0.9).kind, 'rain');
  });
});

describe('particles', () => {
  const box = { centerX: 10, centerZ: -4, halfWidth: 5, bottom: 0, top: 8 };
  const inBox = (p: ArrayLike<number>, i = 0) =>
    p[i * 3]! >= 5 && p[i * 3]! < 15 && p[i * 3 + 1]! >= 0 && p[i * 3 + 1]! < 8 && p[i * 3 + 2]! >= -9 && p[i * 3 + 2]! < 1;

  test('wrapInto keeps values in [min, min + size)', () => {
    assert.equal(wrapInto(3, 0, 10), 3);
    assert.equal(wrapInto(13, 0, 10), 3);
    assert.equal(wrapInto(-1, 0, 10), 9);
    assert.equal(wrapInto(10, 0, 10), 0);
    assert.equal(wrapInto(-1e-17, 0, 10), 0);
    assert.equal(wrapInto(NaN, 2, 10), 2);
    assert.equal(wrapInto(5, 2, 0), 2);
  });

  test('a falling particle comes back in at the top', () => {
    const p = new Float32Array([10, 0.5, -4]);
    recycleParticle(p, 0, 0, -10, 0, 0.1, box);
    assert.ok(Math.abs(p[1]! - 7.5) < 1e-5);
    assert.equal(p[0], 10);
    assert.equal(p[2], -4);
  });

  test('moves by velocity inside the box, at the given index', () => {
    const p = new Float32Array([0, 0, 0, 10, 4, -4]);
    recycleParticle(p, 1, 1, -2, 0.5, 0.5, box);
    assert.deepEqual([...p], [0, 0, 0, 10.5, 3, -3.75]);
  });

  test('when the box moves away, particles re-enter on the far side', () => {
    const p = new Float32Array([10, 4, -4]);
    const moved = { ...box, centerX: 30, centerZ: 20 };
    recycleParticle(p, 0, 0, 0, 0, 0.016, moved);
    assert.ok(p[0]! >= 25 && p[0]! < 35);
    assert.ok(p[2]! >= 15 && p[2]! < 25);
    assert.equal(p[1], 4);
  });

  test('stays in the box over a long windy run', () => {
    const random = seeded(3);
    const p = new Float32Array(3 * 20);
    for (let i = 0; i < p.length; i++) p[i] = (random() - 0.5) * 200;
    for (let step = 0; step < 500; step++) {
      for (let i = 0; i < 20; i++) recycleParticle(p, i, 3.1, -14, -1.7, 1 / 30, box);
    }
    for (let i = 0; i < 20; i++) assert.ok(inBox(p, i), `particle ${i}`);
  });

  test('particle budget: capped, smaller on small or dense screens, none when clear', () => {
    assert.equal(weatherParticleCount('clear'), 0);
    assert.equal(weatherParticleCount('rain'), MAX_WEATHER_PARTICLES.rain);
    assert.ok(MAX_WEATHER_PARTICLES.rain <= 1500 && MAX_WEATHER_PARTICLES.snow <= 900);
    const desktop = { width: 1600, height: 900, pixelRatio: 1 };
    assert.equal(weatherParticleCount('snow', desktop), MAX_WEATHER_PARTICLES.snow);
    assert.ok(weatherParticleCount('snow', { width: 390, height: 800, pixelRatio: 2 }) < MAX_WEATHER_PARTICLES.snow);
    assert.ok(weatherParticleCount('rain', { ...desktop, pixelRatio: 3 }) < MAX_WEATHER_PARTICLES.rain);
  });
});
