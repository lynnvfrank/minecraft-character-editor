import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addResident,
  crowdSkinsFor,
  diffResidents,
  isCustomSkin,
  isOutfitKey,
  normalizeRoster,
  outfitIdFromKey,
  outfitRosterKey,
  parseResidents,
  toggleResident,
} from './residents';

const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

describe('residents: my outfits', () => {
  test('outfit keys: made, recognised and read back', () => {
    assert.equal(outfitRosterKey('abc'), 'outfit:abc');
    assert.equal(isOutfitKey('outfit:abc'), true);
    assert.equal(isOutfitKey('outfit:'), false);
    assert.equal(isOutfitKey('/wardrobe/skins/outfit:abc.png'), false);
    assert.equal(isOutfitKey(null), false);
    assert.equal(outfitIdFromKey('outfit:abc'), 'abc');
    assert.equal(outfitIdFromKey('a'), null);
  });

  test('outfit keys are ordinary roster entries: parsed, validated, toggled and pruned like skins', () => {
    const available = [...ALL, 'outfit:x', 'outfit:y'];
    assert.deepEqual(parseResidents('["a","outfit:x",5,"outfit:x"]'), ['a', 'outfit:x']);
    assert.deepEqual(normalizeRoster(['outfit:x', 'a', 'outfit:gone'], available, 8), ['outfit:x', 'a']);
    // The main character wearing an outfit is kept first, like any main character.
    assert.deepEqual(normalizeRoster(['a', 'b'], available, 2, 'outfit:y'), ['outfit:y', 'a']);
    assert.deepEqual(toggleResident(['a'], 'outfit:x', { available, cap: 3 }), {
      roster: ['a', 'outfit:x'],
      outcome: 'added',
    });
    assert.equal(toggleResident(['a'], 'outfit:gone', { available, cap: 3 }).outcome, 'unknown');
    assert.equal(
      toggleResident(['a', 'outfit:x'], 'outfit:x', { available, cap: 3, locked: 'outfit:x' }).outcome,
      'locked'
    );
    assert.deepEqual(crowdSkinsFor(['a', 'outfit:x', 'outfit:y'], 'outfit:x'), ['a', 'outfit:y']);
  });

  test('an outfit key is never a custom skin, so a deleted outfit is sent home', () => {
    const available = [...ALL, 'outfit:x'];
    assert.equal(isCustomSkin('outfit:x', available), false);
    assert.equal(isCustomSkin('outfit:deleted', available), false);
    assert.equal(isCustomSkin('data:image/png;base64,AAAA', available), true);
    const crowd = [
      { id: 'crowd-1', skin: 'outfit:x' },
      { id: 'crowd-2', skin: 'outfit:deleted' },
      { id: 'crowd-3', skin: 'data:image/png;base64,AAAA' },
      { id: 'crowd-4', skin: 'outfit:x' }, // a twin
    ];
    assert.deepEqual(diffResidents(crowd, ['outfit:x', 'a'], available), {
      toAdd: ['a'],
      toRemove: ['crowd-2', 'crowd-4'],
    });
    assert.deepEqual(diffResidents(crowd, ['a'], available).toRemove, ['crowd-1', 'crowd-2', 'crowd-4']);
  });

  test('addResident: starts from the stored roster or from who is present, and respects the cap', () => {
    const available = [...ALL, 'outfit:x'];
    assert.deepEqual(addResident(['a', 'b'], ['c'], available, 4, 'outfit:x'), {
      roster: ['a', 'b', 'outfit:x'],
      outcome: 'added',
    });
    assert.deepEqual(addResident(null, ['c', 'd', 'blob:edited'], available, 4, 'outfit:x'), {
      roster: ['c', 'd', 'outfit:x'],
      outcome: 'added',
    });
    assert.deepEqual(addResident([], ['c'], available, 4, 'outfit:x'), { roster: ['outfit:x'], outcome: 'added' });
    assert.deepEqual(addResident(['a', 'outfit:x'], [], available, 4, 'outfit:x'), {
      roster: ['a', 'outfit:x'],
      outcome: 'already',
    });
    assert.deepEqual(addResident(['a', 'b'], [], available, 2, 'outfit:x'), { roster: ['a', 'b'], outcome: 'full' });
    assert.equal(addResident(['a'], [], available, 4, 'outfit:gone').outcome, 'unknown');
  });
});
