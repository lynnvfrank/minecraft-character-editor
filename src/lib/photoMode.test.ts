import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_FOV_MAX,
  PHOTO_FOV_MIN,
  PHOTO_TILT_MAX,
  clampFov,
  clampTilt,
  polaroidCaption,
  polaroidLayout,
} from './photoMode';

describe('lens and tilt ranges', () => {
  test('clampFov keeps the lens in range and falls back on junk', () => {
    assert.equal(clampFov(45), 45);
    assert.equal(clampFov(1), PHOTO_FOV_MIN);
    assert.equal(clampFov(500), PHOTO_FOV_MAX);
    assert.equal(clampFov(Number.NaN), 45);
    assert.equal(clampFov(Number.NaN, 30), 30);
  });

  test('clampTilt is symmetric and 0 on junk', () => {
    assert.equal(clampTilt(10), 10);
    assert.equal(clampTilt(90), PHOTO_TILT_MAX);
    assert.equal(clampTilt(-90), -PHOTO_TILT_MAX);
    assert.equal(clampTilt(Number.NaN), 0);
  });
});

describe('polaroidLayout', () => {
  test('margins and caption strip follow the shorter side', () => {
    const l = polaroidLayout(1600, 1000);
    assert.deepEqual(l, {
      width: 1700,
      height: 1250,
      imageX: 50,
      imageY: 50,
      imageWidth: 1600,
      imageHeight: 1000,
      captionX: 850,
      captionY: 1150,
      fontPx: 68,
    });
  });

  test('the photo sits inside the card with room for the caption below', () => {
    for (const [w, h] of [[1920, 1080], [800, 1400], [333, 333], [40, 30], [1, 1]] as const) {
      const l = polaroidLayout(w, h);
      assert.equal(l.width - l.imageWidth, l.imageX * 2, 'even side margins');
      assert.equal(l.imageY, l.imageX, 'top margin matches the sides');
      const strip = l.height - (l.imageY + l.imageHeight);
      assert.ok(strip > l.imageX, 'bottom strip is taller than the margin');
      assert.ok(l.captionY > l.imageY + l.imageHeight && l.captionY < l.height);
      assert.ok(l.fontPx < strip);
      assert.equal(l.captionX * 2 === l.width || Math.abs(l.captionX * 2 - l.width) <= 1, true);
    }
  });

  test('junk sizes still give a card', () => {
    const l = polaroidLayout(Number.NaN, -5);
    assert.equal(l.imageWidth, 1);
    assert.equal(l.imageHeight, 1);
    assert.ok(l.width > 1 && l.height > 1);
  });
});

describe('polaroidCaption', () => {
  test('date and part of day', () => {
    assert.equal(polaroidCaption(new Date(2026, 10, 21, 15, 0, 0), 'Evening'), '21 Nov 2026 · Evening');
    assert.equal(polaroidCaption(new Date(2026, 0, 5), 'dawn'), '5 Jan 2026 · Dawn');
    assert.equal(polaroidCaption(new Date(2026, 0, 5), '  '), '5 Jan 2026');
  });
});
