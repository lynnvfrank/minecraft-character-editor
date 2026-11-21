import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createResidentsStore, RESIDENTS_KEY } from './residentsStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('residentsStore', () => {
  test('starts null with nothing stored and writes nothing until a choice is made', () => {
    const storage = memoryStorage();
    const store = createResidentsStore(storage);
    assert.equal(store.get(), null);
    store.prune(['a', 'b'], 6);
    assert.equal(store.get(), null);
    assert.equal(storage.m.has(RESIDENTS_KEY), false);
  });

  test('set persists under the documented key, notifies, and reads back', () => {
    const storage = memoryStorage();
    const store = createResidentsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set(['a', 'b', 'a']);
    assert.deepEqual(store.get(), ['a', 'b']);
    assert.equal(calls, 1);
    assert.equal(storage.m.get(RESIDENTS_KEY), '["a","b"]');
    store.set(['a', 'b']); // no change: no notification
    assert.equal(calls, 1);
    assert.deepEqual(createResidentsStore(storage).get(), ['a', 'b']);
  });

  test('an empty roster is a stored choice, not "nothing stored"', () => {
    const storage = memoryStorage();
    const store = createResidentsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set([]);
    assert.equal(calls, 1);
    assert.deepEqual(createResidentsStore(storage).get(), []);
  });

  test('malformed stored data counts as nothing stored', () => {
    assert.equal(createResidentsStore(memoryStorage({ [RESIDENTS_KEY]: '{oops' })).get(), null);
    assert.equal(createResidentsStore(memoryStorage({ [RESIDENTS_KEY]: '"a"' })).get(), null);
    assert.deepEqual(createResidentsStore(memoryStorage({ [RESIDENTS_KEY]: '["a",1,"a"]' })).get(), ['a']);
  });

  test('prune drops skins that no longer exist, trims to the cap, and notifies only on change', () => {
    const storage = memoryStorage({ [RESIDENTS_KEY]: '["a","gone","b","c"]' });
    const store = createResidentsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.prune([], 6); // skin list failed to load: leave the roster alone
    assert.deepEqual(store.get(), ['a', 'gone', 'b', 'c']);
    store.prune(['a', 'b', 'c', 'd'], 2);
    assert.deepEqual(store.get(), ['a', 'b']);
    assert.equal(calls, 1);
    assert.equal(storage.m.get(RESIDENTS_KEY), '["a","b"]');
    store.prune(['a', 'b', 'c', 'd'], 2);
    assert.equal(calls, 1);
  });

  test('works with no storage and survives a throwing storage', () => {
    const none = createResidentsStore(null);
    none.set(['a']);
    assert.deepEqual(none.get(), ['a']);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const s = createResidentsStore(throwing);
    assert.equal(s.get(), null);
    s.set(['b']);
    assert.deepEqual(s.get(), ['b']);
  });
});
