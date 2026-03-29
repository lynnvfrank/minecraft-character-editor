/**
 * Skin coordinate spaces and conversion helpers.
 * See docs/CREATOR-DATA-MODEL-ANALYSIS.md — Coordinate Spaces Reference.
 */

/** Norm/skin coordinate size (64×64). */
export const SKIN_SIZE = 64;

/** Working canvas size (128×128). Creator paints at this resolution. */
export const RESOLUTION_MULTIPLIER = 2;
export const WORK_SIZE = SKIN_SIZE * RESOLUTION_MULTIPLIER;

/** Skin coords 0–63. */
export type SkinCoord = { x: number; y: number };

/** Working coords 0–127. */
export type WorkingCoord = { x: number; y: number };

/** Working → skin (divide by RESOLUTION_MULTIPLIER, floor). */
export function workingToSkin(wx: number, wy: number): SkinCoord {
  return {
    x: Math.floor(wx / RESOLUTION_MULTIPLIER),
    y: Math.floor(wy / RESOLUTION_MULTIPLIER)
  };
}

/** Skin → working (multiply by RESOLUTION_MULTIPLIER). */
export function skinToWorking(sx: number, sy: number): WorkingCoord {
  return {
    x: sx * RESOLUTION_MULTIPLIER,
    y: sy * RESOLUTION_MULTIPLIER
  };
}

/**
 * Snap arbitrary working coords to the center of a skin pixel’s 2×2 working block (RM=2).
 * Keeps the soft brush aligned with the 64×64 export grid (no “half-pixel” placement).
 */
export function snapWorkingToSkinCellCenter(wx: number, wy: number): WorkingCoord {
  const sx = Math.floor(wx / RESOLUTION_MULTIPLIER);
  const sy = Math.floor(wy / RESOLUTION_MULTIPLIER);
  const ox = Math.floor(RESOLUTION_MULTIPLIER / 2);
  return {
    x: Math.max(0, Math.min(WORK_SIZE - 1, sx * RESOLUTION_MULTIPLIER + ox)),
    y: Math.max(0, Math.min(WORK_SIZE - 1, sy * RESOLUTION_MULTIPLIER + ox)),
  };
}

/** UV (0–1) → working coords. Texture uses flipY so v is inverted. */
export function uvToWorkingCoords(u: number, v: number): WorkingCoord {
  const x = Math.floor(u * WORK_SIZE);
  const y = Math.floor((1 - v) * WORK_SIZE);
  return {
    x: Math.max(0, Math.min(WORK_SIZE - 1, x)),
    y: Math.max(0, Math.min(WORK_SIZE - 1, y))
  };
}
