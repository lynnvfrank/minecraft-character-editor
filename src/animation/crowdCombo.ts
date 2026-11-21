/**
 * Saved combos on crowd characters (pure; no three.js).
 *
 * The primary plays a saved combo through the animation manager's sequence player (timers and
 * promises, one character). The crowd instead asks, every frame, "which clip weights apply at
 * time t?" and sets them on the character's mixer (controllers/crowdComboPlayer.ts), so several
 * residents can dance the same combo in step and it loops for as long as the gathering lasts.
 */
import type { SavedSequenceStep } from '../domain/sequences';
import { ROUTINE_FADE_SEC, routineWeightsAt, totalDuration, type RoutineStep } from './studioRoutine';
import type { ResolvedLayer } from './studioMix';

/** Step lengths the sequence player falls back to when a step has none. */
const DEFAULT_BLEND_SEC = 2;
const DEFAULT_PAUSE_SEC = 0.5;

/**
 * A saved combo as fixed-length routine steps. Clips the character doesn't have are dropped
 * (a blend left with no clips becomes a pause of the same length). Returns [] when nothing in
 * the combo can be played, so the caller can fall back to a plain dance clip.
 */
export function comboToRoutine(steps: readonly SavedSequenceStep[], hasClip: (name: string) => boolean): RoutineStep[] {
  const out: RoutineStep[] = [];
  let playable = false;
  for (const step of steps) {
    if (step.type === 'pause') {
      const duration = step.min != null && step.max != null ? (step.min + step.max) / 2 : (step.duration ?? DEFAULT_PAUSE_SEC);
      if (duration > 0) out.push({ type: 'pause', duration });
      continue;
    }
    const duration = step.duration ?? DEFAULT_BLEND_SEC;
    if (!(duration > 0)) continue;
    const layers =
      step.type === 'blend'
        ? step.layers.filter((l) => l.weight > 0 && hasClip(l.name)).map((l) => ({ ...l }))
        : hasClip(step.name)
          ? [{ name: step.name, weight: 1 }]
          : [];
    if (layers.length === 0) {
      out.push({ type: 'pause', duration });
      continue;
    }
    playable = true;
    out.push({ type: 'blend', layers, duration });
  }
  return playable ? out : [];
}

/**
 * Clip weights `t` seconds after the combo started, looping forever. The first `fadeSec` ease in
 * from `rest` (what the character was doing, normally idle); every later step, including the
 * first one of each new loop, crossfades from the step before it.
 */
export function comboWeightsAt(
  routine: readonly RoutineStep[],
  t: number,
  rest: Map<string, ResolvedLayer> = new Map(),
  fadeSec: number = ROUTINE_FADE_SEC
): Map<string, ResolvedLayer> {
  const total = totalDuration(routine);
  if (!(total > 0) || !Number.isFinite(t) || t < 0) return new Map(rest);
  // Two copies back to back: the second one's first step fades in from the first one's last.
  const doubled = [...routine, ...routine];
  const weights = routineWeightsAt(doubled, t < total ? t : total + (t % total), rest, fadeSec);
  if (t >= fadeSec || fadeSec <= 0) return weights;
  const k = t / fadeSec;
  const out = new Map<string, ResolvedLayer>();
  for (const key of new Set([...rest.keys(), ...weights.keys()])) {
    const a = rest.get(key);
    const b = weights.get(key);
    const weight = (a?.weight ?? 0) * (1 - k) + (b?.weight ?? 0) * k;
    if (weight > 0) out.set(key, { weight, timeScale: (b ?? a)!.timeScale });
  }
  return out;
}
