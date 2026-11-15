import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maskHiddenLayerRegions, buildLayerVisibleState } from './skinCompositor';
import { SKIN_LAYER_BOUNDS, LAYER_KEYS } from '../skin';

function opaque(size: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(size * size * 4);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return d;
}
const alphaAt = (d: Uint8ClampedArray, size: number, x: number, y: number) => d[(y * size + x) * 4 + 3];
const allVisible = () => Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));

describe('buildLayerVisibleState', () => {
  test('marks only listed layers visible', () => {
    const v = buildLayerVisibleState(['head', 'hat']);
    assert.equal(v.head, true);
    assert.equal(v.hat, true);
    assert.equal(v.body, false);
    assert.deepEqual(Object.keys(v).sort(), [...LAYER_KEYS].sort());
  });
});

describe('maskHiddenLayerRegions', () => {
  test('all visible leaves pixels untouched', () => {
    const d = opaque(64);
    maskHiddenLayerRegions(d, 64, allVisible(), {});
    assert.ok(d.every((v, i) => i % 4 !== 3 || v === 255));
  });

  test('hidden layer clears its bounds and nothing else', () => {
    const d = opaque(64);
    maskHiddenLayerRegions(d, 64, { ...allVisible(), head: false }, {});
    const b = SKIN_LAYER_BOUNDS.head[0]!;
    assert.equal(alphaAt(d, 64, b.x, b.y), 0);
    assert.equal(alphaAt(d, 64, b.x + b.w - 1, b.y + b.h - 1), 0);
    const body = SKIN_LAYER_BOUNDS.body[0]!;
    assert.equal(alphaAt(d, 64, body.x, body.y), 255);
  });

  test('scales bounds with buffer size', () => {
    const size = 128;
    const d = opaque(size);
    maskHiddenLayerRegions(d, size, { ...allVisible(), head: false }, {});
    const b = SKIN_LAYER_BOUNDS.head[0]!;
    assert.equal(alphaAt(d, size, b.x * 2 + 1, b.y * 2 + 1), 0);
    assert.equal(alphaAt(d, size, (b.x + b.w) * 2 - 1, (b.y + b.h) * 2 - 1), 0);
  });

  test('part visibility hides one side only (bounds[0] = R, bounds[1] = L)', () => {
    const d = opaque(64);
    maskHiddenLayerRegions(d, 64, allVisible(), { arms: { L: false } });
    const [r, l] = SKIN_LAYER_BOUNDS.arms;
    assert.equal(alphaAt(d, 64, l!.x, l!.y), 0);
    assert.equal(alphaAt(d, 64, r!.x, r!.y), 255);
  });

  test('part flags are ignored for layers without parts', () => {
    const d = opaque(64);
    maskHiddenLayerRegions(d, 64, allVisible(), { head: { R: false } });
    const b = SKIN_LAYER_BOUNDS.head[0]!;
    assert.equal(alphaAt(d, 64, b.x, b.y), 255);
  });
});
