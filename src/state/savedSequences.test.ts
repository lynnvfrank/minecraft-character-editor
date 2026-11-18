import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSavedSequencesStore, parseSavedSequences, SAVED_SEQUENCES_KEY } from './savedSequences';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const blend = { type: 'blend' as const, layers: [{ name: 'waving', weight: 1, timeScale: 1 }], duration: 3 };

describe('savedSequences', () => {
  test('add persists newest first and notifies', () => {
    const storage = memoryStorage();
    const store = createSavedSequencesStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    const a = store.add('First', [blend], 1);
    const b = store.add('  ', [blend], 2);
    assert.equal(calls, 2);
    assert.deepEqual(store.list().map((s) => s.id), [b.id, a.id]);
    assert.equal(b.label, 'My combo');
    assert.notEqual(a.id, b.id);
    // A fresh store reads the same list back.
    const again = createSavedSequencesStore(storage);
    assert.deepEqual(again.list(), store.list());
  });

  test('remove deletes by id and ignores unknown ids', () => {
    const store = createSavedSequencesStore(memoryStorage());
    const a = store.add('A', [blend], 1);
    let calls = 0;
    store.subscribe(() => calls++);
    store.remove('nope');
    assert.equal(calls, 0);
    store.remove(a.id);
    assert.equal(store.list().length, 0);
    assert.equal(calls, 1);
  });

  test('parse drops malformed entries and bad JSON', () => {
    assert.deepEqual(parseSavedSequences('not json'), []);
    assert.deepEqual(parseSavedSequences('{"a":1}'), []);
    const good = { id: 'x', label: 'X', steps: [blend] };
    const parsed = parseSavedSequences(
      JSON.stringify([
        good,
        { id: 'y', label: 'Y', steps: [] },
        { id: 'z', label: 'Z', steps: [{ type: 'blend', layers: [] }] },
        { id: 'w', label: 'W', steps: [{ type: 'teleport' }] },
      ])
    );
    assert.deepEqual(parsed, [good]);
  });

  test('works with no storage and survives a throwing storage', () => {
    const none = createSavedSequencesStore(null);
    none.add('A', [blend]);
    assert.equal(none.list().length, 1);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const s = createSavedSequencesStore(throwing);
    s.add('B', [blend]);
    assert.equal(s.list().length, 1);
  });

  test('uses the documented storage key', () => {
    const storage = memoryStorage();
    createSavedSequencesStore(storage).add('A', [blend], 5);
    assert.ok(storage.m.has(SAVED_SEQUENCES_KEY));
  });
});
