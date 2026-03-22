/**
 * Creator transition handler: coordinates viewer↔creator transitions
 * with camera animation and mode machine sync.
 *
 * Design click → enterCreator() → hash → mode machine → applyRoute
 * Home button → exitCreator() → hash → mode machine → applyRoute
 */

import { type EditMode, type DrawingTool } from '../../creator/api';
import { getPrimaryCharacterId } from '../../domain';
import type { CharacterState } from '../characterTypes';
import type { CameraPose } from '../creatorPose';

export type CreatorTransitionHandlerDeps = {
  getRoute: () => string;
  getEditMode: () => EditMode;
  getCharacter: (id: string) => CharacterState | undefined;
  getCurrentActionRemainingSec: (char: CharacterState) => number;
  applyCreatorCharacterPose: () => void;
  getCreatorCameraPose: () => CameraPose;
  animateCameraToCreatorView: (pose: CameraPose) => Promise<void>;
  normalizeLayerStateForNonEditMode: () => void;
  setActiveTool: (tool: DrawingTool) => void;
  getCreatorHash: (mode?: EditMode) => string;
  sleep: (ms: number) => Promise<void>;
  updateRouteButtonsState: () => void;
  logTransition: (stage: string, extra?: Record<string, unknown>) => void;
  animationManager: {
    stop: () => void;
    stopIdleWanderer?: () => void;
  } | null;
  resumeHomeMode: () => void;
  CREATOR_EXIT_ANIMATION_MS: number;
};

export function createCreatorTransitionHandler(deps: CreatorTransitionHandlerDeps) {
  let transitionInFlight = false;

  function setInFlight(value: boolean) {
    transitionInFlight = value;
    deps.updateRouteButtonsState();
  }

  async function enterCreator(): Promise<void> {
    if (transitionInFlight || deps.getRoute() !== 'viewer') return;
    setInFlight(true);
    const transitionStart = performance.now();
    deps.logTransition('design-clicked');
    try {
      const char = deps.getCharacter(getPrimaryCharacterId());
      if (char) {
        const remainingSec = deps.getCurrentActionRemainingSec(char);
        const waitSec = Math.min(remainingSec, 1.2);
        if (waitSec > 0) {
          deps.logTransition('waiting-current-clip', { waitSec: Number(waitSec.toFixed(2)) });
          await deps.sleep(waitSec * 1000);
        }
      }

      deps.animationManager?.stop();
      deps.animationManager?.stopIdleWanderer?.();
      deps.applyCreatorCharacterPose();
      const pose = deps.getCreatorCameraPose();
      deps.logTransition('camera-move-start', {
        elapsedMs: Math.round(performance.now() - transitionStart),
        endTarget: pose.target,
        endPosition: pose.position
      });
      await deps.animateCameraToCreatorView(pose);
      deps.logTransition('camera-move-end', { elapsedMs: Math.round(performance.now() - transitionStart) });
      location.hash = deps.getCreatorHash(deps.getEditMode());
    } finally {
      setInFlight(false);
    }
  }

  async function exitCreator(): Promise<void> {
    if (transitionInFlight || deps.getRoute() !== 'creator') return;
    setInFlight(true);
    deps.normalizeLayerStateForNonEditMode();
    deps.setActiveTool('navigate');
    deps.updateRouteButtonsState();
    try {
      document.body.dataset.creatorExiting = '1';
      await deps.sleep(deps.CREATOR_EXIT_ANIMATION_MS);
      location.hash = '#/';
      document.body.removeAttribute('data-creator-exiting');
      await deps.sleep(50);
      if (deps.getRoute() === 'viewer') {
        deps.resumeHomeMode();
      }
    } finally {
      setInFlight(false);
    }
  }

  function getTransitionInFlight(): boolean {
    return transitionInFlight;
  }

  return { enterCreator, exitCreator, getTransitionInFlight };
}
