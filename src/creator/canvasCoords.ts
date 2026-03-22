/**
 * Canvas coordinate and layer lookup helpers.
 * Pure functions for mapping working coords to skin layers/parts.
 * Also provides getSkinCanvas (working canvas singleton) and captureCanvasImageData.
 */

import {
  SKIN_LAYER_BOUNDS,
  SKIN_PART_BOUNDS,
  isInDeadZone,
  isLayerWithParts,
  LAYER_KEYS,
  RESOLUTION_MULTIPLIER,
  WORK_SIZE,
  type Bounds,
} from '../skin';
import type { PartSide } from './api';

export function pointInBounds(x: number, y: number, b: Bounds): boolean {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

/** Return which layer (head, hat, body, etc.) contains the given working coords, or null. */
export function getLayerAtCoords(workingX: number, workingY: number): string | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    if (!bounds) continue;
    for (const b of bounds) {
      if (pointInBounds(normX, normY, b)) return layer;
    }
  }
  return null;
}

/** Return layer and part side (L/R) at coords. side is undefined for single-part layers. */
export function getLayerAndPartAtCoords(
  workingX: number,
  workingY: number
): { layer: string; side?: PartSide } | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    if (!bounds) continue;
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i]!;
      if (pointInBounds(normX, normY, b)) {
        const side: PartSide | undefined = isLayerWithParts(layer) ? (i === 0 ? 'R' : 'L') : undefined;
        return { layer, side };
      }
    }
  }
  return null;
}

/** Return the specific part display name (Right leg, Left pants, etc.) at coords, or null. */
export function getPartDisplayNameAtCoords(workingX: number, workingY: number): string | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  if (isInDeadZone(normX, normY)) return null;
  for (const { part, bounds } of SKIN_PART_BOUNDS) {
    for (const b of bounds) {
      if (pointInBounds(normX, normY, b)) return part;
    }
  }
  return null;
}

export function cloneImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

let skinCanvas: HTMLCanvasElement | null = null;

/** Returns the working canvas (WORK_SIZE × WORK_SIZE). Creates it on first call. */
export function getSkinCanvas(): HTMLCanvasElement {
  if (!skinCanvas) {
    skinCanvas = document.createElement('canvas');
    skinCanvas.width = WORK_SIZE;
    skinCanvas.height = WORK_SIZE;
    skinCanvas.getContext('2d', { willReadFrequently: true });
  }
  return skinCanvas;
}

/** Capture ImageData from canvas. Returns null if context unavailable. */
export function captureCanvasImageData(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
