/**
 * Capture helpers: linearToSrgb for display. Capture logic remains in main
 * (captureCreator3DThumbnail, captureCreator3DPartThumbnail) and registers via
 * capture3DThumbnail module to avoid circular deps with creator.
 */

/** Linear to sRGB conversion for display. Render targets output linear values. */
export function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return c * 12.92;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
