import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherController } from './weatherController';
import { createWeatherStore } from '../state/weather';
import { WEATHER_FADE_SECONDS } from '../lib/weather';

function setup(options: { village?: boolean; time?: number } = {}) {
  const store = createWeatherStore(null);
  const calls = { created: 0, updates: 0, hides: 0, lastBrightness: NaN, lastCenter: { x: NaN, z: NaN } };
  let village = options.village ?? true;
  let time = options.time ?? 12;
  const controller = createWeatherController({
    store,
    createParticles: () => {
      calls.created++;
      return {
        update: (_dt, center, _levels, brightness = 1) => {
          calls.updates++;
          calls.lastBrightness = brightness;
          calls.lastCenter = { ...center };
        },
        hide: () => void calls.hides++,
      };
    },
    getCenter: () => ({ x: 3, z: -2 }),
    isVillageShown: () => village,
    getTimeOfDay: () => time,
    random: () => 0.5,
  });
  return {
    store,
    controller,
    calls,
    setVillage: (v: boolean) => (village = v),
    setTime: (t: number) => (time = t),
  };
}

describe('weather controller', () => {
  test('clear weather builds no particles and leaves the levels at 0', () => {
    const { controller, calls } = setup();
    for (let i = 0; i < 10; i++) controller.update(1 / 60, 'viewer');
    assert.deepEqual(controller.getLevels(), { rain: 0, snow: 0 });
    assert.equal(calls.created, 0);
    assert.equal(calls.updates, 0);
  });

  test('picking rain fades it in; picking clear fades it out', () => {
    const { controller, store, calls } = setup();
    controller.update(0.1, 'viewer');
    store.setMode('rain');
    controller.update(WEATHER_FADE_SECONDS / 2, 'viewer');
    assert.ok(Math.abs(controller.getRain() - 0.5) < 1e-9);
    assert.equal(calls.created, 1);
    assert.deepEqual(calls.lastCenter, { x: 3, z: -2 });
    controller.update(WEATHER_FADE_SECONDS, 'viewer');
    assert.equal(controller.getRain(), 1);

    store.setMode('clear');
    controller.update(WEATHER_FADE_SECONDS / 4, 'viewer');
    assert.ok(Math.abs(controller.getRain() - 0.75) < 1e-9);
    controller.update(WEATHER_FADE_SECONDS, 'viewer');
    assert.deepEqual(controller.getLevels(), { rain: 0, snow: 0 });
    assert.ok(calls.hides > 0);
    assert.equal(calls.created, 1, 'particles are built once');
  });

  test('off the home view the weather is gone at once, and is back in full on return', () => {
    const { controller, store, calls } = setup();
    store.setMode('snow');
    controller.update(0.016, 'viewer');
    assert.deepEqual(controller.getLevels(), { rain: 0, snow: 1 }, 'already snowing on arrival');

    for (const route of ['creator', 'preview', 'studio'] as const) {
      controller.update(0.016, 'viewer');
      const hides = calls.hides;
      const updates = calls.updates;
      controller.update(0.016, route);
      assert.deepEqual(controller.getLevels(), { rain: 0, snow: 0 }, route);
      assert.equal(calls.hides, hides + 1, route);
      controller.update(0.016, route);
      assert.equal(calls.updates, updates, `${route}: particles are not moved`);
    }
    controller.update(0.016, 'viewer');
    assert.equal(controller.getLevels().snow, 1);
  });

  test('no village on screen, no weather', () => {
    const { controller, store, calls, setVillage } = setup({ village: false });
    store.setMode('rain');
    controller.update(0.016, 'viewer');
    assert.equal(controller.getRain(), 0);
    assert.equal(calls.created, 0);
    setVillage(true);
    controller.update(0.016, 'viewer');
    assert.equal(controller.getRain(), 1);
  });

  test('auto picks some weather straight away, reports it, and changes it later', () => {
    const { controller, store } = setup();
    controller.update(0.016, 'viewer');
    store.setMode('auto');
    controller.update(0.016, 'viewer');
    // random() = 0.5 after a clear sky: rain.
    assert.equal(store.get().current, 'rain');
    assert.ok(controller.getRain() > 0 && controller.getRain() < 1, 'fades in');
    const seen = new Set<string>();
    for (let t = 0; t < 600; t += 0.5) {
      controller.update(0.5, 'viewer');
      seen.add(store.get().current);
    }
    assert.ok(seen.has('clear') && seen.has('rain'));

    // The clock stands still while away from the home view.
    const before = store.get().current;
    for (let t = 0; t < 2000; t += 0.5) controller.update(0.5, 'creator');
    controller.update(0.016, 'viewer');
    assert.equal(store.get().current, before);
  });

  test('particles dim at night', () => {
    const { controller, store, calls, setTime } = setup({ time: 12 });
    store.setMode('snow');
    controller.update(0.016, 'viewer');
    assert.equal(calls.lastBrightness, 1);
    setTime(0);
    controller.update(0.016, 'viewer');
    assert.ok(calls.lastBrightness < 0.6 && calls.lastBrightness > 0.2);
  });
});
