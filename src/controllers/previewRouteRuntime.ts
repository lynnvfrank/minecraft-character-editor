/**
 * Preview route runtime (`#/preview`): composes the requested skin/part onto the primary
 * character, applies the camera preset, and exposes `window.__previewCapture` for the
 * thumbnail capture script. Extracted from main.ts.
 */
import type { SceneContext } from '../viewer/scene';
import { getPreviewPreset } from '../viewer/previewPresets';
import { applySkinToModel, applyCreatorLayerVisibility } from '../viewer/skinApplication';
import { buildLayerVisibleState, loadCachedImage, type SkinCompositor } from '../viewer/skinCompositor';
import type { CharacterState } from './characterTypes';
import type { PreviewCameraController } from './previewCamera';
import type { PreviewRouteController, PreviewRouteInfo, PreviewRouteStateInput } from './previewRoute';

export type PreviewCaptureRuntimeApi = {
  waitUntilReady: (timeoutMs?: number) => Promise<void>;
  setPreviewState: (state: PreviewRouteStateInput) => Promise<PreviewRouteInfo>;
  clearPreviewStateOverride: () => void;
  getPreviewState: () => PreviewRouteInfo;
};

/**
 * Base skin a single part is drawn over: the first preferred candidate that exists,
 * else the first available skin, else the fallback.
 */
export function pickPreviewBaseSkin(
  candidates: readonly string[],
  availablePaths: readonly string[],
  fallback: string | null
): string | null {
  for (const candidate of candidates) {
    if (availablePaths.includes(candidate)) return candidate;
  }
  return availablePaths[0] ?? fallback;
}

export type PreviewRouteRuntimeDeps = {
  routeController: PreviewRouteController;
  camera: PreviewCameraController;
  compositor: SkinCompositor;
  getSceneContext: () => SceneContext | null;
  getPrimaryCharacter: () => CharacterState | undefined;
  isPreviewRoute: () => boolean;
  /** Skin paths from the manifest (may be empty before load). */
  getSkinPaths: () => readonly string[];
  baseSkinCandidates: readonly string[];
  fallbackSkinPath: string | null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function createPreviewRouteRuntime(deps: PreviewRouteRuntimeDeps) {
  /** Signature of the state last applied to the character; null forces a re-apply. */
  let lastAppliedSignature: string | null = null;
  /** Bumped on each sync so a slow image load can't overwrite a newer request. */
  let syncToken = 0;

  function isSceneReady(): boolean {
    const ctx = deps.getSceneContext();
    return deps.isPreviewRoute() && !!deps.getPrimaryCharacter() && !!ctx?.camera && !!ctx?.controls;
  }

  async function waitUntilReady(timeoutMs = 30000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (isSceneReady()) return;
      await sleep(50);
    }
    throw new Error('Preview scene did not become ready in time');
  }

  async function sync(): Promise<void> {
    if (!isSceneReady()) return;
    const char = deps.getPrimaryCharacter()!;

    const info = deps.routeController.getPreviewRouteInfo();
    deps.camera.activate(info);

    if (!info.skinPath) {
      lastAppliedSignature = info.signature;
      return;
    }
    if (lastAppliedSignature === info.signature) return;

    const token = ++syncToken;
    const layerVisible = buildLayerVisibleState(getPreviewPreset(info.cameraPreset).visibleLayers);
    const baseSkinPath = info.part
      ? (info.baseSkinPath ?? pickPreviewBaseSkin(deps.baseSkinCandidates, deps.getSkinPaths(), deps.fallbackSkinPath))
      : info.baseSkinPath;

    const [skinImage, baseImage] = await Promise.all([
      loadCachedImage(info.skinPath),
      baseSkinPath ? loadCachedImage(baseSkinPath).catch(() => null) : Promise.resolve(null),
    ]);
    if (token !== syncToken) return;

    const composed = deps.compositor.composePreviewSkinCanvas(baseImage, skinImage, info.part);
    const masked = deps.compositor.buildLayerMaskedCanvas(composed, layerVisible, {}, 64) ?? composed;

    const texture = deps.compositor.getPreviewTexture(masked);
    applySkinToModel(char.model, texture, char.texturePreset, char.alphaMode, info.skinPath);
    char.currentSkin = info.skinPath;
    applyCreatorLayerVisibility(char.model, layerVisible);
    lastAppliedSignature = info.signature;
  }

  /** Forget what was applied so the next sync re-applies (route change, model swap). */
  function invalidate(): void {
    lastAppliedSignature = null;
  }

  /** Leave the preview route. */
  function exit(): void {
    deps.camera.reset();
    deps.routeController.setPreviewRouteOverride(null);
    invalidate();
  }

  function installCaptureApi(): void {
    const host = window as Window & typeof globalThis & { __previewCapture?: PreviewCaptureRuntimeApi };
    host.__previewCapture = {
      waitUntilReady,
      setPreviewState: async (state) => {
        await waitUntilReady();
        deps.routeController.setPreviewRouteOverride(state);
        const info = deps.routeController.getPreviewRouteInfo();
        await sync();
        await nextAnimationFrame();
        await nextAnimationFrame();
        return info;
      },
      clearPreviewStateOverride: () => {
        deps.routeController.setPreviewRouteOverride(null);
        invalidate();
      },
      getPreviewState: () => deps.routeController.getPreviewRouteInfo(),
    };
  }

  return { sync, invalidate, exit, installCaptureApi };
}

export type PreviewRouteRuntime = ReturnType<typeof createPreviewRouteRuntime>;
