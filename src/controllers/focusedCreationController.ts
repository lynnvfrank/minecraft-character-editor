/**
 * Focused Creation: in Creator.Wardrobe the character stays fully visible (all layers); camera
 * presets follow the selected wardrobe row when focused mode is on. On Wardrobe→Creator.3D/2D,
 * layer visibility matches the wardrobe selection when focused mode is on.
 */

import * as THREE from 'three';
import type { PreviewPresetKey } from '../domain';
import {
  creatorFocusedCreationSlice,
  creatorModeSlice,
  creatorWardrobeFocusSlice,
} from '../state/creatorSlices';
import type { CreatorEditModePayload } from '../state/creatorSlicePayloads';
import type { CameraPose, CreatorPoseController } from './creatorPose';
import type { CharacterState } from './characterTypes';
import {
  areWardrobeLayersSameDualLibraryPair,
  type WardrobeLayerKey,
} from '../creator/wardrobeLayers';
import { subscribeWardrobeHoverPreview } from '../creator/wardrobeHoverPreview';
import {
  CREATOR_WARDROBE_DEFERRED_PANEL_REVEAL_BEFORE_CAMERA_END_MS,
  CREATOR_WARDROBE_HOVER_CAMERA_DEBOUNCE_MS,
  estimateCreatorWardrobeCameraTweenDurationMs,
} from '../config/creatorWardrobeMotion';
import { getPreviewPreset } from '../viewer/previewPresets';

export type FocusedCreationControllerDeps = {
  getFocusedCreationEnabled: () => boolean;
  getRoute: () => 'creator' | 'viewer' | 'preview';
  getEditMode: () => 'wardrobe' | '2d' | '3d';
  getWardrobeSelectedLayer: () => WardrobeLayerKey;
  getWardrobeHoverPreviewLayer: () => WardrobeLayerKey | null;
  applyFocusedSoloForWardrobeLayer: (layer: WardrobeLayerKey) => void;
  setLayersPanelFocusedListExpanded: (expanded: boolean) => void;
  creatorPoseController: CreatorPoseController;
  getCharacter: (id: string) => CharacterState | undefined;
  getPrimaryCharacterId: () => string;
  getSceneContext: () => {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; update: () => void };
  };
  /** Show deferred library panels (after staggered timing vs. camera restore). */
  flushDeferredWardrobeLibraryPanelsAfterCamera: () => void;
};

export type FocusedCreationController = { dispose: () => void };

function wardrobeLayerToPreviewPresetKey(layer: WardrobeLayerKey): PreviewPresetKey {
  return layer as PreviewPresetKey;
}

function buildCameraPoseFromPreset(
  preset: ReturnType<typeof getPreviewPreset>,
  char: CharacterState
): CameraPose {
  const origin = char.container.position;
  const position = new THREE.Vector3(
    preset.cameraPosition.x + origin.x,
    preset.cameraPosition.y + origin.y,
    preset.cameraPosition.z + origin.z
  );
  const target = new THREE.Vector3(
    preset.cameraTarget.x + origin.x,
    preset.cameraTarget.y + origin.y,
    preset.cameraTarget.z + origin.z
  );
  return { position, target };
}

export function createFocusedCreationController(
  deps: FocusedCreationControllerDeps
): FocusedCreationController {
  const unsubs: Array<() => void> = [];
  let hoverWardrobeCameraDebounceTimer = 0;
  let deferredPanelRevealTimer = 0;

  function cancelHoverCameraDebounceOnly(): void {
    if (hoverWardrobeCameraDebounceTimer) {
      window.clearTimeout(hoverWardrobeCameraDebounceTimer);
      hoverWardrobeCameraDebounceTimer = 0;
    }
  }

  function cancelDeferredPanelRevealOnly(): void {
    if (deferredPanelRevealTimer) {
      window.clearTimeout(deferredPanelRevealTimer);
      deferredPanelRevealTimer = 0;
    }
  }

  function cancelPendingWardrobeHoverUx(): void {
    cancelHoverCameraDebounceOnly();
    cancelDeferredPanelRevealOnly();
  }

  function runWardrobeFocus(): void {
    if (deps.getRoute() !== 'creator') return;
    if (deps.getEditMode() !== 'wardrobe') return;
    const previewLayer =
      deps.getWardrobeHoverPreviewLayer() ?? deps.getWardrobeSelectedLayer();
    deps.applyFocusedSoloForWardrobeLayer('fullOutfit');
    if (deps.getFocusedCreationEnabled()) {
      const char = deps.getCharacter(deps.getPrimaryCharacterId());
      if (!char) return;
      const preset = getPreviewPreset(wardrobeLayerToPreviewPresetKey(previewLayer));
      const pose = buildCameraPoseFromPreset(preset, char);
      pose.fov = preset.fov ?? 35;
      void deps.creatorPoseController.animateCameraToCreatorView(pose);
    }
  }

  function buildFocusedWardrobeCameraPose(): CameraPose | null {
    if (deps.getRoute() !== 'creator') return null;
    if (deps.getEditMode() !== 'wardrobe') return null;
    if (!deps.getFocusedCreationEnabled()) return null;
    const previewLayer =
      deps.getWardrobeHoverPreviewLayer() ?? deps.getWardrobeSelectedLayer();
    deps.applyFocusedSoloForWardrobeLayer('fullOutfit');
    const char = deps.getCharacter(deps.getPrimaryCharacterId());
    if (!char) return null;
    const preset = getPreviewPreset(wardrobeLayerToPreviewPresetKey(previewLayer));
    const pose = buildCameraPoseFromPreset(preset, char);
    pose.fov = preset.fov ?? 35;
    return pose;
  }

  function startRestoreCameraThenRevealDeferredPanels(): void {
    const pose = buildFocusedWardrobeCameraPose();
    if (!pose) {
      deps.flushDeferredWardrobeLibraryPanelsAfterCamera();
      return;
    }
    const ctx = deps.getSceneContext();
    const flushDelay =
      ctx?.camera != null
        ? Math.max(
            0,
            estimateCreatorWardrobeCameraTweenDurationMs(ctx.camera.position, pose.position) -
              CREATOR_WARDROBE_DEFERRED_PANEL_REVEAL_BEFORE_CAMERA_END_MS
          )
        : 0;

    deferredPanelRevealTimer = window.setTimeout(() => {
      deferredPanelRevealTimer = 0;
      deps.flushDeferredWardrobeLibraryPanelsAfterCamera();
    }, flushDelay);

    void deps.creatorPoseController.animateCameraToCreatorView(pose).then(() => {
      if (deferredPanelRevealTimer) {
        window.clearTimeout(deferredPanelRevealTimer);
        deferredPanelRevealTimer = 0;
      }
      deps.flushDeferredWardrobeLibraryPanelsAfterCamera();
    });
  }

  function runWardrobeFocusFromSelection(): void {
    cancelPendingWardrobeHoverUx();
    runWardrobeFocus();
  }

  function scheduleWardrobeFocusFromHover(): void {
    cancelDeferredPanelRevealOnly();
    cancelHoverCameraDebounceOnly();
    hoverWardrobeCameraDebounceTimer = window.setTimeout(() => {
      hoverWardrobeCameraDebounceTimer = 0;
      if (deps.getRoute() !== 'creator') return;
      if (deps.getEditMode() !== 'wardrobe') return;
      runWardrobeFocus();
    }, CREATOR_WARDROBE_HOVER_CAMERA_DEBOUNCE_MS);
  }

  function onModeChange(detail: CreatorEditModePayload): void {
    if (deps.getRoute() !== 'creator') return;
    const { mode, previousMode } = detail;
    if ((mode === '3d' || mode === '2d') && previousMode === 'wardrobe') {
      if (!deps.getFocusedCreationEnabled()) return;
      const layer = deps.getWardrobeSelectedLayer();
      const expanded = layer === 'fullOutfit' || layer === 'all';
      deps.setLayersPanelFocusedListExpanded(expanded);
      deps.applyFocusedSoloForWardrobeLayer(layer);
    }
  }

  unsubs.push(creatorWardrobeFocusSlice.subscribe(runWardrobeFocusFromSelection));
  unsubs.push(
    subscribeWardrobeHoverPreview(({ layer, source }) => {
      if (layer == null && source == null) {
        cancelPendingWardrobeHoverUx();
        if (deps.getFocusedCreationEnabled()) {
          startRestoreCameraThenRevealDeferredPanels();
        } else {
          runWardrobeFocus();
        }
        return;
      }
      if (source === 'layerPanel' && layer != null) {
        const selectedLayer = deps.getWardrobeSelectedLayer();
        const isSelectedOrSameDualPair =
          layer === selectedLayer || areWardrobeLayersSameDualLibraryPair(layer, selectedLayer);
        if (isSelectedOrSameDualPair) {
          cancelPendingWardrobeHoverUx();
          runWardrobeFocus();
          return;
        }
        scheduleWardrobeFocusFromHover();
        return;
      }

      // Non-layer-panel hover sources (e.g. selector strips) remain immediate for responsiveness.
      cancelPendingWardrobeHoverUx();
      runWardrobeFocus();
    })
  );
  unsubs.push(
    creatorModeSlice.subscribe((detail) => {
      onModeChange(detail);
      if (detail.mode === 'wardrobe') runWardrobeFocusFromSelection();
    })
  );
  unsubs.push(
    creatorFocusedCreationSlice.subscribe(() => {
      if (deps.getRoute() !== 'creator') return;
      if (deps.getEditMode() === 'wardrobe') runWardrobeFocusFromSelection();
    })
  );

  return {
    dispose: () => {
      cancelPendingWardrobeHoverUx();
      unsubs.forEach((u) => u());
    },
  };
}
