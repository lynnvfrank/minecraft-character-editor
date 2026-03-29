/**
 * Shared skin canvas helpers for stamps: undo recording and pixel writes.
 * Stamps (pencil block, soft paint brush, future tools) call these to stay consistent.
 */

import { WORK_SIZE } from '../skin';
import type { PixelChange } from '../state/creatorState';

/** Whether painting is allowed at working-space coordinates (layer mask / 3D visibility). */
export type CanPaintAt = (workingX: number, workingY: number) => boolean;
export type GetCurrentColor = () => string;

export type StrokeRecord = {
  pixels: PixelChange[];
  isEraser: boolean;
  newColor: string;
  recorded: Set<string>;
};

/**
 * Record the current pixel into the stroke for undo, if not already recorded.
 */
export function recordStrokePixel(
  stroke: StrokeRecord,
  skinCtx: CanvasRenderingContext2D,
  px: number,
  py: number
): void {
  const key = `${px},${py}`;
  if (stroke.recorded.has(key)) return;
  stroke.recorded.add(key);
  const d = skinCtx.getImageData(px, py, 1, 1).data;
  stroke.pixels.push({ x: px, y: py, r: d[0], g: d[1], b: d[2], a: d[3] });
}

export function isPixelInSkinBounds(px: number, py: number): boolean {
  return px >= 0 && px < WORK_SIZE && py >= 0 && py < WORK_SIZE;
}

/** Fill a single working pixel with a CSS color string (opaque). */
export function fillPixel(skinCtx: CanvasRenderingContext2D, px: number, py: number, cssColor: string): void {
  skinCtx.fillStyle = cssColor;
  skinCtx.fillRect(px, py, 1, 1);
}

/** Write straight RGBA (0–255) to one working pixel. */
export function putWorkingPixelRgba(
  skinCtx: CanvasRenderingContext2D,
  px: number,
  py: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  const img = new ImageData(1, 1);
  img.data[0] = Math.round(Math.max(0, Math.min(255, r)));
  img.data[1] = Math.round(Math.max(0, Math.min(255, g)));
  img.data[2] = Math.round(Math.max(0, Math.min(255, b)));
  img.data[3] = Math.round(Math.max(0, Math.min(255, a)));
  skinCtx.putImageData(img, px, py);
}
