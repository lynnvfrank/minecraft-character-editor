/**
 * Minecraft 64×64 skin layout pixel bounds.
 * Origin (0,0) is top-left. Per minecraft-skin-layout-specification.md
 */

export type Bounds = { x: number; y: number; w: number; h: number };

/**
 * Pixel bounds for each layer. Face positions in the spec extend beyond the high-level
 * "Bounds" — e.g. BACK BODY at X:32, BACK JACKET at X:32, and the right strip X:56-64.
 */
export const SKIN_LAYER_BOUNDS: Record<string, Bounds[]> = {
  head: [{ x: 0, y: 0, w: 32, h: 16 }],
  hat: [{ x: 32, y: 0, w: 32, h: 16 }],
  body: [
    { x: 16, y: 16, w: 16, h: 16 },
    { x: 32, y: 16, w: 8, h: 16 }, // BACK BODY
  ],
  jacket: [
    { x: 16, y: 32, w: 16, h: 16 },
    { x: 32, y: 32, w: 8, h: 16 }, // BACK JACKET
  ],
  arms: [
    { x: 40, y: 16, w: 16, h: 16 },
    { x: 32, y: 48, w: 16, h: 16 },
    { x: 56, y: 16, w: 8, h: 16 }, // right strip (gap in spec bounds)
  ],
  sleeves: [
    { x: 40, y: 32, w: 16, h: 16 },
    { x: 48, y: 48, w: 16, h: 16 },
    { x: 56, y: 32, w: 8, h: 16 }, // right strip
  ],
  legs: [
    { x: 0, y: 16, w: 16, h: 16 },
    { x: 16, y: 48, w: 16, h: 16 },
  ],
  pants: [
    { x: 0, y: 32, w: 16, h: 16 },
    { x: 0, y: 48, w: 16, h: 16 },
  ],
};

export const SKIN_SIZE = 64;
