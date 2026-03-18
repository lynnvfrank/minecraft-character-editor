/**
 * Trapezoidal movement bounds derived from the camera view frustum.
 * Keeps the character mostly in front of the camera.
 *
 * - Toward camera: 0.5 × walk cycle distance from start
 * - Away from camera: 4 × walk cycle distance from start
 * - Left/right: frustum width at each depth (trapezoid)
 */
import * as THREE from 'three';

/** Distance covered in one full walk cycle at speed 1 (tunable) */
export const WALK_CYCLE_DISTANCE = 0.8;

/** Toward camera: half a walk from start */
const TOWARD_CAMERA_FACTOR = 0.5;
/** Away from camera: 4 walks from start */
const AWAY_FROM_CAMERA_FACTOR = 4;

export type TrapezoidBounds = {
  /** Start position (origin) in XZ */
  startX: number;
  startZ: number;
  /** Depth axis: from start toward camera (unit vector in XZ) */
  depthDirX: number;
  depthDirZ: number;
  /** Perpendicular axis (unit vector in XZ) */
  perpDirX: number;
  perpDirZ: number;
  /** Depth limits: positive = toward camera */
  depthToward: number;
  depthAway: number;
  /** Camera ref for computing width at depth */
  getHalfWidthAtDepth: (depth: number) => number;
};

/**
 * Compute trapezoid bounds from camera. The trapezoid is camera-aligned:
 * narrow near the camera, wider farther away (matches view frustum).
 */
export function getTrapezoidBounds(
  camera: THREE.PerspectiveCamera,
  startX: number,
  startZ: number,
  walkDistance: number = WALK_CYCLE_DISTANCE
): TrapezoidBounds {
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);

  const dx = camPos.x - startX;
  const dz = camPos.z - startZ;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const depthDirX = dx / len;
  const depthDirZ = dz / len;

  const perpDirX = -depthDirZ;
  const perpDirZ = depthDirX;

  const depthToward = TOWARD_CAMERA_FACTOR * walkDistance;
  const depthAway = -AWAY_FROM_CAMERA_FACTOR * walkDistance;

  const vFov = (camera.fov * Math.PI) / 180;
  const aspect = camera.aspect;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const tanHalfH = Math.tan(hFov / 2);

  function getHalfWidthAtDepth(depth: number): number {
    const ptX = startX + depth * depthDirX;
    const ptZ = startZ + depth * depthDirZ;
    const dist = Math.sqrt(
      (camPos.x - ptX) ** 2 + (camPos.z - ptZ) ** 2
    );
    return Math.max(0.1, dist * tanHalfH);
  }

  return {
    startX,
    startZ,
    depthDirX,
    depthDirZ,
    perpDirX,
    perpDirZ,
    depthToward,
    depthAway,
    getHalfWidthAtDepth
  };
}

/**
 * Clamp a position (x, z) to the trapezoid bounds.
 * Modifies the vector in place and returns it.
 */
export function clampToTrapezoid(
  pos: THREE.Vector3,
  bounds: TrapezoidBounds
): THREE.Vector3 {
  const px = pos.x - bounds.startX;
  const pz = pos.z - bounds.startZ;

  const depth = px * bounds.depthDirX + pz * bounds.depthDirZ;
  const lateral = px * bounds.perpDirX + pz * bounds.perpDirZ;

  const depthClamped = THREE.MathUtils.clamp(depth, bounds.depthAway, bounds.depthToward);
  const halfWidth = bounds.getHalfWidthAtDepth(depthClamped);
  const lateralClamped = THREE.MathUtils.clamp(lateral, -halfWidth, halfWidth);

  pos.x = bounds.startX + depthClamped * bounds.depthDirX + lateralClamped * bounds.perpDirX;
  pos.z = bounds.startZ + depthClamped * bounds.depthDirZ + lateralClamped * bounds.perpDirZ;
  pos.y = 0;

  return pos;
}
