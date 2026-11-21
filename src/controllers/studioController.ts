/**
 * Dance studio (`#/studio`): drives the primary character's AnimationMixer directly from a
 * StudioMix (per-clip weights + A↔B crossfade). The math lives in `animation/studioMix.ts`;
 * this module only applies it to actions and owns enter/exit. It also previews a routine
 * (`animation/studioRoutine.ts`) by applying the routine's weights instead of the mix's.
 *
 * The studio is its own stage: it is updated from the main loop's `onWorldUpdate` hook
 * (auto-sweep), the home world (block village, crowd) is hidden on this route, and the idle AI
 * doesn't run, so nothing walks the character away.
 */
import * as THREE from 'three';
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { logger } from '../lib';
import {
  clamp,
  clamp01,
  createEmptyMix,
  defaultLayer,
  dominantClip,
  MAX_TIME_SCALE,
  MIN_TIME_SCALE,
  mixToBlendStep,
  resolveMixWeights,
  stepSweep,
  type StudioCrossfade,
  type StudioLayer,
  type StudioMix,
} from '../animation/studioMix';
import { routineWeightsAt, stepAtTime, totalDuration, type RoutineStep } from '../animation/studioRoutine';
import type { BlendStep } from '../domain/sequences';
import type { CharacterState } from './characterTypes';

export type StudioControllerDeps = {
  getCharacter: () => CharacterState | undefined;
  /** Stop any running sequence/walk so it doesn't fight the studio for the mixer. */
  stopSequences: () => void;
  getSceneContext: () => { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } } | null;
  /** Visual heading of the character (radians), used to put the camera in front of it. */
  getFacing: () => number;
};

/** Read-only view of the studio for the panel. */
export type StudioSnapshot = {
  mix: StudioMix;
  /** Effective weights being applied right now (after normalization). */
  applied: Map<string, { weight: number; timeScale: number }>;
  sweeping: boolean;
  sweepPeriodSec: number;
  /** Step of the routine being previewed, or null when the live mix is in control. */
  routineIndex: number | null;
  /** A routine is waiting for the next bar line of the beat before it starts. */
  routinePending: boolean;
};

const EXIT_FADE_SEC = 0.3;

export function createStudioController(deps: StudioControllerDeps) {
  let mix: StudioMix = createEmptyMix();
  let applied = new Map<string, { weight: number; timeScale: number }>();
  let active = false;
  let sweeping = false;
  let sweepDir: 1 | -1 = 1;
  let sweepPeriodSec = 4;
  const slice = createSubscribable();
  /** Action set the mix was last applied to; changes when the character loads or its rig swaps. */
  let appliedTo: Record<string, THREE.AnimationAction> | null = null;
  /**
   * Routine preview. While set, it (not the mix) decides the weights, so the two never fight
   * over the mixer; the mix itself is left alone and takes over again when the preview ends.
   * Any edit to the mix ends the preview.
   */
  let routine: { steps: readonly RoutineStep[]; time: number; total: number; startAt: number | null } | null = null;

  /** What a pause with nothing before it shows: the idle clip. */
  function restWeights(): Map<string, { weight: number; timeScale: number }> {
    const char = deps.getCharacter();
    const idleKey = char && Object.entries(char.actions).find(([, a]) => a === char.idleAction)?.[0];
    return new Map(idleKey ? [[idleKey, { weight: 1, timeScale: 1 }]] : []);
  }

  function apply(): void {
    applied = routine && routine.time >= 0 ? routineWeightsAt(routine.steps, routine.time, restWeights()) : resolveMixWeights(mix);
    const char = deps.getCharacter();
    if (char && active) {
      appliedTo = char.actions;
      for (const [key, action] of Object.entries(char.actions)) {
        const r = applied.get(key);
        if (r) {
          if (!action.isRunning()) {
            action.reset();
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.clampWhenFinished = false;
            action.play();
          }
          action.enabled = true;
          action.paused = false;
          action.setEffectiveTimeScale(r.timeScale);
          action.setEffectiveWeight(r.weight); // cancels any fade still in progress
        } else if (action.isRunning()) {
          action.stop();
        }
      }
      // So leaving the studio (fadeToAction → idle) crossfades from what's on screen.
      const top = dominantClip(applied);
      char.currentAction = top ? char.actions[top] ?? null : null;
    }
    slice.notify();
  }

  function frameCamera(): void {
    const ctx = deps.getSceneContext();
    const char = deps.getCharacter();
    if (!ctx || !char) return;
    const p = char.container.position;
    const yaw = deps.getFacing();
    // Front three-quarter view, a little above chest height.
    const dist = 5.2;
    const side = 0.45;
    ctx.controls.target.set(p.x, p.y + 1, p.z);
    ctx.camera.position.set(
      p.x + Math.sin(yaw + side) * dist,
      p.y + 1.8,
      p.z + Math.cos(yaw + side) * dist
    );
    ctx.camera.lookAt(ctx.controls.target);
    ctx.controls.update();
  }

  /** Seed the mix from whatever the character is doing, so entering doesn't snap to a T-pose. */
  function seedFromCharacter(): void {
    if (Object.keys(mix.layers).length > 0 || mix.crossfade.a || mix.crossfade.b) return;
    const char = deps.getCharacter();
    if (!char) return;
    const idleKey = Object.entries(char.actions).find(([, a]) => a === char.idleAction)?.[0];
    if (idleKey) mix = { ...mix, crossfade: { ...mix.crossfade, a: idleKey } };
  }

  return {
    enter(): void {
      if (active) return;
      active = true;
      deps.stopSequences();
      seedFromCharacter();
      apply();
      frameCamera();
      logger.info('animation', 'Studio enter', { clips: applied.size });
    },
    /** Fade out every studio layer except the dominant one (the route's resume crossfades that). */
    exit(): void {
      if (!active) return;
      active = false;
      appliedTo = null;
      sweeping = false;
      routine = null;
      const char = deps.getCharacter();
      if (char) {
        for (const action of Object.values(char.actions)) {
          if (action !== char.currentAction && action.isRunning()) action.fadeOut(EXIT_FADE_SEC);
        }
        // The dominant clip may be below weight 1; restore it so the next crossfade starts clean.
        char.currentAction?.setEffectiveWeight(1);
        char.currentAction?.setEffectiveTimeScale(1);
      }
      slice.notify();
    },
    isActive: () => active,
    /** Called every frame from the main loop's onWorldUpdate. */
    update(delta: number): void {
      if (!active) return;
      const char = deps.getCharacter();
      if (char && char.actions !== appliedTo) {
        // Opened #/studio before the character finished loading, or the rig was swapped.
        const first = appliedTo === null;
        seedFromCharacter();
        apply();
        if (first) frameCamera();
      }
      if (routine) {
        // Started on a beat: follow the clock, not frame deltas, so it stays with the music.
        routine.time =
          routine.startAt != null ? (performance.now() - routine.startAt) / 1000 : routine.time + Math.min(delta, 0.1);
        if (routine.time >= routine.total) routine = null; // finished: back to the live mix
        apply();
        return;
      }
      if (!sweeping) return;
      if (!mix.crossfade.a || !mix.crossfade.b) return;
      const next = stepSweep(mix.crossfade.t, sweepDir, Math.min(delta, 0.1), sweepPeriodSec);
      sweepDir = next.dir;
      mix = { ...mix, crossfade: { ...mix.crossfade, t: next.t } };
      apply();
    },
    getSnapshot: (): StudioSnapshot => ({
      mix,
      applied,
      sweeping,
      sweepPeriodSec,
      routineIndex: routine ? stepAtTime(routine.steps, routine.time)?.index ?? null : null,
      routinePending: !!routine && routine.time < 0,
    }),
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),

    setLayer(key: string, patch: Partial<StudioLayer>): void {
      const prev = mix.layers[key] ?? defaultLayer();
      const next: StudioLayer = {
        playing: patch.playing ?? prev.playing,
        weight: clamp01(patch.weight ?? prev.weight),
        timeScale: clamp(patch.timeScale ?? prev.timeScale, MIN_TIME_SCALE, MAX_TIME_SCALE),
      };
      mix = { ...mix, layers: { ...mix.layers, [key]: next } };
      routine = null;
      apply();
    },
    setCrossfade(patch: Partial<StudioCrossfade>): void {
      const cf = { ...mix.crossfade, ...patch };
      cf.t = clamp01(cf.t);
      mix = { ...mix, crossfade: cf };
      // Dragging the slider takes over from the auto-sweep.
      if (patch.t != null) sweeping = false;
      routine = null;
      apply();
    },
    setNormalize(on: boolean): void {
      mix = { ...mix, normalize: on };
      routine = null;
      apply();
    },
    setSweeping(on: boolean, periodSec?: number): void {
      sweeping = on;
      if (periodSec != null) sweepPeriodSec = Math.max(0.5, periodSec);
      slice.notify();
    },
    /** Stop every layer and clear the crossfade slots. */
    reset(): void {
      mix = { ...createEmptyMix(), normalize: mix.normalize };
      sweeping = false;
      routine = null;
      apply();
    },
    /** Replace the whole mix (e.g. load a routine step back into the sliders). */
    setMix(next: StudioMix): void {
      mix = next;
      sweeping = false;
      routine = null;
      apply();
    },
    /**
     * Preview a routine from its first step; plays once. False if there is nothing to play.
     * `startAtMs` (a `performance.now()` time, e.g. the beat's next bar line) delays the start; the
     * live mix keeps playing until then.
     */
    playRoutine(steps: readonly RoutineStep[], startAtMs?: number | null): boolean {
      const total = totalDuration(steps);
      if (!active || total <= 0) return false;
      const startAt = startAtMs != null && Number.isFinite(startAtMs) ? startAtMs : null;
      routine = { steps, time: startAt != null ? (performance.now() - startAt) / 1000 : 0, total, startAt };
      apply();
      return true;
    },
    /** End the preview and hand the character back to the live mix. */
    stopRoutine(): void {
      if (!routine) return;
      routine = null;
      apply();
    },
    /** The current mix as one blend step (null when nothing plays). */
    toBlendStep(durationSec: number): BlendStep | null {
      return mixToBlendStep(mix, durationSec);
    },
  };
}

export type StudioController = ReturnType<typeof createStudioController>;
