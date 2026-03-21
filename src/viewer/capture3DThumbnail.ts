/**
 * Registry for 3D thumbnail capture. Main.ts registers the implementation
 * to avoid circular dependency with creator.
 */

import type { PreviewPresetKey } from '../domain';

export type Capture3DThumbnailFn = (size?: number) => Promise<string | null>;

export type Capture3DPartThumbnailFn = (part: PreviewPresetKey, size?: number) => Promise<string | null>;

let captureFn: Capture3DThumbnailFn | null = null;
let capturePartFn: Capture3DPartThumbnailFn | null = null;

export function registerCapture3DThumbnail(fn: Capture3DThumbnailFn): void {
  captureFn = fn;
}

export function getCapture3DThumbnail(): Capture3DThumbnailFn | null {
  return captureFn;
}

export function registerCapture3DPartThumbnail(fn: Capture3DPartThumbnailFn): void {
  capturePartFn = fn;
}

export function getCapture3DPartThumbnail(): Capture3DPartThumbnailFn | null {
  return capturePartFn;
}
