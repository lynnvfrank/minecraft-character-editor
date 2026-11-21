import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createVillageSaveSection, createVillageStore, VILLAGE_KEY } from './villageStore';
import { VILLAGE_MAP } from '../domain/blockWorld';
import { applyVillageEdit } from '../domain/villageEdit';
import { buildSaveFile, parseSaveFile } from '../domain/saveFile';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

function edited(col = 0, row = 2, tile = 'T'): readonly string[] {
  const result = applyVillageEdit(VILLAGE_MAP, col, row, tile);
  assert.ok(result.ok);
  return result.map;
}

describe('villageStore', () => {
  test('starts as the built-in village and writes nothing', () => {
    const storage = memoryStorage();
    const store = createVillageStore(storage);
    assert.equal(store.get(), VILLAGE_MAP);
    assert.equal(store.isCustom(), false);
    assert.equal(storage.m.size, 0);
    assert.equal(createVillageStore(null).get(), VILLAGE_MAP);
  });

  test('set persists under the documented key, notifies once, and a new store reads it back', () => {
    const storage = memoryStorage();
    const store = createVillageStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    const map = edited();
    assert.equal(store.set(map), true);
    assert.deepEqual(store.get(), map);
    assert.equal(store.isCustom(), true);
    assert.equal(calls, 1);
    assert.equal(store.set(map), true); // no change: no notification
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(storage.m.get(VILLAGE_KEY)!), map);
    assert.deepEqual(createVillageStore(storage).get(), map);
  });

  test('a map that breaks the rules is refused and nothing changes', () => {
    const storage = memoryStorage();
    const store = createVillageStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    const blockedCentre = VILLAGE_MAP.map((row, r) => (r === 18 ? row.slice(0, 18) + 'T' + row.slice(19) : row));
    assert.equal(store.set(blockedCentre), false);
    assert.equal(store.set(VILLAGE_MAP.slice(1)), false);
    assert.equal(store.get(), VILLAGE_MAP);
    assert.equal(calls, 0);
    assert.equal(storage.m.size, 0);
  });

  test('reset (or painting back to the original) returns to the built-in map and clears storage', () => {
    const storage = memoryStorage();
    const store = createVillageStore(storage);
    store.set(edited());
    let calls = 0;
    store.subscribe(() => calls++);
    store.reset();
    assert.equal(store.get(), VILLAGE_MAP);
    assert.equal(storage.m.has(VILLAGE_KEY), false);
    assert.equal(calls, 1);
    store.reset();
    assert.equal(calls, 1);
    store.set(edited());
    store.set([...VILLAGE_MAP]);
    assert.equal(store.isCustom(), false);
    assert.equal(storage.m.has(VILLAGE_KEY), false);
  });

  test('damaged or rule-breaking storage falls back to the built-in village', () => {
    const sealedGarden = VILLAGE_MAP.map((row, r) => (r === 27 ? row.slice(0, 12) + 'f' + row.slice(13) : row));
    const bad = [
      'not json',
      '{"rows":[]}',
      '[]',
      JSON.stringify(VILLAGE_MAP.slice(1)),
      JSON.stringify(VILLAGE_MAP.map((row) => row.replace('.', '?'))),
      JSON.stringify(sealedGarden),
    ];
    for (const text of bad) {
      assert.equal(createVillageStore(memoryStorage({ [VILLAGE_KEY]: text })).get(), VILLAGE_MAP, text.slice(0, 30));
    }
  });

  test('storage that throws is survived', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const store = createVillageStore(throwing);
    assert.equal(store.get(), VILLAGE_MAP);
    assert.equal(store.set(edited()), true);
    assert.equal(store.isCustom(), true);
  });
});

describe('village backup section', () => {
  test('round-trips through the backup file and replaces the live village', () => {
    const source = createVillageStore(memoryStorage());
    const map = edited(3, 30, 'L');
    source.set(map);
    const section = createVillageSaveSection(source);
    assert.equal(section.key, 'village');
    const file = JSON.stringify(buildSaveFile({ village: section.read() }));

    const target = createVillageStore(memoryStorage());
    target.set(edited(0, 2, 'r'));
    const parsed = parseSaveFile(file, [createVillageSaveSection(target)]);
    assert.ok(parsed.ok);
    assert.equal(parsed.entries.length, 1);
    assert.match(parsed.entries[0]!.summary, /replaces yours/);
    parsed.entries[0]!.apply();
    assert.deepEqual(target.get(), map);
  });

  test('a backup made before any building restores the original village', () => {
    const untouched = createVillageSaveSection(createVillageStore(null));
    const file = JSON.stringify(buildSaveFile({ village: untouched.read() }));
    const target = createVillageStore(memoryStorage());
    target.set(edited());
    const parsed = parseSaveFile(file, [createVillageSaveSection(target)]);
    assert.ok(parsed.ok);
    assert.match(parsed.entries[0]!.summary, /original/);
    parsed.entries[0]!.apply();
    assert.equal(target.isCustom(), false);
  });

  test('parse fully validates: a broken village in a file is skipped', () => {
    const section = createVillageSaveSection(createVillageStore(null));
    assert.equal(section.parse('nope'), null);
    assert.equal(section.parse(VILLAGE_MAP.slice(2)), null);
    assert.equal(section.parse(VILLAGE_MAP.map((row, r) => (r === 0 ? row.replace('==', '..') : row))), null);
    const parsed = parseSaveFile(JSON.stringify(buildSaveFile({ village: ['x'], other: 1 })), [section, { key: 'other', label: 'Other', read: () => 1, parse: (v: unknown) => v, write: () => {} }]);
    assert.ok(parsed.ok);
    assert.equal(parsed.entries.length, 1);
    assert.deepEqual(parsed.skipped, ['Village layout']);
  });
});
