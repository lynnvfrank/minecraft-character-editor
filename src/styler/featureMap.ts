/**
 * Feature maps: per-skin metadata saying what each pixel of a 64x64 skin *is* (skin, hair,
 * eyes & face, outfit), so looks can be mixed across skins by feature instead of by body
 * part. Skins don't come with this, so a map starts from automatic detection (the Make it me
 * detectors) and is corrected by hand with the feature tag brush in the 2D/3D editor.
 *
 * Pure: runs in Node (tests) and the browser. Pixel keys are `y * 64 + x`.
 */
import {
  detectBodyHairMask,
  detectHairMask,
  detectSkinMask,
  medianSkinColor,
  normalizeSkin,
  type RGB,
  type SkinPixels,
} from './skinStyler';

export const FEATURE_LABELS = ['skin', 'hair', 'eyes', 'outfit'] as const;
export type FeatureLabel = (typeof FEATURE_LABELS)[number];

/** Stored code per pixel: 0 = untagged (transparent or unknown), then FEATURE_LABELS order. */
export const UNTAGGED = 0;
/**
 * Outfit is the whole costume: clothes, shoes, hats, flowers, bows and anything else worn. It
 * can later be split into sub-tags (top, bottom, shoes, headwear, ...) with new codes; the
 * stored letter for outfit stays 'c' so existing tags keep decoding.
 */
export const FEATURE_CODE: Record<FeatureLabel, number> = { skin: 1, hair: 2, eyes: 3, outfit: 4 };
const CODE_LABEL: readonly (FeatureLabel | null)[] = [null, 'skin', 'hair', 'eyes', 'outfit'];

export const FEATURE_MAP_SIZE = 64 * 64;
/** One code per pixel of a 64x64 skin. */
export type FeatureMap = Uint8Array;

export function createFeatureMap(): FeatureMap {
  return new Uint8Array(FEATURE_MAP_SIZE);
}

export function labelAt(map: FeatureMap, k: number): FeatureLabel | null {
  return CODE_LABEL[map[k] ?? 0] ?? null;
}

/** Pixel keys with the given label. */
export function pixelsWithLabel(map: FeatureMap, label: FeatureLabel): Set<number> {
  const code = FEATURE_CODE[label];
  const out = new Set<number>();
  for (let k = 0; k < map.length; k++) if (map[k] === code) out.add(k);
  return out;
}

export function countLabels(map: FeatureMap): Record<FeatureLabel, number> {
  const counts: Record<FeatureLabel, number> = { skin: 0, hair: 0, eyes: 0, outfit: 0 };
  for (let k = 0; k < map.length; k++) {
    const label = CODE_LABEL[map[k]!];
    if (label) counts[label]++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Skin layout: which texels are used, and which belong to the outer (overlay) layer.

type Cuboid = { u: number; v: number; w: number; h: number; d: number; overlay: boolean };

/** Modern 64x64 layout (Steve-width arms; slim arms leave a few texels untouched, which is fine). */
const CUBOIDS: readonly Cuboid[] = [
  { u: 0, v: 0, w: 8, h: 8, d: 8, overlay: false }, // head
  { u: 32, v: 0, w: 8, h: 8, d: 8, overlay: true }, // hat
  { u: 16, v: 16, w: 8, h: 12, d: 4, overlay: false }, // body
  { u: 16, v: 32, w: 8, h: 12, d: 4, overlay: true }, // jacket
  { u: 40, v: 16, w: 4, h: 12, d: 4, overlay: false }, // right arm
  { u: 40, v: 32, w: 4, h: 12, d: 4, overlay: true }, // right sleeve
  { u: 32, v: 48, w: 4, h: 12, d: 4, overlay: false }, // left arm
  { u: 48, v: 48, w: 4, h: 12, d: 4, overlay: true }, // left sleeve
  { u: 0, v: 16, w: 4, h: 12, d: 4, overlay: false }, // right leg
  { u: 0, v: 32, w: 4, h: 12, d: 4, overlay: true }, // right pants
  { u: 16, v: 48, w: 4, h: 12, d: 4, overlay: false }, // left leg
  { u: 0, v: 48, w: 4, h: 12, d: 4, overlay: true }, // left pants
];

/** 0 = unused texel, 1 = inner (base) layer, 2 = outer (overlay) layer. */
const TEXEL_LAYER: Uint8Array = (() => {
  const out = new Uint8Array(FEATURE_MAP_SIZE);
  for (const c of CUBOIDS) {
    const mark = (x0: number, y0: number, w: number, h: number) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out[y * 64 + x] = c.overlay ? 2 : 1;
    };
    mark(c.u + c.d, c.v, 2 * c.w, c.d); // top + bottom
    mark(c.u, c.v + c.d, 2 * c.d + 2 * c.w, c.h); // right, front, left, back
  }
  return out;
})();

export function isUsedTexel(k: number): boolean {
  return TEXEL_LAYER[k] !== 0;
}

export function isOverlayTexel(k: number): boolean {
  return TEXEL_LAYER[k] === 2;
}

/** Front of the head (inner face or hat front): where eyes & face details live. */
export function isFaceTexel(k: number): boolean {
  const x = k % 64;
  const y = (k / 64) | 0;
  return y >= 8 && y < 16 && ((x >= 8 && x < 16) || (x >= 40 && x < 48));
}

// ---------------------------------------------------------------------------
// Automatic tagging (the starting point a person then corrects).

function alphaOf(skin: SkinPixels, k: number): number {
  return skin.data[k * 4 + 3] ?? 0;
}

/**
 * Guess a feature map from the Make it me detectors: hair (head + long hair on the body),
 * eyes & face (the face features Make it me would copy), skin, and everything else that is
 * painted becomes outfit. Transparent and unused texels stay untagged.
 */
export function autoTagFeatures(input: SkinPixels, tolerance = 42): FeatureMap {
  const { image: skin } = normalizeSkin(input);
  const map = createFeatureMap();
  const headHair = detectHairMask(skin, tolerance);
  const hair = new Set<number>([...headHair, ...detectBodyHairMask(skin, tolerance)]);
  const skinMask = detectSkinMask(skin, hair, 24);
  const skinColor = medianSkinColor(skin, hair);
  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    if (!isUsedTexel(k) || alphaOf(skin, k) < 48) continue;
    let code: number = FEATURE_CODE.outfit;
    // Eyes & face: anything on the face (front of head or hat) that is neither hair nor skin
    // colored — eyes, brows, lashes, mouth, blush.
    if (isFaceTexel(k) && !headHair.has(k) && !skinMask.has(k) && differsFrom(skin, k, skinColor)) code = FEATURE_CODE.eyes;
    else if (hair.has(k) && !skinMask.has(k)) code = FEATURE_CODE.hair;
    else if (skinMask.has(k)) code = FEATURE_CODE.skin;
    map[k] = code;
  }
  return map;
}

function differsFrom(skin: SkinPixels, k: number, color: RGB): boolean {
  const d = skin.data;
  const dr = d[k * 4]! - color[0];
  const dg = d[k * 4 + 1]! - color[1];
  const db = d[k * 4 + 2]! - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) >= 24;
}

// ---------------------------------------------------------------------------
// Storage encoding: run-length string, e.g. "n520s8h12" (n = untagged).

const CODE_CHARS = 'nshec';

export function encodeFeatureMap(map: FeatureMap): string {
  let out = '';
  let run = 0;
  let prev = -1;
  for (let k = 0; k <= map.length; k++) {
    const code = k < map.length ? map[k]! : -1;
    if (code === prev) {
      run++;
      continue;
    }
    if (prev >= 0) out += CODE_CHARS[prev] + (run > 1 ? String(run) : '');
    prev = code;
    run = 1;
  }
  return out;
}

/** Inverse of encodeFeatureMap; null when the string is not a complete, valid map. */
export function decodeFeatureMap(text: unknown): FeatureMap | null {
  if (typeof text !== 'string' || text.length > 20_000) return null;
  const map = createFeatureMap();
  let k = 0;
  const re = /([nshec])(\d*)/gy;
  while (re.lastIndex < text.length) {
    const m = re.exec(text);
    if (!m) return null;
    const code = CODE_CHARS.indexOf(m[1]!);
    const run = m[2] ? Number(m[2]) : 1;
    if (!Number.isInteger(run) || run < 1 || k + run > FEATURE_MAP_SIZE) return null;
    map.fill(code, k, k + run);
    k += run;
  }
  return k === FEATURE_MAP_SIZE ? map : null;
}

// ---------------------------------------------------------------------------
// Mixing features from several skins.

export type TaggedSkin = { pixels: SkinPixels; map: FeatureMap };

export type FeatureSources = {
  /** The outfit, and the skin whose body every other feature is laid onto. */
  outfit: TaggedSkin;
  /** Skin tone (and its shading) — defaults to the outfit skin's own. */
  skin?: TaggedSkin | null;
  /** Hair shape and color. Null keeps the outfit skin's own hair. */
  hair?: TaggedSkin | null;
  /** Eyes & face details. Null keeps the outfit skin's own face. */
  eyes?: TaggedSkin | null;
};

function luminance(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
}

function medianTagged(t: TaggedSkin, label: FeatureLabel): RGB | null {
  const code = FEATURE_CODE[label];
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const d = t.pixels.data;
  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    if (t.map[k] !== code || (d[k * 4 + 3] ?? 0) < 48) continue;
    rs.push(d[k * 4]!);
    gs.push(d[k * 4 + 1]!);
    bs.push(d[k * 4 + 2]!);
  }
  if (!rs.length) return null;
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]!;
  return [med(rs), med(gs), med(bs)];
}

/**
 * Build one skin from features of several: one skin's outfit, with hair, eyes & face
 * and skin tone taken from the other skins by their tags.
 *
 * Per pixel, in order: eyes & face (front of the head only), hair, outfit; whatever is left on
 * the inner layer is skin — the skin source's own pixel where it is tagged skin there (keeps its
 * shading), else its median tone shaded like the pixel it replaces. Left-over overlay texels are
 * cleared, so hair or outfit that isn't chosen doesn't linger on the outer layer.
 */
export function composeFeatures(sources: FeatureSources): SkinPixels {
  const outfit = sources.outfit;
  const skinSrc = sources.skin ?? outfit;
  const hairSrc = sources.hair ?? outfit;
  const eyesSrc = sources.eyes ?? outfit;
  const out = { width: 64, height: 64, data: new Uint8ClampedArray(FEATURE_MAP_SIZE * 4) };
  const o = out.data;

  const tone = medianTagged(skinSrc, 'skin') ?? medianTagged(outfit, 'skin') ?? [224, 172, 138];
  const outfitTone = medianTagged(outfit, 'skin');
  const outfitToneLum = outfitTone ? 0.299 * outfitTone[0] + 0.587 * outfitTone[1] + 0.114 * outfitTone[2] : 0;

  const copy = (from: SkinPixels, k: number) => {
    o.set(from.data.subarray(k * 4, k * 4 + 4), k * 4);
  };

  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    if (!isUsedTexel(k)) continue;
    if (isFaceTexel(k) && eyesSrc.map[k] === FEATURE_CODE.eyes) {
      copy(eyesSrc.pixels, k);
    } else if (hairSrc.map[k] === FEATURE_CODE.hair) {
      copy(hairSrc.pixels, k);
    } else if (outfit.map[k] === FEATURE_CODE.outfit) {
      copy(outfit.pixels, k);
    } else if (!isOverlayTexel(k)) {
      if (skinSrc.map[k] === FEATURE_CODE.skin) {
        copy(skinSrc.pixels, k);
      } else {
        // Shade the tone like the outfit skin's own pixel here (if it was skin), else flat.
        let shade = 1;
        if (outfit.map[k] === FEATURE_CODE.skin && outfitToneLum > 0) {
          shade = Math.min(1.4, Math.max(0.6, luminance(outfit.pixels.data, k * 4) / outfitToneLum));
        }
        o[k * 4] = tone[0] * shade;
        o[k * 4 + 1] = tone[1] * shade;
        o[k * 4 + 2] = tone[2] * shade;
        o[k * 4 + 3] = 255;
      }
    }
    // Inner-layer texels must stay opaque in game.
    if (!isOverlayTexel(k) && o[k * 4 + 3]! < 255) {
      if (o[k * 4 + 3] === 0) {
        o[k * 4] = tone[0];
        o[k * 4 + 1] = tone[1];
        o[k * 4 + 2] = tone[2];
      }
      o[k * 4 + 3] = 255;
    }
  }
  return out;
}
