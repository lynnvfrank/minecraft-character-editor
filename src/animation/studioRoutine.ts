/**
 * Dance studio routine math (pure; no Three.js, no DOM).
 *
 * A routine is an ordered list of steps: blends (a snapshot of the studio mix, held for a while)
 * and pauses. Saved as-is it is a `SavedSequence` the Move panel can play. The studio previews it
 * by asking `routineWeightsAt` which clip weights apply at time t, with a short crossfade from
 * each step into the next.
 *
 * Every edit returns a new array; an out-of-range index returns the same array untouched.
 */
import type { BlendLayerSpec, BlendStep, SavedSequenceStep } from '../domain/sequences';
import {
  clamp,
  createEmptyMix,
  MAX_TIME_SCALE,
  MIN_TIME_SCALE,
  WEIGHT_EPSILON,
  type ResolvedLayer,
  type StudioMix,
} from './studioMix';

export type RoutineBlendStep = BlendStep & { duration: number };
export type RoutinePauseStep = { type: 'pause'; duration: number };
/** Always has a fixed duration, so a routine's length is known up front. */
export type RoutineStep = RoutineBlendStep | RoutinePauseStep;

export const MIN_STEP_SEC = 0.25;
export const MAX_STEP_SEC = 20;
export const DEFAULT_STEP_SEC = 2;
export const DEFAULT_PAUSE_SEC = 0.5;
/** Crossfade from one step into the next (matches the blend fade in animation/manager.ts). */
export const ROUTINE_FADE_SEC = 0.3;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Clamp a step length to the allowed range; junk (NaN, empty input) becomes the default. */
export function clampStepDuration(sec: number, fallback: number = DEFAULT_STEP_SEC): number {
  if (!Number.isFinite(sec)) return fallback;
  return round3(clamp(sec, MIN_STEP_SEC, MAX_STEP_SEC));
}

const inRange = (steps: readonly RoutineStep[], i: number) => Number.isInteger(i) && i >= 0 && i < steps.length;

/** Append a blend (e.g. from `mixToBlendStep`) with its own length. */
export function addStep(steps: readonly RoutineStep[], blend: BlendStep, durationSec: number): RoutineStep[] {
  return [...steps, { type: 'blend', layers: blend.layers, duration: clampStepDuration(durationSec) }];
}

export function addPause(steps: readonly RoutineStep[], durationSec: number = DEFAULT_PAUSE_SEC): RoutineStep[] {
  return [...steps, { type: 'pause', duration: clampStepDuration(durationSec, DEFAULT_PAUSE_SEC) }];
}

/** Move a step up (-1) or down (+1). */
export function moveStep(steps: readonly RoutineStep[], index: number, dir: -1 | 1): readonly RoutineStep[] {
  const to = index + dir;
  if (!inRange(steps, index) || !inRange(steps, to)) return steps;
  const next = [...steps];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export function removeStep(steps: readonly RoutineStep[], index: number): readonly RoutineStep[] {
  if (!inRange(steps, index)) return steps;
  return steps.filter((_, i) => i !== index);
}

/** Replace a step's clips with a new blend; the step keeps its length (and becomes a blend). */
export function updateStep(steps: readonly RoutineStep[], index: number, blend: BlendStep): readonly RoutineStep[] {
  if (!inRange(steps, index)) return steps;
  return steps.map((s, i) => (i === index ? { type: 'blend', layers: blend.layers, duration: s.duration } : s));
}

export function setStepDuration(steps: readonly RoutineStep[], index: number, durationSec: number): readonly RoutineStep[] {
  if (!inRange(steps, index)) return steps;
  return steps.map((s, i) => (i === index ? { ...s, duration: clampStepDuration(durationSec, s.duration) } : s));
}

/** Where the selected step ends up after `moveStep(steps, index, dir)` on a list of `length`. */
export function selectionAfterMove(selected: number | null, index: number, dir: -1 | 1, length: number): number | null {
  const to = index + dir;
  if (selected == null || index < 0 || to < 0 || index >= length || to >= length) return selected;
  if (selected === index) return to;
  if (selected === to) return index;
  return selected;
}

/** Where the selected step ends up after `removeStep(steps, index)` (null if it was the one removed). */
export function selectionAfterRemove(selected: number | null, index: number): number | null {
  if (selected == null || selected === index) return null;
  return selected > index ? selected - 1 : selected;
}

export function totalDuration(steps: readonly RoutineStep[]): number {
  return round3(steps.reduce((sum, s) => sum + s.duration, 0));
}

export const hasBlend = (steps: readonly RoutineStep[]): boolean => steps.some((s) => s.type === 'blend');

/**
 * Which step is playing at time t (seconds from the start), and how far into it.
 * A boundary belongs to the step that starts there. Null before 0, at/after the end, or when empty.
 */
export function stepAtTime(
  steps: readonly RoutineStep[],
  t: number
): { index: number; localTime: number } | null {
  if (!Number.isFinite(t) || t < 0) return null;
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    const end = start + steps[i]!.duration;
    if (t < end) return { index: i, localTime: t - start };
    start = end;
  }
  return null;
}

function blendWeights(layers: readonly BlendLayerSpec[]): Map<string, ResolvedLayer> {
  const out = new Map<string, ResolvedLayer>();
  for (const l of layers) {
    if (!(l.weight > WEIGHT_EPSILON)) continue;
    const prev = out.get(l.name);
    out.set(l.name, {
      weight: (prev?.weight ?? 0) + l.weight,
      timeScale: clamp(l.timeScale ?? 1, MIN_TIME_SCALE, MAX_TIME_SCALE),
    });
  }
  return out;
}

/**
 * Weights on screen while step `index` holds. A pause keeps the blend before it (as the sequence
 * player does); a pause with no blend before it shows `rest` (normally the idle clip).
 */
function heldWeights(
  steps: readonly RoutineStep[],
  index: number,
  rest: Map<string, ResolvedLayer>
): Map<string, ResolvedLayer> {
  for (let i = index; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type === 'blend') return blendWeights(s.layers);
  }
  return rest;
}

/**
 * Clip weights for previewing the routine at time t. Each step after the first fades in from the
 * one before over `fadeSec` (or the whole step, if it's shorter). Empty map when t is outside
 * the routine.
 */
export function routineWeightsAt(
  steps: readonly RoutineStep[],
  t: number,
  rest: Map<string, ResolvedLayer> = new Map(),
  fadeSec: number = ROUTINE_FADE_SEC
): Map<string, ResolvedLayer> {
  const at = stepAtTime(steps, t);
  if (!at) return new Map();
  const to = heldWeights(steps, at.index, rest);
  const fade = Math.min(Math.max(0, fadeSec), steps[at.index]!.duration);
  if (at.index === 0 || fade <= 0 || at.localTime >= fade) return to;
  const from = heldWeights(steps, at.index - 1, rest);
  if (from === to) return to;
  const k = at.localTime / fade;
  const out = new Map<string, ResolvedLayer>();
  for (const key of new Set([...from.keys(), ...to.keys()])) {
    const a = from.get(key);
    const b = to.get(key);
    const weight = (a?.weight ?? 0) * (1 - k) + (b?.weight ?? 0) * k;
    if (weight <= WEIGHT_EPSILON) continue;
    // A clip in both steps eases its speed; otherwise it keeps its own while fading.
    const timeScale = a && b ? a.timeScale * (1 - k) + b.timeScale * k : (a ?? b)!.timeScale;
    out.set(key, { weight, timeScale });
  }
  return out;
}

/**
 * Turn a saved blend back into a studio mix (playing layers, no crossfade) so it can be tweaked.
 * Normalize is on when the weights already add up to 100%, so the sliders read the same numbers.
 */
export function blendStepToMix(step: BlendStep): StudioMix {
  const mix = createEmptyMix();
  let total = 0;
  for (const [name, r] of blendWeights(step.layers)) {
    const weight = Math.min(1, r.weight);
    mix.layers[name] = { playing: true, weight, timeScale: r.timeScale };
    total += weight;
  }
  mix.normalize = Math.abs(total - 1) < 0.01;
  return mix;
}

/** The routine as plain saved-sequence steps (a copy, safe to store). */
export function toSavedSteps(steps: readonly RoutineStep[]): SavedSequenceStep[] {
  return steps.map((s) =>
    s.type === 'blend'
      ? { type: 'blend', layers: s.layers.map((l) => ({ ...l })), duration: s.duration }
      : { type: 'pause', duration: s.duration }
  );
}

/** "1 step · 2s", "3 steps · 6.5s". */
export function describeRoutineLength(steps: readonly RoutineStep[]): string {
  const n = steps.length;
  return `${n} step${n === 1 ? '' : 's'} · ${formatSeconds(totalDuration(steps))}`;
}

export function formatSeconds(sec: number): string {
  return `${Math.round(sec * 100) / 100}s`;
}
