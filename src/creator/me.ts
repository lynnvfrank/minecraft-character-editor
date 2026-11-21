/**
 * Me: the character's own hair, eyes and skin, each a style picked from any skin in the library
 * plus an optional color. Chosen in the Me tab (mePanel.ts) and worn under every outfit picked in
 * the Wardrobe: the Wardrobe's final pass dresses the composed outfit with Me (applyMe).
 *
 * Styles are cut out of their skins by feature tags (featureTagsStore.ts, painted in the 2D/3D
 * editor) or, for untagged skins, by the automatic guess. The mixing and recoloring is pure
 * (styler/meLook.ts); this module holds the choices, loads skins and draws catalog cut-outs.
 */
import { SKIN_SIZE, RESOLUTION_MULTIPLIER, WORK_SIZE } from '../skin';
import { autoTagFeatures, FEATURE_CODE, isOverlayTexel, type FeatureMap, type TaggedSkin } from '../styler/featureMap';
import { dressMe, ME_FEATURES, type MeFeature, type MeLook } from '../styler/meLook';
import { loadFeatureTags, onFeatureTagsSaved, skinPixelKey } from './featureTagsStore';
import { convertArmLayout } from '../skin/armConvert';
import { detectArmModelFromRGBA, type ArmModel } from '../skin/armModel';

export type { MeFeature } from '../styler/meLook';
export { ME_FEATURES } from '../styler/meLook';

type StoredChoice = { style: string | null; color: string | null };
type StoredLook = Record<MeFeature, StoredChoice>;

const STORAGE_KEY = 'blockygotchi.me.v1';
/** The Wardrobe Pieces picks this replaces: carried over once as styles. */
const OLD_PIECES_KEY = 'blockygotchi.wardrobePieces.v1';

const HEX = /^#[0-9a-f]{6}$/;

function emptyLook(): StoredLook {
  return { hair: { style: null, color: null }, eyes: { style: null, color: null }, skin: { style: null, color: null } };
}

function validStyle(v: unknown): string | null {
  // Saved-this-visit skins are data URLs: too big to keep, and gone next visit anyway.
  return typeof v === 'string' && v.length < 300 && !v.startsWith('data:') ? v : null;
}

function loadLook(): StoredLook {
  const look = emptyLook();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<MeFeature, Partial<StoredChoice>>>;
      for (const f of ME_FEATURES) {
        look[f].style = validStyle(parsed?.[f]?.style);
        const c = parsed?.[f]?.color;
        look[f].color = typeof c === 'string' && HEX.test(c) ? c : null;
      }
      return look;
    }
    const old = JSON.parse(localStorage.getItem(OLD_PIECES_KEY) ?? 'null') as Partial<Record<MeFeature, unknown>> | null;
    if (old) for (const f of ME_FEATURES) look[f].style = validStyle(old[f]);
  } catch {
    // unreadable: start fresh
  }
  return look;
}

function saveLook(): void {
  try {
    const keep = emptyLook();
    for (const f of ME_FEATURES) {
      keep[f].style = look[f].style?.startsWith('data:') ? null : look[f].style;
      keep[f].color = look[f].color;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch {
    // storage unavailable: the look lasts for this visit
  }
}

const look: StoredLook = loadLook();
/** Hovered style in the catalog: previews in place of that feature's style. */
let preview: { feature: MeFeature; style: string | null } | null = null;
const listeners = new Set<() => void>();

/** Notified when a style, a color or the hover preview changes (the outfit is re-dressed). */
export function onMeChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  listeners.forEach((fn) => fn());
}

export function getMeChoice(feature: MeFeature): Readonly<StoredChoice> {
  return look[feature];
}

function effectiveStyle(feature: MeFeature): string | null {
  return preview?.feature === feature ? preview.style : look[feature].style;
}

export function setMeStyle(feature: MeFeature, style: string | null): void {
  look[feature].style = style;
  if (preview?.feature === feature) preview = null;
  saveLook();
  if (style && !sources.has(style)) void ensureSource(style).then(emit);
  else emit();
}

export function setMeColor(feature: MeFeature, color: string | null): void {
  const c = color?.slice(0, 7).toLowerCase() ?? null;
  look[feature].color = c && HEX.test(c) ? c : null;
  saveLook();
  emit();
}

/** Preview a style while it's hovered in the catalog (undefined = stop previewing). */
export function previewMeStyle(feature: MeFeature, style: string | null | undefined): void {
  const next = style === undefined ? null : { feature, style };
  if (next?.feature === preview?.feature && next?.style === preview?.style) return;
  preview = next;
  if (next?.style && !sources.has(next.style)) {
    const path = next.style;
    void ensureSource(path).then(() => {
      if (preview?.style === path) emit();
    });
    return;
  }
  emit();
}

/** The arm shape Me wears (Slim / Classic), or null for Auto (each outfit keeps its own). */
let armTarget: () => ArmModel | null = () => null;
export function setMeArmTarget(fn: () => ArmModel | null): void {
  armTarget = fn;
}
/** The arm setting changed: re-dress the outfit. */
export function notifyMeArmsChanged(): void {
  emit();
}

/** True when Me changes anything about an outfit. */
export function hasMe(): boolean {
  return armTarget() != null || ME_FEATURES.some((f) => effectiveStyle(f) != null || look[f].color != null);
}

/** A tagged skin with its arms (pixels and tags) rebuilt for `target`, if they're the other shape. */
const fitted = new Map<string, { src: TaggedSkin; out: TaggedSkin }>();
function fitArms(src: TaggedSkin, target: ArmModel | null, cacheKey?: string): TaggedSkin {
  if (!target) return src;
  const data = src.pixels.data as Uint8ClampedArray;
  const from = detectArmModelFromRGBA(data, 64);
  if (!from || from === target) return src;
  const key = cacheKey ? `${cacheKey}|${target}` : null;
  const cached = key ? fitted.get(key) : undefined;
  if (cached && cached.src === src) return cached.out;
  const out: TaggedSkin = {
    pixels: { width: 64, height: 64, data: convertArmLayout(data, from, target) },
    map: convertArmLayout(src.map, from, target, 1),
  };
  if (key) fitted.set(key, { src, out });
  return out;
}

// ---------------------------------------------------------------------------
// Source skins: 64x64 pixels (read exactly as the editor loads them, so tag keys match) + tags.

const sources = new Map<string, TaggedSkin | null>();
const loading = new Map<string, Promise<TaggedSkin | null>>();
/** Auto-guessed maps by skin key (guessing takes a few ms; outfits re-dress on every hover). */
const guessed = new Map<string, FeatureMap>();

function tagsFor(pixels: Uint8ClampedArray): FeatureMap {
  const key = skinPixelKey(pixels);
  const stored = loadFeatureTags(key);
  if (stored) return stored;
  let map = guessed.get(key);
  if (!map) {
    map = autoTagFeatures({ width: SKIN_SIZE, height: SKIN_SIZE, data: pixels });
    if (guessed.size > 256) guessed.clear();
    guessed.set(key, map);
  }
  return map;
}

function downsample(work: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const src = (y * RESOLUTION_MULTIPLIER * WORK_SIZE + x * RESOLUTION_MULTIPLIER) * 4;
      out.set(work.subarray(src, src + 4), (y * SKIN_SIZE + x) * 4);
    }
  }
  return out;
}

function loadImage(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path.startsWith('data:') || path.startsWith('/') ? path : `/${path}`;
  });
}

/** Load a skin the way skinIO.loadSkinToCanvas does (draw at working size, sample back) and tag it. */
export function ensureSource(path: string): Promise<TaggedSkin | null> {
  if (sources.has(path)) return Promise.resolve(sources.get(path) ?? null);
  let pending = loading.get(path);
  if (pending) return pending;
  pending = (async () => {
    const img = await loadImage(path);
    let result: TaggedSkin | null = null;
    if (img && img.width > 0 && img.height > 0) {
      const c = document.createElement('canvas');
      c.width = WORK_SIZE;
      c.height = WORK_SIZE;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const h = img.height < img.width ? (WORK_SIZE * img.height) / img.width : WORK_SIZE;
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, WORK_SIZE, h);
        const pixels = downsample(ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data);
        result = { pixels: { width: SKIN_SIZE, height: SKIN_SIZE, data: pixels }, map: tagsFor(pixels) };
      }
    }
    sources.set(path, result);
    loading.delete(path);
    return result;
  })();
  loading.set(path, pending);
  return pending;
}

/** Tags were edited in the 2D/3D editor: re-read the tags of loaded skins. */
onFeatureTagsSaved(() => {
  for (const [path, src] of sources) {
    if (src) sources.set(path, { pixels: src.pixels, map: tagsFor(src.pixels.data as Uint8ClampedArray) });
  }
  fitted.clear();
  tagListeners.forEach((fn) => fn());
  if (hasMe()) emit();
});
const tagListeners = new Set<() => void>();
/** Notified when any skin's tags change (catalog cut-outs redraw). */
export function onMeTagsChanged(fn: () => void): () => void {
  tagListeners.add(fn);
  return () => tagListeners.delete(fn);
}

/** Load the chosen styles (call once at startup); emits when they're ready. */
export function loadMeStyles(): void {
  const pending = ME_FEATURES.map((f) => look[f].style).filter((p): p is string => p != null).map(ensureSource);
  if (pending.length) void Promise.all(pending).then(emit);
}

// ---------------------------------------------------------------------------
// The Wardrobe's final pass.

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The composed outfit (working resolution) worn by Me, or null when Me changes nothing (or its
 * styles haven't loaded yet). Only texels that changed are rewritten, so the outfit keeps any
 * hi-res detail.
 */
export function applyMe(work: ImageData): ImageData | null {
  if (!hasMe()) return null;
  const target = armTarget();
  const meLook = {} as MeLook;
  for (const f of ME_FEATURES) {
    const path = effectiveStyle(f);
    const color = look[f].color;
    const src = path ? (sources.get(path) ?? null) : null;
    meLook[f] = { style: src ? fitArms(src, target, path!) : null, color: color ? hexToRgb(color) : null };
  }
  const outfitPixels = downsample(work.data);
  const outfit = fitArms({ pixels: { width: SKIN_SIZE, height: SKIN_SIZE, data: outfitPixels }, map: tagsFor(outfitPixels) }, target);
  if (outfit.pixels.data === outfitPixels && ME_FEATURES.every((f) => !meLook[f].style && !meLook[f].color)) return null;
  const dressed = dressMe(outfit, meLook).data;

  const out = new ImageData(new Uint8ClampedArray(work.data), WORK_SIZE, WORK_SIZE);
  for (let k = 0; k < SKIN_SIZE * SKIN_SIZE; k++) {
    const i = k * 4;
    if (dressed[i] === outfitPixels[i] && dressed[i + 1] === outfitPixels[i + 1] && dressed[i + 2] === outfitPixels[i + 2] && dressed[i + 3] === outfitPixels[i + 3]) continue;
    const sx = k % SKIN_SIZE;
    const sy = (k / SKIN_SIZE) | 0;
    for (let dy = 0; dy < RESOLUTION_MULTIPLIER; dy++) {
      for (let dx = 0; dx < RESOLUTION_MULTIPLIER; dx++) {
        const o = ((sy * RESOLUTION_MULTIPLIER + dy) * WORK_SIZE + sx * RESOLUTION_MULTIPLIER + dx) * 4;
        out.data[o] = dressed[i]!;
        out.data[o + 1] = dressed[i + 1]!;
        out.data[o + 2] = dressed[i + 2]!;
        out.data[o + 3] = dressed[i + 3]!;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catalog cut-outs: a feature pulled out of its skin, shown from the front.

/** Front view regions: [inner x, inner y, overlay x, overlay y, width, height, draw at y]. */
const HEAD_FRONT = [8, 8, 40, 8, 8, 8, 0] as const;
const TORSO_TOP = [20, 20, 20, 36, 8, 5, 8] as const;
const NEUTRAL: [number, number, number, number] = [205, 205, 210, 110];
const FACE_BASE: [number, number, number, number] = [226, 196, 172, 255];

/** Logical size (in skin pixels) of a cut-out for a feature. */
export function cutoutSize(feature: MeFeature): { w: number; h: number } {
  return feature === 'eyes' ? { w: 8, h: 8 } : { w: 8, h: 13 };
}

/**
 * Draw one feature of a skin into `canvas` (scaled, pixelated):
 * hair on a faint head and shoulders, eyes on a plain face, skin with its own shading.
 */
export function drawCutout(canvas: HTMLCanvasElement, src: TaggedSkin, feature: MeFeature): void {
  const { w, h } = cutoutSize(feature);
  const img = new ImageData(w, h);
  const put = (x: number, y: number, c: ArrayLike<number>) => {
    const o = (y * w + x) * 4;
    const a = (c[3] ?? 255) / 255;
    const inv = 1 - a;
    img.data[o] = img.data[o]! * inv + c[0]! * a;
    img.data[o + 1] = img.data[o + 1]! * inv + c[1]! * a;
    img.data[o + 2] = img.data[o + 2]! * inv + c[2]! * a;
    img.data[o + 3] = Math.min(255, img.data[o + 3]! + (c[3] ?? 255));
  };
  const d = src.pixels.data;
  const px = (k: number) => d.subarray(k * 4, k * 4 + 4);
  const regions = feature === 'eyes' ? [HEAD_FRONT] : [HEAD_FRONT, TORSO_TOP];
  const code = FEATURE_CODE[feature];

  // Skin: a flat median tone where the skin isn't showing, so only its own pixels carry shading.
  let tone: number[] = FACE_BASE;
  if (feature === 'skin') {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let k = 0; k < 64 * 64; k++) {
      if (src.map[k] !== code || (d[k * 4 + 3] ?? 0) < 48) continue;
      rs.push(d[k * 4]!);
      gs.push(d[k * 4 + 1]!);
      bs.push(d[k * 4 + 2]!);
    }
    const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1] ?? 200;
    if (rs.length) tone = [med(rs), med(gs), med(bs), 255];
  }

  for (const [ix, iy, ox, oy, rw, rh, at] of regions) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        put(x, at + y, feature === 'hair' ? NEUTRAL : tone);
        for (const [bx, by] of [[ix, iy], [ox, oy]] as const) {
          const k = (by + y) * 64 + bx + x;
          if (src.map[k] !== code || (d[k * 4 + 3] ?? 0) === 0) continue;
          if (feature === 'skin' && isOverlayTexel(k)) continue;
          put(x, at + y, px(k));
        }
      }
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d')?.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / w, canvas.height / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(tmp, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
}
