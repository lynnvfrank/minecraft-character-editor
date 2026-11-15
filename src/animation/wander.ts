/**
 * Pure math for character facing and the idle wanderer (no three.js scene, no timers).
 * Used by animation/manager.ts; tested in wander.test.ts.
 */
import type { TrapezoidBounds } from '../lib/trapezoidBounds';

export type XZ = { x: number; z: number };

/** Wrap an angle (radians) into [-π, π). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Lerp between angles along the shortest arc (avoids a 270° swing on large turns). */
export function lerpAngleRad(from: number, to: number, t: number): number {
  return wrapAngle(from + wrapAngle(to - from) * t);
}

/** Hermite smoothstep on [0, 1], clamped. */
export function smoothstep(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/** Yaw (radians) that faces from `from` toward `to` in the XZ plane (+Z is yaw 0). */
export function yawToward(from: XZ, to: XZ): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Small emotes for the idle wanderer: quick and non-disruptive. */
export const WANDER_EMOTES = [
  'acknowledging',
  'bashful',
  'blow-akiss',
  'bored',
  'shrugging',
  'yawn',
  'happy',
  'happy-idle',
] as const;

/** Relative waypoints: [depth in walk units, lateral fraction -1..1]. Converted to world via bounds. */
export const WAYPOINT_RELATIVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1.5, 0.4],
  [-1.5, -0.4],
  [-2.5, 0],
  [-0.5, 0.5],
  [-0.5, -0.5],
];

/** Convert a relative waypoint to a world XZ position, clamped to the trapezoid. */
export function waypointToWorld(
  rel: readonly [number, number],
  bounds: TrapezoidBounds,
  walkCycleDistance: number
): XZ {
  const [depthRel, lateralFrac] = rel;
  const depth = Math.min(Math.max(depthRel * walkCycleDistance, bounds.depthAway), bounds.depthToward);
  const lateral = lateralFrac * bounds.getHalfWidthAtDepth(depth);
  return {
    x: bounds.startX + depth * bounds.depthDirX + lateral * bounds.perpDirX,
    z: bounds.startZ + depth * bounds.depthDirZ + lateral * bounds.perpDirZ,
  };
}

/**
 * Pick the next wander target: the waypoint needing the smallest turn, preferring those within
 * 90° of the current facing. Waypoints at the current position are skipped.
 */
export function pickWanderWaypoint(waypoints: readonly XZ[], position: XZ, facing: number): XZ {
  const candidates = waypoints
    .filter((wp) => wp.x !== position.x || wp.z !== position.z)
    .map((wp) => ({ wp, turn: Math.abs(wrapAngle(yawToward(position, wp) - facing)) }));
  const within90 = candidates.filter(({ turn }) => turn <= Math.PI / 2);
  const pool = within90.length > 0 ? within90 : candidates;
  if (pool.length === 0) return waypoints[0] ?? { x: 0, z: 0 };
  return pool.reduce((best, c) => (c.turn < best.turn ? c : best)).wp;
}
