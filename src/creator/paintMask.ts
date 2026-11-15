/**
 * Which skin pixels are visible and paintable, from layer visibility / lock / 2D selection state.
 * Pure (skin-pixel coordinates, no DOM); used by blockyEditor.ts and tested in paintMask.test.ts.
 */
import { SKIN_SIZE, SKIN_LAYER_BOUNDS, LAYER_KEYS, isLayerKey, isLayerWithParts, type LayerKey } from '../skin';
import type { CreatorState } from '../state/creatorState';

type Rect = { x: number; y: number; w: number; h: number };

/** One visible skin rectangle (one part box) in 64×64 skin space. */
export type VisibleSkinRegion = Rect & { layerKey: LayerKey; partIndex: number };

export type PaintMaskState = Pick<
  CreatorState,
  'layer3DVisible' | 'layer3DPartVisible' | 'layer3DLocked' | 'restrictToLayers' | 'selectedLayers'
>;

const contains = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** For layers with L/R parts, bounds[0] is the right side and bounds[1] the left. */
function isPartVisible(state: PaintMaskState, layer: LayerKey, partIndex: number): boolean {
  if (!isLayerWithParts(layer)) return true;
  const parts = state.layer3DPartVisible[layer];
  return partIndex === 0 ? parts?.R !== false : parts?.L !== false;
}

/** True when every layer and every L/R part is shown (the 2D editor then uses the full 64×64 grid). */
export function isFullSkinVisible(state: PaintMaskState): boolean {
  return LAYER_KEYS.every(
    (k) => state.layer3DVisible[k] === true && isPartVisible(state, k, 0) && isPartVisible(state, k, 1)
  );
}

/** One entry per visible part rectangle (never merged), in LAYER_KEYS order. */
export function computeVisibleSkinRegions(state: PaintMaskState): VisibleSkinRegion[] {
  const out: VisibleSkinRegion[] = [];
  for (const layer of LAYER_KEYS) {
    if (state.layer3DVisible[layer] !== true) continue;
    SKIN_LAYER_BOUNDS[layer].forEach((b, i) => {
      if (isPartVisible(state, layer, i)) out.push({ x: b.x, y: b.y, w: b.w, h: b.h, layerKey: layer, partIndex: i });
    });
  }
  return out;
}

/** Bounding box of `regions`, or null when they cover the whole skin (no crop needed) or are empty. */
export function focusedCrop(regions: readonly Rect[]): Rect | null {
  if (regions.length === 0) return null;
  let minX = SKIN_SIZE;
  let minY = SKIN_SIZE;
  let maxX = 0;
  let maxY = 0;
  for (const r of regions) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0 || (w >= SKIN_SIZE && h >= SKIN_SIZE)) return null;
  return { x: minX, y: minY, w, h };
}

/** Topmost visible layer (LAYER_KEYS order) whose visible part covers skin pixel (x, y). */
export function layerAtSkinPixel(state: PaintMaskState, x: number, y: number): LayerKey | null {
  for (const layer of LAYER_KEYS) {
    if (state.layer3DVisible[layer] !== true) continue;
    const bounds = SKIN_LAYER_BOUNDS[layer];
    for (let i = 0; i < bounds.length; i++) {
      if (isPartVisible(state, layer, i) && contains(bounds[i]!, x, y)) return layer;
    }
  }
  return null;
}

/** 2D "restrict to layers": pixel lies in a selected layer (always true when unrestricted or nothing selected). */
export function isInSelectedLayers(state: PaintMaskState, x: number, y: number): boolean {
  if (!state.restrictToLayers || state.selectedLayers.size === 0) return true;
  for (const layer of state.selectedLayers) {
    if (!isLayerKey(layer)) continue;
    if (SKIN_LAYER_BOUNDS[layer].some((b) => contains(b, x, y))) return true;
  }
  return false;
}

/** Paintable: inside the 2D selection, on a visible part, and that layer isn't locked. */
export function canPaintAtSkinPixel(state: PaintMaskState, x: number, y: number): boolean {
  if (!isInSelectedLayers(state, x, y)) return false;
  const layer = layerAtSkinPixel(state, x, y);
  return layer != null && !state.layer3DLocked[layer];
}

/** Locked layer under the pixel (for "this layer is locked" feedback), else null. */
export function lockedLayerAtSkinPixel(state: PaintMaskState, x: number, y: number): LayerKey | null {
  if (!isInSelectedLayers(state, x, y)) return null;
  const layer = layerAtSkinPixel(state, x, y);
  return layer != null && state.layer3DLocked[layer] ? layer : null;
}

/** Template label for a part box, e.g. "Right Arm"; plain capitalised layer name otherwise. */
export function getTemplateLabelText(layerKey: string, bounds: { x: number; y: number }): string {
  const sided: Record<string, Record<string, string>> = {
    arms: { '40,16': 'Right Arm', '32,48': 'Left Arm' },
    sleeves: { '40,32': 'Right Sleeve', '48,48': 'Left Sleeve' },
    pants: { '0,32': 'Right Pants', '0,48': 'Left Pants' },
    legs: { '0,16': 'Right Leg', '16,48': 'Left Leg' },
  };
  const label = sided[layerKey]?.[`${bounds.x},${bounds.y}`];
  return label ?? layerKey.charAt(0).toUpperCase() + layerKey.slice(1);
}
