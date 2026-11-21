import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSkinPixels, getPixel, key, rgbToHsv, setPixel, type RGBA, type SkinPixels } from './skinStyler';
import { FEATURE_CODE, FEATURE_MAP_SIZE, createFeatureMap, isOverlayTexel, isUsedTexel, type TaggedSkin } from './featureMap';
import { dressMe, irisPixels, type MeLook } from './meLook';

const TONE: RGBA = [205, 145, 115, 255];
const HAIR: RGBA = [90, 50, 20, 255];
const SHIRT: RGBA = [10, 180, 40, 255];
const IRIS: RGBA = [30, 60, 200, 255];
const WHITE: RGBA = [250, 250, 250, 255];

/** Brown hair on the head, a skin face with white+blue eyes on row 12, a green shirt. */
function sample(): TaggedSkin {
  const image = createSkinPixels(64, 64);
  const map = createFeatureMap();
  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    if (!isUsedTexel(k) || isOverlayTexel(k)) continue;
    const x = k % 64;
    const y = (k / 64) | 0;
    let c = TONE;
    let code = FEATURE_CODE.skin;
    if (y < 16 && !(y >= 10 && x >= 8 && x < 16)) [c, code] = [HAIR, FEATURE_CODE.hair];
    else if (y >= 20 && y < 32 && x >= 16 && x < 40) [c, code] = [SHIRT, FEATURE_CODE.outfit];
    setPixel(image, x, y, c);
    map[k] = code;
  }
  for (const [x, c] of [[9, WHITE], [10, IRIS], [13, IRIS], [14, WHITE]] as const) {
    setPixel(image, x, 12, c);
    map[key(x, 12)] = FEATURE_CODE.eyes;
  }
  return { pixels: image, map };
}

const plain = (): MeLook => ({
  hair: { style: null, color: null },
  eyes: { style: null, color: null },
  skin: { style: null, color: null },
});

function hueOf(img: SkinPixels, x: number, y: number): number {
  const [r, g, b] = getPixel(img, x, y);
  return rgbToHsv(r / 255, g / 255, b / 255)[0];
}

describe('dressMe', () => {
  test('with no choices the outfit is unchanged', () => {
    const s = sample();
    const out = dressMe(s, plain());
    for (const [x, y] of [[4, 12], [10, 12], [22, 25], [11, 14]] as const) {
      assert.deepEqual(getPixel(out, x, y), getPixel(s.pixels, x, y));
    }
  });

  test('hair color recolors hair only', () => {
    const s = sample();
    const look = plain();
    look.hair.color = [40, 200, 60];
    const out = dressMe(s, look);
    assert.ok(Math.abs(hueOf(out, 4, 12) - 0.35) < 0.05, `hair hue ${hueOf(out, 4, 12)}`);
    assert.deepEqual(getPixel(out, 22, 25), SHIRT);
    assert.deepEqual(getPixel(out, 11, 14), TONE);
  });

  test('eye color changes the iris, not the whites or the skin', () => {
    const s = sample();
    const look = plain();
    look.eyes.color = [200, 40, 40];
    const out = dressMe(s, look);
    const h = hueOf(out, 10, 12);
    assert.ok(h < 0.05 || h > 0.95, `iris hue ${h}`);
    assert.deepEqual(getPixel(out, 9, 12), WHITE);
    assert.deepEqual(getPixel(out, 11, 14), TONE);
  });

  test('skin color recolors skin, keeps the outfit and hair', () => {
    const s = sample();
    const look = plain();
    look.skin.color = [110, 70, 50];
    const out = dressMe(s, look);
    assert.notDeepEqual(getPixel(out, 11, 14), TONE);
    assert.deepEqual(getPixel(out, 22, 25), SHIRT);
    assert.deepEqual(getPixel(out, 4, 12), HAIR);
  });

  test('irisPixels skips whites', () => {
    const s = sample();
    const iris = irisPixels(s.pixels, [key(9, 12), key(10, 12), key(13, 12), key(14, 12)]);
    assert.deepEqual([...iris].sort((a, b) => a - b), [key(10, 12), key(13, 12)]);
  });
});
