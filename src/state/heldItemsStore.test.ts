import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHeldItemsStore, HELD_ITEMS_KEY } from './heldItemsStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('heldItemsStore', () => {
  test('set persists, notifies once per change, and reads back', () => {
    const storage = memoryStorage();
    const store = createHeldItemsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set('/a.png', 'torch');
    store.set('/a.png', 'torch');
    assert.equal(calls, 1);
    assert.equal(store.get('/a.png'), 'torch');
    assert.equal(storage.m.get(HELD_ITEMS_KEY), '{"/a.png":"torch"}');
    assert.equal(createHeldItemsStore(storage).get('/a.png'), 'torch');
    store.set('/a.png', null);
    assert.equal(store.get('/a.png'), null);
    assert.equal(calls, 2);
  });

  test('ignores unknown items, bad keys and junk in storage', () => {
    const store = createHeldItemsStore(memoryStorage({ [HELD_ITEMS_KEY]: '{"/a.png":"laser","/b.png":"flag"' }));
    assert.deepEqual(store.all(), {});
    store.set('data:image/png;base64,AA', 'torch');
    store.set('/a.png', 'laser');
    assert.deepEqual(store.all(), {});
    assert.equal(store.get(null), null);
  });

  test('works without storage', () => {
    const store = createHeldItemsStore(null);
    store.set('outfit:x', 'wand');
    assert.equal(store.get('outfit:x'), 'wand');
  });

  test('merge: restored assignments win', () => {
    const store = createHeldItemsStore(memoryStorage());
    store.set('/a.png', 'torch');
    store.merge({ '/a.png': 'flag', '/b.png': 'pick' });
    assert.deepEqual(store.all(), { '/a.png': 'flag', '/b.png': 'pick' });
  });
});
