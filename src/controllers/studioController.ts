/**
 * Dance studio (`#/studio`): drives the primary character's AnimationMixer directly from a
 * StudioMix (per-clip weights + A↔B crossfade). The math lives in `animation/studioMix.ts`;
 * this module only applies it to actions and owns enter/exit.
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

  function apply(): void {
    applied = resolveMixWeights(mix);
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
      if (!sweeping) return;
      if (!mix.crossfade.a || !mix.crossfade.b) return;
      const next = stepSweep(mix.crossfade.t, sweepDir, Math.min(delta, 0.1), sweepPeriodSec);
      sweepDir = next.dir;
      mix = { ...mix, crossfade: { ...mix.crossfade, t: next.t } };
      apply();
    },
    getSnapshot: (): StudioSnapshot => ({ mix, applied, sweeping, sweepPeriodSec }),
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),

    setLayer(key: string, patch: Partial<StudioLayer>): void {
      const prev = mix.layers[key] ?? defaultLayer();
      const next: StudioLayer = {
        playing: patch.playing ?? prev.playing,
        weight: clamp01(patch.weight ?? prev.weight),
        timeScale: clamp(patch.timeScale ?? prev.timeScale, MIN_TIME_SCALE, MAX_TIME_SCALE),
      };
      mix = { ...mix, layers: { ...mix.layers, [key]: next } };
      apply();
    },
    setCrossfade(patch: Partial<StudioCrossfade>): void {
      const cf = { ...mix.crossfade, ...patch };
      cf.t = clamp01(cf.t);
      mix = { ...mix, crossfade: cf };
      // Dragging the slider takes over from the auto-sweep.
      if (patch.t != null) sweeping = false;
      apply();
    },
    setNormalize(on: boolean): void {
      mix = { ...mix, normalize: on };
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
      apply();
    },
    /** The current mix as one blend step (null when nothing plays). */
    toBlendStep(durationSec: number): BlendStep | null {
      return mixToBlendStep(mix, durationSec);
    },
  };
}

export type StudioController = ReturnType<typeof createStudioController>;
