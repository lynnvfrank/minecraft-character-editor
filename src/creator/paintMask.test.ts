import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFullSkinVisible,
  computeVisibleSkinRegions,
  focusedCrop,
  layerAtSkinPixel,
  isInSelectedLayers,
  canPaintAtSkinPixel,
  lockedLayerAtSkinPixel,
  getTemplateLabelText,
} from './paintMask';
import { createCreatorState } from '../state/creatorState';
import { SKIN_LAYER_BOUNDS, LAYER_KEYS } from '../skin';

const fresh = () => createCreatorState();
const head = SKIN_LAYER_BOUNDS.head[0]!;
const hat = SKIN_LAYER_BOUNDS.hat[0]!;
const [armR, armL] = SKIN_LAYER_BOUNDS.arms as [typeof head, typeof head];

describe('visibility', () => {
  test('default state shows the full skin', () => {
    assert.equal(isFullSkinVisible(fresh()), true);
    const regions = computeVisibleSkinRegions(fresh());
    const total = LAYER_KEYS.reduce((n, k) => n + SKIN_LAYER_BOUNDS[k].length, 0);
    assert.equal(regions.length, total);
  });

  test('a hidden part breaks full visibility and drops one region', () => {
    const s = fresh();
    s.layer3DPartVisible.arms = { L: false };
    assert.equal(isFullSkinVisible(s), false);
    const arms = computeVisibleSkinRegions(s).filter((r) => r.layerKey === 'arms');
    assert.deepEqual(arms.map((r) => r.partIndex), [0], 'only the right arm (index 0) remains');
  });

  test('focusedCrop: null for the full skin, bounding box for a subset', () => {
    assert.equal(focusedCrop(computeVisibleSkinRegions(fresh())), null);
    assert.equal(focusedCrop([]), null);
    const s = fresh();
    for (const k of LAYER_KEYS) s.layer3DVisible[k] = k === 'head';
    assert.deepEqual(focusedCrop(computeVisibleSkinRegions(s)), { x: head.x, y: head.y, w: head.w, h: head.h });
  });
});

describe('layerAtSkinPixel', () => {
  test('finds the layer under a pixel', () => {
    assert.equal(layerAtSkinPixel(fresh(), head.x, head.y), 'head');
    assert.equal(layerAtSkinPixel(fresh(), armL.x, armL.y), 'arms');
  });

  test('right edge is exclusive', () => {
    const s = fresh();
    const x = head.x + head.w; // first pixel past the head box
    const got = layerAtSkinPixel(s, x, head.y);
    assert.notEqual(got, 'head');
  });

  test('hidden layer or hidden side is skipped', () => {
    const s = fresh();
    s.layer3DVisible.head = false;
    assert.equal(layerAtSkinPixel(s, head.x, head.y), null);
    s.layer3DPartVisible.arms = { R: false };
    assert.equal(layerAtSkinPixel(s, armR.x, armR.y), null);
    assert.equal(layerAtSkinPixel(s, armL.x, armL.y), 'arms');
  });
});

describe('painting rules', () => {
  test('unrestricted or nothing selected: anywhere is in selection', () => {
    const s = fresh();
    s.restrictToLayers = false;
    assert.equal(isInSelectedLayers(s, hat.x, hat.y), true);
    s.restrictToLayers = true;
    s.selectedLayers = new Set();
    assert.equal(isInSelectedLayers(s, hat.x, hat.y), true);
  });

  test('restricted selection limits painting', () => {
    const s = fresh();
    s.selectedLayers = new Set(['head']);
    assert.equal(canPaintAtSkinPixel(s, head.x, head.y), true);
    assert.equal(canPaintAtSkinPixel(s, hat.x, hat.y), false);
  });

  test('locked layer blocks painting and reports the lock', () => {
    const s = fresh();
    s.layer3DLocked.head = true;
    assert.equal(canPaintAtSkinPixel(s, head.x, head.y), false);
    assert.equal(lockedLayerAtSkinPixel(s, head.x, head.y), 'head');
    assert.equal(lockedLayerAtSkinPixel(s, hat.x, hat.y), null);
  });

  test('a pixel outside every layer box is not paintable', () => {
    let outside: { x: number; y: number } | null = null;
    for (let y = 0; y < 64 && !outside; y++) {
      for (let x = 0; x < 64 && !outside; x++) {
        const covered = LAYER_KEYS.some((k) =>
          SKIN_LAYER_BOUNDS[k].some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
        );
        if (!covered) outside = { x, y };
      }
    }
    assert.ok(outside, 'layout has at least one uncovered pixel');
    assert.equal(layerAtSkinPixel(fresh(), outside.x, outside.y), null);
    assert.equal(canPaintAtSkinPixel(fresh(), outside.x, outside.y), false);
  });
});

describe('getTemplateLabelText', () => {
  test('sided labels for limbs, capitalised name otherwise', () => {
    assert.equal(getTemplateLabelText('arms', armR), 'Right Arm');
    assert.equal(getTemplateLabelText('arms', armL), 'Left Arm');
    assert.equal(getTemplateLabelText('head', head), 'Head');
  });
});
