import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherStore, parseWeatherSettings, WEATHER_KEY } from './weather';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('weather store', () => {
  test('defaults to clear, with or without storage', () => {
    assert.deepEqual(createWeatherStore(memoryStorage()).get(), { mode: 'clear', current: 'clear' });
    assert.deepEqual(createWeatherStore(null).get(), { mode: 'clear', current: 'clear' });
  });

  test('parse rejects malformed data', () => {
    assert.deepEqual(parseWeatherSettings('{"mode":"snow"}'), { mode: 'snow' });
    for (const bad of [null, '', 'rain', '{', '[]', '{"mode":"hail"}', '{"mode":5}', 'null', '"snow"']) {
      assert.deepEqual(parseWeatherSettings(bad), { mode: 'clear' }, String(bad));
    }
  });

  test('persists the mode, notifies once per change, and a fresh store reads it back', () => {
    const storage = memoryStorage();
    const store = createWeatherStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setMode('rain');
    store.setMode('rain');
    assert.equal(calls, 1);
    assert.deepEqual(store.get(), { mode: 'rain', current: 'rain' });
    assert.deepEqual(JSON.parse(storage.m.get(WEATHER_KEY)!), { mode: 'rain' });
    assert.deepEqual(createWeatherStore(storage).get(), { mode: 'rain', current: 'rain' });
  });

  test('auto: the current weather changes without being saved; a fixed choice ignores it', () => {
    const storage = memoryStorage();
    const store = createWeatherStore(storage);
    store.setMode('snow');
    store.setCurrent('rain');
    assert.equal(store.get().current, 'snow');

    store.setMode('auto');
    assert.deepEqual(store.get(), { mode: 'auto', current: 'snow' }, 'keeps the sky until auto picks');
    let calls = 0;
    store.subscribe(() => calls++);
    store.setCurrent('rain');
    store.setCurrent('rain');
    assert.equal(calls, 1);
    assert.deepEqual(store.get(), { mode: 'auto', current: 'rain' });
    assert.deepEqual(JSON.parse(storage.m.get(WEATHER_KEY)!), { mode: 'auto' });
    // Reloading in auto starts clear until the auto weather picks.
    assert.deepEqual(createWeatherStore(storage).get(), { mode: 'auto', current: 'clear' });
  });

  test('a storage that throws is survivable', () => {
    const store = createWeatherStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    store.setMode('snow');
    assert.equal(store.get().mode, 'snow');
  });
});
