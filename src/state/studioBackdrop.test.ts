import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioBackdropStore, STUDIO_BACKDROP_KEY } from './studioBackdrop';
import { CUSTOM_BACKDROP_ID, DEFAULT_BACKDROP_SETTINGS } from '../lib/studioBackdrop';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    m,
  };
}

describe('studio backdrop store', () => {
  test('defaults to the Default backdrop with the floor on', () => {
    assert.deepEqual(createStudioBackdropStore(memoryStorage()).get(), DEFAULT_BACKDROP_SETTINGS);
    assert.deepEqual(createStudioBackdropStore(null).get(), DEFAULT_BACKDROP_SETTINGS);
  });

  test('persists changes and a fresh store reads them back', () => {
    const storage = memoryStorage();
    const store = createStudioBackdropStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setBackdrop('sunset');
    store.setFloor(false);
    assert.equal(calls, 2);
    const expected = { ...DEFAULT_BACKDROP_SETTINGS, id: 'sunset', floor: false };
    assert.deepEqual(JSON.parse(storage.m.get(STUDIO_BACKDROP_KEY)!), expected);
    assert.deepEqual(createStudioBackdropStore(storage).get(), expected);
  });

  test('setCustomColor switches to the custom backdrop and normalizes the color', () => {
    const store = createStudioBackdropStore(memoryStorage());
    store.setCustomColor('#AABBCC');
    assert.deepEqual(store.get(), { id: CUSTOM_BACKDROP_ID, customColor: '#aabbcc', floor: true });
    store.setBackdrop('black');
    assert.equal(store.get().customColor, '#aabbcc');
  });

  test('ignores unknown ids, bad colors and no-op changes', () => {
    const storage = memoryStorage();
    const store = createStudioBackdropStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setBackdrop('lava');
    store.setBackdrop('default');
    store.setCustomColor('purple');
    store.setFloor(true);
    assert.equal(calls, 0);
    assert.equal(storage.m.has(STUDIO_BACKDROP_KEY), false);
  });

  test('survives corrupt storage and a storage that throws', () => {
    assert.deepEqual(createStudioBackdropStore(memoryStorage({ [STUDIO_BACKDROP_KEY]: '{oops' })).get(), DEFAULT_BACKDROP_SETTINGS);
    const store = createStudioBackdropStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    store.setBackdrop('ocean');
    assert.equal(store.get().id, 'ocean');
  });
});
