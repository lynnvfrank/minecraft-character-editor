/**
 * Small pure helpers for the crowd's social life (greetings and plaza gatherings); the state
 * machine itself is in crowd.ts.
 */
import type { XZ } from './wander';

/** Order-independent key for a pair of agents (per-pair greeting cooldown). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * `count` spots evenly spaced on a circle around `center`, starting at angle `phase` (radians).
 * The circle grows past `radius` if needed so neighbours stay at least `minGap` apart.
 */
export function ringSpots(center: XZ, count: number, radius: number, phase = 0, minGap = 0): XZ[] {
  if (count <= 0) return [];
  const fit = count > 1 ? minGap / (2 * Math.sin(Math.PI / count)) : 0;
  const r = Math.max(radius, fit);
  const out: XZ[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    out.push({ x: center.x + Math.sin(a) * r, z: center.z + Math.cos(a) * r });
  }
  return out;
}

/**
 * Give each walker a different spot, nearest first come first served. Returns one spot index per
 * walker (same order), or -1 when the spots ran out.
 */
export function assignSpots(walkers: readonly XZ[], spots: readonly XZ[]): number[] {
  const free = new Set(spots.map((_, i) => i));
  return walkers.map((w) => {
    let best = -1;
    let bestDist = Infinity;
    for (const i of free) {
      const d = Math.hypot(spots[i]!.x - w.x, spots[i]!.z - w.z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) free.delete(best);
    return best;
  });
}

/** Take `count` random items (fewer if the list is shorter); `random` returns [0, 1). */
export function pickSome<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]!);
  }
  return out;
}
