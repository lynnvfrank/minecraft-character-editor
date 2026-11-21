import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { flipPixelRows, linearToSrgb, renderTargetPixelsToImageData } from './captureHelpers';

describe('flipPixelRows', () => {
  test('flips rows of a non-square buffer without changing values', () => {
    // 2 wide, 3 tall: each row filled with its WebGL row index x 100 (row 0 = bottom)
    const px = new Uint8Array(2 * 3 * 4);
    for (let row = 0; row < 3; row++) px.fill(row * 100, row * 8, row * 8 + 8);
    const out = flipPixelRows(px, 2, 3);
    assert.equal(out.length, px.length);
    assert.deepEqual([...out.slice(0, 8)], Array(8).fill(200), 'top row was the last WebGL row');
    assert.deepEqual([...out.slice(8, 16)], Array(8).fill(100));
    assert.deepEqual([...out.slice(16, 24)], Array(8).fill(0));
  });
});

describe('linearToSrgb', () => {
  test('endpoints are fixed', () => {
    assert.equal(linearToSrgb(0), 0);
    assert.ok(Math.abs(linearToSrgb(1) - 1) < 1e-9);
  });
  test('mid grey brightens (linear 0.5 ≈ sRGB 0.735)', () => {
    assert.ok(Math.abs(linearToSrgb(0.5) - 0.7354) < 1e-3);
  });
});

describe('renderTargetPixelsToImageData', () => {
  test('flips rows (WebGL is bottom-up)', () => {
    // 2x2: bottom row red, top row blue in WebGL order
    const px = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
    const out = renderTargetPixelsToImageData(px, 2);
    assert.deepEqual([...out.slice(0, 4)], [0, 0, 255, 255], 'top-left is blue');
    assert.deepEqual([...out.slice(8, 12)], [255, 0, 0, 255], 'bottom-left is red');
  });
  test('converts colour to sRGB and keeps alpha', () => {
    const out = renderTargetPixelsToImageData(new Uint8Array([128, 0, 0, 77]), 1);
    assert.equal(out[0], Math.round(linearToSrgb(128 / 255) * 255));
    assert.equal(out[3], 77);
  });
});
