/**
 * Defaults for the soft paint brush (Chebyshev rings + alpha falloff over existing skin).
 */

export type PaintBrushSize = { width: number; height: number };

/**
 * Bump when brush size semantics or defaults change. Creator resets `paintBrushSize` from
 * {@link PAINT_BRUSH_TOOL_CONFIG.defaultSize} once per browser (localStorage key `creator:paintBrushSchema`).
 */
export const PAINT_BRUSH_SCHEMA_VERSION = '2026-03-30-skinpx-v2';

export const PAINT_BRUSH_TOOL_CONFIG = {
  /** Width/height in skin pixels (64×64 layout); working stamp = this ×2 (exact, no odd bump). */
  defaultSize: { width: 8, height: 8 } as PaintBrushSize,
  defaultSoftness: 4,
  /** Minimum effective brush opacity at the outer Chebyshev ring (center is always 1). */
  outerRingAlphaFloor: 0.05,
  /**
   * Outer-ring opacity ≈ max(outerRingAlphaFloor, 1 − softness × step).
   * Higher softness → lower opacity at the edge (softer falloff toward the skin underneath).
   */
  outerRingAlphaStepPerSoftness: 0.19,
  minSoftness: 1,
  maxSoftness: 5,
} as const;
