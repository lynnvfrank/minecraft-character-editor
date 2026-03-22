/**
 * Easing functions for animations.
 */

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
