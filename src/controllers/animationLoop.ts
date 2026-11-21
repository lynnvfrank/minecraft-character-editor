/**
 * Animation loop: animate, step-one-frame logic, paused state.
 */

import * as THREE from 'three';
import { logger } from '../lib';
import type { CharacterState } from './characterTypes';

export type AnimationLoopDeps = {
  getSceneContext: () => {
    clock: THREE.Clock;
    characters: Record<string, CharacterState>;
    controls: { update: () => void };
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
  };
  getRoute: () => 'creator' | 'viewer' | 'preview' | 'studio';
  getCreatorTransitionInFlight: () => boolean;
  getCharacter: (id: string) => CharacterState | undefined;
  getPrimaryCharacterId: () => string;
  animationManager: {
    tick: (delta: number) => void;
    getDebugState?: () => Record<string, unknown> | undefined;
    isWalking?: () => boolean;
    isInWalkToPhase?: () => boolean;
    isBusy?: () => boolean;
  } | null;
  characterAI: { update: (delta: number) => void } | null;
  /** Called each frame before render; route-specific updates (preview texture, camera panel, etc.) */
  onFrameUpdate: (route: 'creator' | 'viewer' | 'preview' | 'studio') => void;
  /** Skip a character's mixer this frame (the crowd freezes while the creator is open). */
  shouldUpdateCharacter?: (char: CharacterState) => boolean;
  /** World simulation (crowd, selection, camera follow); runs after the animation manager. */
  onWorldUpdate?: (delta: number, route: 'creator' | 'viewer' | 'preview' | 'studio') => void;
  /**
   * World time scale (1 = normal, 0 = frozen). Mixers, the animation manager, the character AI and
   * onWorldUpdate get `delta * scale`; the camera hooks below always get the real delta, and the
   * frame is still rendered, so the camera moves while the world stands still (photo mode Freeze).
   */
  getTimeScale?: () => number;
  /** Camera moves on real time, after the world update and before the orbit controls update. */
  onCameraUpdate?: (realDelta: number, route: 'creator' | 'viewer' | 'preview' | 'studio') => void;
  /** After the orbit controls update, just before render (e.g. a camera roll the controls would undo). */
  beforeRender?: (route: 'creator' | 'viewer' | 'preview' | 'studio') => void;
};

export type AnimationLoopController = {
  animate: () => void;
  setPaused: (value: boolean) => void;
  isPaused: () => boolean;
  stepOneFrame: () => void;
};

export function createAnimationLoopController(deps: AnimationLoopDeps): AnimationLoopController {
  const {
    getSceneContext,
    getRoute,
    getCreatorTransitionInFlight,
    animationManager,
    characterAI,
    onFrameUpdate,
    shouldUpdateCharacter = () => true,
    onWorldUpdate,
    getTimeScale,
    onCameraUpdate,
    beforeRender,
  } = deps;

  function updateMixers(delta: number) {
    for (const char of Object.values(getSceneContext().characters)) {
      if (shouldUpdateCharacter(char)) char.mixer.update(delta);
    }
  }

  let paused = false;

  function setPaused(value: boolean) {
    paused = value;
  }

  function isPaused(): boolean {
    return paused;
  }

  function logStepFrame(delta: number) {
    const char = Object.values(getSceneContext().characters)[0] as CharacterState | undefined;
    const debug = animationManager?.getDebugState?.();

    if (logger.isEnabled('animation', 'debug') && debug) {
      const actionName =
        char?.currentAction && char.actions
          ? Object.entries(char.actions).find(([, a]) => a === char.currentAction)?.[0] ?? 'unknown'
          : 'none';
      const clipDuration = char?.currentAction?.getClip()?.duration ?? null;
      const actionTime = char?.currentAction?.time ?? null;

      const data: Record<string, unknown> = {
        action: actionName,
        actionTime: actionTime != null ? actionTime.toFixed(3) : null,
        clipDuration: clipDuration != null ? clipDuration.toFixed(3) : null,
        delta,
      };
      if ((debug as { activeTurn?: { progress: number; actionTime: number } }).activeTurn) {
        const at = (debug as { activeTurn: { progress: number; actionTime: number } }).activeTurn;
        data.turnProgress = at.progress.toFixed(3);
        data.turnActionTime = at.actionTime.toFixed(3);
      }
      if ((debug as { activeWalk?: { t: number; pos: unknown } }).activeWalk) {
        const aw = (debug as { activeWalk: { t: number; pos: unknown } }).activeWalk;
        data.walkT = aw.t.toFixed(3);
        data.walkPos = aw.pos;
      }
      const fd = (debug as { facingDeg?: number | null; ownsFacing?: boolean });
      if (fd.facingDeg != null) data.facingDeg = fd.facingDeg.toFixed(1);
      data.ownsFacing = fd.ownsFacing;
      logger.debug('animation', 'Step frame', data);
    }

    if (logger.isEnabled('position', 'debug') && debug) {
      const d = debug as { modelYawDeg?: number; bonesCharYawDeg?: number; containerPos?: unknown };
      const visualYaw =
        d.modelYawDeg != null && d.bonesCharYawDeg != null ? d.modelYawDeg + d.bonesCharYawDeg : d.modelYawDeg;
      logger.debug('position', 'Step frame', {
        modelYawDeg: d.modelYawDeg?.toFixed(1) ?? 'n/a',
        bonesCharYawDeg: d.bonesCharYawDeg?.toFixed(1) ?? 'n/a',
        visualYawDeg: visualYaw != null ? visualYaw.toFixed(1) : 'n/a',
        containerPos: d.containerPos,
      });
    }

    if (logger.isEnabled('stateMachine', 'debug') && debug) {
      const d = debug as { isInWalkToPhase?: boolean; isWalking?: boolean; isBusy?: boolean };
      logger.debug('stateMachine', 'Step frame', {
        isInWalkToPhase: d.isInWalkToPhase,
        isWalking: d.isWalking,
        isBusy: d.isBusy,
      });
    }

    if (logger.isEnabled('renderer', 'debug')) {
      logger.debug('renderer', 'Step frame', { delta, deltaMs: (delta * 1000).toFixed(1) });
    }
  }

  function stepOneFrame() {
    const ctx = getSceneContext();
    const delta = 1 / 60;
    updateMixers(delta);
    if (animationManager) animationManager.tick(delta);
    characterAI?.update(delta);
    onWorldUpdate?.(delta, getRoute());
    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);

    logStepFrame(delta);
  }

  function animate() {
    requestAnimationFrame(animate);
    const ctx = getSceneContext();
    const route = getRoute();

    onFrameUpdate(route);

    if (paused) return;

    const realDelta = ctx.clock.getDelta();
    const scale = getTimeScale?.() ?? 1;
    const delta = Number.isFinite(scale) && scale >= 0 ? realDelta * scale : realDelta;
    updateMixers(delta);
    if (animationManager) animationManager.tick(delta);
    if (getRoute() === 'viewer' && !getCreatorTransitionInFlight()) characterAI?.update(delta);
    onWorldUpdate?.(delta, route);
    onCameraUpdate?.(realDelta, route);
    ctx.controls.update();
    beforeRender?.(route);
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  return {
    animate,
    setPaused,
    isPaused,
    stepOneFrame,
  };
}
