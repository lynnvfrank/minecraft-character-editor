/**
 * Keeps the 3D character's texture in sync with the creator's 2D skin canvas, and runs the
 * per-frame, per-route scene updates. Extracted from main.ts.
 */
import * as THREE from 'three';
import { LAYER_KEYS } from '../skin/layout';
import { applySkinToModel, applyCreatorLayerVisibility } from '../viewer/skinApplication';
import {
  createPixelSkinTexture,
  type LayerPartVisibleState,
  type LayerVisibleState,
  type SkinCompositor,
} from '../viewer/skinCompositor';
import type { AppRoute } from './modes/appModeMachine';
import type { CharacterState } from './characterTypes';

/**
 * Dirty flag that also turns dirty when the route switches into `watchedRoute`
 * (the canvas may have changed while the creator was hidden). Pure, see creatorPreview.test.ts.
 */
export function createRouteDirtyTracker(watchedRoute: AppRoute) {
  let dirty = false;
  let lastRoute: AppRoute | null = null;
  return {
    markDirty(): void {
      dirty = true;
    },
    /** Call once per frame; returns true when work is due for `watchedRoute`. */
    consume(route: AppRoute): boolean {
      const entered = route === watchedRoute && lastRoute !== watchedRoute;
      lastRoute = route;
      if (route !== watchedRoute) return false;
      if (!dirty && !entered) return false;
      dirty = false;
      return true;
    },
  };
}

export type CreatorPreviewDeps = {
  compositor: SkinCompositor;
  getPrimaryCharacter: () => CharacterState | undefined;
  getSkinCanvas: () => HTMLCanvasElement | null;
  getLayerVisible: () => LayerVisibleState;
  getLayerPartVisible: () => LayerPartVisibleState;
  getWorkSize: () => number;
  /** Per-frame work on the preview route (camera debug panel). */
  onPreviewFrame: () => void;
};

export function createCreatorPreviewController(deps: CreatorPreviewDeps) {
  const tracker = createRouteDirtyTracker('creator');
  let fallbackTexture: THREE.CanvasTexture | null = null;

  function updateTexture(): void {
    const canvas = deps.getSkinCanvas();
    const char = deps.getPrimaryCharacter();
    if (!canvas || !char) return;
    fallbackTexture ??= createPixelSkinTexture(canvas);
    const layerVisible = deps.getLayerVisible();
    // Build from a fresh masked copy each time so paint/erase shows immediately
    // (reusing the canvas texture directly can show stale pixels on base layers).
    const texture = deps.compositor.buildVisibilityTexture(
      canvas,
      layerVisible,
      deps.getLayerPartVisible(),
      deps.getWorkSize(),
      fallbackTexture
    );
    applySkinToModel(char.model, texture, 'clamped-flip', 'transparent');
    applyCreatorLayerVisibility(char.model, layerVisible);
  }

  function onFrame(route: AppRoute): void {
    if (tracker.consume(route)) updateTexture();
    if (route === 'preview') {
      deps.onPreviewFrame();
    } else if (route === 'viewer') {
      const char = deps.getPrimaryCharacter();
      if (char) applyCreatorLayerVisibility(char.model, Object.fromEntries(LAYER_KEYS.map((k) => [k, true])));
    }
  }

  return {
    /** Re-upload the creator canvas to the 3D model on the next creator frame. */
    markDirty: tracker.markDirty,
    onFrame,
  };
}

export type CreatorPreviewController = ReturnType<typeof createCreatorPreviewController>;
