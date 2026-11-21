/**
 * Dance studio camera moves (pure): the turntable orbit and the framing presets.
 * controllers/studioStageController.ts applies them to the camera.
 *
 * An orbit is described around a center point: `angle` is the heading from the center to the camera
 * (radians, 0 = +Z, like a character's facing), `radius` the horizontal distance and `height` how
 * far the camera is above the center.
 */
export type Point3 = { x: number; y: number; z: number };
export type OrbitPose = { angle: number; radius: number; height: number };

/** Where the camera is for an orbit pose around `center`. */
export function orbitPosition(center: Point3, angle: number, radius: number, height: number): Point3 {
  return { x: center.x + Math.sin(angle) * radius, y: center.y + height, z: center.z + Math.cos(angle) * radius };
}

/** The orbit pose of a camera at `center + (dx, dy, dz)` (inverse of orbitPosition). */
export function orbitFromOffset(dx: number, dy: number, dz: number): OrbitPose {
  return { angle: Math.atan2(dx, dz), radius: Math.hypot(dx, dz), height: dy };
}

export type TurntableSpeedId = 'slow' | 'medium' | 'fast';

/** Seconds for one full turn. */
export const TURNTABLE_SPEEDS: Record<TurntableSpeedId, { label: string; secondsPerTurn: number }> = {
  slow: { label: 'Slow', secondsPerTurn: 40 },
  medium: { label: 'Medium', secondsPerTurn: 20 },
  fast: { label: 'Fast', secondsPerTurn: 10 },
};
export const TURNTABLE_SPEED_ORDER: readonly TurntableSpeedId[] = ['slow', 'medium', 'fast'];
export const DEFAULT_TURNTABLE_SPEED: TurntableSpeedId = 'medium';

/** Wrap an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  const a = ((angle % turn) + turn) % turn;
  return a > Math.PI ? a - turn : a;
}

/** The orbit angle after `delta` seconds at a speed, kept in (-π, π]. */
export function stepTurntable(angle: number, speed: TurntableSpeedId, delta: number): number {
  if (delta === 0) return angle;
  return wrapAngle(angle + ((Math.PI * 2) / TURNTABLE_SPEEDS[speed].secondsPerTurn) * delta);
}

/** From `a` toward `b` the short way round; t in [0, 1]. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

export function lerpOrbit(a: OrbitPose, b: OrbitPose, t: number): OrbitPose {
  return {
    angle: lerpAngle(a.angle, b.angle, t),
    radius: a.radius + (b.radius - a.radius) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

/** Smooth start and stop for a camera move; t in [0, 1] (clamped). */
export function easeInOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

export type CameraFramingId = 'fullBody' | 'closeUp' | 'wide';

export type CameraFraming = {
  label: string;
  title: string;
  /** Horizontal distance from the character. */
  distance: number;
  /** Camera and look-at heights above the character's feet. */
  cameraHeight: number;
  targetHeight: number;
  /** Radians off the character's facing (0 = straight in front). */
  side: number;
};

export const CAMERA_FRAMINGS: Record<CameraFramingId, CameraFraming> = {
  // Same shot the studio opens with.
  fullBody: { label: 'Full body', title: 'Head to toe', distance: 5.2, cameraHeight: 1.8, targetHeight: 1, side: 0.45 },
  closeUp: { label: 'Close-up', title: 'Face and shoulders', distance: 2.3, cameraHeight: 1.75, targetHeight: 1.55, side: 0.3 },
  wide: { label: 'Wide', title: 'The whole stage', distance: 9, cameraHeight: 2.8, targetHeight: 1, side: 0.45 },
};
export const CAMERA_FRAMING_ORDER: readonly CameraFramingId[] = ['fullBody', 'closeUp', 'wide'];

/** A framing placed at a character: where to look and the orbit pose around that point. */
export function framingPose(framing: CameraFraming, anchor: Point3 & { yaw: number }): { target: Point3; orbit: OrbitPose } {
  return {
    target: { x: anchor.x, y: anchor.y + framing.targetHeight, z: anchor.z },
    orbit: {
      angle: wrapAngle(anchor.yaw + framing.side),
      radius: framing.distance,
      height: framing.cameraHeight - framing.targetHeight,
    },
  };
}

/**
 * The dancers as one group (see `groupShot` in domain/groupDance.ts, described here by shape): the
 * XZ shift from the lead to the group's middle and how much further back the camera has to stand.
 */
export type GroupShift = { dx: number; dz: number; extraDistance: number };

/**
 * A framing placed for the whole group: aimed at the group's middle and pulled back to fit
 * everyone. With no group (null) it is the plain framing at the lead.
 */
export function groupFramingPose(
  framing: CameraFraming,
  anchor: Point3 & { yaw: number },
  group: GroupShift | null
): { target: Point3; orbit: OrbitPose } {
  if (!group) return framingPose(framing, anchor);
  return framingPose(
    { ...framing, distance: framing.distance + Math.max(0, group.extraDistance) },
    { ...anchor, x: anchor.x + group.dx, z: anchor.z + group.dz }
  );
}

/** Framings that show everyone on stage; the others stay on the lead. */
export const GROUP_FRAMINGS: readonly CameraFramingId[] = ['fullBody', 'wide'];

/**
 * Move `current` toward `goal`, closing the gap smoothly whatever the frame rate (`rate` per
 * second; about 95% of the way after 3 / rate seconds). Never overshoots.
 */
export function approach(current: number, goal: number, rate: number, delta: number): number {
  if (!(delta > 0) || !(rate > 0)) return current;
  return current + (goal - current) * (1 - Math.exp(-rate * delta));
}
