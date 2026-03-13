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
  body: [{ x: 16, y: 16, w: 24, h: 16 }],
  jacket: [{ x: 16, y: 32, w: 24, h: 16 }],
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

/**
 * Dead zones / non-skin zones from reference diagrams (minecraft-skin-layout-specification.md).
 * These areas contain meta-information (cropping instructions, legend, etc.), not skin texture.
 * Excluded from template overlay and hover info (reported as "not over skin").
 */
export const SKIN_DEAD_ZONES: Bounds[] = [
  { x: 0, y: 0, w: 8, h: 8 },    // top-left: cropping instructions
  { x: 24, y: 0, w: 16, h: 8 },   // top-middle: source/provenance
  { x: 56, y: 16, w: 8, h: 32 },  // right-side legend
];

/** True if (normX, normY) is inside any dead zone (norm coords 0–63). */
export function isInDeadZone(normX: number, normY: number): boolean {
  for (const z of SKIN_DEAD_ZONES) {
    if (normX >= z.x && normX < z.x + z.w && normY >= z.y && normY < z.y + z.h) return true;
  }
  return false;
}

/**
 * Specific part bounds for hover display (right/left legs, pants, arms, sleeves).
 * Per minecraft-skin-layout-specification.md Quick Reference.
 */
export const SKIN_PART_BOUNDS: { part: string; bounds: Bounds[] }[] = [
  { part: 'Head', bounds: [{ x: 0, y: 0, w: 32, h: 16 }] },
  { part: 'Hat', bounds: [{ x: 32, y: 0, w: 32, h: 16 }] },
  { part: 'Body', bounds: [{ x: 16, y: 16, w: 24, h: 16 }] },
  { part: 'Jacket', bounds: [{ x: 16, y: 32, w: 24, h: 16 }] },
  { part: 'Right leg', bounds: [{ x: 0, y: 16, w: 16, h: 16 }] },
  { part: 'Right pants', bounds: [{ x: 0, y: 32, w: 16, h: 16 }] },
  { part: 'Left leg', bounds: [{ x: 16, y: 48, w: 16, h: 16 }] },
  { part: 'Left pants', bounds: [{ x: 0, y: 48, w: 16, h: 16 }] },
  { part: 'Right arm', bounds: [{ x: 40, y: 16, w: 16, h: 16 }, { x: 56, y: 16, w: 8, h: 16 }] },
  { part: 'Right sleeve', bounds: [{ x: 40, y: 32, w: 16, h: 16 }, { x: 56, y: 32, w: 8, h: 16 }] },
  { part: 'Left arm', bounds: [{ x: 32, y: 48, w: 16, h: 16 }] },
  { part: 'Left sleeve', bounds: [{ x: 48, y: 48, w: 16, h: 16 }] },
];
