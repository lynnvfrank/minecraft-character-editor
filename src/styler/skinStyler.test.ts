import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  type RGB,
  type RGBA,
  type SkinPixels,
  type FaceTemplate,
  applyFaceTemplate,
  createSkinPixels,
  detectBodyHairMask,
  fillSmallTorsoHairGaps,
  getPixel,
  hairCorePalette,
  key,
  makeFaceTemplate,
  normalizeSkin,
  parseHexColor,
  pyRound,
  pySetOrder,
  pyTupleHash,
  rgbToHsv,
  hsvToRgb,
  setPixel,
  styleSkin,
  traceSurfaceHairPaths,
} from './skinStyler';

function syntheticSkin(hair: RGBA = [40, 20, 10, 255], eye: RGBA = [20, 30, 80, 255], size = 64): SkinPixels {
  const image = createSkinPixels(64, 64);
  const skin: RGBA = [205, 145, 115, 255];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) setPixel(image, x, y, hair);
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) setPixel(image, x, y, skin);
  setPixel(image, 10, 11, eye);
  setPixel(image, 13, 11, eye);
  setPixel(image, 11, 14, [120, 40, 45, 255]);
  setPixel(image, 12, 14, [120, 40, 45, 255]);
  for (let y = 20; y < 32; y++) for (let x = 16; x < 40; x++) setPixel(image, x, y, [10, 180, 40, 255]);
  if (size === 64) return image;
  const scale = size / 64;
  const big = createSkinPixels(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) setPixel(big, x, y, getPixel(image, Math.floor(x / scale), Math.floor(y / scale)));
  return big;
}

const px = (img: SkinPixels, x: number, y: number) => getPixel(img, x, y);
const has = (mask: Set<number>, x: number, y: number) => mask.has(key(x, y));
const hsv = (p: readonly number[]) => rgbToHsv(p[0] / 255, p[1] / 255, p[2] / 255);
const near = (a: number, b: number, delta: number) => assert.ok(Math.abs(a - b) <= delta, `${a} vs ${b}`);

describe('python helpers', () => {
  test('banker rounding', () => {
    assert.equal(pyRound(0.5), 0);
    assert.equal(pyRound(1.5), 2);
    assert.equal(pyRound(2.5), 2);
    assert.equal(pyRound(2.6), 3);
  });
  test('hsv round trip', () => {
    const [h, s, v] = rgbToHsv(0.2, 0.4, 0.9);
    const back = hsvToRgb(h, s, v);
    near(back[0], 0.2, 1e-12);
    near(back[2], 0.9, 1e-12);
  });
  test('CPython tuple hash and set order', () => {
    assert.equal(pyTupleHash(9, 13), 7725512173669746116n);
    assert.equal(pyTupleHash(63, 63), 5555937163083981899n);
    const keys: number[] = [];
    for (let y = 10; y < 15; y++) for (const x of [9, 14, 10, 13]) keys.push(key(x, y));
    // From CPython 3.14: list({(x, y) ...}) for the same insertion sequence.
    assert.deepEqual(pySetOrder(keys).slice(0, 6), [654, 846, 905, 713, 778, 717]);
  });
  test('parseHexColor', () => {
    assert.deepEqual(parseHexColor('#A45C8A'), [0xa4, 0x5c, 0x8a]);
    assert.deepEqual(parseHexColor('abc'), [0xaa, 0xbb, 0xcc]);
    assert.throws(() => parseHexColor('#12'));
    assert.throws(() => parseHexColor('#zzzzzz'));
  });
  test('normalize HD and legacy', () => {
    const hd = normalizeSkin(syntheticSkin(undefined, undefined, 128));
    assert.equal(hd.wasNormalized, true);
    assert.deepEqual(px(hd.image, 9, 1), [40, 20, 10, 255]);
    const legacy = normalizeSkin(createSkinPixels(64, 32));
    assert.equal(legacy.image.height, 64);
    assert.throws(() => normalizeSkin(createSkinPixels(50, 50)));
  });
});

describe('skin styler (ported from test_skin_styler.py)', () => {
  test('recolor is confined to head uv', () => {
    const original = syntheticSkin();
    const { image, hairMask } = styleSkin(original, { targetHairColor: [180, 40, 200], tolerance: 55 });
    assert.ok(hairMask.size);
    assert.deepEqual(px(image, 20, 25), px(original, 20, 25));
    assert.notDeepEqual(px(image, 9, 1), px(original, 9, 1));
  });

  test('long front hair continues down torso without touching outfit center', () => {
    const original = syntheticSkin([200, 56, 40, 255]);
    for (let y = 20; y < 28; y++) for (const x of [20, 21, 26, 27]) setPixel(original, x, y, [216, 88, 40, 255]);
    const { image, hairMask } = styleSkin(original, { targetHairColor: [175, 155, 105], tolerance: 42 });
    assert.ok(has(hairMask, 20, 25));
    assert.notDeepEqual(px(image, 20, 25), px(original, 20, 25));
    assert.deepEqual(px(image, 23, 25), px(original, 23, 25));
  });

  test('front hair can fill all three safe edge columns', () => {
    const original = syntheticSkin([122, 70, 34, 255]);
    for (let y = 20; y < 30; y++) for (const x of [20, 21, 22, 25, 26, 27]) setPixel(original, x, y, [185, 102, 26, 255]);
    const { image, hairMask } = styleSkin(original, { targetHairColor: [80, 170, 120], tolerance: 42 });
    for (const [x, y] of [[20, 27], [22, 27], [25, 27], [27, 27]]) {
      assert.ok(has(hairMask, x, y));
      assert.notDeepEqual(px(image, x, y), px(original, x, y));
    }
  });

  test('noisy same-hue shading survives the head to torso handoff', () => {
    const original = syntheticSkin([88, 152, 200, 255]);
    const shades: RGBA[] = [[20, 54, 89, 255], [34, 79, 126, 255], [59, 122, 184, 255]];
    for (let y = 20; y < 30; y++) for (const x of [20, 21, 22, 25, 26, 27]) setPixel(original, x, y, shades[y % 3]);
    const { image, hairMask } = styleSkin(original, { targetHairColor: [115, 65, 180], tolerance: 42 });
    for (const [x, y] of [[20, 20], [21, 24], [22, 28], [25, 28], [27, 20]]) {
      assert.ok(has(hairMask, x, y), `${x},${y}`);
      assert.notDeepEqual(px(image, x, y), px(original, x, y));
    }
  });

  test('matching sleeves prevent broad clothing from becoming hair', () => {
    const original = syntheticSkin([145, 75, 50, 255]);
    const clothing: RGBA = [150, 80, 55, 255];
    for (let y = 20; y < 32; y++) {
      for (let x = 20; x < 28; x++) setPixel(original, x, y, clothing);
      for (let x = 44; x < 47; x++) setPixel(original, x, y, clothing);
    }
    for (let y = 52; y < 64; y++) for (let x = 36; x < 39; x++) setPixel(original, x, y, clothing);
    const { image, hairMask } = styleSkin(original, { targetHairColor: [175, 155, 105], tolerance: 42 });
    assert.ok(!has(hairMask, 20, 25));
    assert.deepEqual(px(image, 20, 25), clothing);
  });

  test('accessory color is removed from long hair core palette', () => {
    const core = hairCorePalette([[184, 88, 56], [216, 104, 72], [200, 184, 232], [200, 104, 72]]);
    const s = core.map((c) => c.join());
    assert.ok(s.includes('184,88,56'));
    assert.ok(s.includes('216,104,72'));
    assert.ok(!s.includes('200,184,232'));
  });

  test('torso handoff rejects a similarly colored bikini', () => {
    const original = syntheticSkin([88, 56, 56, 255]);
    const hair: RGBA = [98, 72, 75, 255];
    const bikini: RGBA = [164, 67, 67, 255];
    for (let y = 13; y < 16; y++) {
      setPixel(original, 40, y, hair);
      setPixel(original, 47, y, hair);
    }
    for (let y = 20; y < 23; y++) {
      setPixel(original, 20, y, hair);
      setPixel(original, 27, y, hair);
    }
    for (let y = 20; y < 27; y++) {
      setPixel(original, 22, y, bikini);
      setPixel(original, 25, y, bikini);
    }
    const mask = detectBodyHairMask(original, 42);
    assert.ok(has(mask, 20, 21));
    assert.ok(has(mask, 27, 21));
    assert.ok(!has(mask, 22, 21));
    assert.ok(!has(mask, 25, 21));
  });

  test('confirmed long hair recovers matching shoulder cap pixels', () => {
    const original = syntheticSkin([174, 86, 56, 255]);
    const hair: RGBA = [185, 93, 61, 255];
    for (let y = 20; y < 28; y++) {
      setPixel(original, 20, y, hair);
      setPixel(original, 27, y, hair);
    }
    setPixel(original, 44, 16, hair);
    setPixel(original, 45, 16, hair);
    const mask = detectBodyHairMask(original, 42);
    assert.ok(has(mask, 20, 25));
    assert.ok(has(mask, 44, 16));
    assert.ok(has(mask, 45, 16));
  });

  test('exact skin shade reclaims a false positive shoulder', () => {
    const hair: RGBA = [170, 110, 80, 255];
    const skin: RGBA = [205, 145, 115, 255];
    const original = syntheticSkin(hair);
    for (let y = 20; y < 29; y++) {
      setPixel(original, 20, y, hair);
      setPixel(original, 27, y, hair);
    }
    for (let y = 20; y < 23; y++) for (let x = 47; x < 51; x++) setPixel(original, x, y, skin);
    const { image, hairMask } = styleSkin(original, { targetHairColor: [70, 175, 120], tolerance: 42 });
    assert.ok(has(hairMask, 20, 25));
    assert.ok(!has(hairMask, 48, 21));
    assert.deepEqual(px(image, 48, 21), skin);
  });

  test('pale long hair does not claim exposed neck skin', () => {
    const hair: RGBA = [248, 184, 200, 255];
    const skin: RGBA = [255, 223, 204, 255];
    const original = syntheticSkin(hair);
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) setPixel(original, x, y, skin);
    for (let y = 20; y < 23; y++) for (let x = 22; x < 26; x++) setPixel(original, x, y, skin);
    for (let y = 20; y < 29; y++) {
      setPixel(original, 20, y, hair);
      setPixel(original, 27, y, hair);
    }
    const mask = detectBodyHairMask(original, 42);
    assert.ok(has(mask, 20, 25));
    assert.ok(has(mask, 27, 25));
    assert.ok(!has(mask, 22, 20));
    assert.ok(!has(mask, 25, 22));
  });

  test('confirmed long hair links aligned base and outer torso layers', () => {
    const original = syntheticSkin([200, 56, 88, 255]);
    const hair: RGBA = [204, 72, 104, 255];
    const clothing: RGBA = [20, 150, 80, 255];
    for (let y = 20; y < 30; y++) {
      setPixel(original, 20, y, hair);
      setPixel(original, 32, y, hair);
    }
    for (let y = 36; y < 48; y++) {
      setPixel(original, 20, y, clothing);
      setPixel(original, 32, y, clothing);
    }
    setPixel(original, 20, 44, hair);
    setPixel(original, 32, 44, hair);
    const mask = detectBodyHairMask(original, 42);
    assert.ok(has(mask, 20, 28));
    assert.ok(has(mask, 20, 44));
    assert.ok(has(mask, 32, 28));
    assert.ok(has(mask, 32, 44));
    assert.ok(!has(mask, 20, 43));
    assert.ok(!has(mask, 32, 43));
  });

  test('tiny palette-matched holes are filled without absorbing clothing', () => {
    const original = syntheticSkin([200, 56, 88, 255]);
    const hair: RGBA = [204, 72, 104, 255];
    for (const [x, y] of [[20, 23], [20, 24], [20, 25], [26, 23], [26, 24], [26, 25], [26, 26]]) setPixel(original, x, y, hair);
    const established = new Set([key(20, 23), key(20, 25), key(26, 23)]);
    const filled = fillSmallTorsoHairGaps(original, established, [[200, 56, 88], [204, 72, 104]], 42);
    assert.ok(has(filled, 20, 24));
    assert.ok(!has(filled, 26, 24));
    assert.ok(!has(filled, 26, 25));
    assert.ok(!has(filled, 26, 26));
  });

  test('edge tracer stops when a new palette region crosses a strong border', () => {
    const image = createSkinPixels(8, 8);
    for (let y = 0; y < 3; y++) setPixel(image, 1, y, [210, 70, 40, 255]);
    for (let y = 3; y < 8; y++) setPixel(image, 1, y, [105, 35, 30, 255]);
    const palette: RGB[] = [[210, 70, 40], [105, 35, 30]];
    const traced = traceSurfaceHairPaths(image, [0, 0, 3, 8], palette, new Set([1]), 42, 2, 2);
    assert.ok(has(traced, 1, 2));
    assert.ok(!has(traced, 1, 3));
  });

  test('recolor rotates hues without flattening palette', () => {
    const original = syntheticSkin([210, 70, 100, 255]);
    setPixel(original, 40, 8, [235, 95, 130, 255]);
    const { image, hairMask } = styleSkin(original, { targetHairColor: [100, 70, 220], tolerance: 85 });
    assert.ok(has(hairMask, 40, 8));
    const hb = hsv(px(original, 9, 1));
    const ha = hsv(px(image, 9, 1));
    const ab = hsv(px(original, 40, 8));
    const aa = hsv(px(image, 40, 8));
    const mod1 = (v: number) => ((v % 1) + 1) % 1;
    const t = hsv([100, 70, 220]);
    near(mod1(ab[0] - hb[0]), mod1(aa[0] - ha[0]), 0.005);
    near(ha[1], t[1], 0.03);
    near(ha[2], t[2], 0.03);
    near(ab[1] / hb[1], aa[1] / ha[1], 0.04);
    near(ab[2] / hb[2], aa[2] / ha[2], 0.04);
  });

  test('isolated eye color is not mistaken for hair', () => {
    const c: RGBA = [40, 20, 10, 255];
    const original = syntheticSkin(c, c);
    setPixel(original, 42, 11, c);
    let { hairMask } = styleSkin(original, { targetHairColor: [100, 70, 220], tolerance: 55 });
    assert.ok(!has(hairMask, 10, 11));
    assert.ok(!has(hairMask, 42, 11));
    setPixel(original, 10, 10, c);
    setPixel(original, 42, 10, c);
    ({ hairMask } = styleSkin(original, { targetHairColor: [100, 70, 220], tolerance: 55 }));
    assert.ok(has(hairMask, 10, 11));
    assert.ok(has(hairMask, 42, 11));
  });

  test('reference eyes are applied', () => {
    const reference = syntheticSkin(undefined, [10, 220, 240, 255]);
    const target = syntheticSkin([20, 20, 20, 255], [220, 20, 20, 255]);
    const faceTemplate = makeFaceTemplate(reference, 55);
    const { image } = styleSkin(target, { targetHairColor: [80, 120, 220], tolerance: 55, faceTemplate });
    assert.deepEqual(px(image, 10, 14), px(reference, 10, 11));
  });

  test('reference eyes leave exactly one face row below', () => {
    const reference = syntheticSkin(undefined, [10, 220, 240, 255]);
    const target = syntheticSkin([80, 55, 30, 255], [205, 145, 115, 255]);
    for (const x of [10, 13]) {
      setPixel(target, x, 13, [30, 40, 90, 255]);
      setPixel(target, x, 14, [70, 120, 210, 255]);
    }
    const faceTemplate = makeFaceTemplate(reference, 55);
    const { image, hairMask } = styleSkin(target, { targetHairColor: [180, 150, 100], tolerance: 55, faceTemplate });
    assert.deepEqual(px(image, 10, 14), px(reference, 10, 11));
    assert.deepEqual(px(image, 10, 15), px(target, 10, 15));
    assert.ok(!has(hairMask, 10, 14));
  });

  test('bright center bang is not mistaken for skin', () => {
    const original = syntheticSkin([200, 56, 40, 255]);
    setPixel(original, 11, 11, [241, 134, 70, 255]);
    const { image, hairMask } = styleSkin(original, {
      targetHairColor: [190, 170, 105],
      tolerance: 42,
      targetSkinColor: [225, 185, 180],
      skinTolerance: 24,
    });
    assert.ok(has(hairMask, 11, 11));
    assert.notDeepEqual(px(image, 11, 11), [241, 134, 70, 255]);
  });

  test('eye matching preserves mouth and hair over eyes', () => {
    const reference = syntheticSkin(undefined, [10, 220, 240, 255]);
    for (let y = 10; y < 13; y++) setPixel(reference, 9, y, [40, 20, 10, 255]);
    const target = syntheticSkin([20, 20, 20, 255], [220, 20, 20, 255]);
    const mouth = px(target, 11, 14);
    for (const [x, y] of [[10, 10], [10, 11], [42, 10], [42, 11]]) setPixel(target, x, y, [20, 20, 20, 255]);
    setPixel(target, 45, 12, [250, 250, 250, 255]);
    const faceTemplate = makeFaceTemplate(reference, 55);
    const { image, hairMask } = styleSkin(target, {
      targetHairColor: [80, 120, 220],
      tolerance: 55,
      faceTemplate,
      eyesOverBangs: false,
    });
    assert.ok(!faceTemplate.features.has(key(9, 12)));
    assert.ok(has(hairMask, 10, 11));
    assert.notDeepEqual(px(image, 10, 11), px(reference, 10, 11));
    assert.notEqual(px(image, 42, 11)[3], 0);
    assert.equal(px(image, 45, 12)[3], 0);
    assert.deepEqual(px(image, 11, 14), mouth);
  });

  test('eyes over bangs use only the base face layer', () => {
    const reference = syntheticSkin(undefined, [10, 220, 240, 255]);
    const target = syntheticSkin([20, 20, 20, 255], [220, 20, 20, 255]);
    for (const [x, y] of [[10, 10], [10, 11], [42, 10], [42, 11]]) setPixel(target, x, y, [20, 20, 20, 255]);
    setPixel(target, 9, 11, [220, 20, 20, 255]);
    setPixel(target, 14, 11, [220, 20, 20, 255]);
    const faceTemplate = makeFaceTemplate(reference, 55);
    const { image } = styleSkin(target, {
      targetHairColor: [80, 120, 220],
      tolerance: 55,
      faceTemplate,
      preserveHatLayerLashes: false,
    });
    assert.deepEqual(px(image, 10, 14), px(reference, 10, 11));
    assert.deepEqual(px(image, 42, 14), [0, 0, 0, 0]);
  });

  test('hat layer lash shape uses the designed liner color', () => {
    const original = syntheticSkin();
    setPixel(original, 40, 12, [25, 20, 22, 255]);
    const liner: RGBA = [88, 35, 66, 255];
    const template: FaceTemplate = {
      features: new Map<number, RGBA>([
        [key(8, 12), liner],
        [key(10, 12), [30, 130, 180, 255]],
      ]),
      skinColor: [205, 145, 115],
      anchorY: 14,
    };
    const preserved = applyFaceTemplate(original, original, template, new Set(), false, null, true, true);
    const replaced = applyFaceTemplate(original, original, template, new Set(), false, null, true, false);
    assert.deepEqual(px(preserved, 40, 12), liner);
    assert.deepEqual(px(replaced, 40, 12), [0, 0, 0, 0]);
  });

  test('hd input is normalized', () => {
    const result = styleSkin(syntheticSkin(undefined, undefined, 128), { targetHairColor: [100, 80, 180] });
    assert.equal(result.wasNormalized, true);
    assert.equal(result.image.width, 64);
    assert.equal(result.image.height, 64);
  });

  test('skin tone changes matching exposed pixels only', () => {
    const original = syntheticSkin();
    for (let y = 20; y < 32; y++) setPixel(original, 42, y, [205, 145, 115, 255]);
    const { image } = styleSkin(original, {
      targetHairColor: [80, 40, 120],
      tolerance: 55,
      targetSkinColor: [120, 75, 55],
      skinTolerance: 28,
    });
    assert.notDeepEqual(px(image, 42, 20), px(original, 42, 20));
    assert.deepEqual(px(image, 20, 25), px(original, 20, 25));
  });

  test('skin tone stops at a pale swimsuit edge', () => {
    const original = syntheticSkin();
    const faceSkin: RGBA = [255, 227, 209, 255];
    const swimsuit: RGBA = [246, 246, 246, 255];
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) setPixel(original, x, y, faceSkin);
    setPixel(original, 10, 11, [20, 40, 80, 255]);
    setPixel(original, 13, 11, [20, 40, 80, 255]);
    for (let y = 20; y < 32; y++) for (let x = 20; x < 28; x++) setPixel(original, x, y, swimsuit);
    for (let y = 20; y < 22; y++) for (let x = 22; x < 26; x++) setPixel(original, x, y, faceSkin);
    for (let y = 20; y < 32; y++) for (let x = 4; x < 8; x++) setPixel(original, x, y, faceSkin);
    setPixel(original, 20, 36, faceSkin);
    const { image } = styleSkin(original, {
      targetHairColor: [80, 40, 120],
      tolerance: 42,
      targetSkinColor: [185, 115, 125],
      skinTolerance: 24,
    });
    assert.notDeepEqual(px(image, 23, 20), px(original, 23, 20));
    assert.deepEqual(px(image, 23, 25), swimsuit);
    assert.notDeepEqual(px(image, 5, 25), px(original, 5, 25));
    assert.deepEqual(px(image, 20, 36), faceSkin);
  });

  test('outfit palette colorizes neutral fabric without touching skin', () => {
    const original = syntheticSkin();
    const neutral: RGBA = [238, 238, 238, 255];
    for (let y = 22; y < 32; y++) for (let x = 20; x < 28; x++) setPixel(original, x, y, neutral);
    const face = px(original, 11, 13);
    const { image } = styleSkin(original, {
      targetHairColor: [175, 155, 105],
      tolerance: 42,
      targetOutfitColor: [65, 105, 210],
    });
    assert.notDeepEqual(px(image, 23, 25), neutral);
    assert.ok(hsv(px(image, 23, 25))[1] > 0.35);
    assert.deepEqual(px(image, 11, 13), face);
  });

  test('hair accessory palette is independent from hair', () => {
    const original = syntheticSkin([105, 55, 30, 255]);
    const accessory: RGBA = [35, 95, 220, 255];
    for (let y = 2; y < 5; y++) for (let x = 40; x < 43; x++) setPixel(original, x, y, accessory);
    const preserved = styleSkin(original, { targetHairColor: [205, 170, 95], tolerance: 42 }).image;
    const styled = styleSkin(original, {
      targetHairColor: [205, 170, 95],
      tolerance: 42,
      targetAccessoryColor: [80, 190, 95],
    }).image;
    assert.deepEqual(px(preserved, 41, 3), accessory);
    assert.notDeepEqual(px(styled, 41, 3), accessory);
    assert.notDeepEqual(px(styled, 9, 1), px(original, 9, 1));
  });

  test('long hair flower is traced beside body hair', () => {
    const original = syntheticSkin([145, 70, 35, 255]);
    for (let y = 20; y < 29; y++) for (const x of [20, 21]) setPixel(original, x, y, [150, 75, 38, 255]);
    const flower: RGBA = [50, 105, 225, 255];
    setPixel(original, 22, 23, flower);
    setPixel(original, 22, 24, flower);
    const { image } = styleSkin(original, {
      targetHairColor: [190, 155, 95],
      tolerance: 42,
      targetAccessoryColor: [190, 70, 155],
    });
    assert.notDeepEqual(px(image, 22, 23), flower);
    assert.notDeepEqual(px(image, 20, 23), px(original, 20, 23));
  });

  test('large floral clothing panel beside long hair is not an accessory', () => {
    const original = syntheticSkin([145, 70, 35, 255]);
    for (let y = 20; y < 30; y++) for (const x of [20, 21]) setPixel(original, x, y, [150, 75, 38, 255]);
    const floral: RGBA = [50, 105, 225, 255];
    for (let y = 22; y < 28; y++) for (const x of [22, 23, 24]) setPixel(original, x, y, floral);
    const { image } = styleSkin(original, {
      targetHairColor: [190, 155, 95],
      tolerance: 42,
      targetAccessoryColor: [190, 70, 155],
    });
    assert.deepEqual(px(image, 23, 24), floral);
  });

  test('pastel back hair does not absorb cross-hue pastel clothing', () => {
    const clothing: RGBA = [190, 225, 218, 255];
    const original = syntheticSkin([248, 200, 205, 255]);
    for (let y = 20; y < 30; y++) {
      setPixel(original, 32, y, [235, 180, 198, 255]);
      setPixel(original, 33, y, [235, 180, 198, 255]);
      for (let x = 34; x < 40; x++) setPixel(original, x, y, clothing);
    }
    const { image, hairMask } = styleSkin(original, { targetHairColor: [135, 75, 185], tolerance: 42 });
    assert.ok(has(hairMask, 32, 25));
    assert.notDeepEqual(px(image, 32, 25), px(original, 32, 25));
    assert.ok(!has(hairMask, 36, 25));
    assert.deepEqual(px(image, 36, 25), clothing);
  });

  test('skin tone reaches forehead pixels between bangs', () => {
    const original = syntheticSkin([190, 120, 100, 255]);
    const { image, hairMask } = styleSkin(original, {
      targetHairColor: [100, 70, 220],
      tolerance: 85,
      targetSkinColor: [225, 185, 180],
      skinTolerance: 28,
    });
    assert.notDeepEqual(px(image, 11, 9), px(original, 11, 9));
    assert.ok(!has(hairMask, 11, 9));
  });

  test('omitting targetHairColor leaves hair untouched', () => {
    const original = syntheticSkin();
    const { image, hairMask } = styleSkin(original, {});
    assert.ok(hairMask.size);
    assert.deepEqual([...image.data], [...original.data]);
  });
});
