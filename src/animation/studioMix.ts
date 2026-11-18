/**
 * Dance studio mix math (pure; no Three.js, no DOM).
 *
 * A mix is a set of per-clip layers (play/stop, weight, time scale) plus one A↔B crossfade.
 * `resolveMixWeights` turns it into the weight and time scale each mixer action should get.
 *
 * Why normalize: THREE.AnimationMixer blends the bind pose into whatever weight is missing
 * below 1, so two clips at 0.3 + 0.3 look like they're sagging toward a T-pose. With
 * `normalize` on (the default), positive weights are scaled to sum to exactly 1.
 */
import type { BlendLayerSpec, BlendStep } from '../domain/sequences';

export type StudioLayer = { playing: boolean; weight: number; timeScale: number };

export type CrossfadeCurve = 'linear' | 'equal-power';

export type StudioCrossfade = {
  a: string | null;
  b: string | null;
  /** 0 = all A, 1 = all B. */
  t: number;
  curve: CrossfadeCurve;
};

export type StudioMix = {
  layers: Record<string, StudioLayer>;
  crossfade: StudioCrossfade;
  normalize: boolean;
};

export type ResolvedLayer = { weight: number; timeScale: number };

export const MIN_TIME_SCALE = 0;
export const MAX_TIME_SCALE = 2;
/** Weights below this are treated as off (the action is stopped). */
export const WEIGHT_EPSILON = 1e-4;

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export function defaultLayer(): StudioLayer {
  return { playing: false, weight: 1, timeScale: 1 };
}

export function createEmptyMix(): StudioMix {
  return {
    layers: {},
    crossfade: { a: null, b: null, t: 0, curve: 'equal-power' },
    normalize: true,
  };
}

/**
 * Weights for A and B at position t. Linear sums to 1; equal-power keeps loudness-style
 * "presence" constant (cos/sin), which reads better at the midpoint. Equal-power sums above 1
 * in the middle, so it's normally used with `normalize` on.
 */
export function crossfadeWeights(t: number, curve: CrossfadeCurve): { a: number; b: number } {
  const x = clamp01(t);
  if (curve === 'linear') return { a: 1 - x, b: x };
  return { a: Math.cos((x * Math.PI) / 2), b: Math.sin((x * Math.PI) / 2) };
}

/**
 * Final weight and time scale per clip. Clips with no weight are left out (stop them).
 * A clip that is both a playing layer and a crossfade slot gets both contributions.
 * Crossfade slots use the layer's time scale when the clip has a layer, else 1.
 */
export function resolveMixWeights(mix: StudioMix): Map<string, ResolvedLayer> {
  const raw = new Map<string, ResolvedLayer>();
  const add = (key: string, weight: number) => {
    if (weight <= WEIGHT_EPSILON) return;
    const ts = clamp(mix.layers[key]?.timeScale ?? 1, MIN_TIME_SCALE, MAX_TIME_SCALE);
    const prev = raw.get(key);
    raw.set(key, { weight: (prev?.weight ?? 0) + weight, timeScale: ts });
  };

  for (const [key, layer] of Object.entries(mix.layers)) {
    if (layer.playing) add(key, clamp01(layer.weight));
  }

  const { a, b, t, curve } = mix.crossfade;
  if (a && b && a !== b) {
    const w = crossfadeWeights(t, curve);
    add(a, w.a);
    add(b, w.b);
  } else if (a || b) {
    // One slot filled (or A = B): that clip plays at full weight.
    add((a ?? b)!, 1);
  }

  if (!mix.normalize) return raw;
  let total = 0;
  for (const r of raw.values()) total += r.weight;
  if (total <= WEIGHT_EPSILON) return new Map();
  const out = new Map<string, ResolvedLayer>();
  for (const [key, r] of raw) out.set(key, { weight: r.weight / total, timeScale: r.timeScale });
  return out;
}

/** Highest-weight clip (ties: first in insertion order), or null when nothing plays. */
export function dominantClip(weights: Map<string, ResolvedLayer>): string | null {
  let best: string | null = null;
  let bestW = -Infinity;
  for (const [key, r] of weights) {
    if (r.weight > bestW) {
      best = key;
      bestW = r.weight;
    }
  }
  return best;
}

/** Round to 3 decimals so saved JSON stays readable and stable. */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Snapshot the current mix as one blend step for the sequence system. Null if nothing plays. */
export function mixToBlendStep(mix: StudioMix, durationSec: number): BlendStep | null {
  const weights = resolveMixWeights(mix);
  if (weights.size === 0) return null;
  const layers: BlendLayerSpec[] = [...weights]
    .map(([name, r]) => ({ name, weight: round3(r.weight), timeScale: round3(r.timeScale) }))
    .sort((x, y) => y.weight - x.weight || x.name.localeCompare(y.name));
  return { type: 'blend', layers, duration: round3(clamp(durationSec, 0.5, 60)) };
}

/** Short default name like "Wave 60% + Clap 40%". */
export function describeBlend(step: BlendStep, labelFor: (key: string) => string = (k) => k): string {
  return step.layers
    .slice(0, 3)
    .map((l) => `${labelFor(l.name)} ${Math.round(l.weight * 100)}%`)
    .join(' + ') + (step.layers.length > 3 ? ' + …' : '');
}

/**
 * Advance an automatic A↔B sweep (ping-pong). `dir` is +1 or -1; returns the new t and dir.
 * `periodSec` is the time for one full A→B pass.
 */
export function stepSweep(t: number, dir: 1 | -1, dt: number, periodSec: number): { t: number; dir: 1 | -1 } {
  if (periodSec <= 0) return { t: clamp01(t), dir };
  let next = t + (dir * Math.max(0, dt)) / periodSec;
  let d = dir;
  // Reflect off the ends (a huge dt can bounce more than once).
  for (let i = 0; i < 8 && (next > 1 || next < 0); i++) {
    if (next > 1) {
      next = 2 - next;
      d = -1;
    } else if (next < 0) {
      next = -next;
      d = 1;
    }
  }
  return { t: clamp01(next), dir: d };
}
