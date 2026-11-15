/**
 * Applies a route (viewer / creator / preview) to the scene and UI. Called by the mode machine
 * whenever the hash route changes. Extracted from main.ts `applyRoute`.
 */
import * as THREE from 'three';
import type { EditMode } from '../creator/api';
import type { PreviewPreset } from '../domain';
import { getPreviewPreset } from '../viewer/previewPresets';
import type { SceneContext } from '../viewer/scene';
import type { CharacterState } from './characterTypes';
import type { CreatorPoseController } from './creatorPose';
import type { AppRoute, RouteInfo } from './modes/appModeMachine';
import type { PreviewRouteRuntime } from './previewRouteRuntime';

type Vec3 = { x: number; y: number; z: number };

/** Camera position/target for a preview preset, offset to where the character stands. */
export function presetPoseAt(preset: PreviewPreset, origin: Vec3): { position: Vec3; target: Vec3 } {
  return {
    position: {
      x: preset.cameraPosition.x + origin.x,
      y: preset.cameraPosition.y + origin.y,
      z: preset.cameraPosition.z + origin.z,
    },
    target: {
      x: preset.cameraTarget.x + origin.x,
      y: preset.cameraTarget.y + origin.y,
      z: preset.cameraTarget.z + origin.z,
    },
  };
}

/**
 * Whether entering the creator should (re)load the character's skin into the editor canvas:
 * yes if the canvas is empty or the user picked a different skin on the home screen.
 */
export function shouldReloadCreatorSkin(
  currentSkin: string | null | undefined,
  canvasPopulated: boolean,
  lastLoadedPath: string | null
): currentSkin is string {
  if (!currentSkin) return false;
  return !canvasPopulated || currentSkin !== lastLoadedPath;
}

/** Creator API the router needs (from src/creator.ts). */
export type RouterCreatorApi = {
  init: () => void;
  getEditMode: () => EditMode;
  setEditMode: (mode: EditMode, opts: { syncUrl: boolean }) => void;
  getFocusedCreationEnabled: () => boolean;
  getCanvasPopulated: () => boolean;
  loadSkinFromPath: (path: string) => Promise<void> | void;
};

export type RouterDeps = {
  creator: RouterCreatorApi;
  defaultCreatorMode: EditMode;
  creatorPose: () => CreatorPoseController;
  previewRuntime: PreviewRouteRuntime;
  getRoute: () => AppRoute;
  getPrimaryCharacter: () => CharacterState | undefined;
  getSceneContext: () => SceneContext | null;
  /** Move the 3D view into the creator's main area or side slot for the current edit mode. */
  updateCreatorViewPlacement: () => void;
  /** Put the 3D view back in the full-width viewer layout. */
  ensureViewerLayout: () => void;
  /** Return the character to idle/wander on the home screen. */
  resumeHome: () => void;
  /** Refresh anything that depends on the route (nav buttons). */
  onApplied: () => void;
};

export function createRouter(deps: RouterDeps) {
  let lastApplied: RouteInfo | null = null;
  /** Path last loaded into the creator canvas (from the gallery or on route enter). */
  let lastCreatorLoadedPath: string | null = null;

  function snapCreatorCamera(): void {
    const pose = deps.creatorPose();
    const char = deps.getPrimaryCharacter();
    const focusedWardrobe =
      deps.creator.getEditMode() === 'wardrobe' && deps.creator.getFocusedCreationEnabled() && deps.getRoute() === 'creator';
    if (!focusedWardrobe || !char) {
      pose.snapCameraToCreatorView(pose.getCreatorCameraPose());
      return;
    }
    const preset = getPreviewPreset('fullOutfit');
    const { position, target } = presetPoseAt(preset, char.container.position);
    const ctx = deps.getSceneContext();
    if (ctx?.camera) {
      ctx.camera.fov = preset.fov ?? 35;
      ctx.camera.updateProjectionMatrix();
    }
    pose.snapCameraToCreatorView({
      position: new THREE.Vector3(position.x, position.y, position.z),
      target: new THREE.Vector3(target.x, target.y, target.z),
    });
  }

  function enterCreator(info: RouteInfo): void {
    const { creator } = deps;
    const pose = deps.creatorPose();
    const desiredMode = info.creatorMode ?? deps.defaultCreatorMode;

    // Already in the creator: only the edit mode (hash suffix) changed.
    if (lastApplied?.route === 'creator') {
      if (creator.getEditMode() !== desiredMode) {
        creator.setEditMode(desiredMode, { syncUrl: false });
        deps.updateCreatorViewPlacement();
      }
      return;
    }

    if (creator.getEditMode() !== desiredMode) creator.setEditMode(desiredMode, { syncUrl: false });
    pose.applyCreatorCharacterPose();
    creator.init();
    deps.updateCreatorViewPlacement();

    const mode = creator.getEditMode();
    if (mode === '3d' || mode === '2d') {
      requestAnimationFrame(() => {
        if (deps.getRoute() === 'creator' && creator.getEditMode() === mode) pose.applyCreatorCharacterPose();
      });
    }
    window.setTimeout(snapCreatorCamera, 0);
    window.setTimeout(() => {
      deps.updateCreatorViewPlacement();
      window.dispatchEvent(new Event('resize'));
      const skin = deps.getPrimaryCharacter()?.currentSkin;
      if (shouldReloadCreatorSkin(skin, creator.getCanvasPopulated(), lastCreatorLoadedPath)) {
        void creator.loadSkinFromPath(skin);
        lastCreatorLoadedPath = skin;
      }
    }, 0);
  }

  function apply(info: RouteInfo): void {
    document.body.dataset.route = info.route;
    if (info.route === 'creator') {
      deps.previewRuntime.exit();
      enterCreator(info);
    } else if (info.route === 'preview') {
      deps.ensureViewerLayout();
      deps.creatorPose().lockCharacterToCreatorIdle();
      window.setTimeout(() => {
        void deps.previewRuntime.sync();
        window.dispatchEvent(new Event('resize'));
      }, 0);
    } else {
      deps.ensureViewerLayout();
      deps.previewRuntime.exit();
      deps.resumeHome();
    }
    deps.onApplied();
    lastApplied = info;
  }

  return {
    apply,
    /** Record a skin the creator loaded itself (gallery pick) so re-entry doesn't reload it. */
    noteCreatorLoadedPath(path: string): void {
      lastCreatorLoadedPath = path;
    },
  };
}

export type Router = ReturnType<typeof createRouter>;
