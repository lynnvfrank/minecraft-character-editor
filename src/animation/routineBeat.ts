/**
 * "Snap to beat" for studio routines (pure; tested in routineBeat.test.ts). Saved routines always
 * store seconds; snapping only changes which lengths the panel offers and converts them from beats
 * at the current tempo. Bpm-to-seconds rules live in lib/beatClock.ts.
 */
import { rescaleSnapped, snapSeconds } from '../lib/beatClock';
import { MAX_STEP_SEC, MIN_STEP_SEC, type RoutineStep } from './studioRoutine';

/** Every step's length moved onto the beat grid (the same array when nothing changes). */
export function snapRoutine(steps: readonly RoutineStep[], bpm: number): readonly RoutineStep[] {
  let changed = false;
  const out = steps.map((s) => {
    const duration = snapSeconds(s.duration, bpm, MIN_STEP_SEC, MAX_STEP_SEC);
    if (duration === s.duration) return s;
    changed = true;
    return { ...s, duration };
  });
  return changed ? out : steps;
}

/** Snapped steps carried to a new tempo: each keeps its number of beats. */
export function rescaleRoutine(steps: readonly RoutineStep[], fromBpm: number, toBpm: number): readonly RoutineStep[] {
  if (fromBpm === toBpm) return steps;
  let changed = false;
  const out = steps.map((s) => {
    const duration = rescaleSnapped(s.duration, fromBpm, toBpm, MIN_STEP_SEC, MAX_STEP_SEC);
    if (duration === s.duration) return s;
    changed = true;
    return { ...s, duration };
  });
  return changed ? out : steps;
}
