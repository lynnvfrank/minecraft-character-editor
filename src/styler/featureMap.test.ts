import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSkinPixels, getPixel, key, setPixel, type RGBA, type SkinPixels } from './skinStyler';
import {
  FEATURE_CODE,
  FEATURE_MAP_SIZE,
  autoTagFeatures,
  composeFeatures,
  countLabels,
  createFeatureMap,
  decodeFeatureMap,
  encodeFeatureMap,
  isOverlayTexel,
  isUsedTexel,
  labelAt,
  pixelsWithLabel,
  type FeatureMap,
} from './featureMap';

const SKIN: RGBA = [205, 145, 115, 255];

/** Head of `hair` with a skin face, two eyes, a green shirt, skin arms and legs. */
function sampleSkin(hair: RGBA, shirt: RGBA, eye: RGBA = [20, 30, 80, 255], tone: RGBA = SKIN): SkinPixels {
  const image = createSkinPixels(64, 64);
  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    if (isUsedTexel(k) && !isOverlayTexel(k)) setPixel(image, k % 64, (k / 64) | 0, tone);
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (isUsedTexel(key(x, y))) setPixel(image, x, y, hair);
  for (let y = 10; y < 16; y++) for (let x = 8; x < 16; x++) setPixel(image, x, y, tone);
  setPixel(image, 9, 12, eye);
  setPixel(image, 14, 12, eye);
  for (let y = 20; y < 32; y++) for (let x = 16; x < 40; x++) if (isUsedTexel(key(x, y))) setPixel(image, x, y, shirt);
  return image;
}

/** Hand-made map matching sampleSkin's drawing. */
function sampleMap(skin: SkinPixels): FeatureMap {
  const map = createFeatureMap();
  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    if (!isUsedTexel(k) || skin.data[k * 4 + 3] === 0) continue;
    const x = k % 64;
    const y = (k / 64) | 0;
    if (y < 16 && !(y >= 10 && x >= 8 && x < 16)) map[k] = FEATURE_CODE.hair;
    else if (y >= 20 && y < 32 && x >= 16 && x < 40) map[k] = FEATURE_CODE.outfit;
    else map[k] = FEATURE_CODE.skin;
  }
  map[key(9, 12)] = FEATURE_CODE.eyes;
  map[key(14, 12)] = FEATURE_CODE.eyes;
  return map;
}

describe('feature map layout', () => {
  test('head front is inner, hat front is overlay, head corner is unused', () => {
    assert.equal(isUsedTexel(key(10, 10)), true);
    assert.equal(isOverlayTexel(key(10, 10)), false);
    assert.equal(isOverlayTexel(key(42, 10)), true);
    assert.equal(isUsedTexel(key(2, 2)), false);
  });
});

describe('encode / decode', () => {
  test('round-trips a map', () => {
    const map = sampleMap(sampleSkin([40, 20, 10, 255], [10, 180, 40, 255]));
    const text = encodeFeatureMap(map);
    assert.ok(text.length < 1500, `encoded length ${text.length}`);
    assert.deepEqual(decodeFeatureMap(text), map);
  });

  test('round-trips an empty map', () => {
    const map = createFeatureMap();
    assert.equal(encodeFeatureMap(map), 'n4096');
    assert.deepEqual(decodeFeatureMap('n4096'), map);
  });

  test('rejects short, long and malformed strings', () => {
    assert.equal(decodeFeatureMap('n4095'), null);
    assert.equal(decodeFeatureMap('n4097'), null);
    assert.equal(decodeFeatureMap('n4000x96'), null);
    assert.equal(decodeFeatureMap(42), null);
    assert.equal(decodeFeatureMap('n0n4096'), null);
  });
});

describe('autoTagFeatures', () => {
  test('finds hair, eyes, skin and outfit on a simple skin', () => {
    const skin = sampleSkin([40, 20, 10, 255], [10, 180, 40, 255]);
    const map = autoTagFeatures(skin);
    assert.equal(labelAt(map, key(4, 12)), 'hair'); // head side
    assert.equal(labelAt(map, key(9, 12)), 'eyes');
    assert.equal(labelAt(map, key(11, 14)), 'skin');
    assert.equal(labelAt(map, key(22, 25)), 'outfit'); // shirt front
    assert.equal(labelAt(map, key(2, 2)), null); // unused corner
    const counts = countLabels(map);
    assert.ok(counts.hair > 100 && counts.skin > 100 && counts.outfit > 50, JSON.stringify(counts));
  });
});

describe('composeFeatures', () => {
  const a = sampleSkin([40, 20, 10, 255], [10, 180, 40, 255]); // brown hair, green shirt
  const b = sampleSkin([250, 220, 90, 255], [200, 30, 30, 255], [10, 120, 20, 255], [120, 80, 60, 255]); // blond, red, green eyes, dark tone
  const ta = { pixels: a, map: sampleMap(a) };
  const tb = { pixels: b, map: sampleMap(b) };

  test('with only outfit it reproduces the skin', () => {
    const out = composeFeatures({ outfit: ta });
    for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
      if (!isUsedTexel(k) || isOverlayTexel(k)) continue;
      assert.deepEqual(getPixel(out, k % 64, (k / 64) | 0), getPixel(a, k % 64, (k / 64) | 0), `pixel ${k}`);
    }
  });

  test('takes hair, eyes and tone from other skins and keeps the outfit', () => {
    const out = composeFeatures({ outfit: ta, hair: tb, eyes: tb, skin: tb });
    assert.deepEqual(getPixel(out, 4, 12), [250, 220, 90, 255]); // b's hair
    assert.deepEqual(getPixel(out, 9, 12), [10, 120, 20, 255]); // b's eyes
    assert.deepEqual(getPixel(out, 22, 25), [10, 180, 40, 255]); // a's shirt
    assert.deepEqual(getPixel(out, 11, 14), [120, 80, 60, 255]); // b's tone on the face
    assert.deepEqual(getPixel(out, 44, 25), [120, 80, 60, 255]); // b's tone on the arm
  });

  test('hair that is not chosen becomes skin on the inner layer', () => {
    assert.ok(pixelsWithLabel(ta.map, 'hair').has(key(4, 12)));
    const shaved = composeFeatures({ outfit: ta, hair: { pixels: a, map: createFeatureMap() }, skin: ta });
    assert.deepEqual(getPixel(shaved, 4, 12), SKIN);
  });
});
