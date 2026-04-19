/**
 * Creator 2D/3D layer padlock: panel controls + blocked paint on locked regions.
 * Set to `true` to restore lock UI and enforcement.
 */
export const CREATOR_LAYER_LOCK_ENABLED = false;

export function isLayerLockedForPaint(
  layer: string,
  layer3DLocked: Readonly<Record<string, boolean>>
): boolean {
  if (!CREATOR_LAYER_LOCK_ENABLED) return false;
  return layer3DLocked[layer] === true;
}
