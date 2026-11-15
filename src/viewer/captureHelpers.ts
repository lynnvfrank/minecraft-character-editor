/**
 * Pure helpers for 3D thumbnail capture (no DOM, no WebGL), tested in captureHelpers.test.ts.
 */

/** Linear to sRGB conversion for display. Render targets output linear values. */
export function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Convert WebGL `readPixels` output (linear, bottom-up rows) to canvas ImageData order
 * (sRGB, top-down rows). Alpha is copied unchanged.
 */
export function renderTargetPixelsToImageData(pixels: Uint8Array, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    for (let x = 0; x < size; x++) {
      const src = srcRow + x * 4;
      const dst = dstRow + x * 4;
      out[dst] = Math.round(linearToSrgb(pixels[src]! / 255) * 255);
      out[dst + 1] = Math.round(linearToSrgb(pixels[src + 1]! / 255) * 255);
      out[dst + 2] = Math.round(linearToSrgb(pixels[src + 2]! / 255) * 255);
      out[dst + 3] = pixels[src + 3]!;
    }
  }
  return out;
}
