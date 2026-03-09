/**
 * Debug logging for model facing (rotation.y) snaps.
 * Enable with: ?debugFacing=1 in the URL
 *
 * Logs: time, source, prev→new yaw, delta, direction facing, state machine state, walk/turn phase.
 */

const DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(location.search).get('debugFacing') !== null;

/** Log when facing changes by more than this (radians). ~0.05 = 3°, ~0.15 = 8.5° */
const SNAP_THRESHOLD = 0.05;

let lastLogTime = 0;
const LOG_THROTTLE_MS = 50;

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

function formatTime(): string {
  const elapsedSec =
    typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  return `${elapsedSec.toFixed(2)}s`;
}

function buildLogLine(
  source: string,
  prevYaw: number,
  newYaw: number,
  delta: number
): string {
  const ctx = contextProvider?.() ?? {};
  const parts: string[] = [];

  parts.push(`[${formatTime()}]`);
  parts.push(`[Facing] ${source}`);
  parts.push(`| ${radToDeg(prevYaw).toFixed(1)}° → ${radToDeg(newYaw).toFixed(1)}° (Δ ${radToDeg(delta).toFixed(1)}°)`);
  parts.push(`| dir ${yawToDirection(prevYaw)} → ${yawToDirection(newYaw)}`);

  if (ctx.state != null) parts.push(`| state=${ctx.state}`);
  if (ctx.isWalking) parts.push(`| walking`);
  if (ctx.isInWalkToPhase) parts.push(`| inWalkTo`);
  if (ctx.isBusy) parts.push(`| busy`);

  return parts.join(' ');
}

/**
 * Call when setting model.rotation.y. Logs if the change exceeds SNAP_THRESHOLD
 * and we haven't logged recently (throttle).
 */
export function logFacingChange(
  source: string,
  prevYaw: number,
  newYaw: number
): void {
  if (!DEBUG) return;

  const now = Date.now();
  if (now - lastLogTime < LOG_THROTTLE_MS) return;

  const delta = angleDiff(newYaw, prevYaw);
  if (Math.abs(delta) < SNAP_THRESHOLD) return;

  lastLogTime = now;
  console.log(buildLogLine(source, prevYaw, newYaw, delta));
}
