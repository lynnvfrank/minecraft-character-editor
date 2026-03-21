/**
 * Skin load/save and canvas image data capture.
 * Works with the working canvas (WORK_SIZE × WORK_SIZE); export downscales to 64×64.
 */

import { SKIN_SIZE, WORK_SIZE } from '../skin';

/** Capture current canvas image data for undo. */
export function captureCanvasImageData(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8ClampedArray(0);
  const imgData = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
  return new Uint8ClampedArray(imgData.data);
}

/** Restore canvas from RGBA data. */
export function putImageDataFromRGBA(data: Uint8ClampedArray, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imgData = ctx.createImageData(WORK_SIZE, WORK_SIZE);
  imgData.data.set(data);
  ctx.putImageData(imgData, 0, 0);
}

/** Load skin from URL, draw to canvas. Returns { beforeData, afterData } for undo. */
export async function loadSkinToCanvas(
  path: string,
  canvas: HTMLCanvasElement,
  capture: (c: HTMLCanvasElement) => Uint8ClampedArray
): Promise<{ beforeData: Uint8ClampedArray; afterData: Uint8ClampedArray } | null> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const beforeData = capture(canvas);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load skin: ${path}`));
      // Data URLs (e.g. saved skins) must be used as-is; relative paths get leading slash
      img.src = path.startsWith('data:') ? path : path.startsWith('/') ? path : `/${path}`.replace(/\/+/g, '/');
    });
  } catch {
    return null;
  }
  const sw = img.width;
  const sh = img.height;
  if (sw <= 0 || sh <= 0) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  if (sh < sw) {
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, WORK_SIZE, (WORK_SIZE * sh) / sw);
  } else {
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, WORK_SIZE, WORK_SIZE);
  }
  const afterData = capture(canvas);
  return { beforeData, afterData };
}

/** Export skin downscaled to 64×64 PNG data URL. Uses nearest-neighbor. */
export function exportTo64x64DataURL(canvas: HTMLCanvasElement): string {
  const out = document.createElement('canvas');
  out.width = SKIN_SIZE;
  out.height = SKIN_SIZE;
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, WORK_SIZE, WORK_SIZE, 0, 0, SKIN_SIZE, SKIN_SIZE);
  return out.toDataURL('image/png');
}
