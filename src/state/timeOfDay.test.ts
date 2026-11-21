import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeOfDayStore, parseTimeOfDaySettings, TIME_OF_DAY_KEY } from './timeOfDay';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  let writes = 0;
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes++;
      m.set(k, v);
    },
    m,
    writes: () => writes,
  };
}

describe('timeOfDay store', () => {
  test('defaults to midday with auto off', () => {
    const store = createTimeOfDayStore(memoryStorage());
    assert.deepEqual(store.get(), { time: 12, auto: false });
    assert.deepEqual(createTimeOfDayStore(null).get(), { time: 12, auto: false });
  });

  test('persists time and auto, and a fresh store reads them back', () => {
    const storage = memoryStorage();
    const store = createTimeOfDayStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setTime(18.5);
    store.setAuto(true);
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(storage.m.get(TIME_OF_DAY_KEY)!), { time: 18.5, auto: true });
    assert.deepEqual(createTimeOfDayStore(storage).get(), { time: 18.5, auto: true });
  });

  test('wraps time into a day and skips no-op notifications', () => {
    const store = createTimeOfDayStore(memoryStorage());
    let calls = 0;
    store.subscribe(() => calls++);
    store.setTime(25);
    assert.equal(store.get().time, 1);
    store.setTime(1);
    store.setAuto(false);
    assert.equal(calls, 1);
    store.setTime(-2);
    assert.equal(store.get().time, 22);
  });

  test('setTime(…, false) notifies without writing until persist()', () => {
    const storage = memoryStorage();
    const store = createTimeOfDayStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setTime(3, false);
    store.setTime(4, false);
    assert.equal(calls, 2);
    assert.equal(storage.writes(), 0);
    store.persist();
    assert.equal(storage.writes(), 1);
    assert.equal(createTimeOfDayStore(storage).get().time, 4);
  });

  test('parse rejects malformed data', () => {
    const fallback = { time: 12, auto: false };
    assert.deepEqual(parseTimeOfDaySettings(null), fallback);
    assert.deepEqual(parseTimeOfDaySettings('not json'), fallback);
    assert.deepEqual(parseTimeOfDaySettings('[1,2]'), fallback);
    assert.deepEqual(parseTimeOfDaySettings('"7"'), fallback);
    assert.deepEqual(parseTimeOfDaySettings('{"time":"7","auto":"yes"}'), fallback);
    assert.deepEqual(parseTimeOfDaySettings('{"time":null,"auto":true}'), { time: 12, auto: true });
    assert.deepEqual(parseTimeOfDaySettings('{"time":30}'), { time: 6, auto: false });
    assert.deepEqual(parseTimeOfDaySettings('{"time":-1,"auto":true}'), { time: 23, auto: true });
  });

  test('survives storage that throws', () => {
    const store = createTimeOfDayStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    store.setTime(9);
    store.setAuto(true);
    assert.deepEqual(store.get(), { time: 9, auto: true });
  });
});
