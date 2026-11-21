/**
 * Pixel-exact Minecraft skin styling.
 *
 * Faithful TypeScript port of `skin_styler_core.py` (Daily Dress Skin Styler).
 * Only the styling pipeline used by `style_skin()` is ported; renderers,
 * folder generation and the GUI are not.
 *
 * Images are plain `{ width, height, data }` RGBA buffers so the code runs in
 * Node as well as the browser (a real `ImageData` is accepted structurally).
 * Pixel sets use numeric keys `y * 64 + x`.
 */

export interface SkinPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];
export type Box = readonly [number, number, number, number];
export type PixelSet = Set<number>;

export interface FaceTemplate {
  /** Keyed by `y * 64 + x`; insertion order matters (first liner pixel wins). */
  readonly features: Map<number, RGBA>;
  readonly skinColor: RGB;
  readonly anchorY: number;
}

export interface StyleSkinOptions {
  /** When null/undefined the hair recolor step is skipped (masks still computed). */
  targetHairColor?: RGB | null;
  tolerance?: number;
  faceTemplate?: FaceTemplate | null;
  matchReferenceSkinTone?: boolean;
  targetSkinColor?: RGB | null;
  skinTolerance?: number;
  includeBodyHair?: boolean;
  eyesOverBangs?: boolean;
  targetOutfitColor?: RGB | null;
  targetAccessoryColor?: RGB | null;
  preserveHatLayerLashes?: boolean;
  /**
   * Manual hair corrections (keys = y*64+x, 64x64 space), applied on top of detection.
   * `hairAdd` pixels are always hair (and never skin/accessory); `hairRemove` pixels never are.
   * Not part of the Python styler; empty/omitted sets leave results identical to it.
   */
  hairAdd?: Iterable<number> | null;
  hairRemove?: Iterable<number> | null;
  /**
   * Hand-made feature tags for this skin (styler/featureMap.ts). When given they replace
   * detection: hair, skin and outfit masks come straight from the tags (no accessory mask).
   * Not part of the Python styler.
   */
  tags?: { hair: Set<number>; skin: Set<number>; clothing: Set<number> } | null;
}

export interface StyleSkinResult {
  image: SkinPixels;
  hairMask: PixelSet;
  wasNormalized: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE_HEAD: Box = [0, 0, 32, 16];
export const HAT_HEAD: Box = [32, 0, 64, 16];
export const FACE_FRONT: Box = [8, 8, 16, 16];
export const HAT_FRONT: Box = [40, 8, 48, 16];
export const STANDARD_EYE_ANCHOR = 14;
export const EYE_FEATURE_BOX: Box = [8, 12, 16, 15];
export const EYE_FEATURE_COLUMNS: readonly number[] = [8, 9, 10, 13, 14, 15];
export const EYE_SEARCH_BOX: Box = [8, 10, 16, 15];
export const TORSO_FRONT: Box = [20, 20, 28, 32];
export const TORSO_RIGHT: Box = [16, 20, 20, 32];
export const TORSO_LEFT: Box = [28, 20, 32, 32];
export const TORSO_BACK: Box = [32, 20, 40, 32];
export const TORSO_OVERLAY_FRONT: Box = [20, 36, 28, 48];
export const TORSO_OVERLAY_RIGHT: Box = [16, 36, 20, 48];
export const TORSO_OVERLAY_LEFT: Box = [28, 36, 32, 48];
export const TORSO_OVERLAY_BACK: Box = [32, 36, 40, 48];

const KEY_WIDTH = 64;

// ---------------------------------------------------------------------------
// Small helpers (Python semantics)
// ---------------------------------------------------------------------------

export function key(x: number, y: number): number {
  return y * KEY_WIDTH + x;
}
export function keyX(k: number): number {
  return k % KEY_WIDTH;
}
export function keyY(k: number): number {
  return Math.floor(k / KEY_WIDTH);
}

/** 4-neighbors in Python order (x-1, x+1, y-1, y+1), dropping off-grid ones. */
function neighbors4(x: number, y: number): number[] {
  const out: number[] = [];
  if (x - 1 >= 0) out.push(key(x - 1, y));
  if (x + 1 < KEY_WIDTH) out.push(key(x + 1, y));
  if (y - 1 >= 0) out.push(key(x, y - 1));
  if (y + 1 < KEY_WIDTH) out.push(key(x, y + 1));
  return out;
}

function inGrid(x: number, y: number): boolean {
  return x >= 0 && x < KEY_WIDTH && y >= 0 && y < KEY_WIDTH;
}

/** Python float `%` (result takes the divisor's sign). */
function pyMod(a: number, b: number): number {
  let m = a % b;
  if (m) {
    if (b < 0 !== m < 0) m += b;
  } else {
    m = b < 0 ? -0 : 0;
  }
  return m;
}

/** Python 3 `round()` (round half to even) for a float. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return r;
}

function median(values: number[]): number {
  if (!values.length) throw new Error('median of empty data');
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Exact port of CPython `colorsys.rgb_to_hsv`. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const rangec = maxc - minc;
  const v = maxc;
  if (minc === maxc) return [0.0, 0.0, v];
  const s = rangec / maxc;
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h: number;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2.0 + rc - bc;
  else h = 4.0 + gc - rc;
  h = pyMod(h / 6.0, 1.0);
  return [h, s, v];
}

/** Exact port of CPython `colorsys.hsv_to_rgb`. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s === 0.0) return [v, v, v];
  let i = Math.trunc(h * 6.0);
  const f = h * 6.0 - i;
  const p = v * (1.0 - s);
  const q = v * (1.0 - s * f);
  const t = v * (1.0 - s * (1.0 - f));
  i = ((i % 6) + 6) % 6;
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function hsvOf(color: RGB | RGBA): [number, number, number] {
  return rgbToHsv(color[0] / 255, color[1] / 255, color[2] / 255);
}

const TAU = 2 * Math.PI;


// ---------------------------------------------------------------------------
// CPython set iteration order emulation
// ---------------------------------------------------------------------------
// A few Python loops mutate state while iterating a set of (x, y) tuples, so
// their result depends on CPython's hash-table order. For sets built purely by
// insertion (no deletions) we reproduce that order exactly (64-bit CPython).

const U64 = (1n << 64n) - 1n;
const XXPRIME_1 = 11400714785074694791n;
const XXPRIME_2 = 14029467366897019727n;
const XXPRIME_5 = 2870177450012600261n;

/** CPython `hash((x, y))` for small non-negative ints, as an unsigned 64-bit value. */
export function pyTupleHash(x: number, y: number): bigint {
  let acc = XXPRIME_5;
  for (const lane of [BigInt(x), BigInt(y)]) {
    acc = (acc + lane * XXPRIME_2) & U64;
    acc = ((acc << 31n) | (acc >> 33n)) & U64;
    acc = (acc * XXPRIME_1) & U64;
  }
  acc = (acc + (2n ^ (XXPRIME_5 ^ 3527539n))) & U64;
  if (acc === U64) return 1546275796n;
  return acc;
}

const LINEAR_PROBES = 9;

function insertClean(table: Array<number | null>, hashes: bigint[], k: number, hash: bigint): void {
  const mask = BigInt(table.length - 1);
  let perturb = hash;
  let i = hash & mask;
  for (;;) {
    let idx = Number(i);
    if (table[idx] === null) {
      table[idx] = k;
      hashes[idx] = hash;
      return;
    }
    if (i + BigInt(LINEAR_PROBES) <= mask) {
      for (let j = 0; j < LINEAR_PROBES; j++) {
        idx++;
        if (table[idx] === null) {
          table[idx] = k;
          hashes[idx] = hash;
          return;
        }
      }
    }
    perturb >>= 5n;
    i = (i * 5n + 1n + perturb) & mask;
  }
}

/** Iteration order of a CPython set of (x, y) tuples built by `add` in the given order. */
export function pySetOrder(insertionOrder: Iterable<number>): number[] {
  let table: Array<number | null> = new Array(8).fill(null);
  let hashes: bigint[] = new Array(8).fill(0n);
  let used = 0;
  const present = new Set<number>();
  for (const k of insertionOrder) {
    if (present.has(k)) continue;
    present.add(k);
    insertClean(table, hashes, k, pyTupleHash(keyX(k), keyY(k)));
    used++;
    const mask = table.length - 1;
    if (used * 5 >= mask * 3) {
      const minused = used > 50000 ? used * 2 : used * 4;
      let size = 8;
      while (size <= minused) size <<= 1;
      const oldTable = table;
      const oldHashes = hashes;
      table = new Array(size).fill(null);
      hashes = new Array(size).fill(0n);
      oldTable.forEach((entry, idx) => {
        if (entry !== null) insertClean(table, hashes, entry, oldHashes[idx]);
      });
    }
  }
  return table.filter((entry): entry is number => entry !== null);
}

// ---------------------------------------------------------------------------
// Image access
// ---------------------------------------------------------------------------

export function createSkinPixels(width = 64, height = 64): SkinPixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneSkinPixels(image: SkinPixels): SkinPixels {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

export function getPixel(image: SkinPixels, x: number, y: number): RGBA {
  const i = (y * image.width + x) * 4;
  const d = image.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

export function setPixel(image: SkinPixels, x: number, y: number, color: RGBA): void {
  const i = (y * image.width + x) * 4;
  image.data[i] = color[0];
  image.data[i + 1] = color[1];
  image.data[i + 2] = color[2];
  image.data[i + 3] = color[3];
}

function rgbAt(image: SkinPixels, x: number, y: number): RGB {
  const i = (y * image.width + x) * 4;
  const d = image.data;
  return [d[i], d[i + 1], d[i + 2]];
}

function alphaAt(image: SkinPixels, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

function rgbKey(image: SkinPixels, k: number): RGB {
  return rgbAt(image, keyX(k), keyY(k));
}

function sameRgb(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function sortedKeys(set: Iterable<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

function union(...sets: Iterable<number>[]): PixelSet {
  const out = new Set<number>();
  for (const s of sets) for (const k of s) out.add(k);
  return out;
}

function difference(a: Iterable<number>, ...others: Set<number>[]): PixelSet {
  const out = new Set<number>();
  for (const k of a) if (!others.some((o) => o.has(k))) out.add(k);
  return out;
}

function intersection(a: Set<number>, b: Set<number>): PixelSet {
  const out = new Set<number>();
  for (const k of a) if (b.has(k)) out.add(k);
  return out;
}

// ---------------------------------------------------------------------------
// Parsing / normalization
// ---------------------------------------------------------------------------

export function parseHexColor(input: string): RGB {
  let value = input.trim().replace(/^#+/, '');
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  if (value.length !== 6) throw new Error('Color must look like #A45C8A');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error('Color must contain only hexadecimal digits');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** Legacy 64x32 → 64x64: mirror the right arm/leg into the left-limb UVs. */
function convertLegacySkin(image: SkinPixels): SkinPixels {
  const out = createSkinPixels(64, 64);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) setPixel(out, x, y, getPixel(image, x, y));
  const copy = (sx: number, sy: number, w: number, h: number, dx: number, dy: number) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) setPixel(out, dx + (w - 1 - x), dy + y, getPixel(image, sx + x, sy + y));
  };
  // Left leg from right leg.
  copy(4, 16, 4, 4, 20, 48);
  copy(8, 16, 4, 4, 24, 48);
  copy(0, 20, 4, 12, 24, 52);
  copy(4, 20, 4, 12, 20, 52);
  copy(8, 20, 4, 12, 16, 52);
  copy(12, 20, 4, 12, 28, 52);
  // Left arm from right arm.
  copy(44, 16, 4, 4, 36, 48);
  copy(48, 16, 4, 4, 40, 48);
  copy(40, 20, 4, 12, 40, 52);
  copy(44, 20, 4, 12, 36, 52);
  copy(48, 20, 4, 12, 32, 52);
  copy(52, 20, 4, 12, 44, 52);
  return out;
}

/** Return a 64x64 RGBA skin (copy), using nearest-neighbor for HD multiples. */
export function normalizeSkin(image: SkinPixels): { image: SkinPixels; wasNormalized: boolean } {
  const { width, height } = image;
  if (width === 64 && height === 64) return { image: cloneSkinPixels(image), wasNormalized: false };
  if (width === height && width >= 64 && width % 64 === 0) {
    const scale = width / 64;
    const offset = Math.floor(scale / 2); // PIL NEAREST samples the pixel center
    const out = createSkinPixels(64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) setPixel(out, x, y, getPixel(image, x * scale + offset, y * scale + offset));
    return { image: out, wasNormalized: true };
  }
  if (width === 64 && height === 32) return { image: convertLegacySkin(image), wasNormalized: true };
  if (width === height * 2 && width >= 64 && width % 64 === 0) {
    const scale = width / 64;
    const offset = Math.floor(scale / 2);
    const small = createSkinPixels(64, 32);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) setPixel(small, x, y, getPixel(image, x * scale + offset, y * scale + offset));
    return { image: convertLegacySkin(small), wasNormalized: true };
  }
  throw new Error(`unsupported dimensions ${width}x${height}; expected 64x64 or an integer HD multiple`);
}

// ---------------------------------------------------------------------------
// Color matching
// ---------------------------------------------------------------------------

function quantize(color: RGB, step = 16): RGB {
  return [
    Math.min(255, Math.floor(color[0] / step) * step + Math.floor(step / 2)),
    Math.min(255, Math.floor(color[1] / step) * step + Math.floor(step / 2)),
    Math.min(255, Math.floor(color[2] / step) * step + Math.floor(step / 2)),
  ];
}

export function colorDistance(first: RGB | RGBA, second: RGB | RGBA): number {
  const redMean = (first[0] + second[0]) / 2;
  const redWeight = 2 + redMean / 256;
  const blueWeight = 2 + (255 - redMean) / 256;
  let total = redWeight * (first[0] - second[0]) ** 2;
  total += 4 * (first[1] - second[1]) ** 2;
  total += blueWeight * (first[2] - second[2]) ** 2;
  return Math.sqrt(total) / 2.8;
}
const distance = colorDistance;

function minDistance(color: RGB, palette: readonly RGB[]): number {
  let best = Infinity;
  for (const seed of palette) best = Math.min(best, distance(color, seed));
  return best;
}

function likelySkinTone(color: RGB): boolean {
  const [hue, saturation, value] = hsvOf(color);
  const degrees = hue * 360;
  return (degrees <= 55 || degrees >= 345) && 0.06 <= saturation && saturation <= 0.78 && value >= 0.22;
}

function hairSeedCoordinates(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) out.push([x, y]);
  for (let y = 8; y < 16; y++) for (let x = 24; x < 32; x++) out.push([x, y]);
  const sides = [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23];
  for (let y = 8; y < 12; y++) for (const x of sides) out.push([x, y]);
  for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) out.push([x, y]);
  return out;
}

export function hairPalette(skin: SkinPixels, maxColors = 10): RGB[] {
  const normalized = skin.width === 64 && skin.height === 64 ? skin : normalizeSkin(skin).image;
  const counts = new Map<number, { color: RGB; count: number; order: number }>();
  for (const [x, y] of hairSeedCoordinates()) {
    const [r, g, b, a] = getPixel(normalized, x, y);
    if (a >= 48) {
      const q = quantize([r, g, b]);
      const id = (q[0] << 16) | (q[1] << 8) | q[2];
      const entry = counts.get(id);
      if (entry) entry.count++;
      else counts.set(id, { color: q, count: 1, order: counts.size });
    }
  }
  if (!counts.size) return [];
  let totalCount = 0;
  for (const e of counts.values()) totalCount += e.count;
  // Counter.most_common: count descending, ties in first-insertion order.
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, maxColors);
  const selected: RGB[] = [];
  let covered = 0;
  const target = Math.max(1, Math.trunc(totalCount * 0.86));
  for (const { color, count } of ranked) {
    selected.push(color);
    covered += count;
    if (covered >= target && selected.length >= 3) break;
  }
  return selected;
}

function matchesHairPalette(color: RGB, palette: readonly RGB[], tolerance: number): boolean {
  if (minDistance(color, palette) <= tolerance) return true;
  const [hue, saturation, value] = hsvOf(color);
  if (saturation < 0.09 || value < 0.04) return false;
  for (const seed of palette.slice(0, 6)) {
    const [seedHue, seedSaturation, seedValue] = hsvOf(seed);
    if (seedSaturation < 0.09 || seedValue < 0.04) continue;
    let hueGap = Math.abs(hue - seedHue);
    hueGap = Math.min(hueGap, 1.0 - hueGap);
    if (hueGap <= 24 / 360 && Math.abs(saturation - seedSaturation) <= 0.48) return true;
  }
  return false;
}

function sameHueShadingFamily(
  color: RGB,
  palette: readonly RGB[],
  hueLimit = 24.0,
  saturationLimit = 0.28,
): boolean {
  const [hue, saturation, value] = hsvOf(color);
  if (saturation < 0.06 || value < 0.035) return false;
  for (const seed of palette) {
    const [seedHue, seedSaturation, seedValue] = hsvOf(seed);
    if (seedSaturation < 0.06 || seedValue < 0.035) continue;
    const hueGap = Math.min(Math.abs(hue - seedHue), 1.0 - Math.abs(hue - seedHue));
    if (hueGap <= hueLimit / 360 && Math.abs(saturation - seedSaturation) <= saturationLimit) return true;
  }
  return false;
}

function bodyHairMatch(color: RGB, palette: readonly RGB[], tolerance: number): boolean {
  if (!palette.length) return false;
  const nearest = minDistance(color, palette);
  if (nearest <= Math.min(25.0, tolerance * 0.58)) return true;
  const paletteHasHue = palette.some((seed) => hsvOf(seed)[1] >= 0.08);
  if (paletteHasHue) return sameHueShadingFamily(color, palette, 32.0, 0.4);
  return nearest <= tolerance;
}

function strictHairMatch(color: RGB, palette: readonly RGB[], tolerance: number): boolean {
  return palette.length > 0 && minDistance(color, palette) <= tolerance;
}

export function hairCorePalette(palette: readonly RGB[]): RGB[] {
  if (!palette.length) return [];
  const anchor = palette[0];
  const [anchorHue, anchorSaturation] = hsvOf(anchor);
  const selected: RGB[] = [];
  for (const color of palette) {
    const [hue, saturation, value] = hsvOf(color);
    let hueGap = Math.abs(hue - anchorHue);
    hueGap = Math.min(hueGap, 1.0 - hueGap);
    if (
      value <= 0.12 ||
      (anchorSaturation < 0.08 && distance(color, anchor) <= 68) ||
      (saturation < 0.05 && distance(color, anchor) <= 52) ||
      (anchorSaturation >= 0.08 && saturation >= 0.05 && hueGap <= 32 / 360)
    ) {
      selected.push(color);
    }
  }
  return selected.length ? selected : palette.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Head hair
// ---------------------------------------------------------------------------

function floodConnected(
  start: Iterable<number>,
  candidates: Set<number>,
  accept: (fromKey: number, toKey: number) => boolean,
): PixelSet {
  const connected = new Set<number>(start);
  const pending = [...connected];
  while (pending.length) {
    const k = pending.pop()!;
    const x = keyX(k);
    const y = keyY(k);
    for (const n of neighbors4(x, y)) {
      if (candidates.has(n) && !connected.has(n) && accept(k, n)) {
        connected.add(n);
        pending.push(n);
      }
    }
  }
  return connected;
}

export function detectHairMask(skin: SkinPixels, tolerance = 42.0): PixelSet {
  const normalized = ensure64(skin);
  const palette = hairPalette(normalized);
  if (!palette.length) return new Set();

  const mask: PixelSet = new Set();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 64; x++) {
      if (alphaAt(normalized, x, y) < 48) continue;
      if (matchesHairPalette(rgbAt(normalized, x, y), palette, tolerance)) mask.add(key(x, y));
    }
  }

  const skinColor = medianSkinColor(normalized, mask);
  const eyeAnchor = detectEyeAnchor(normalized, skinColor);
  const searchBottom = EYE_SEARCH_BOX[3];
  const top = Math.max(EYE_SEARCH_BOX[1], eyeAnchor - 2);
  const bottom = Math.min(searchBottom, eyeAnchor + 1);
  const eyePixels = bilateralEyeFeatures(normalized, skinColor, eyeAnchor);
  const verticalTolerance = Math.min(38.0, Math.max(22.0, tolerance * 0.68));
  for (const k of pySetOrder(eyePixels)) {
    const x = keyX(k);
    const y = keyY(k);
    const above = key(x, y - 1);
    if (
      !mask.has(above) ||
      distance(rgbAt(normalized, x, y), rgbAt(normalized, x, y - 1)) > verticalTolerance
    ) {
      mask.delete(k);
    }
  }

  const connectionTolerance = Math.min(48.0, Math.max(24.0, tolerance * 0.86));
  const edgeOk = (a: number, b: number) =>
    distance(rgbKey(normalized, a), rgbKey(normalized, b)) <= connectionTolerance;

  const inBox = (k: number, box: Box) => {
    const x = keyX(k);
    const y = keyY(k);
    return box[0] <= x && x < box[2] && box[1] <= y && y < box[3];
  };

  const faceCandidates = new Set([...mask].filter((k) => inBox(k, FACE_FRONT)));
  const connected = floodConnected(
    [...faceCandidates].filter((k) => keyY(k) <= top),
    faceCandidates,
    edgeOk,
  );
  for (let y = top; y < bottom; y++)
    for (const x of EYE_FEATURE_COLUMNS) if (!connected.has(key(x, y))) mask.delete(key(x, y));

  for (let y = 13; y < FACE_FRONT[3]; y++) {
    mask.delete(key(11, y));
    mask.delete(key(12, y));
  }

  const overlayCandidates = new Set([...mask].filter((k) => inBox(k, HAT_FRONT)));
  const overlayConnected = floodConnected(
    [...overlayCandidates].filter((k) => keyY(k) <= top),
    overlayCandidates,
    edgeOk,
  );
  const overlayOffset = HAT_FRONT[0] - FACE_FRONT[0];
  for (let y = top; y < bottom; y++)
    for (const x of EYE_FEATURE_COLUMNS) {
      const overlay = key(x + overlayOffset, y);
      if (!overlayConnected.has(overlay)) mask.delete(overlay);
    }
  return mask;
}

// ---------------------------------------------------------------------------
// Body hair
// ---------------------------------------------------------------------------

function headToBodySeedColumns(
  hairMask: Set<number>,
  headBox: Box,
  headOverlayBox: Box,
  bodyWidth: number,
): Set<number> {
  const headWidth = headBox[2] - headBox[0];
  const seeds = new Set<number>();
  for (let bodyX = 0; bodyX < bodyWidth; bodyX++) {
    const start = Math.floor((bodyX * headWidth) / bodyWidth);
    const end = Math.max(start + 1, Math.ceil(((bodyX + 1) * headWidth) / bodyWidth));
    for (let localX = start; localX < Math.min(headWidth, end); localX++) {
      const baseX = headBox[0] + localX;
      const overlayX = headOverlayBox[0] + localX;
      let hit = false;
      for (let y = headBox[3] - 3; y < headBox[3]; y++) {
        if (hairMask.has(key(baseX, y)) || hairMask.has(key(overlayX, y))) {
          hit = true;
          break;
        }
      }
      if (hit) {
        seeds.add(bodyX);
        break;
      }
    }
  }
  return seeds;
}

function headToBodySeedColors(
  skin: SkinPixels,
  hairMask: Set<number>,
  headBox: Box,
  headOverlayBox: Box,
  bodyWidth: number,
): Map<number, RGB[]> {
  const headWidth = headBox[2] - headBox[0];
  const projected = new Map<number, RGB[]>();
  for (let bodyX = 0; bodyX < bodyWidth; bodyX++) {
    const start = Math.floor((bodyX * headWidth) / bodyWidth);
    const end = Math.max(start + 1, Math.ceil(((bodyX + 1) * headWidth) / bodyWidth));
    const colors: RGB[] = [];
    for (let localX = start; localX < Math.min(headWidth, end); localX++) {
      for (const sourceX of [headBox[0] + localX, headOverlayBox[0] + localX]) {
        for (let y = headBox[3] - 3; y < headBox[3]; y++) {
          if (hairMask.has(key(sourceX, y))) {
            const color = rgbAt(skin, sourceX, y);
            if (!colors.some((c) => sameRgb(c, color))) colors.push(color);
          }
        }
      }
    }
    if (colors.length) projected.set(bodyX, colors);
  }
  return projected;
}

/**
 * Trace downward, edge-aware paths from a mapped head/torso seam.
 * `skin` may be any size (tests use small images); keys are `y * 64 + x`.
 */
export function traceSurfaceHairPaths(
  skin: SkinPixels,
  box: Box,
  palette: readonly RGB[],
  seedColumns: Set<number>,
  tolerance: number,
  startDepth: number,
  maxPerHalf: number | null,
  seedColors: Map<number, RGB[]> | null = null,
): PixelSet {
  if (!palette.length || !seedColumns.size) return new Set();
  const [left, top, right, bottom] = box;
  const width = right - left;
  const height = bottom - top;
  const edgeLimit = Math.min(82.0, Math.max(52.0, tolerance * 1.42));
  const paletteLimit = Math.min(62.0, Math.max(40.0, tolerance * 1.18));
  const seedEdgeLimit = Math.min(32.0, Math.max(22.0, tolerance * 0.66));
  const seedSkinCenter = skin.width === 64 && skin.height === 64 ? medianSkinColor(skin, new Set()) : null;

  const LK = 1024; // local key stride
  const lkey = (x: number, y: number) => y * LK + x;
  const candidateDistance = new Map<number, number>();
  const nearestSeed = new Map<number, number>();
  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      if (alphaAt(skin, left + lx, top + ly) < 48) continue;
      const color = rgbAt(skin, left + lx, top + ly);
      const distances = palette.map((seed) => distance(color, seed));
      let nearest = 0;
      for (let i = 1; i < distances.length; i++) if (distances[i] < distances[nearest]) nearest = i;
      if (bodyHairMatch(color, palette, paletteLimit)) {
        const c = lkey(lx, ly);
        candidateDistance.set(c, Math.min(distances[nearest], paletteLimit * 0.92));
        nearestSeed.set(c, nearest);
      }
    }
  }

  // Independent of the candidate pixel, so computed once.
  const nearbySeedColors: RGB[] = [];
  if (seedColors !== null) {
    for (const colors of seedColors.values()) {
      for (const color of colors) {
        if (seedSkinCenter !== null && likelySkinTone(color) && distance(color, seedSkinCenter) <= 24.0) continue;
        if (strictHairMatch(color, palette, seedEdgeLimit) || sameHueShadingFamily(color, palette, 24.0, 0.22))
          nearbySeedColors.push(color);
      }
    }
  }
  const seedList = [...seedColumns];

  const accepted: PixelSet = new Set();
  const scores = new Map<number, number>();
  for (let ly = 0; ly < height; ly++) {
    const rowCandidates: number[] = [];
    for (const c of candidateDistance.keys()) if (Math.floor(c / LK) === ly) rowCandidates.push(c % LK);
    const proposed: Array<[number, number]> = []; // [score, localX]
    for (const lx of rowCandidates) {
      const c = lkey(lx, ly);
      const paletteQuality = 1.0 - candidateDistance.get(c)! / Math.max(1.0, paletteLimit);
      let best: number | null = null;
      const currentColor = rgbAt(skin, left + lx, top + ly);
      const handoffIsValid =
        seedColors === null ||
        !nearbySeedColors.length ||
        minDistance(currentColor, nearbySeedColors) <= seedEdgeLimit ||
        sameHueShadingFamily(currentColor, nearbySeedColors);
      if (ly < Math.max(6, startDepth) && !handoffIsValid) continue;
      if (ly < startDepth && Math.min(...seedList.map((s) => Math.abs(lx - s))) <= 1) {
        if (handoffIsValid) best = 2.0 + paletteQuality - ly * 0.18;
      }
      for (const py of [ly - 1, ly - 2]) {
        if (py < 0) continue;
        for (let px = Math.max(0, lx - 1); px < Math.min(width, lx + 2); px++) {
          const previous = lkey(px, py);
          const prevScore = scores.get(previous);
          if (prevScore === undefined) continue;
          const previousColor = rgbAt(skin, left + px, top + py);
          const border = distance(previousColor, currentColor);
          const samePaletteTrack = nearestSeed.get(previous) === nearestSeed.get(c);
          if (border > edgeLimit && !(samePaletteTrack && border <= edgeLimit * 1.25)) continue;
          const gapPenalty = py === ly - 2 ? 0.34 : 0.0;
          const driftPenalty = Math.abs(px - lx) * 0.16;
          const continuation =
            prevScore +
            0.82 +
            paletteQuality * 0.55 -
            (border / Math.max(1.0, edgeLimit)) * 0.48 -
            gapPenalty -
            driftPenalty;
          if (best === null || continuation > best) best = continuation;
        }
      }
      if (best !== null && best >= 1.35) proposed.push([best, lx]);
    }

    let kept = proposed;
    if (maxPerHalf !== null) {
      kept = [];
      const midpoint = width / 2;
      for (const rightHalf of [false, true]) {
        const half = proposed.filter((item) => item[1] >= midpoint === rightHalf);
        // Python sorts (score, (x, y)) tuples descending.
        half.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        kept.push(...half.slice(0, maxPerHalf));
      }
    }
    for (const [score, lx] of kept) {
      scores.set(lkey(lx, ly), score);
      accepted.add(key(left + lx, top + ly));
    }
  }
  return accepted;
}

function linkAlignedTorsoHairLayers(
  skin: SkinPixels,
  mask: Set<number>,
  palette: readonly RGB[],
  tolerance: number,
): PixelSet {
  if (!mask.size || !palette.length) return new Set(mask);
  const linked = new Set(mask);
  const paletteLimit = Math.min(58.0, Math.max(36.0, tolerance * 1.1));
  const counterpartLimit = Math.min(48.0, Math.max(28.0, tolerance));
  const layerPairs: Array<[Box, Box]> = [
    [TORSO_FRONT, TORSO_OVERLAY_FRONT],
    [TORSO_RIGHT, TORSO_OVERLAY_RIGHT],
    [TORSO_LEFT, TORSO_OVERLAY_LEFT],
    [TORSO_BACK, TORSO_OVERLAY_BACK],
  ];
  for (const [baseBox, overlayBox] of layerPairs) {
    const width = baseBox[2] - baseBox[0];
    const height = baseBox[3] - baseBox[1];
    for (let ly = 0; ly < height; ly++) {
      for (let lx = 0; lx < width; lx++) {
        const base = key(baseBox[0] + lx, baseBox[1] + ly);
        const overlay = key(overlayBox[0] + lx, overlayBox[1] + ly);
        for (const [confirmed, counterpart] of [
          [base, overlay],
          [overlay, base],
        ]) {
          if (!mask.has(confirmed) || linked.has(counterpart)) continue;
          const confirmedColor = rgbKey(skin, confirmed);
          if (alphaAt(skin, keyX(counterpart), keyY(counterpart)) < 48) continue;
          const counterpartColor = rgbKey(skin, counterpart);
          if (!bodyHairMatch(counterpartColor, palette, paletteLimit)) continue;
          if (distance(confirmedColor, counterpartColor) > counterpartLimit) continue;
          linked.add(counterpart);
        }
      }
    }
  }
  return linked;
}

export function fillSmallTorsoHairGaps(
  skin: SkinPixels,
  mask: Set<number>,
  palette: readonly RGB[],
  tolerance: number,
): PixelSet {
  if (!mask.size || !palette.length) return new Set(mask);
  const filled = new Set(mask);
  const paletteLimit = Math.min(50.0, Math.max(34.0, tolerance * 1.12));
  const boxes: Box[] = [
    TORSO_FRONT,
    TORSO_RIGHT,
    TORSO_LEFT,
    TORSO_BACK,
    TORSO_OVERLAY_FRONT,
    TORSO_OVERLAY_RIGHT,
    TORSO_OVERLAY_LEFT,
    TORSO_OVERLAY_BACK,
  ];
  for (const box of boxes) {
    const [left, top, right, bottom] = box;
    const width = right - left;
    const isFront = box === TORSO_FRONT || box === TORSO_OVERLAY_FRONT;
    const candidates = new Set<number>();
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) {
        const k = key(x, y);
        if (
          !filled.has(k) &&
          alphaAt(skin, x, y) >= 48 &&
          bodyHairMatch(rgbAt(skin, x, y), palette, paletteLimit) &&
          (!isFront || x - left <= 2 || x - left >= width - 3)
        )
          candidates.add(k);
      }
    const seen = new Set<number>();
    // Order matters (filled grows); iterate in CPython set order.
    for (const seed of pySetOrder(candidates)) {
      if (seen.has(seed)) continue;
      const component = new Set([seed]);
      const pending = [seed];
      seen.add(seed);
      while (pending.length) {
        const k = pending.pop()!;
        for (const n of neighbors4(keyX(k), keyY(k))) {
          if (candidates.has(n) && !seen.has(n)) {
            seen.add(n);
            component.add(n);
            pending.push(n);
          }
        }
      }
      if (component.size > 3) continue;
      let touching = 0;
      for (const k of component) {
        const x = keyX(k);
        const y = keyY(k);
        let any = false;
        for (const ox of [-1, 0, 1])
          for (const oy of [-1, 0, 1]) {
            if (!ox && !oy) continue;
            if (inGrid(x + ox, y + oy) && filled.has(key(x + ox, y + oy))) any = true;
          }
        if (any) touching++;
      }
      if (touching === component.size) for (const k of component) filled.add(k);
    }
  }
  return filled;
}

function pixelComponents(coordinates: Set<number>, skin?: SkinPixels, edgeLimit?: number): PixelSet[] {
  const remaining = new Set(coordinates);
  const components: PixelSet[] = [];
  for (const start of sortedKeys(coordinates)) {
    if (!remaining.has(start)) continue;
    remaining.delete(start);
    const component = new Set([start]);
    const pending = [start];
    while (pending.length) {
      const k = pending.pop()!;
      for (const n of neighbors4(keyX(k), keyY(k))) {
        if (!remaining.has(n)) continue;
        if (skin && edgeLimit !== undefined && distance(rgbKey(skin, k), rgbKey(skin, n)) > edgeLimit) continue;
        remaining.delete(n);
        component.add(n);
        pending.push(n);
      }
    }
    components.push(component);
  }
  return components;
}

function detectShoulderHair(
  skin: SkinPixels,
  headMask: Set<number>,
  torsoMask: Set<number>,
  palette: readonly RGB[],
  tolerance: number,
): PixelSet {
  if (!torsoMask.size || !palette.length) return new Set();
  const referenceColors: RGB[] = [...torsoMask].map((k) => rgbKey(skin, k));
  for (const k of headMask) {
    const x = keyX(k);
    const y = keyY(k);
    if (y >= 12 && (x < 8 || (16 <= x && x < 24) || (32 <= x && x < 40) || (48 <= x && x < 56)))
      referenceColors.push(rgbKey(skin, k));
  }
  if (!referenceColors.length) return new Set();
  const colorLimit = Math.min(42.0, Math.max(28.0, tolerance * 0.86));
  const regions: Array<[Box, Box]> = [
    [[44, 16, 48, 20], [40, 20, 56, 23]],
    [[44, 32, 48, 36], [40, 36, 56, 39]],
    [[36, 48, 40, 52], [32, 52, 48, 55]],
    [[52, 48, 56, 52], [48, 52, 64, 55]],
  ];
  const recovered: PixelSet = new Set();
  for (const [cap, upperFaces] of regions) {
    const candidates = new Set<number>();
    for (const b of [cap, upperFaces])
      for (let y = b[1]; y < b[3]; y++)
        for (let x = b[0]; x < b[2]; x++) {
          if (alphaAt(skin, x, y) < 48) continue;
          const color = rgbAt(skin, x, y);
          if (bodyHairMatch(color, palette, colorLimit) && minDistance(color, referenceColors) <= colorLimit)
            candidates.add(key(x, y));
        }
    for (const component of pixelComponents(candidates, skin, colorLimit)) {
      if (component.size >= 6 && [...component].every((k) => likelySkinTone(rgbKey(skin, k)))) continue;
      if (component.size <= 24) for (const k of component) recovered.add(k);
    }
  }
  return recovered;
}

function pruneTorsoHairHandoffs(
  skin: SkinPixels,
  mask: Set<number>,
  headMask: Set<number>,
  palette: readonly RGB[],
  tolerance: number,
): PixelSet {
  if (!mask.size || !palette.length) return new Set(mask);
  const seedLimit = Math.min(32.0, Math.max(22.0, tolerance * 0.66));
  const seedSkinCenter = medianSkinColor(skin, headMask);
  const surfaceSpecs: Array<[Box, Box, Box]> = [
    [TORSO_FRONT, [8, 8, 16, 16], [40, 8, 48, 16]],
    [TORSO_OVERLAY_FRONT, [8, 8, 16, 16], [40, 8, 48, 16]],
    [TORSO_RIGHT, [0, 8, 8, 16], [32, 8, 40, 16]],
    [TORSO_OVERLAY_RIGHT, [0, 8, 8, 16], [32, 8, 40, 16]],
    [TORSO_LEFT, [16, 8, 24, 16], [48, 8, 56, 16]],
    [TORSO_OVERLAY_LEFT, [16, 8, 24, 16], [48, 8, 56, 16]],
    [TORSO_BACK, [24, 8, 32, 16], [56, 8, 64, 16]],
    [TORSO_OVERLAY_BACK, [24, 8, 32, 16], [56, 8, 64, 16]],
  ];
  const torsoCoordinates = new Set<number>();
  const retained = new Set<number>();
  for (const [box, headBox, overlayBox] of surfaceSpecs) {
    const [left, top, right, bottom] = box;
    const region = boxCoordinates(box);
    for (const k of region) torsoCoordinates.add(k);
    const surfaceMask = intersection(mask, region);
    if (!surfaceMask.size) continue;
    const projected = headToBodySeedColors(skin, headMask, headBox, overlayBox, right - left);
    const trustedColors: RGB[] = [];
    for (const colors of projected.values())
      for (const color of colors) {
        if (likelySkinTone(color) && distance(color, seedSkinCenter) <= 24.0) continue;
        if (strictHairMatch(color, palette, seedLimit) || sameHueShadingFamily(color, palette, 24.0, 0.22))
          trustedColors.push(color);
      }
    if (!trustedColors.length) {
      for (const k of surfaceMask) retained.add(k);
      continue;
    }
    const eligible = new Set<number>();
    for (const k of surfaceMask) {
      const color = rgbKey(skin, k);
      if (
        keyY(k) - top >= 6 ||
        minDistance(color, trustedColors) <= seedLimit ||
        sameHueShadingFamily(color, trustedColors)
      )
        eligible.add(k);
    }
    const connected = new Set([...eligible].filter((k) => keyY(k) - top < 6));
    const pending = [...connected];
    while (pending.length) {
      const k = pending.pop()!;
      const x = keyX(k);
      const y = keyY(k);
      for (const oy of [-2, -1, 0, 1, 2])
        for (const ox of [-1, 0, 1]) {
          if (!ox && !oy) continue;
          if (!inGrid(x + ox, y + oy)) continue;
          const n = key(x + ox, y + oy);
          if (eligible.has(n) && !connected.has(n)) {
            connected.add(n);
            pending.push(n);
          }
        }
    }
    for (const k of connected) retained.add(k);
    void bottom;
  }
  return union(difference(mask, torsoCoordinates), retained);
}

export function detectBodyHairMask(skin: SkinPixels, tolerance = 42.0): PixelSet {
  const normalized = ensure64(skin);
  const palette = hairPalette(normalized);
  if (!palette.length) return new Set();
  const core = hairCorePalette(palette);
  const strictTolerance = Math.min(58.0, Math.max(38.0, tolerance * 1.12));
  const mask: PixelSet = new Set();
  const headMask = detectHairMask(normalized, tolerance);
  const protectedSkin = detectSkinMask(normalized, headMask, 24.0);

  const armSamples: number[] = [];
  for (const [l, t, r, b] of [
    [44, 20, 47, 32],
    [36, 52, 39, 64],
  ])
    for (let y = t; y < b; y++) for (let x = l; x < r; x++) if (alphaAt(normalized, x, y) >= 48) armSamples.push(key(x, y));
  const skinCenter = medianSkinColor(normalized, headMask);
  const nonSkinArmSamples = armSamples.filter(
    (k) => distance(rgbKey(normalized, k), skinCenter) > Math.max(28.0, tolerance * 0.72),
  );
  const coreHasHue = core.some((color) => hsvOf(color)[1] >= 0.08);
  let matchingArmSamples = 0;
  for (const k of nonSkinArmSamples) {
    const color = rgbKey(normalized, k);
    if (
      strictHairMatch(color, core, strictTolerance) &&
      (!coreHasHue || sameHueShadingFamily(color, core, 32.0, 0.34))
    )
      matchingArmSamples++;
  }
  const armMatchRatio = matchingArmSamples / Math.max(1, nonSkinArmSamples.length);
  const clothingConflict = nonSkinArmSamples.length >= 16 && matchingArmSamples >= 12 && armMatchRatio >= 0.45;

  const surfaceSpecs: Array<[Box, Box, Box, number, number | null]> = [
    [TORSO_FRONT, [8, 8, 16, 16], [40, 8, 48, 16], 3, 2],
    [TORSO_OVERLAY_FRONT, [8, 8, 16, 16], [40, 8, 48, 16], 5, 2],
    [TORSO_RIGHT, [0, 8, 8, 16], [32, 8, 40, 16], 3, 2],
    [TORSO_OVERLAY_RIGHT, [0, 8, 8, 16], [32, 8, 40, 16], 5, 2],
    [TORSO_LEFT, [16, 8, 24, 16], [48, 8, 56, 16], 3, 2],
    [TORSO_OVERLAY_LEFT, [16, 8, 24, 16], [48, 8, 56, 16], 5, 2],
    [TORSO_BACK, [24, 8, 32, 16], [56, 8, 64, 16], 3, null],
    [TORSO_OVERLAY_BACK, [24, 8, 32, 16], [56, 8, 64, 16], 5, null],
  ];
  for (const [box, headBox, overlayBox, startDepth, maxPerHalf] of surfaceSpecs) {
    const width = box[2] - box[0];
    let seeds = headToBodySeedColumns(headMask, headBox, overlayBox, width);
    const seedColors = headToBodySeedColors(normalized, headMask, headBox, overlayBox, width);
    const isFront = box === TORSO_FRONT || box === TORSO_OVERLAY_FRONT;
    if (isFront && !seeds.size) seeds = new Set([0, width - 1]);
    if (clothingConflict && box !== TORSO_OVERLAY_FRONT) continue;
    let traced = traceSurfaceHairPaths(normalized, box, core, seeds, tolerance, startDepth, maxPerHalf, seedColors);
    if (isFront) {
      const edge = (x: number) => x - box[0] <= 2 || x - box[0] >= width - 3;
      traced = new Set([...traced].filter((k) => edge(keyX(k))));
      const lowerEdgeCandidates = new Set<number>();
      for (let y = box[1] + 7; y < box[3]; y++)
        for (let x = box[0]; x < box[2]; x++)
          if (
            edge(x) &&
            alphaAt(normalized, x, y) >= 48 &&
            bodyHairMatch(rgbAt(normalized, x, y), core, strictTolerance)
          )
            lowerEdgeCandidates.add(key(x, y));
      let changed = true;
      while (changed) {
        changed = false;
        for (const k of difference(lowerEdgeCandidates, traced)) {
          if (neighbors4(keyX(k), keyY(k)).some((n) => traced.has(n))) {
            traced.add(k);
            changed = true;
          }
        }
      }
    }
    for (const k of traced) mask.add(k);
  }
  const linked = linkAlignedTorsoHairLayers(normalized, mask, core, tolerance);
  const filled = fillSmallTorsoHairGaps(normalized, linked, core, tolerance);
  let torso = linkAlignedTorsoHairLayers(normalized, filled, core, tolerance);
  torso = pruneTorsoHairHandoffs(normalized, torso, headMask, core, tolerance);
  torso = linkAlignedTorsoHairLayers(normalized, torso, core, tolerance);
  const shoulder = detectShoulderHair(normalized, headMask, torso, core, tolerance);
  return difference(union(torso, shoulder), protectedSkin);
}

// ---------------------------------------------------------------------------
// Recoloring
// ---------------------------------------------------------------------------

export interface RecolorHairOptions {
  tolerance?: number;
  hairMask?: Set<number> | null;
  colorReferenceMask?: Set<number> | null;
  colorizeNeutrals?: boolean;
  neutralSaturationFloor?: number;
}

export function recolorHair(
  skin: SkinPixels,
  target: RGB,
  options: RecolorHairOptions = {},
): { image: SkinPixels; mask: PixelSet } {
  const {
    tolerance = 42.0,
    hairMask = null,
    colorReferenceMask = null,
    colorizeNeutrals = false,
    neutralSaturationFloor = 0.0,
  } = options;
  const source = ensure64(skin);
  const result = cloneSkinPixels(source);
  const mask = hairMask != null ? new Set(hairMask) : detectHairMask(source, tolerance);
  if (!mask.size) return { image: result, mask };
  const referenceMask = colorReferenceMask && colorReferenceMask.size ? new Set(colorReferenceMask) : mask;

  let hueX = 0.0;
  let hueY = 0.0;
  let hueWeight = 0.0;
  const sourceSaturations: number[] = [];
  const sourceValues: number[] = [];
  for (const k of sortedKeys(referenceMask)) {
    const [hue, saturation, value] = hsvOf(rgbKey(source, k));
    if (value < 0.02) continue;
    sourceValues.push(value);
    if (saturation < 0.04) continue;
    const weight = saturation * Math.max(value, 0.15);
    const angle = hue * TAU;
    hueX += Math.cos(angle) * weight;
    hueY += Math.sin(angle) * weight;
    hueWeight += weight;
    sourceSaturations.push(saturation);
  }

  const [targetHue, targetSaturation, targetValue] = hsvOf(target);
  let sourceHue: number;
  if (hueWeight === 0) {
    if (!colorizeNeutrals || !sourceValues.length) return { image: result, mask };
    sourceHue = targetHue;
  } else {
    sourceHue = pyMod(Math.atan2(hueY, hueX) / TAU, 1.0);
  }
  const hueShift = targetSaturation < 0.02 ? 0.0 : pyMod(targetHue - sourceHue + 0.5, 1.0) - 0.5;
  const sourceSaturation = Math.max(0.03, sourceSaturations.length ? median(sourceSaturations) : 0.03);
  const sourceValue = Math.max(0.03, median(sourceValues));
  const saturationScale = Math.min(4.0, Math.max(0.05, targetSaturation / sourceSaturation));
  const valueScale = Math.min(3.0, Math.max(0.15, targetValue / sourceValue));

  for (const k of mask) {
    const x = keyX(k);
    const y = keyY(k);
    const [r, g, b, alpha] = getPixel(source, x, y);
    const [oldHue, oldSaturation, oldValue] = rgbToHsv(r / 255, g / 255, b / 255);
    if (oldValue < 0.02) continue;
    let newHue: number;
    let newSaturation: number;
    if (oldSaturation < 0.04) {
      if (!colorizeNeutrals) continue;
      newHue = targetHue;
      const neutralWeight = Math.min(1.0, Math.max(0.14, (1.0 - oldValue) * 1.45 + 0.16));
      newSaturation = targetSaturation * Math.max(neutralWeight, neutralSaturationFloor);
    } else {
      newHue = pyMod(oldHue + hueShift, 1.0);
      newSaturation = Math.min(1.0, oldSaturation * saturationScale);
    }
    const newValue = Math.min(1.0, oldValue * valueScale);
    const changed = hsvToRgb(newHue, newSaturation, newValue);
    setPixel(result, x, y, [pyRound(changed[0] * 255), pyRound(changed[1] * 255), pyRound(changed[2] * 255), alpha]);
  }
  return { image: result, mask };
}

function medianRgb(samples: RGB[]): RGB {
  return [
    pyRound(median(samples.map((c) => c[0]))),
    pyRound(median(samples.map((c) => c[1]))),
    pyRound(median(samples.map((c) => c[2]))),
  ];
}

export function medianSkinColor(skin: SkinPixels, hairMask: Set<number>): RGB {
  const pixels = ensure64(skin);
  const safeSamples: RGB[] = [];
  const safeCoords: Array<[number, number]> = [];
  for (let x = 9; x < 15; x++) safeCoords.push([x, 15]);
  safeCoords.push([11, 14], [12, 14]);
  for (const [x, y] of safeCoords) {
    const color = rgbAt(pixels, x, y);
    if (alphaAt(pixels, x, y) >= 128 && likelySkinTone(color)) safeSamples.push(color);
  }
  if (safeSamples.length >= 2) return medianRgb(safeSamples);

  const samples: RGB[] = [];
  for (let y = 11; y < 16; y++)
    for (let x = 9; x < 15; x++) {
      if (hairMask.has(key(x, y))) continue;
      const color = rgbAt(pixels, x, y);
      if (alphaAt(pixels, x, y) >= 128 && likelySkinTone(color)) samples.push(color);
    }
  if (!samples.length)
    for (let y = 8; y < 16; y++)
      for (let x = 9; x < 15; x++) {
        const color = rgbAt(pixels, x, y);
        if (alphaAt(pixels, x, y) >= 128 && likelySkinTone(color)) samples.push(color);
      }
  if (!samples.length)
    for (let y = 11; y < 16; y++)
      for (let x = 9; x < 15; x++) if (alphaAt(pixels, x, y) >= 128) samples.push(rgbAt(pixels, x, y));
  if (!samples.length) return [0xc6, 0x8d, 0x71];
  return medianRgb(samples);
}

export function detectEyeAnchor(skin: SkinPixels, skinColor: RGB | null = null): number {
  const pixels = ensure64(skin);
  const sc = skinColor ?? medianSkinColor(pixels, new Set());
  const candidates: Array<[number, number]> = [];
  for (let y = EYE_SEARCH_BOX[1]; y < EYE_SEARCH_BOX[3]; y++) {
    let score = 0;
    for (const [lx, rx] of [
      [9, 14],
      [10, 13],
    ]) {
      if (alphaAt(pixels, lx, y) < 48 || alphaAt(pixels, rx, y) < 48) continue;
      const left = rgbAt(pixels, lx, y);
      const right = rgbAt(pixels, rx, y);
      if (distance(left, sc) < 27 || distance(right, sc) < 27) continue;
      if (distance(left, right) <= 76) score++;
    }
    if (score) candidates.push([score, y]);
  }
  if (!candidates.length) return 13;
  const strongest = Math.max(...candidates.map((c) => c[0]));
  const allowed = Math.max(1, strongest - 1);
  return Math.max(...candidates.filter((c) => c[0] >= allowed).map((c) => c[1]));
}

function bilateralEyeFeatures(pixels: SkinPixels, skinColor: RGB, anchorY: number): PixelSet {
  const features: PixelSet = new Set();
  for (let y = Math.max(EYE_SEARCH_BOX[1], anchorY - 2); y < Math.min(EYE_SEARCH_BOX[3], anchorY + 1); y++) {
    for (const [lx, rx] of [
      [9, 14],
      [10, 13],
    ]) {
      if (alphaAt(pixels, lx, y) < 48 || alphaAt(pixels, rx, y) < 48) continue;
      const left = rgbAt(pixels, lx, y);
      const right = rgbAt(pixels, rx, y);
      if (distance(left, skinColor) < 27 || distance(right, skinColor) < 27) continue;
      if (distance(left, right) <= 76) {
        features.add(key(lx, y));
        features.add(key(rx, y));
      }
    }
  }
  return features;
}

function boxCoordinates(box: Box): PixelSet {
  const out: PixelSet = new Set();
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) out.add(key(x, y));
  return out;
}

function traceSkinRegion(
  candidates: Set<number>,
  region: Set<number>,
  seeds: Set<number>,
  pixels: SkinPixels,
  edgeLimit: number,
): PixelSet {
  const available = intersection(candidates, region);
  return floodConnected(
    intersection(available, seeds),
    available,
    (a, b) => distance(rgbKey(pixels, a), rgbKey(pixels, b)) <= edgeLimit,
  );
}

export function detectSkinMask(skin: SkinPixels, hairMask: Set<number> | null = null, tolerance = 24.0): PixelSet {
  const pixels = ensure64(skin);
  const hm = hairMask ?? detectHairMask(pixels);
  const center = medianSkinColor(pixels, hm);
  const candidates = new Set<number>();
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      if (alphaAt(pixels, x, y) < 48) continue;
      if (distance(rgbAt(pixels, x, y), center) > tolerance) continue;
      candidates.add(key(x, y));
    }

  const faceCandidates = new Set(
    [...candidates].filter((k) => {
      const x = keyX(k);
      const y = keyY(k);
      return 8 <= x && x < 16 && 8 <= y && y < 16;
    }),
  );
  const crownPalette = hairCorePalette(hairPalette(pixels));
  const crownHairCandidates = new Set<number>();
  if (crownPalette.length)
    for (const k of intersection(faceCandidates, hm)) {
      const color = rgbKey(pixels, k);
      if (minDistance(color, crownPalette) < distance(color, center)) crownHairCandidates.add(k);
    }
  const crownHair = floodConnected(
    [...crownHairCandidates].filter((k) => keyY(k) === 8),
    crownHairCandidates,
    (a, b) => distance(rgbKey(pixels, a), rgbKey(pixels, b)) <= 28.0,
  );
  for (const k of crownHair) faceCandidates.delete(k);
  const faceSeeds = [...faceCandidates].filter((k) => {
    const x = keyX(k);
    const y = keyY(k);
    return (y === 15 && 9 <= x && x <= 14) || (y === 14 && (x === 11 || x === 12));
  });
  const connectedFace = floodConnected(faceSeeds, faceCandidates, () => true);

  const headRegion = boxCoordinates(BASE_HEAD);
  const torsoRegion = boxCoordinates([16, 16, 40, 32]);
  const rightArmRegion = boxCoordinates([40, 16, 56, 32]);
  const leftArmRegion = boxCoordinates([32, 48, 48, 64]);
  const rightLegRegion = boxCoordinates([0, 16, 16, 32]);
  const leftLegRegion = boxCoordinates([16, 48, 32, 64]);
  const bodyCandidates = difference(candidates, hm);

  const coreLimit = Math.max(7.0, Math.min(18.0, tolerance * 0.52));
  const edgeLimit = Math.max(9.0, Math.min(27.0, tolerance * 0.88));
  const core = (k: number) => bodyCandidates.has(k) && distance(rgbKey(pixels, k), center) <= coreLimit;

  const mask = intersection(bodyCandidates, headRegion);
  for (const k of connectedFace) mask.add(k);

  const anatomicalRegion = union(torsoRegion, rightArmRegion, leftArmRegion, rightLegRegion, leftLegRegion);
  for (const k of intersection(bodyCandidates, anatomicalRegion))
    if (distance(rgbKey(pixels, k), center) <= coreLimit) mask.add(k);

  const torsoSeedCandidates: number[] = [];
  for (let x = 22; x < 26; x++) torsoSeedCandidates.push(key(x, 20));
  for (let x = 34; x < 38; x++) torsoSeedCandidates.push(key(x, 20));
  for (let x = 16; x < 40; x++) torsoSeedCandidates.push(key(x, 31));
  const torsoSeeds = new Set(torsoSeedCandidates.filter(core));
  for (const k of traceSkinRegion(bodyCandidates, torsoRegion, torsoSeeds, pixels, edgeLimit)) mask.add(k);

  const seedsAt = (ys: number[], x0: number, x1: number) => {
    const out = new Set<number>();
    for (const y of ys) for (let x = x0; x < x1; x++) if (core(key(x, y))) out.add(key(x, y));
    return out;
  };
  const regions: Array<[Set<number>, Set<number>]> = [
    [rightArmRegion, seedsAt([31], 40, 56)],
    [leftArmRegion, seedsAt([63], 32, 48)],
    [rightLegRegion, seedsAt([20, 31], 0, 16)],
    [leftLegRegion, seedsAt([52, 63], 16, 32)],
  ];
  for (const [region, seeds] of regions)
    for (const k of traceSkinRegion(bodyCandidates, region, seeds, pixels, edgeLimit)) mask.add(k);
  return mask;
}

export function recolorSkinTone(
  skin: SkinPixels,
  target: RGB,
  hairMask: Set<number> | null = null,
  tolerance = 24.0,
  skinMask: Set<number> | null = null,
): { image: SkinPixels; mask: PixelSet } {
  const source = ensure64(skin);
  const hm = hairMask ?? detectHairMask(source);
  const mask = skinMask != null ? new Set(skinMask) : detectSkinMask(source, hm, tolerance);
  const result = cloneSkinPixels(source);
  if (!mask.size) return { image: result, mask };

  const values = [...mask].map((k) => hsvOf(rgbKey(source, k))[2]);
  const medianValue = Math.max(0.08, median(values));
  const [targetHue, targetSaturation, targetValue] = hsvOf(target);
  const valueScale = Math.min(2.5, Math.max(0.35, targetValue / medianValue));
  for (const k of mask) {
    const x = keyX(k);
    const y = keyY(k);
    const [r, g, b, alpha] = getPixel(source, x, y);
    const [, oldSaturation, oldValue] = rgbToHsv(r / 255, g / 255, b / 255);
    const newSaturation = Math.min(1.0, targetSaturation * 0.88 + oldSaturation * 0.12);
    const newValue = Math.min(1.0, Math.max(0.03, oldValue * valueScale));
    const changed = hsvToRgb(targetHue, newSaturation, newValue);
    setPixel(result, x, y, [pyRound(changed[0] * 255), pyRound(changed[1] * 255), pyRound(changed[2] * 255), alpha]);
  }
  return { image: result, mask };
}

// ---------------------------------------------------------------------------
// Accessories / outfit
// ---------------------------------------------------------------------------

function hairHsvCenter(skin: SkinPixels, hairMask: Set<number>): [number, number, number] {
  let hueX = 0.0;
  let hueY = 0.0;
  let weights = 0.0;
  const saturations: number[] = [];
  const values: number[] = [];
  const sorted = sortedKeys(hairMask);
  const baseSamples = sorted.filter((k) => keyY(k) < 16 && keyX(k) < 32);
  const samples = baseSamples.length ? baseSamples : sorted.filter((k) => keyY(k) < 16);
  for (const k of samples) {
    if (alphaAt(skin, keyX(k), keyY(k)) < 48) continue;
    const [hue, saturation, value] = hsvOf(rgbKey(skin, k));
    values.push(value);
    if (saturation < 0.06) continue;
    const weight = saturation * Math.max(0.15, value);
    hueX += Math.cos(hue * TAU) * weight;
    hueY += Math.sin(hue * TAU) * weight;
    weights += weight;
    saturations.push(saturation);
  }
  const hue = weights ? pyMod(Math.atan2(hueY, hueX) / TAU, 1.0) : 0.0;
  return [hue, saturations.length ? median(saturations) : 0.0, values.length ? median(values) : 0.5];
}

function accessoryLike(color: RGB, hairCenter: [number, number, number]): boolean {
  const [hue, saturation, value] = hsvOf(color);
  const [hairHue, hairSaturation, hairValue] = hairCenter;
  let hueGap = Math.abs(hue - hairHue);
  hueGap = Math.min(hueGap, 1.0 - hueGap);
  if (saturation >= 0.11 && (hairSaturation < 0.08 || hueGap >= 34 / 360)) return true;
  if (saturation < 0.08 && hairSaturation >= 0.24 && Math.abs(value - hairValue) >= 0.16) return true;
  return false;
}

export function detectHairAccessoryMask(
  skin: SkinPixels,
  headHairMask: Set<number>,
  bodyHairMask: Set<number> | null = null,
  skinMask: Set<number> | null = null,
): PixelSet {
  const pixels = ensure64(skin);
  const bodyHair = new Set(bodyHairMask ?? []);
  const skinSet = new Set(skinMask ?? []);
  const hairCenter = hairHsvCenter(pixels, headHairMask);

  const protectedFace = new Set<number>();
  for (let y = 10; y < 16; y++) {
    for (let x = 8; x < 16; x++) protectedFace.add(key(x, y));
    for (let x = 40; x < 48; x++) protectedFace.add(key(x, y));
  }
  const headCandidates = new Set<number>();
  for (let y = 0; y < 16; y++)
    for (let x = 32; x < 64; x++) {
      const k = key(x, y);
      if (
        alphaAt(pixels, x, y) >= 48 &&
        headHairMask.has(k) &&
        !skinSet.has(k) &&
        !protectedFace.has(k) &&
        accessoryLike(rgbAt(pixels, x, y), hairCenter)
      )
        headCandidates.add(k);
    }
  const headMask: PixelSet = new Set();
  for (const component of pixelComponents(headCandidates, pixels, 46.0))
    if (component.size <= 32) for (const k of component) headMask.add(k);

  const headAccessoryColors = [...headMask].map((k) => rgbKey(pixels, k));

  const corridor = new Set<number>();
  for (const k of bodyHair) {
    const hx = keyX(k);
    const hy = keyY(k);
    for (let oy = -1; oy < 2; oy++)
      for (let ox = -1; ox < 2; ox++) {
        const x = hx + ox;
        const y = hy + oy;
        if (0 <= x && x < 64 && 16 <= y && y < 64) corridor.add(key(x, y));
      }
  }
  const bodyCandidates = new Set<number>();
  for (const k of corridor) {
    if (bodyHair.has(k) || skinSet.has(k)) continue;
    if (alphaAt(pixels, keyX(k), keyY(k)) < 48) continue;
    if (accessoryLike(rgbKey(pixels, k), hairCenter)) bodyCandidates.add(k);
  }
  const bodyMask: PixelSet = new Set();
  for (const component of pixelComponents(bodyCandidates, pixels, 46.0)) {
    let contacts = 0;
    let touchingPixels = 0;
    for (const k of component) {
      const x = keyX(k);
      const y = keyY(k);
      let local = 0;
      for (const oy of [-1, 0, 1])
        for (const ox of [-1, 0, 1]) {
          if (!ox && !oy) continue;
          if (inGrid(x + ox, y + oy) && bodyHair.has(key(x + ox, y + oy))) local++;
        }
      contacts += local;
      if (local > 0) touchingPixels++;
    }
    const n = component.size;
    const minimumTouching = Math.max(1, Math.ceil(n * 0.65));
    const paletteMatch =
      headAccessoryColors.length > 0 &&
      [...component].some((k) => {
        const c = rgbKey(pixels, k);
        return headAccessoryColors.some((h) => distance(c, h) <= 58);
      });
    const tinyEmbeddedOrnament = n <= 6 && touchingPixels === n && contacts >= n * 3;
    if (
      1 <= n &&
      n <= 24 &&
      touchingPixels >= minimumTouching &&
      contacts >= Math.max(2, n * 2) &&
      (paletteMatch || tinyEmbeddedOrnament)
    )
      for (const k of component) bodyMask.add(k);
  }
  return union(headMask, bodyMask);
}

export function detectOutfitMask(
  skin: SkinPixels,
  hairMask: Set<number>,
  skinMask: Set<number>,
  accessoryMask: Set<number> | null = null,
): PixelSet {
  const pixels = ensure64(skin);
  const excluded = union(hairMask, skinMask, accessoryMask ?? []);
  const out: PixelSet = new Set();
  for (let y = 16; y < 64; y++)
    for (let x = 0; x < 64; x++) if (alphaAt(pixels, x, y) >= 48 && !excluded.has(key(x, y))) out.add(key(x, y));
  return out;
}

// ---------------------------------------------------------------------------
// Face templates
// ---------------------------------------------------------------------------

export function makeFaceTemplate(reference: SkinPixels, hairTolerance = 42.0): FaceTemplate {
  const normalized = ensure64(reference);
  const hairMask = detectHairMask(normalized, hairTolerance);
  const skinColor = medianSkinColor(normalized, hairMask);
  const sourceAnchorY = detectEyeAnchor(normalized, skinColor);
  const features = new Map<number, RGBA>();
  const [left, , right] = EYE_FEATURE_BOX;
  const top = Math.max(EYE_SEARCH_BOX[1], sourceAnchorY - 2);
  const bottom = Math.min(EYE_SEARCH_BOX[3], sourceAnchorY + 1);
  const verticalShift = STANDARD_EYE_ANCHOR - sourceAnchorY;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      if (!EYE_FEATURE_COLUMNS.includes(x)) continue;
      if (hairMask.has(key(x, y))) continue;
      const color = getPixel(normalized, x, y);
      if (color[3] >= 48 && distance(color, skinColor) >= 24) {
        const ny = y + verticalShift;
        if (EYE_FEATURE_BOX[1] <= ny && ny < EYE_FEATURE_BOX[3]) features.set(key(x, ny), color);
      }
    }
  return { features, skinColor, anchorY: STANDARD_EYE_ANCHOR };
}

export function applyFaceTemplate(
  styled: SkinPixels,
  originalInput: SkinPixels,
  template: FaceTemplate,
  originalHairMask: Set<number>,
  matchReferenceSkinTone = false,
  faceFillColor: RGB | null = null,
  eyesOverBangs = true,
  preserveHatLayerLashes = true,
): SkinPixels {
  const result = normalizeSkin(styled).image;
  const original = ensure64(originalInput);
  const destinationSkin = medianSkinColor(original, originalHairMask);
  const fill = faceFillColor ?? (matchReferenceSkinTone ? template.skinColor : destinationSkin);
  const originalAnchor = detectEyeAnchor(original, destinationSkin);
  const verticalShift = STANDARD_EYE_ANCHOR - template.anchorY;
  let linerColor: RGBA | null = null;
  for (const [k, color] of template.features) {
    const x = keyX(k);
    if (x === EYE_FEATURE_BOX[0] || x === EYE_FEATURE_BOX[2] - 1) {
      linerColor = color;
      break;
    }
  }
  const probableHatLash = (color: RGBA) => {
    if (color[3] < 48) return false;
    const [, saturation, value] = hsvOf(color);
    return value <= 0.4 && (saturation <= 0.72 || value <= 0.25);
  };

  const [left, , right] = EYE_FEATURE_BOX;
  const top = Math.max(EYE_SEARCH_BOX[1], originalAnchor - 2);
  const bottom = Math.min(EYE_SEARCH_BOX[3], originalAnchor + 1);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      if (!EYE_FEATURE_COLUMNS.includes(x)) continue;
      if (originalHairMask.has(key(x, y))) continue;
      const oldAlpha = alphaAt(original, x, y);
      if (oldAlpha >= 48) setPixel(result, x, y, [fill[0], fill[1], fill[2], oldAlpha]);
    }

  for (const [k, color] of template.features) {
    const x = keyX(k);
    const y = keyY(k) + verticalShift;
    if (EYE_SEARCH_BOX[1] <= y && y < EYE_SEARCH_BOX[3] && (eyesOverBangs || !originalHairMask.has(key(x, y))))
      setPixel(result, x, y, color);
  }

  const overlayOffset = HAT_FRONT[0] - FACE_FRONT[0];
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      if (!EYE_FEATURE_COLUMNS.includes(x)) continue;
      const ox = x + overlayOffset;
      const keepLash = preserveHatLayerLashes && probableHatLash(getPixel(original, ox, y));
      if (!originalHairMask.has(key(ox, y)) && !keepLash) setPixel(result, ox, y, [0, 0, 0, 0]);
      else if (keepLash && linerColor !== null) setPixel(result, ox, y, linerColor);
    }
  if (eyesOverBangs) {
    for (const k of template.features.keys()) {
      const x = keyX(k);
      const y = keyY(k) + verticalShift;
      if (EYE_SEARCH_BOX[1] <= y && y < EYE_SEARCH_BOX[3]) {
        const ox = x + overlayOffset;
        const keepLash = preserveHatLayerLashes && probableHatLash(getPixel(original, ox, y));
        if (!keepLash) setPixel(result, ox, y, [0, 0, 0, 0]);
        else if (linerColor !== null) setPixel(result, ox, y, linerColor);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function ensure64(image: SkinPixels): SkinPixels {
  return image.width === 64 && image.height === 64 ? image : normalizeSkin(image).image;
}

export function styleSkin(image: SkinPixels, options: StyleSkinOptions): StyleSkinResult {
  const {
    targetHairColor = null,
    tolerance = 42.0,
    faceTemplate = null,
    matchReferenceSkinTone = false,
    targetSkinColor = null,
    skinTolerance = 24.0,
    includeBodyHair = true,
    eyesOverBangs = true,
    targetOutfitColor = null,
    targetAccessoryColor = null,
    preserveHatLayerLashes = true,
    hairAdd = null,
    hairRemove = null,
    tags = null,
  } = options;
  const add = new Set<number>(hairAdd ?? []);
  const remove = new Set<number>(hairRemove ?? []);
  for (const k of remove) add.delete(k);
  const hasFixes = add.size > 0 || remove.size > 0;
  const { image: normalized, wasNormalized } = normalizeSkin(image);
  let skinMask: PixelSet;
  let accessoryMask: PixelSet;
  let effectiveHeadHairMask: PixelSet;
  let effectiveHairMask: PixelSet;
  if (tags) {
    const isHeadKey = (k: number) => keyY(k) < 16;
    skinMask = new Set(tags.skin);
    accessoryMask = new Set();
    effectiveHeadHairMask = new Set([...tags.hair].filter(isHeadKey));
    effectiveHairMask = includeBodyHair ? new Set(tags.hair) : new Set(effectiveHeadHairMask);
  } else {
    const originalHairMask = detectHairMask(normalized, tolerance);
    const anatomicalSkinMask = detectSkinMask(normalized, originalHairMask, skinTolerance);
    const bodyHairMask = includeBodyHair ? detectBodyHairMask(normalized, tolerance) : new Set<number>();
    const combinedHairMask = union(originalHairMask, bodyHairMask);
    skinMask = union(detectSkinMask(normalized, combinedHairMask, skinTolerance), anatomicalSkinMask);
    accessoryMask = detectHairAccessoryMask(normalized, originalHairMask, bodyHairMask, skinMask);
    effectiveHeadHairMask = difference(originalHairMask, skinMask, accessoryMask);
    effectiveHairMask = difference(combinedHairMask, skinMask, accessoryMask);
  }
  if (hasFixes) {
    const isHead = (k: number) => keyY(k) < 16 && keyX(k) < 64;
    skinMask = difference(skinMask, add);
    accessoryMask = difference(accessoryMask, add);
    effectiveHairMask = difference(union(effectiveHairMask, add), remove);
    effectiveHeadHairMask = difference(union(effectiveHeadHairMask, [...add].filter(isHead)), remove);
  }
  const outfitMask = tags
    ? difference(tags.clothing, effectiveHairMask)
    : detectOutfitMask(normalized, effectiveHairMask, skinMask, accessoryMask);
  const base =
    targetSkinColor != null
      ? recolorSkinTone(normalized, targetSkinColor, effectiveHairMask, skinTolerance, skinMask).image
      : normalized;
  let styled =
    targetHairColor != null
      ? recolorHair(base, targetHairColor, {
          tolerance,
          hairMask: effectiveHairMask,
          colorReferenceMask: effectiveHeadHairMask,
        }).image
      : cloneSkinPixels(base);
  if (targetOutfitColor != null)
    styled = recolorHair(styled, targetOutfitColor, {
      tolerance,
      hairMask: outfitMask,
      colorReferenceMask: outfitMask,
      colorizeNeutrals: true,
      neutralSaturationFloor: 0.68,
    }).image;
  if (targetAccessoryColor != null)
    styled = recolorHair(styled, targetAccessoryColor, {
      tolerance,
      hairMask: accessoryMask,
      colorReferenceMask: accessoryMask,
      colorizeNeutrals: true,
    }).image;
  if (faceTemplate != null)
    styled = applyFaceTemplate(
      styled,
      normalized,
      faceTemplate,
      effectiveHeadHairMask,
      matchReferenceSkinTone,
      targetSkinColor,
      eyesOverBangs,
      preserveHatLayerLashes,
    );
  return { image: styled, hairMask: effectiveHairMask, wasNormalized };
}
