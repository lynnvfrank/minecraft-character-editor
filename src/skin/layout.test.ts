import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYER_KEYS,
  SKIN_LAYER_BOUNDS,
  SKIN_PART_BOUNDS,
  WARDROBE_COMPOSITE_BOUNDS,
  getPartBounds,
  partToLayer,
  isInDeadZone,
  UV_PART_TO_LAYER,
  type Bounds,
} from './layout';
import {
  WORK_SIZE,
  workingToSkin,
  skinToWorking,
  snapWorkingToSkinCellCenter,
  uvToWorkingCoords,
} from './coordinates';

const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('skin layout', () => {
  test('every layer rect is inside the 64×64 texture', () => {
    for (const key of LAYER_KEYS) {
      for (const b of SKIN_LAYER_BOUNDS[key]) {
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 64 && b.y + b.h <= 64, `${key} out of bounds`);
      }
    }
  });

  test('no two layer rects overlap (each texel belongs to at most one layer)', () => {
    const all = LAYER_KEYS.flatMap((k) => SKIN_LAYER_BOUNDS[k].map((b) => ({ k, b })));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        assert.ok(!overlaps(all[i]!.b, all[j]!.b), `${all[i]!.k} overlaps ${all[j]!.k}`);
      }
    }
  });

  test('limbs have right (index 0) and left (index 1) rects matching Minecraft layout', () => {
    assert.deepEqual(SKIN_LAYER_BOUNDS.arms[0], { x: 40, y: 16, w: 16, h: 16 }); // right arm
    assert.deepEqual(SKIN_LAYER_BOUNDS.arms[1], { x: 32, y: 48, w: 16, h: 16 }); // left arm
    assert.deepEqual(SKIN_LAYER_BOUNDS.legs[1], { x: 16, y: 48, w: 16, h: 16 }); // left leg
  });

  test('part display names round-trip to their layer', () => {
    for (const { part } of SKIN_PART_BOUNDS) {
      const layer = partToLayer(part);
      assert.ok(layer, `no layer for ${part}`);
    }
    assert.equal(partToLayer('Left sleeve'), 'sleeves');
    assert.equal(partToLayer('nope'), null);
  });

  test('getPartBounds resolves atomic, composite, and unknown parts', () => {
    assert.deepEqual(getPartBounds('head'), SKIN_LAYER_BOUNDS.head);
    assert.deepEqual(getPartBounds('top'), WARDROBE_COMPOSITE_BOUNDS.top);
    assert.deepEqual(getPartBounds('unknown'), []);
  });

  test('every UV part maps to a layer', () => {
    assert.equal(UV_PART_TO_LAYER.sleeveL, 'sleeves');
    assert.equal(UV_PART_TO_LAYER.head, 'head');
  });

  test('dead zones', () => {
    assert.equal(isInDeadZone(0, 0), true);
    assert.equal(isInDeadZone(8, 8), false); // head front
  });
});

describe('skin coordinates', () => {
  test('working ↔ skin round trip', () => {
    assert.deepEqual(workingToSkin(5, 7), { x: 2, y: 3 });
    assert.deepEqual(skinToWorking(2, 3), { x: 4, y: 6 });
  });

  test('snap to cell center stays on the 64 grid and inside the canvas', () => {
    assert.deepEqual(snapWorkingToSkinCellCenter(4, 5), { x: 5, y: 5 });
    const edge = snapWorkingToSkinCellCenter(WORK_SIZE + 10, -3);
    assert.ok(edge.x <= WORK_SIZE - 1 && edge.y >= 0);
  });

  test('uv flips v and clamps', () => {
    assert.deepEqual(uvToWorkingCoords(0, 1), { x: 0, y: 0 });
    assert.deepEqual(uvToWorkingCoords(1, 0), { x: WORK_SIZE - 1, y: WORK_SIZE - 1 });
  });
});
