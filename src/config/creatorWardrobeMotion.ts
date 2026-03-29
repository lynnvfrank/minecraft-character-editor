/**
 * Creator.Wardrobe motion tuning (camera + right-rail library panels).
 * Adjust these for responsiveness vs. calm; keep panel JS timing aligned with CSS when noted below.
 */

import * as THREE from 'three';

/** World-units/sec scale for camera travel → tween length (clamped by min/max). Higher = faster camera. */
export const CREATOR_WARDROBE_CAMERA_TRAVEL_SPEED = 1.8;

export const CREATOR_WARDROBE_CAMERA_DURATION_MIN_MS = 420;
export const CREATOR_WARDROBE_CAMERA_DURATION_MAX_MS = 1440;

/** Hover intent threshold for non-selected layer-tree rows before camera focus changes. */
export const CREATOR_WARDROBE_HOVER_CAMERA_DEBOUNCE_MS = 300;

/**
 * Library panel slide duration used by wardrobe hide/show timeouts.
 * Keep in sync with `$creator-mode-panel-enter-duration` in `src/styles/creator/_animations.scss` (e.g. 360 ↔ 0.36s).
 */
export const CREATOR_WARDROBE_LIBRARY_PANEL_TRANSITION_MS = 360;

/**
 * When restoring after layer-tree hover (focused mode), start showing library panels this many ms
 * *before* the estimated camera tween end so panel motion and camera can finish together.
 * Typical starting point: near `CREATOR_WARDROBE_LIBRARY_PANEL_TRANSITION_MS`.
 */
export const CREATOR_WARDROBE_DEFERRED_PANEL_REVEAL_BEFORE_CAMERA_END_MS = 340;

/** Same formula as `animateCameraToCreatorView` (estimate only; actual tween uses identical clamp). */
export function estimateCreatorWardrobeCameraTweenDurationMs(
  startPosition: THREE.Vector3,
  endPosition: THREE.Vector3
): number {
  const distance = startPosition.distanceTo(endPosition);
  return THREE.MathUtils.clamp(
    (distance / CREATOR_WARDROBE_CAMERA_TRAVEL_SPEED) * 1000,
    CREATOR_WARDROBE_CAMERA_DURATION_MIN_MS,
    CREATOR_WARDROBE_CAMERA_DURATION_MAX_MS
  );
}
