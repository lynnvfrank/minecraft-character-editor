import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WARDROBE_ORIGINAL,
  applyMutuallyExclusiveCompositeClears,
  createDefaultWardrobeSelections,
  getWardrobeResolvePartOrder,
  getWardrobeResolveStep,
  type WardrobeSelectionState,
} from './wardrobeSelection';
import { WARDROBE_PART_KEYS } from './wardrobeLayers';

/** Every part picked, so we can see exactly what a new pick clears. */
function allPicked(): WardrobeSelectionState {
  return Object.fromEntries(WARDROBE_PART_KEYS.map((k) => [k, `/${k}.png`])) as WardrobeSelectionState;
}
const cleared = (s: WardrobeSelectionState) => WARDROBE_PART_KEYS.filter((k) => s[k] === null).sort();

describe('default selections', () => {
  test('overlays use the base skin; other parts are unselected', () => {
    const s = createDefaultWardrobeSelections();
    assert.equal(s.hat, WARDROBE_ORIGINAL);
    assert.equal(s.jacket, WARDROBE_ORIGINAL);
    assert.equal(s.head, null);
    assert.equal(s.torso, null);
    assert.deepEqual(Object.keys(s).sort(), [...WARDROBE_PART_KEYS].sort());
  });
});

describe('resolve step', () => {
  test('ORIGINAL keeps the base; a path draws', () => {
    assert.deepEqual(getWardrobeResolveStep('hat', WARDROBE_ORIGINAL), { kind: 'keepBase' });
    assert.deepEqual(getWardrobeResolveStep('head', '/x.png'), { kind: 'draw', path: '/x.png' });
  });
  test('unselected overlay is cleared; unselected base part is kept', () => {
    assert.deepEqual(getWardrobeResolveStep('hat', null), { kind: 'clear' });
    assert.deepEqual(getWardrobeResolveStep('head', null), { kind: 'keepBase' });
  });
});

describe('resolve order', () => {
  test('contains every part exactly once', () => {
    const order = getWardrobeResolvePartOrder();
    assert.deepEqual([...order].sort(), [...WARDROBE_PART_KEYS].sort());
  });
  test('composites paint before the atomics that overlap them', () => {
    const order = getWardrobeResolvePartOrder();
    const at = (k: string) => order.indexOf(k as never);
    assert.ok(at('center') < at('jacket'));
    assert.ok(at('center') < at('body'));
    assert.ok(at('torso') < at('body'));
    assert.ok(at('torso') < at('arms'));
  });
});

describe('mutually exclusive clears', () => {
  test('picking head clears all and top', () => {
    const s = allPicked();
    applyMutuallyExclusiveCompositeClears(s, 'head');
    assert.deepEqual(cleared(s), ['all', 'top']);
  });

  test('picking legs clears all and bottom', () => {
    const s = allPicked();
    applyMutuallyExclusiveCompositeClears(s, 'legs');
    assert.deepEqual(cleared(s), ['all', 'bottom']);
  });

  test('committing an upper atomic clears torso and jacketGroup but keeps center', () => {
    const s = allPicked();
    applyMutuallyExclusiveCompositeClears(s, 'arms');
    assert.deepEqual(cleared(s), ['all', 'jacketGroup', 'torso']);
    assert.equal(s.center, '/center.png');
  });

  test('hovering an upper atomic keeps every composite', () => {
    const s = allPicked();
    applyMutuallyExclusiveCompositeClears(s, 'sleeves', { hoverPreview: true });
    assert.deepEqual(cleared(s), ['all']);
  });

  test('composites exclude each other', () => {
    const s = allPicked();
    applyMutuallyExclusiveCompositeClears(s, 'torso');
    assert.deepEqual(cleared(s), ['all', 'center', 'jacketGroup']);
  });

  test('hovering jacketGroup keeps a committed center', () => {
    const s = allPicked();
    applyMutuallyExclusiveCompositeClears(s, 'jacketGroup', { hoverPreview: true });
    assert.deepEqual(cleared(s), ['all', 'torso']);
    const committed = allPicked();
    applyMutuallyExclusiveCompositeClears(committed, 'jacketGroup');
    assert.deepEqual(cleared(committed), ['all', 'center', 'torso']);
  });
});
