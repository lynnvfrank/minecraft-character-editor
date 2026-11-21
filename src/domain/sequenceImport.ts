/**
 * Rules for sequences that come from outside the app (a backup file or a share link): strict
 * cleaning of untrusted input, "same combo?" comparison, and merging into the saved list.
 * Pure; the store that uses it is state/savedSequences.ts.
 */
import { isSavedSequenceStep, type BlendLayerSpec, type SavedSequence, type SavedSequenceStep } from './sequences';

export const MAX_SEQUENCE_LABEL_LENGTH = 40;
export const MAX_SEQUENCE_STEPS = 24;
export const MAX_BLEND_LAYERS = 8;
/** How many combos one backup file may carry. */
export const MAX_IMPORTED_SEQUENCES = 200;
export const DEFAULT_SEQUENCE_LABEL = 'My combo';

// Same ranges the studio uses (animation/studioRoutine.ts, animation/studioMix.ts); domain can't import them.
const MIN_STEP_SEC = 0.25;
const MAX_STEP_SEC = 20;
const MAX_TIME_SCALE = 2;
const MAX_CLIP_NAME_LENGTH = 64;
const CLIP_NAME_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * True for plain slug-like clip keys ("waving", "blow-akiss"). Rejects anything else, including
 * names every object has ("constructor"), which would otherwise look like a loaded clip.
 */
export function isSafeClipName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= MAX_CLIP_NAME_LENGTH &&
    CLIP_NAME_RE.test(name) &&
    !(name in Object.prototype) &&
    !(name.toLowerCase() in Object.prototype)
  );
}

/** Control characters, zero-width characters and text-direction overrides. */
const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

/** Trim, drop control characters, collapse whitespace and cap the length. Empty becomes "My combo". */
export function cleanSequenceLabel(label: unknown): string {
  if (typeof label !== 'string') return DEFAULT_SEQUENCE_LABEL;
  const text = [...label.replace(UNSAFE_LABEL_CHARS, ' ').replace(/\s+/g, ' ').trim()]
    .slice(0, MAX_SEQUENCE_LABEL_LENGTH)
    .join('')
    .trim();
  return text || DEFAULT_SEQUENCE_LABEL;
}

function cleanDuration(v: unknown): number | undefined {
  return finite(v) ? round3(clamp(v, MIN_STEP_SEC, MAX_STEP_SEC)) : undefined;
}

function cleanStep(raw: unknown): SavedSequenceStep | null {
  if (!isSavedSequenceStep(raw)) return null;
  if (raw.type === 'animation') {
    if (!isSafeClipName(raw.name)) return null;
    const duration = cleanDuration(raw.duration);
    return duration === undefined ? { type: 'animation', name: raw.name } : { type: 'animation', name: raw.name, duration };
  }
  if (raw.type === 'pause') {
    // A random-length pause becomes its average: simpler to store and to share.
    const d = finite(raw.min) && finite(raw.max) ? (raw.min + raw.max) / 2 : raw.duration;
    return { type: 'pause', duration: finite(d) ? round3(clamp(d, 0.05, MAX_STEP_SEC)) : 0.5 };
  }
  if (raw.layers.length > MAX_BLEND_LAYERS) return null;
  const layers: BlendLayerSpec[] = [];
  for (const l of raw.layers) {
    if (!isSafeClipName(l.name) || !finite(l.weight)) return null;
    const layer: BlendLayerSpec = { name: l.name, weight: round3(clamp(l.weight, 0, 1)) };
    if (l.timeScale !== undefined) {
      if (!finite(l.timeScale)) return null;
      layer.timeScale = round3(clamp(l.timeScale, 0, MAX_TIME_SCALE));
    }
    layers.push(layer);
  }
  const duration = cleanDuration(raw.duration);
  return duration === undefined ? { type: 'blend', layers } : { type: 'blend', layers, duration };
}

/**
 * A clean copy of an untrusted sequence, or null if any part of it is not a valid sequence.
 * Numbers are clamped to the studio's ranges, the label is cleaned, and an unusable id becomes ''
 * (the store then makes a new one).
 */
export function sanitizeSequence(raw: unknown): SavedSequence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > MAX_SEQUENCE_STEPS) return null;
  const steps: SavedSequenceStep[] = [];
  for (const s of r.steps) {
    const step = cleanStep(s);
    if (!step) return null;
    steps.push(step);
  }
  const id = typeof r.id === 'string' && ID_RE.test(r.id) && !(r.id in Object.prototype) ? r.id : '';
  return { id, label: cleanSequenceLabel(r.label), steps };
}

/**
 * Swap clips this app doesn't have for something harmless: a missing layer is dropped from its
 * blend, and a step with nothing left becomes a pause of the same length.
 */
export function withoutUnknownClips(
  steps: readonly SavedSequenceStep[],
  hasClip: (name: string) => boolean
): SavedSequenceStep[] {
  return steps.map((step): SavedSequenceStep => {
    if (step.type === 'animation') return hasClip(step.name) ? step : { type: 'pause', duration: step.duration ?? 2 };
    if (step.type !== 'blend') return step;
    const layers = step.layers.filter((l) => hasClip(l.name));
    if (layers.length === step.layers.length) return step;
    if (layers.length === 0) return { type: 'pause', duration: step.duration ?? 2 };
    return { ...step, layers };
  });
}

function stepKey(step: SavedSequenceStep): unknown {
  if (step.type === 'animation') return ['a', step.name, step.duration ?? null];
  if (step.type === 'pause') return ['p', step.duration ?? null, step.min ?? null, step.max ?? null];
  return ['b', step.duration ?? null, step.layers.map((l) => [l.name, round3(l.weight), round3(l.timeScale ?? 1)])];
}

/** Two sequences with the same key are the same combo to the user (same name, same steps); ids don't count. */
export function sequenceContentKey(seq: Pick<SavedSequence, 'label' | 'steps'>): string {
  return JSON.stringify([seq.label, seq.steps.map(stepKey)]);
}

/**
 * Merge imported sequences into the existing list: existing ones stay as they are and in place,
 * imported ones the user doesn't have yet (by content) go after them, and an imported id that is
 * missing or already taken is replaced by `makeId()`.
 */
export function mergeSequences(
  existing: readonly SavedSequence[],
  incoming: readonly SavedSequence[],
  makeId: () => string
): { list: SavedSequence[]; added: number } {
  const list = [...existing];
  const ids = new Set(list.map((s) => s.id));
  const contents = new Set(list.map(sequenceContentKey));
  let added = 0;
  for (const seq of incoming) {
    const key = sequenceContentKey(seq);
    if (contents.has(key)) continue;
    let id = seq.id;
    // makeId is expected to give a fresh id sooner or later; the cap only guards a broken one.
    for (let tries = 0; (!id || ids.has(id)) && tries < 1000; tries++) id = makeId();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    contents.add(key);
    list.push({ ...seq, id });
    added++;
  }
  return { list, added };
}
