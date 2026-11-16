import type { LayerKey } from '../skin';

export type PreviewPresetKey =
  | 'fullOutfit'
  | 'hat'
  | 'head'
  | 'jacket'
  | 'body'
  | 'arms'
  | 'sleeves'
  | 'pants'
  | 'legs'
  | 'torso'
  | 'jacketGroup'
  | 'bottom'
  | 'center'
  | 'top'
  | 'all';

export type PreviewVector = {
  x: number;
  y: number;
  z: number;
};

export type PreviewViewport = {
  width: number;
  height: number;
};

export type PreviewPreset = {
  visibleLayers: readonly LayerKey[];
  cameraPosition: PreviewVector;
  cameraTarget: PreviewVector;
  fov?: number;
  viewport: PreviewViewport;
};

/** Where a character stands and which way it faces (yaw in radians, 0 = facing +Z). */
export type CharacterAnchor = { x: number; y: number; z: number; yaw: number };

/**
 * Presets are authored for a character at the origin facing +Z. Rotate the camera position and
 * target by the character's yaw about Y and move them to where it stands, so the camera sees the
 * same view of it (its face, not its back) wherever it is in the world.
 */
export function placeAroundCharacter(
  v: PreviewVector,
  anchor: CharacterAnchor
): PreviewVector {
  const c = Math.cos(anchor.yaw);
  const s = Math.sin(anchor.yaw);
  // Same rotation as THREE.Vector3.applyAxisAngle((0, 1, 0), yaw).
  return {
    x: anchor.x + v.x * c + v.z * s,
    y: anchor.y + v.y,
    z: anchor.z - v.x * s + v.z * c,
  };
}
