import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGroupDanceStore, GROUP_DANCE_KEY } from './groupDanceStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('groupDanceStore', () => {
  test('starts with no dancers', () => {
    assert.deepEqual(createGroupDanceStore(memoryStorage()).get(), { count: 0, formation: 'line', offsetSec: 0 });
    assert.deepEqual(createGroupDanceStore(null).get(), { count: 0, formation: 'line', offsetSec: 0 });
  });

  test('set persists, notifies, and a fresh store reads it back', () => {
    const storage = memoryStorage();
    const store = createGroupDanceStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ count: 2 });
    store.set({ formation: 'stagger', offsetSec: 0.25 });
    assert.equal(calls, 2);
    assert.deepEqual(store.get(), { count: 2, formation: 'stagger', offsetSec: 0.25 });
    assert.deepEqual(createGroupDanceStore(storage).get(), store.get());
    assert.ok(storage.m.has(GROUP_DANCE_KEY));
  });

  test('no change, no write and no notification', () => {
    const storage = memoryStorage();
    const store = createGroupDanceStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ count: 0 });
    store.set({ formation: 'circle' as never });
    assert.equal(calls, 0);
    assert.equal(storage.m.size, 0);
  });

  test('values are clamped on the way in', () => {
    const store = createGroupDanceStore(memoryStorage());
    store.set({ count: 5, offsetSec: 3 });
    assert.deepEqual(store.get(), { count: 2, formation: 'line', offsetSec: 0.5 });
  });

  test('broken stored JSON and a throwing storage fall back to the defaults', () => {
    assert.equal(createGroupDanceStore(memoryStorage({ [GROUP_DANCE_KEY]: 'nope' })).get().count, 0);
    const store = createGroupDanceStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    store.set({ count: 1 });
    assert.equal(store.get().count, 1);
  });
});
