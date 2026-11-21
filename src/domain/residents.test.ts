import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  crowdSkinsFor,
  diffResidents,
  effectiveRoster,
  fillRoster,
  isCustomSkin,
  normalizeRoster,
  parseResidents,
  randomRoster,
  toggleResident,
} from './residents';

const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('residents', () => {
  test('parse: null for missing or malformed data, strings only, no duplicates', () => {
    assert.equal(parseResidents(null), null);
    assert.equal(parseResidents(''), null);
    assert.equal(parseResidents('not json'), null);
    assert.equal(parseResidents('{"a":1}'), null);
    assert.deepEqual(parseResidents('[]'), []);
    assert.deepEqual(parseResidents(JSON.stringify(['a', 3, null, 'b', 'a', '', { x: 1 }])), ['a', 'b']);
  });

  test('normalize drops unknown skins and trims to the cap, keeping the primary', () => {
    assert.deepEqual(normalizeRoster(['x', 'b', 'a', 'b'], ALL, 6), ['b', 'a']);
    assert.deepEqual(normalizeRoster(['a', 'b', 'c', 'd'], ALL, 3), ['a', 'b', 'c']);
    assert.deepEqual(normalizeRoster(['a', 'b', 'c', 'd'], ALL, 3, 'd'), ['d', 'a', 'b']);
    // A primary skin that isn't in the list is not forced in.
    assert.deepEqual(normalizeRoster(['a'], ALL, 3, 'data:custom'), ['a']);
    assert.deepEqual(normalizeRoster(['a'], ALL, 0), []);
  });

  test('effective roster falls back to who is present when nothing is stored', () => {
    assert.deepEqual(effectiveRoster(null, ['c', 'zz', 'a'], ALL, 6, 'a'), ['a', 'c']);
    assert.deepEqual(effectiveRoster([], ['c'], ALL, 6, 'a'), ['a']);
    assert.deepEqual(effectiveRoster(['b'], ['c'], ALL, 6, null), ['b']);
  });

  test('toggle adds, removes, and refuses when full, locked or unknown', () => {
    const opts = { available: ALL, cap: 3, locked: 'a' };
    assert.deepEqual(toggleResident(['a'], 'b', opts), { roster: ['a', 'b'], outcome: 'added' });
    assert.deepEqual(toggleResident(['a', 'b'], 'b', opts), { roster: ['a'], outcome: 'removed' });
    assert.deepEqual(toggleResident(['a', 'b'], 'a', opts), { roster: ['a', 'b'], outcome: 'locked' });
    assert.deepEqual(toggleResident(['a', 'b', 'c'], 'd', opts), { roster: ['a', 'b', 'c'], outcome: 'full' });
    // Removing still works at the cap.
    assert.equal(toggleResident(['a', 'b', 'c'], 'c', opts).outcome, 'removed');
    assert.deepEqual(toggleResident(['a'], 'nope', opts), { roster: ['a'], outcome: 'unknown' });
  });

  test('toggle does not mutate its input', () => {
    const roster = ['a', 'b'];
    toggleResident(roster, 'b', { available: ALL, cap: 3 });
    toggleResident(roster, 'c', { available: ALL, cap: 3 });
    assert.deepEqual(roster, ['a', 'b']);
  });

  test('fill keeps current residents and tops up in list order to the cap', () => {
    assert.deepEqual(fillRoster(['g', 'c'], ALL, 4), ['g', 'c', 'a', 'b']);
    assert.deepEqual(fillRoster([], ['a', 'b'], 6), ['a', 'b']);
  });

  test('random roster: within the cap, no duplicates, includes the primary, repeatable', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = randomRoster(ALL, 5, seeded(seed), 'h');
      assert.ok(r.length >= 2 && r.length <= 5, `size ${r.length}`);
      assert.equal(new Set(r).size, r.length);
      assert.ok(r.every((s) => ALL.includes(s)));
      assert.ok(r.includes('h'));
    }
    assert.deepEqual(randomRoster(ALL, 5, seeded(7), 'h'), randomRoster(ALL, 5, seeded(7), 'h'));
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) sizes.add(randomRoster(ALL, 5, seeded(seed)).length);
    assert.deepEqual([...sizes].sort(), [2, 3, 4, 5]);
  });

  test('random roster copes with tiny lists and edge RNG values', () => {
    assert.deepEqual(randomRoster([], 5, Math.random), []);
    assert.deepEqual(randomRoster(['a'], 5, Math.random), ['a']);
    assert.deepEqual(randomRoster(ALL, 0, Math.random), []);
    assert.equal(randomRoster(ALL, 5, () => 0).length, 2);
    // An RNG that (wrongly) returns 1 must not overflow the cap or the list.
    const r = randomRoster(ALL, 5, () => 1);
    assert.equal(r.length, 5);
    assert.ok(r.every((s) => ALL.includes(s)));
  });

  test('crowd skins are the roster without the primary', () => {
    assert.deepEqual(crowdSkinsFor(['a', 'b', 'c'], 'b'), ['a', 'c']);
    assert.deepEqual(crowdSkinsFor(['a', 'b'], null), ['a', 'b']);
    assert.deepEqual(crowdSkinsFor(['a', 'b'], 'data:custom'), ['a', 'b']);
  });

  test('diff: who to add and who to remove', () => {
    const crowd = [
      { id: 'crowd-1', skin: 'a' },
      { id: 'crowd-2', skin: 'b' },
      { id: 'crowd-3', skin: 'c' },
    ];
    assert.deepEqual(diffResidents(crowd, ['a', 'b', 'c']), { toAdd: [], toRemove: [] });
    assert.deepEqual(diffResidents(crowd, ['a', 'd']), { toAdd: ['d'], toRemove: ['crowd-2', 'crowd-3'] });
    assert.deepEqual(diffResidents(crowd, []), { toAdd: [], toRemove: ['crowd-1', 'crowd-2', 'crowd-3'] });
    assert.deepEqual(diffResidents([], ['a', 'a', 'b']), { toAdd: ['a', 'b'], toRemove: [] });
  });

  test('diff removes twins and characters with no known skin', () => {
    const crowd = [
      { id: 'crowd-1', skin: 'a' },
      { id: 'crowd-2', skin: 'a' },
      { id: 'crowd-3', skin: null },
    ];
    assert.deepEqual(diffResidents(crowd, ['a']), { toAdd: [], toRemove: ['crowd-2', 'crowd-3'] });
  });

  test('a character in a custom skin (not in the skin list) is never sent home by the roster', () => {
    assert.equal(isCustomSkin('blob:edited', ALL), true);
    assert.equal(isCustomSkin('a', ALL), false);
    assert.equal(isCustomSkin(null, ALL), false);
    const crowd = [
      { id: 'crowd-1', skin: 'a' },
      { id: 'crowd-2', skin: 'blob:edited' },
      { id: 'crowd-3', skin: 'b' },
      { id: 'crowd-4', skin: null },
    ];
    // Stays whether or not anyone else does, and doesn't count as one of the wanted skins.
    assert.deepEqual(diffResidents(crowd, ['a', 'c'], ALL), { toAdd: ['c'], toRemove: ['crowd-3', 'crowd-4'] });
    assert.deepEqual(diffResidents(crowd, [], ALL), { toAdd: [], toRemove: ['crowd-1', 'crowd-3', 'crowd-4'] });
    // Without the skin list the old rule applies (unknown skins go).
    assert.deepEqual(diffResidents(crowd, ['a']).toRemove, ['crowd-2', 'crowd-3', 'crowd-4']);
  });
});
