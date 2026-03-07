/**
 * Skin pre-processing: replace transparency with a solid color on primary
 * body parts (head, body, legs, arms). Overlay parts (hat, jacket, sleeves, pants)
 * keep their transparency.
 *
 * To disable: set SKIN_PREPROCESS_CONFIG.enabled = false
 * To remove from codebase: delete this file and the preprocessSkinTexture()
 * call in main.ts.
 */

import * as THREE from 'three';

export type SkinPreprocessConfig = {
  /** When false, returns the texture unchanged (preprocessing disabled) */
  enabled: boolean;
  /** Color for transparent pixels in primary regions. Hex number (e.g. 0x000000) or CSS color string */
  replacementColor: number | string;
  /** Alpha threshold below which a pixel is considered transparent (0–255) */
  alphaThreshold?: number;
};

export const SKIN_PREPROCESS_CONFIG: SkinPreprocessConfig = {
  enabled: true,
  replacementColor: 0x000000,
  alphaThreshold: 127,
};

/** Primary layer bounds (X, Y, W, H). Transparency is replaced with solid color. */
const PRIMARY_REGIONS: [number, number, number, number][] = [
  [0, 0, 32, 16],   // Head
  [16, 16, 16, 16], // Body
  [0, 16, 16, 16],  // Right Leg
  [16, 48, 16, 16], // Left Leg
  [40, 16, 16, 16], // Right Arm
  [32, 48, 16, 16], // Left Arm
];

function isInPrimaryRegion(x: number, y: number): boolean {
  return PRIMARY_REGIONS.some(([rx, ry, rw, rh]) =>
    x >= rx && x < rx + rw && y >= ry && y < ry + rh
  );
}

function parseColor(color: number | string): { r: number; g: number; b: number } {
  if (typeof color === 'number') {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    return { r, g, b };
  }
  const hex = color.replace(/^#/, '');
  if (hex.length === 6) {
    const n = parseInt(hex, 16);
    return {
      r: ((n >> 16) & 0xff) / 255,
      g: ((n >> 8) & 0xff) / 255,
      b: (n & 0xff) / 255,
    };
  }
  return { r: 0, g: 0, b: 1 };
}

/**
 * Preprocesses a skin texture: replaces transparent pixels with a solid color
 * in primary regions (head, body, legs, arms). Overlay regions keep transparency.
 * If config.enabled is false, returns the original texture unchanged.
 */
export function preprocessSkinTexture(
  texture: THREE.Texture,
  config: SkinPreprocessConfig = SKIN_PREPROCESS_CONFIG
): THREE.Texture {
  if (!config.enabled) return texture;

  const img = texture.image as HTMLImageElement | undefined;
  if (!img || !(img instanceof HTMLImageElement)) return texture;

  const w = img.naturalWidth || img.width || 64;
  const h = img.naturalHeight || img.height || 64;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return texture;

  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const { r: R, g: G, b: B } = parseColor(config.replacementColor);
  const threshold = config.alphaThreshold ?? 127;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isInPrimaryRegion(x, y)) continue;

      const i = (y * w + x) * 4;
      const a = data.data[i + 3];
      if (a < threshold) {
        data.data[i] = Math.round(R * 255);
        data.data[i + 1] = Math.round(G * 255);
        data.data[i + 2] = Math.round(B * 255);
        data.data[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(data, 0, 0);

  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = texture.colorSpace;
  return out;
}
