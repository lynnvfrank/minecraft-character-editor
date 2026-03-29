/**
 * Soft paint brush stamp: Chebyshev distance from center, source-over blend with existing texels.
 * Effective opacity falls from 1 at center toward a softness-dependent floor at the outer ring.
 */

import { hexToRgb } from '../lib/color';
import type { PaintBrushSize } from '../config/paintBrushTool';
import { PAINT_BRUSH_TOOL_CONFIG } from '../config/paintBrushTool';
import { RESOLUTION_MULTIPLIER, WORK_SIZE } from '../skin';
import { isPixelInSkinBounds, putWorkingPixelRgba, type CanPaintAt, type StrokeRecord } from './skinCanvasWrite';

/**
 * `PaintBrushSize` width/height are **skin** pixels (64×64 layout — same grid as exported PNG).
 * Working stamp uses exactly `skin × RESOLUTION_MULTIPLIER` per axis (matches 128→64 export grid).
 */
export function paintBrushWorkingDimensions(size: PaintBrushSize): { w: number; h: number } {
  const toW = (d: number): number => {
    const scaled = Math.round(Math.max(0, Number(d)) * RESOLUTION_MULTIPLIER);
    return Math.min(WORK_SIZE, Math.max(1, scaled));
  };
  return { w: toW(size.width), h: toW(size.height) };
}

/** Outer-ring brush opacity (center is 1). Higher softness → softer edge. */
function outerRingBrushAlpha(softness: number): number {
  const soft = Math.max(
    PAINT_BRUSH_TOOL_CONFIG.minSoftness,
    Math.min(PAINT_BRUSH_TOOL_CONFIG.maxSoftness, Math.floor(softness))
  );
  return Math.max(
    PAINT_BRUSH_TOOL_CONFIG.outerRingAlphaFloor,
    1 - PAINT_BRUSH_TOOL_CONFIG.outerRingAlphaStepPerSoftness * soft
  );
}

/** Working-pixel coordinates covered by one stamp (for hover backup). */
export function listPaintBrushStampPixels(
  sx: number,
  sy: number,
  size: PaintBrushSize,
  alignTopLeft: boolean
): { px: number; py: number }[] {
  const { w, h } = paintBrushWorkingDimensions(size);
  const offsetX = alignTopLeft ? 0 : Math.floor(w / 2);
  const offsetY = alignTopLeft ? 0 : Math.floor(h / 2);
  const startX = sx - offsetX;
  const startY = sy - offsetY;
  const out: { px: number; py: number }[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = startX + dx;
      const py = startY + dy;
      if (isPixelInSkinBounds(px, py)) out.push({ px, py });
    }
  }
  return out;
}

/**
 * Apply one soft-brush stamp centered on the stamp's bounding box.
 * `sx, sy` is the top-left of the stamp (working pixels). Even widths are allowed (fractional Chebyshev center).
 */
export function paintBrushStampAt(
  skinCtx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  size: PaintBrushSize,
  softness: number,
  baseColorHex: string,
  canPaintAt: CanPaintAt,
  stroke: StrokeRecord | null | undefined,
  alignTopLeft: boolean
): void {
  const { w, h } = paintBrushWorkingDimensions(size);
  const edgeAlpha = outerRingBrushAlpha(softness);

  const offsetX = alignTopLeft ? 0 : Math.floor(w / 2);
  const offsetY = alignTopLeft ? 0 : Math.floor(h / 2);
  const startX = sx - offsetX;
  const startY = sy - offsetY;

  const centerX = startX + (w - 1) / 2;
  const centerY = startY + (h - 1) / 2;
  const maxRing = Math.max((w - 1) / 2, (h - 1) / 2);
  /** Chebyshev rings in working space are 2× finer than visible skin pixels on the 3D model (nearest filter). Quantize so each falloff step spans a full 2×2 working block. */
  const maxRingSkin = Math.floor(maxRing / RESOLUTION_MULTIPLIER);

  const [Sr, Sg, Sb] = hexToRgb(baseColorHex);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = startX + dx;
      const py = startY + dy;
      if (!isPixelInSkinBounds(px, py) || !canPaintAt(px, py)) continue;

      const cheb = Math.max(Math.abs(px - centerX), Math.abs(py - centerY));
      const ringSkin = Math.floor(cheb / RESOLUTION_MULTIPLIER);
      const t = maxRingSkin > 0 ? Math.min(1, ringSkin / maxRingSkin) : 0;
      const a = 1 + (edgeAlpha - 1) * t;

      const d = skinCtx.getImageData(px, py, 1, 1).data;
      const Dr = d[0]!;
      const Dg = d[1]!;
      const Db = d[2]!;
      const Da = d[3]!;

      if (stroke) {
        const key = `${px},${py}`;
        if (!stroke.recorded.has(key)) {
          stroke.recorded.add(key);
          stroke.pixels.push({ x: px, y: py, r: Dr, g: Dg, b: Db, a: Da });
        }
      }

      const outR = Sr * a + Dr * (1 - a);
      const outG = Sg * a + Dg * (1 - a);
      const outB = Sb * a + Db * (1 - a);
      const outA = 255 * a + Da * (1 - a);

      putWorkingPixelRgba(skinCtx, px, py, outR, outG, outB, outA);
    }
  }
}
