import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioSectionsStore, STUDIO_SECTIONS_KEY } from './studioSections';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('studioSectionsStore', () => {
  test('starts with the defaults, with or without storage', () => {
    for (const store of [createStudioSectionsStore(memoryStorage()), createStudioSectionsStore(null)]) {
      assert.equal(store.isOpen('clips'), true);
      assert.equal(store.isOpen('capture'), false);
    }
  });

  test('toggle persists, notifies, and a fresh store reads it back', () => {
    const storage = memoryStorage();
    const store = createStudioSectionsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.toggle('dancers');
    store.toggle('clips');
    assert.equal(calls, 2);
    assert.equal(store.isOpen('dancers'), true);
    assert.equal(store.isOpen('clips'), false);
    const again = createStudioSectionsStore(storage);
    assert.deepEqual(again.get(), store.get());
  });

  test('setting the current value writes nothing and notifies nobody', () => {
    const storage = memoryStorage();
    const store = createStudioSectionsStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set('clips', true);
    assert.equal(calls, 0);
    assert.equal(storage.m.size, 0);
  });

  test('broken stored JSON and a throwing storage fall back to the defaults', () => {
    assert.equal(createStudioSectionsStore(memoryStorage({ [STUDIO_SECTIONS_KEY]: '{oops' })).isOpen('routine'), true);
    const store = createStudioSectionsStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    store.toggle('backdrop');
    assert.equal(store.isOpen('backdrop'), true);
  });
});
