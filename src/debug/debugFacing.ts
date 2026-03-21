/**
 * Debug logging for model facing (rotation.y) snaps.
 * Enable with: ?log=position:debug or ?log=position:trace
 *
 * Logs: source, prevYaw→newYaw, delta, direction facing, state machine state, walk/turn phase.
 * Uses the shared logger (see docs/LOGGING-ARCHITECTURE.md).
 */
import { logger } from '../lib/logger';

/** Log when facing changes by more than this (radians). ~0.05 = 3°, ~0.15 = 8.5° */
const SNAP_THRESHOLD = 0.05;

export type FacingLogContext = {
  state?: string;
  isWalking?: boolean;
  isInWalkToPhase?: boolean;
  isBusy?: boolean;
};

let contextProvider: (() => FacingLogContext) | null = null;

export function setFacingLogContextProvider(fn: () => FacingLogContext): void {
  contextProvider = fn;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalize angle diff to [-PI, PI] */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Yaw (radians) → forward direction in XZ. yaw=0 → +Z, yaw=π/2 → -X. */
function yawToDirection(yaw: number): string {
  const deg = radToDeg(yaw);
  if (deg >= -22.5 && deg < 22.5) return '+Z';
  if (deg >= 22.5 && deg < 67.5) return '-X+Z';
  if (deg >= 67.5 && deg < 112.5) return '-X';
  if (deg >= 112.5 && deg < 157.5) return '-X-Z';
  if (deg >= 157.5 || deg < -157.5) return '-Z';
  if (deg >= -157.5 && deg < -112.5) return '+X-Z';
  if (deg >= -112.5 && deg < -67.5) return '+X';
  return '+X+Z';
}

/**
 * Call when setting model.rotation.y. Logs if the change exceeds SNAP_THRESHOLD
 * and position:debug (or trace) is enabled. Uses shared logger + throttle.
 */
export function logFacingChange(
  source: string,
  prevYaw: number,
  newYaw: number
): void {
  if (!logger.isEnabled('position', 'debug')) return;

  const delta = angleDiff(newYaw, prevYaw);
  if (Math.abs(delta) < SNAP_THRESHOLD) return;

  const ctx = contextProvider?.() ?? {};
  const data: Record<string, unknown> = {
    source,
    prevYawDeg: radToDeg(prevYaw).toFixed(1),
    newYawDeg: radToDeg(newYaw).toFixed(1),
    deltaDeg: radToDeg(delta).toFixed(1),
    dirPrev: yawToDirection(prevYaw),
    dirNew: yawToDirection(newYaw)
  };
  if (ctx.state != null) data.state = ctx.state;
  if (ctx.isWalking) data.walking = true;
  if (ctx.isInWalkToPhase) data.inWalkTo = true;
  if (ctx.isBusy) data.busy = true;

  logger.debug('position', 'facing', data);
}
