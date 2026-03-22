/**
 * Creator pose and camera: idle/frozen states, camera transitions for creator mode.
 */

import * as THREE from 'three';
import { logger } from '../lib';
import type { CharacterStateLike } from '../animation';
import type { CharacterState } from './characterTypes';
import { EDIT_MODE_WARDROBE, type EditMode } from '../creator/api';

export type CameraPose = { target: THREE.Vector3; position: THREE.Vector3 };

export type CreatorPoseDeps = {
  getCharacter: (id: string) => CharacterState | undefined;
  getPrimaryCharacterId: () => string;
  getEditMode: () => EditMode;
  fadeToAction: (char: CharacterStateLike, action: THREE.AnimationAction, duration?: number) => void;
  getSceneContext: () => { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } };
  animationManager: { stop: () => void; stopIdleWanderer?: () => void } | null;
  creatorCameraTarget: THREE.Vector3;
  creatorCameraPosition: THREE.Vector3;
  creatorCameraOffsetFromCharacter: THREE.Vector3;
  creatorTargetOffsetFromCharacter: THREE.Vector3;
  creatorIdleTransitionMinDurationSec: number;
  easeOutCubic: (t: number) => number;
};

const CAMERA_TRAVEL_SPEED = 4;
const CAMERA_TRANSITION_DURATION_MIN_MS = 400;
const CAMERA_TRANSITION_DURATION_MAX_MS = 1500;

export type CreatorPoseController = {
  lockCharacterToCreatorIdle: () => void;
  lockCharacterFrozenForPainting: () => void;
  letIdleCompleteThenFreeze: () => void;
  applyCreatorCharacterPose: (detail?: { mode?: string; previousMode?: string }) => void;
  getCurrentActionRemainingSec: (char: CharacterState) => number;
  getCreatorCameraPose: () => CameraPose;
  snapCameraToCreatorView: (pose?: CameraPose) => void;
  animateCameraToCreatorView: (pose?: CameraPose) => Promise<void>;
  isCreatorIdleCompletingTransition: () => boolean;
};

export function createCreatorPoseController(deps: CreatorPoseDeps): CreatorPoseController {
  let creatorIdleCompletingTransition = false;

  function lockCharacterToCreatorIdle() {
    deps.animationManager?.stop();
    deps.animationManager?.stopIdleWanderer?.();
    const char = deps.getCharacter(deps.getPrimaryCharacterId());
    if (!char?.idleAction) return;
    char.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    char.idleAction.clampWhenFinished = false;
    char.idleAction.paused = false;
    char.idleAction.setEffectiveTimeScale(1);
    deps.fadeToAction(char, char.idleAction, 0.25);
  }

  function lockCharacterFrozenForPainting() {
    deps.animationManager?.stop();
    deps.animationManager?.stopIdleWanderer?.();
    const char = deps.getCharacter(deps.getPrimaryCharacterId());
    if (!char?.idleAction) return;
    char.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    char.idleAction.clampWhenFinished = false;
    deps.fadeToAction(char, char.idleAction, 0.15);
    char.idleAction.time = 0;
    char.idleAction.paused = true;
    char.idleAction.setEffectiveTimeScale(0);
    char.currentAction = char.idleAction;
  }

  function letIdleCompleteThenFreeze() {
    deps.animationManager?.stop();
    deps.animationManager?.stopIdleWanderer?.();
    const char = deps.getCharacter(deps.getPrimaryCharacterId());
    if (!char?.idleAction) return;

    const action = char.idleAction;
    const clipDuration = action.getClip()?.duration ?? 0;
    const timeInCycle =
      clipDuration > 0.001
        ? ((action.time % clipDuration) + clipDuration) % clipDuration
        : 0;

    const minDuration = deps.creatorIdleTransitionMinDurationSec;
    const playForward =
      clipDuration < minDuration || timeInCycle >= clipDuration / 2;
    const direction = playForward ? 'forward' : 'backward';
    const reason =
      clipDuration < minDuration
        ? 'short-clip'
        : timeInCycle >= clipDuration / 2
          ? 'midpoint-or-later'
          : 'before-midpoint';

    logger.info('animation', 'Creator idle transition', {
      direction,
      reason,
      clipDurationSec: Number(clipDuration.toFixed(3)),
      timeInCycleSec: Number(timeInCycle.toFixed(3)),
      minDurationSec: minDuration,
      crossfadeDuration: 0.15,
    });

    creatorIdleCompletingTransition = true;

    logger.info('animation', 'Creator idle crossfade start', {
      fromAction: (char.currentAction as unknown as { _clip?: { name?: string } })?._clip?.name ?? 'none',
      toAction: (action as unknown as { _clip?: { name?: string } })._clip?.name ?? 'unknown',
      fromTime: char.currentAction ? Number(char.currentAction.time.toFixed(3)) : null,
      toTime: Number(action.time.toFixed(3)),
      duration: 0.15,
    });
    deps.fadeToAction(char, action, 0.15);
    logger.info('animation', 'Creator idle crossfade done', {
      actionTime: Number(action.time.toFixed(3)),
      effectiveTimeScale: playForward ? 1 : -1,
    });

    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    action.paused = false;
    action.setEffectiveTimeScale(playForward ? 1 : -1);

    const onFinished = () => {
      char.mixer.removeEventListener('finished', onFinished);
      logger.info('animation', 'Creator idle transition finished', {
        finalTime: Number(action.time.toFixed(3)),
        direction,
      });
      action.paused = true;
      action.setEffectiveTimeScale(0);
      window.setTimeout(() => {
        creatorIdleCompletingTransition = false;
      }, 0);
    };
    char.mixer.addEventListener('finished', onFinished);
  }

  function applyCreatorCharacterPose(_detail?: { mode?: string; previousMode?: string }) {
    const mode = deps.getEditMode();

    if (mode === EDIT_MODE_WARDROBE) {
      lockCharacterToCreatorIdle();
    } else {
      lockCharacterFrozenForPainting();
    }
  }

  function getCurrentActionRemainingSec(char: CharacterState): number {
    const action = char.currentAction;
    if (!action || action === char.idleAction) return 0;
    const clipDuration = action.getClip()?.duration ?? 0;
    if (clipDuration <= 0.01) return 0;
    const time = ((action.time % clipDuration) + clipDuration) % clipDuration;
    const remaining = clipDuration - time;
    return remaining > 0.05 ? Math.min(remaining, 4) : 0;
  }

  function getCreatorCameraPose(): CameraPose {
    const char = deps.getCharacter(deps.getPrimaryCharacterId());
    if (!char) {
      return {
        target: deps.creatorCameraTarget.clone(),
        position: deps.creatorCameraPosition.clone(),
      };
    }

    const yaw = char.model.rotation.y;
    const upAxis = new THREE.Vector3(0, 1, 0);
    const cameraOffset = deps.creatorCameraOffsetFromCharacter.clone().applyAxisAngle(upAxis, yaw);
    const targetOffset = deps.creatorTargetOffsetFromCharacter.clone().applyAxisAngle(upAxis, yaw);
    const position = char.container.position.clone().add(cameraOffset);
    const target = char.container.position.clone().add(targetOffset);
    return { target, position };
  }

  function snapCameraToCreatorView(pose?: CameraPose) {
    const p = pose ?? getCreatorCameraPose();
    const ctx = deps.getSceneContext();
    if (!ctx?.camera || !ctx?.controls) return;
    ctx.camera.position.copy(p.position);
    ctx.controls.target.copy(p.target);
    ctx.controls.update();
  }

  function animateCameraToCreatorView(pose?: CameraPose): Promise<void> {
    const p = pose ?? getCreatorCameraPose();
    const ctx = deps.getSceneContext();
    if (!ctx?.camera || !ctx?.controls) return Promise.resolve();

    const startPosition = ctx.camera.position.clone();
    const endPosition = p.position.clone();
    const startTarget = ctx.controls.target.clone();
    const endTarget = p.target.clone();

    const distance = startPosition.distanceTo(endPosition);
    const durationMs = THREE.MathUtils.clamp(
      (distance / CAMERA_TRAVEL_SPEED) * 1000,
      CAMERA_TRANSITION_DURATION_MIN_MS,
      CAMERA_TRANSITION_DURATION_MAX_MS
    );

    const startTime = performance.now();

    return new Promise<void>((resolve) => {
      const tick = () => {
        const sc = deps.getSceneContext();
        if (!sc) return;
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        const eased = deps.easeOutCubic(t);

        sc.camera.position.copy(startPosition).lerp(endPosition, eased);
        sc.controls.target.copy(startTarget).lerp(endTarget, eased);
        sc.controls.update();

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          snapCameraToCreatorView(p);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  function isCreatorIdleCompletingTransition(): boolean {
    return creatorIdleCompletingTransition;
  }

  return {
    lockCharacterToCreatorIdle,
    lockCharacterFrozenForPainting,
    letIdleCompleteThenFreeze,
    applyCreatorCharacterPose,
    getCurrentActionRemainingSec,
    getCreatorCameraPose,
    snapCameraToCreatorView,
    animateCameraToCreatorView,
    isCreatorIdleCompletingTransition,
  };
}
