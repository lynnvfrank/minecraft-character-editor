/**
 * Main entry point: app orchestration, routing, character/scene setup.
 * See docs/concepts/MODES.md for route vocabulary (viewer, creator, preview).
 */
import './styles/index.scss';
import * as THREE from 'three';

import {
  createAnimationManager,
  type SequenceStep,
  type TurnStrategy,
  type CharacterStateLike,
} from './animation';
import { getPreviewBaseSkinCandidates } from './config/scene.config';
import {
  getUrlSearchParams,
  parseUrlParamsConfig,
  TURN_STRATEGIES,
  parseTurnStrategy,
} from './config/urlParams';
import {
  initCreator,
  getCreatorSkinCanvas,
  loadSkinFromPath,
  getCreatorCanvasPopulated,
  getEditMode,
  setEditMode,
  getCreatorWorkSize,
  getLayer3DVisible,
  getLayer3DPartVisible,
  setActiveTool,
  normalizeLayerStateForNonEditMode,
  unregisterCreatorShortcuts,
  getFocusedCreationEnabled,
  setFocusedCreationEnabled,
  getWardrobeSelectedLayer,
  getWardrobeHoverPreviewLayer,
  applyFocusedSoloForWardrobeLayer,
  setLayersPanelFocusedListExpanded,
  flushDeferredWardrobeLibraryPanelsAfterCamera,
} from './creator';
import { EDIT_MODE_WARDROBE, type EditMode } from './creator/api';
import { createIcon } from './creator/icons';
import { createCharacterController } from './controllers/character';
import {
  type CharacterState,
  buildCharacterConfig,
} from './controllers/characterTypes';
import { createCharacterEventsController } from './controllers/characterEvents';
import { createAnimationLoopController } from './controllers/animationLoop';
import { createCreatorPoseController, type CreatorPoseController } from './controllers/creatorPose';
import { createCreatorCameraController } from './controllers/creatorCameraController';
import {
  createFocusedCreationController,
  type FocusedCreationController,
} from './controllers/focusedCreationController';
import {
  startModeActor,
  getModeActor,
  setApplyRouteCallback,
  setCreatorExitCallback,
  setCreatorShortcutsCleanup,
  syncModeMachineFromHash,
  getRouteInfoFromMachine as getRouteInfo,
  getRouteFromMachine as getRoute,
  parseHashToRouteInfo,
} from './controllers/modes/appModeMachine';
import {
  createPreviewRouteController,
  type PreviewRouteInfo,
  type PreviewRouteStateInput,
} from './controllers/previewRoute';
import { createCreatorTransitionHandler } from './controllers/transitions/creatorTransitionHandler';
import { createViewerUIController } from './controllers/viewerUI';
import { setupTestControls, setFacingLogContextProvider } from './debug';
import type { SkinEntry, AnimationEntry } from './domain';
import { getPrimaryCharacterId } from './domain';
import {
  creatorCanvasSlice,
  creatorLayerSlice,
  creatorModeSlice,
  creatorSkinLoadSlice,
} from './state/creatorSlices';
import { logger, easeOutCubic } from './lib';
import { createSocketManager, createCharacterAI } from './services';
import {
  preprocessSkinTexture,
  ARM_MODEL_PATHS,
  detectArmModelFromRGBA,
  readArmModelSetting,
  writeArmModelSetting,
  type ArmModel,
} from './skin';
import { registerArmModelPanelContext } from './creator/armModelPanel';
import { createPreviewCameraController } from './controllers/previewCamera';
import { createArmModelState } from './state/armModelState';
import { initTheme } from './ui/theme';
import { initAboutPanel } from './ui/aboutPanel';
import { LAYER_KEYS } from './skin';
import {
  initElectronStatus,
} from './ui';
import { linearToSrgb } from './viewer/captureHelpers';
import { createSkinCompositor, buildLayerVisibleState, loadCachedImage } from './viewer/skinCompositor';
import { registerCapture3DThumbnail, registerCapture3DPartThumbnail } from './viewer/capture3DThumbnail';
import {
  initScene as initViewerScene,
  applyShadowToModel,
  logModelUVInfo,
  logMeshNames,
  createDebugTexture,
  applySkinToModel,
  applyCreatorLayerVisibility,
  applyCreatorLayerVisibilityForCapture,
  setupCreator3DPaint,
  setupCreatorCameraLight,
  updateOrbitControlsForEditMode,
  recreateOrbitControls,
  getPreviewPreset,
  type PreviewPresetKey,
  type SceneContext,
  type TexturePreset,
  type AlphaMode,
} from './viewer';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const FALLBACK_SKINS: SkinEntry[] = [
  { path: '/wardrobe/skins/RunningboyRig.png', label: 'Default' }
];

const FALLBACK_ANIMATIONS: AnimationEntry[] = [
  { path: '/animations/animations.glb', key: 'bored', label: 'Bored' },
  { path: '/animations/animations.glb', key: 'crying', label: 'Crying' }
];

const USE_DEBUG_TEXTURE = false;

/** When true, log mesh names and UV bounds to console on model load */
const LOG_MODEL_INFO = false;

const params = getUrlSearchParams();
const urlConfig = parseUrlParamsConfig(params);
const DEFAULT_SCENE_FOV = urlConfig.defaultSceneFov;
const isTestMode = urlConfig.isTestMode;
const SHOW_PREVIEW_CAMERA_CONTROLS = urlConfig.showPreviewCameraControls;
const CREATOR_IDLE_TRANSITION_MIN_DURATION_SEC = urlConfig.creatorIdleTransitionMinDurationSec;
let turnStrategy: TurnStrategy = parseTurnStrategy(params);
const CREATOR_CAMERA_TARGET = new THREE.Vector3(0, 1, 0);
const CREATOR_CAMERA_POSITION = new THREE.Vector3(0, 1.5, 4);
const CREATOR_REFERENCE_CHARACTER_POSITION = new THREE.Vector3(0, 0, 0);
const CREATOR_CAMERA_OFFSET_FROM_CHARACTER = CREATOR_CAMERA_POSITION
  .clone()
  .sub(CREATOR_REFERENCE_CHARACTER_POSITION);
const CREATOR_TARGET_OFFSET_FROM_CHARACTER = CREATOR_CAMERA_TARGET
  .clone()
  .sub(CREATOR_REFERENCE_CHARACTER_POSITION);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type AppRoute = 'creator' | 'viewer' | 'preview';
type RouteInfo = { route: AppRoute; creatorMode: EditMode | null };
/** Extended scene context with typed characters. Populated in main() after initViewerScene. */
type AppSceneContext = SceneContext & { characters: Record<string, CharacterState> };
type PreviewCaptureRuntimeApi = {
  waitUntilReady: (timeoutMs?: number) => Promise<void>;
  setPreviewState: (state: PreviewRouteStateInput) => Promise<PreviewRouteInfo>;
  clearPreviewStateOverride: () => void;
  getPreviewState: () => PreviewRouteInfo;
};
/** Composite sequences loaded from /sequences/index.json */
type Sequence = { id: string; label: string; steps: SequenceStep[] };
// -----------------------------------------------------------------------------
// Module state (mutable refs resolved during init)
// -----------------------------------------------------------------------------

/** Resolved after main() creates the transition handler. */
let getCreatorTransitionInFlight: () => boolean = () => false;
let lastAppliedRouteInfo: RouteInfo | null = null;

const PREVIEW_BASE_SKIN_CANDIDATES = getPreviewBaseSkinCandidates(FALLBACK_SKINS[0]?.path);

const previewRouteController = createPreviewRouteController(
  () => (typeof window !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams())
);

// -----------------------------------------------------------------------------
// Route and layout helpers
// -----------------------------------------------------------------------------

function getCreatorHash(mode: EditMode = EDIT_MODE_WARDROBE): string {
  return `#/creator/${mode}`;
}

let sceneContext: AppSceneContext | null = null;

function getSceneContext(): AppSceneContext {
  if (!sceneContext) throw new Error('Scene not initialized');
  return sceneContext;
}

let getCharacter: (id: string) => CharacterState | undefined = (id) =>
  sceneContext?.characters[id] as CharacterState | undefined;
/** Set by main() from characterController. Used by resumeHomeMode and other callbacks. */
let fadeToAction: (char: CharacterStateLike, action: THREE.AnimationAction, duration?: number) => void = () => {};

let animationManager: ReturnType<typeof createAnimationManager> | null = null;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function logTransition(stage: string, extra: Record<string, unknown> = {}) {
  const char = getCharacter(getPrimaryCharacterId());
  const payload: Record<string, unknown> = {
    route: getRoute(),
    ...extra
  };
  if (char) {
    payload.characterPos = {
      x: Number(char.container.position.x.toFixed(3)),
      y: Number(char.container.position.y.toFixed(3)),
      z: Number(char.container.position.z.toFixed(3))
    };
    payload.characterYawDeg = Number(THREE.MathUtils.radToDeg(char.model.rotation.y).toFixed(1));
    if (char.currentAction) {
      payload.currentAction = Object.entries(char.actions).find(([, a]) => a === char.currentAction)?.[0] ?? 'unknown';
      payload.actionTime = Number(char.currentAction.time.toFixed(3));
      payload.actionDuration = Number((char.currentAction.getClip()?.duration ?? 0).toFixed(3));
    }
  }
  const ctx = sceneContext;
  if (ctx && ctx.camera && ctx.controls) {
    payload.cameraPos = {
      x: Number(ctx.camera.position.x.toFixed(3)),
      y: Number(ctx.camera.position.y.toFixed(3)),
      z: Number(ctx.camera.position.z.toFixed(3))
    };
    payload.cameraTarget = {
      x: Number(ctx.controls.target.x.toFixed(3)),
      y: Number(ctx.controls.target.y.toFixed(3)),
      z: Number(ctx.controls.target.z.toFixed(3))
    };
  }
  logger.info('transition', stage, payload);
}

function updateRouteButtonsState() {
  const inFlight = getCreatorTransitionInFlight();
  const designBtn = document.getElementById('enter-creator-btn') as HTMLButtonElement | null;
  const homeBtn = document.getElementById('enter-viewer-btn') as HTMLButtonElement | null;
  if (designBtn) {
    designBtn.disabled = inFlight;
    const textEl = designBtn.querySelector('.creator-home-btn-text');
    if (textEl) textEl.textContent = inFlight ? 'Designing...' : 'Design';
  }
  if (homeBtn) {
    homeBtn.disabled = inFlight;
    const textEl = homeBtn.querySelector('.creator-home-btn-text');
    if (textEl) textEl.textContent = 'Home';
  }
}

let creatorPoseController: CreatorPoseController;
let focusedCreationController: FocusedCreationController | null = null;
let characterController: ReturnType<typeof createCharacterController>;
let viewerUIController: ReturnType<typeof createViewerUIController>;
let characterEventsController: ReturnType<typeof createCharacterEventsController>;
let animationLoopController: ReturnType<typeof createAnimationLoopController>;

function setupCreatorTransitionButton(
  transitionHandler: { enterCreator: () => Promise<void> }
) {
  const btn = document.getElementById('enter-creator-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const icon = createIcon('modeCreator', { width: 22, height: 22 });
  const span = document.createElement('span');
  span.className = 'creator-home-btn-text';
  span.textContent = 'Design';
  btn.textContent = '';
  btn.appendChild(icon);
  btn.appendChild(span);
  btn.addEventListener('click', () => {
    void transitionHandler.enterCreator();
  });
  updateRouteButtonsState();
}

function resumeHomeMode() {
  const char = getCharacter(getPrimaryCharacterId());
  if (char?.idleAction) {
    char.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    char.idleAction.clampWhenFinished = false;
    fadeToAction(char, char.idleAction, 0.3);
  }
  const reacted = characterAI?.onUserActivity(true) ?? false;
  if (!reacted) {
    animationManager?.runOneWanderStep?.();
  }
}

const CREATOR_EXIT_ANIMATION_MS = 450;

function setupViewerTransitionButton(
  transitionHandler: { exitCreator: () => Promise<void> }
) {
  const btn = document.getElementById('enter-viewer-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const icon = createIcon('modeHome', { width: 22, height: 22 });
  const span = document.createElement('span');
  span.className = 'creator-home-btn-text';
  span.textContent = 'Home';
  btn.textContent = '';
  btn.appendChild(icon);
  btn.appendChild(span);
  btn.addEventListener('click', () => {
    void transitionHandler.exitCreator();
  });
  updateRouteButtonsState();
}

function ensureViewerFullWidthLayout() {
  const app = document.getElementById('app');
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!app || !wrapper) return;
  if (app.parentElement !== wrapper) {
    wrapper.appendChild(app);
  }
  onWindowResize();
}

function applyRoute(routeInfo?: RouteInfo): void {
  const info = routeInfo ?? getRouteInfo();
  const route = info.route;
  document.body.dataset.route = route;
  if (route === 'creator') {
    previewCamera.reset();
    previewRouteController.setPreviewRouteOverride(null);
    lastAppliedPreviewSignature = null;
    const desiredMode = info.creatorMode ?? EDIT_MODE_WARDROBE;
    if (lastAppliedRouteInfo?.route === 'creator') {
      if (getEditMode() !== desiredMode) {
        setEditMode(desiredMode, { syncUrl: false });
        updateCreator3DViewPlacement();
      }
      updateRouteButtonsState();
      lastAppliedRouteInfo = info;
      return;
    }
    if (getEditMode() !== desiredMode) {
      setEditMode(desiredMode, { syncUrl: false });
    }
    creatorPoseController.applyCreatorCharacterPose();
    initCreator();
    // Re-apply creator layout for current mode (especially when returning in 2D).
    updateCreator3DViewPlacement();
    const mode = getEditMode();
    if (mode === '3d' || mode === '2d') {
      requestAnimationFrame(() => {
        if (getRoute() === 'creator' && getEditMode() === mode) {
          creatorPoseController.applyCreatorCharacterPose();
        }
      });
    }
    window.setTimeout(() => {
      const entryMode = getEditMode();
      if (
        entryMode === EDIT_MODE_WARDROBE &&
        getFocusedCreationEnabled() &&
        getRoute() === 'creator'
      ) {
        const char = getCharacter(getPrimaryCharacterId());
        if (char) {
          const preset = getPreviewPreset('fullOutfit');
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
          try {
            const ctx = getSceneContext();
            ctx.camera.fov = preset.fov ?? 35;
            ctx.camera.updateProjectionMatrix();
          } catch {
            // scene not ready
          }
          creatorPoseController.snapCameraToCreatorView({ position, target });
        } else {
          creatorPoseController.snapCameraToCreatorView(creatorPoseController.getCreatorCameraPose());
        }
      } else {
        creatorPoseController.snapCameraToCreatorView(creatorPoseController.getCreatorCameraPose());
      }
    }, 0);
    window.setTimeout(() => {
      updateCreator3DViewPlacement();
      window.dispatchEvent(new Event('resize'));
      const c = getCharacter(getPrimaryCharacterId());
      if (c?.currentSkin) {
        const shouldLoad = !getCreatorCanvasPopulated() || c.currentSkin !== lastCreatorLoadedPath;
        if (shouldLoad) {
          loadSkinFromPath(c.currentSkin);
          lastCreatorLoadedPath = c.currentSkin;
        }
      }
    }, 0);
  } else if (route === 'preview') {
    ensureViewerFullWidthLayout();
    creatorPoseController.lockCharacterToCreatorIdle();
    window.setTimeout(() => {
      void syncPreviewRouteState();
      window.dispatchEvent(new Event('resize'));
    }, 0);
  } else {
    ensureViewerFullWidthLayout();
    previewCamera.reset();
    previewRouteController.setPreviewRouteOverride(null);
    lastAppliedPreviewSignature = null;
    resumeHomeMode();
  }
  updateRouteButtonsState();
  lastAppliedRouteInfo = info;
}

// -----------------------------------------------------------------------------
// Bootstrap: DOM check, mode machine, initial route
// -----------------------------------------------------------------------------

const container = document.getElementById('three-canvas-container');

if (!container) {
  throw new Error('Missing #three-canvas-container element in DOM.');
}

let skinsList: SkinEntry[] = [];
let animationsList: AnimationEntry[] = [];
let sequencesList: Sequence[] = [];
let socketManager: ReturnType<typeof createSocketManager> | null = null;
let characterAI: ReturnType<typeof createCharacterAI> | null = null;

// Defer initial routing until after module evaluation finishes.
// `applyRoute()` may touch preview-related vars/functions that are declared later in this file,
// and deferring avoids temporal-dead-zone runtime errors during initial load.
setApplyRouteCallback(applyRoute);
setCreatorExitCallback(() => {
  normalizeLayerStateForNonEditMode();
  setActiveTool('navigate');
});
setCreatorShortcutsCleanup(unregisterCreatorShortcuts);
startModeActor();
const modeActor = getModeActor();
if (modeActor) {
  modeActor.subscribe((snapshot) => {
    logger.debug('stateMachine', 'Mode changed', { value: snapshot.value, context: snapshot.context });
  });
}
window.setTimeout(() => {
  const routeInfo = parseHashToRouteInfo();
  if (!syncModeMachineFromHash(routeInfo)) {
    applyRoute(routeInfo);
  }
}, 0);
window.addEventListener('hashchange', () => {
  syncModeMachineFromHash(parseHashToRouteInfo());
});

// -----------------------------------------------------------------------------
// User activity (idle/wander)
// -----------------------------------------------------------------------------

/** Throttled user activity. Mousemove = non-explicit (doesn't block wandering). Keys/clicks = explicit. */
function setupUserActivityListeners() {
  let lastMouseReport = 0;
  const MOUSE_THROTTLE_MS = 200;

  document.addEventListener('mousemove', () => {
    if (getRoute() !== 'viewer') return;
    const now = Date.now();
    if (now - lastMouseReport < MOUSE_THROTTLE_MS) return;
    lastMouseReport = now;
    characterAI?.onUserActivity(false);
  });
  document.addEventListener('keydown', () => {
    if (getRoute() !== 'viewer') return;
    characterAI?.onUserActivity(true);
  });
}

function onWindowResize() {
  const ctx = sceneContext;
  if (!ctx || !ctx.container || !ctx.camera || !ctx.renderer) return;
  const width = ctx.container.clientWidth;
  const height = ctx.container.clientHeight;
  ctx.camera.aspect = width / height;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(width, height);
  logger.debug('renderer', 'Resize', { width, height });
}

let creatorPreviewTexture: THREE.CanvasTexture | null = null;
let creatorPreviewDirty = false;
let lastRouteForPreview = '';
/** Path last loaded into creator (from gallery or route enter). Used to know when to reload from char.currentSkin (user picked different skin in home). */
let lastCreatorLoadedPath: string | null = null;
let lastAppliedPreviewSignature: string | null = null;
let previewRouteSyncToken = 0;
const skinCompositor = createSkinCompositor();
const previewCamera = createPreviewCameraController({
  getSceneContext: () => sceneContext,
  defaultFov: DEFAULT_SCENE_FOV,
  showDebugPanel: SHOW_PREVIEW_CAMERA_CONTROLS,
  isPreviewRoute: () => getRoute() === 'preview',
});
const focusAutoDisableBoundControls = new WeakSet<object>();
let lastCreatorCameraInputWasMouse = false;

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function bindFocusedModeAutoDisableOnMouseCameraMove(): void {
  const ctx = sceneContext;
  if (!ctx?.renderer || !ctx?.controls) return;
  const canvas = ctx.renderer.domElement;
  if (!canvas) return;

  // OrbitControls start does not describe the input device, so we infer it from recent DOM input.
  const markMouseInput = () => {
    lastCreatorCameraInputWasMouse = true;
  };
  const markNonMouseInput = () => {
    lastCreatorCameraInputWasMouse = false;
  };

  if (!canvas.dataset.focusedMouseInputBound) {
    canvas.dataset.focusedMouseInputBound = '1';
    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.pointerType === 'mouse') markMouseInput();
      else markNonMouseInput();
    });
    canvas.addEventListener('mousedown', markMouseInput);
    canvas.addEventListener('wheel', markMouseInput, { passive: true });
    canvas.addEventListener('touchstart', markNonMouseInput, { passive: true });
  }

  const controlsObj = ctx.controls as object & {
    addEventListener?: (type: string, listener: () => void) => void;
  };
  if (focusAutoDisableBoundControls.has(controlsObj)) return;
  focusAutoDisableBoundControls.add(controlsObj);
  controlsObj.addEventListener?.('start', () => {
    if (!lastCreatorCameraInputWasMouse) return;
    if (getRoute() !== 'creator') return;
    const mode = getEditMode();
    if (mode !== 'wardrobe' && mode !== '3d') return;
    if (!getFocusedCreationEnabled()) return;
    setFocusedCreationEnabled(false);
  });
}

async function waitForPreviewSceneReady(timeoutMs: number = 30000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (getRoute() === 'preview' && !!getCharacter(getPrimaryCharacterId()) && !!sceneContext?.camera && !!sceneContext?.controls) {
      return;
    }
    await sleep(50);
  }
  throw new Error('Preview scene did not become ready in time');
}

function getPreferredPreviewBaseSkinPath(): string | null {
  for (const candidate of PREVIEW_BASE_SKIN_CANDIDATES) {
    if (skinsList.some((skin) => skin.path === candidate)) return candidate;
  }
  return skinsList[0]?.path ?? FALLBACK_SKINS[0]?.path ?? null;
}

// -----------------------------------------------------------------------------
// Preview route: skin composition, camera, capture
// -----------------------------------------------------------------------------

function applyPreviewTextureFromCanvas(char: CharacterState, canvas: HTMLCanvasElement, skinPath: string): void {
  const texture = skinCompositor.getPreviewTexture(canvas);
  applySkinToModel(char.model, texture, char.texturePreset, char.alphaMode, skinPath);
  char.currentSkin = skinPath;
}

function installPreviewCaptureRuntimeApi(): void {
  const host = window as Window & typeof globalThis & {
    __previewCapture?: PreviewCaptureRuntimeApi;
  };
  host.__previewCapture = {
    waitUntilReady: async (timeoutMs?: number) => {
      await waitForPreviewSceneReady(timeoutMs);
    },
    setPreviewState: async (state: PreviewRouteStateInput) => {
      await waitForPreviewSceneReady();
      previewRouteController.setPreviewRouteOverride(state);
      const previewInfo = previewRouteController.getPreviewRouteInfo();
      await syncPreviewRouteState();
      await nextAnimationFrame();
      await nextAnimationFrame();
      return previewInfo;
    },
    clearPreviewStateOverride: () => {
      previewRouteController.setPreviewRouteOverride(null);
      lastAppliedPreviewSignature = null;
    },
    getPreviewState: () => previewRouteController.getPreviewRouteInfo(),
  };
}

async function syncPreviewRouteState(): Promise<void> {
  if (getRoute() !== 'preview') return;
  const ctx = sceneContext;
  const char = getCharacter(getPrimaryCharacterId());
  if (!char || !ctx?.camera || !ctx?.controls) return;

  const previewInfo = previewRouteController.getPreviewRouteInfo();
  previewCamera.activate(previewInfo);

  if (!previewInfo.skinPath) {
    lastAppliedPreviewSignature = previewInfo.signature;
    return;
  }
  if (lastAppliedPreviewSignature === previewInfo.signature) return;

  const token = ++previewRouteSyncToken;
  const preset = getPreviewPreset(previewInfo.cameraPreset);
  const layerVisible = buildLayerVisibleState(preset.visibleLayers);
  const baseSkinPath = previewInfo.part
    ? (previewInfo.baseSkinPath ?? getPreferredPreviewBaseSkinPath())
    : previewInfo.baseSkinPath;

  const [skinImage, baseImage] = await Promise.all([
    loadCachedImage(previewInfo.skinPath),
    baseSkinPath ? loadCachedImage(baseSkinPath).catch(() => null) : Promise.resolve(null),
  ]);
  if (token !== previewRouteSyncToken) return;

  const composedCanvas = skinCompositor.composePreviewSkinCanvas(baseImage, skinImage, previewInfo.part);
  const maskedCanvas = skinCompositor.buildLayerMaskedCanvas(composedCanvas, layerVisible, {}, 64) ?? composedCanvas;
  if (token !== previewRouteSyncToken) return;

  applyPreviewTextureFromCanvas(char, maskedCanvas, previewInfo.skinPath);
  applyCreatorLayerVisibility(char.model, layerVisible);
  lastAppliedPreviewSignature = previewInfo.signature;
}

// -----------------------------------------------------------------------------
// Creator: 3D view placement and preview texture
// -----------------------------------------------------------------------------

function updateCreator3DViewPlacement() {
  if (getRoute() !== 'creator' || !sceneContext) return;
  const app = document.getElementById('app');
  const wrapper = document.getElementById('creator-view-wrapper');
  const slot = document.getElementById('creator-3d-preview-slot');
  if (!app || !wrapper || !slot) return;
  const mode = getEditMode();
  const show3DInMainArea = mode === '3d' || mode === 'wardrobe';
  if (show3DInMainArea) {
    const ctx = sceneContext;
    if (app.parentElement !== wrapper) {
      wrapper.appendChild(app);
      const prevControls = ctx.controls;
      ctx.controls = recreateOrbitControls(ctx.camera, ctx.renderer, prevControls);
      prevControls.dispose();
      updateOrbitControlsForEditMode(ctx.controls, getRoute);
      bindFocusedModeAutoDisableOnMouseCameraMove();
    }
    onWindowResize();
  } else {
    if (app.parentElement !== slot) {
      slot.appendChild(app);
    }
    onWindowResize();
  }
}

function updateCreatorPreviewTexture() {
  if (getRoute() !== 'creator') return;
  const canvas = getCreatorSkinCanvas();
  const char = getCharacter(getPrimaryCharacterId());
  if (!canvas || !char) return;
  if (!creatorPreviewTexture) {
    creatorPreviewTexture = new THREE.CanvasTexture(canvas);
    creatorPreviewTexture.colorSpace = THREE.SRGBColorSpace;
    creatorPreviewTexture.magFilter = THREE.NearestFilter;
    creatorPreviewTexture.minFilter = THREE.NearestFilter;
    creatorPreviewTexture.generateMipmaps = false;
    creatorPreviewTexture.wrapS = creatorPreviewTexture.wrapT = THREE.ClampToEdgeWrapping;
    creatorPreviewTexture.flipY = true;
  }
  const layerVisible = getLayer3DVisible();
  const layerPartVisible = getLayer3DPartVisible();
  // Always build texture from fresh canvas copy so eraser/paint updates show immediately
  // (direct creatorPreviewTexture can show stale pixels on base layers due to GPU/Three.js caching)
  const textureToUse = skinCompositor.buildVisibilityTexture(canvas, layerVisible, layerPartVisible, getCreatorWorkSize(), creatorPreviewTexture!);

  applySkinToModel(char.model, textureToUse, 'clamped-flip' as TexturePreset, 'transparent' as AlphaMode);
  applyCreatorLayerVisibility(char.model, layerVisible);
}

function setupCreatorPreviewDirtySubscription(): void {
  const markDirty = () => { creatorPreviewDirty = true; };

  creatorCanvasSlice.subscribe(() => markDirty());
  creatorLayerSlice.subscribe(() => markDirty());
  creatorModeSlice.subscribe((detail) => {
    if (getRoute() !== 'creator') return;
    creatorPoseController.applyCreatorCharacterPose(detail);
  });
  creatorSkinLoadSlice.subscribe((detail) => {
    markDirty();
    setDetectedArmModel(detectArmModelFromCanvas(getCreatorSkinCanvas()));
    const path = detail.path;
    if (typeof path === 'string') {
      const char = getCharacter(getPrimaryCharacterId());
      if (char) {
        char.currentSkin = path;
        lastCreatorLoadedPath = path;
        viewerUIController.highlightActiveSkin(getPrimaryCharacterId(), path);
      }
    }
  });
}

function createOnFrameUpdate() {
  return (route: 'creator' | 'viewer' | 'preview') => {
    if (route === 'creator') {
      if (lastRouteForPreview !== 'creator') creatorPreviewDirty = true;
      lastRouteForPreview = 'creator';
      if (creatorPreviewDirty) {
        updateCreatorPreviewTexture();
        creatorPreviewDirty = false;
      }
    } else if (route === 'preview') {
      lastRouteForPreview = 'preview';
      previewCamera.update();
    } else {
      lastRouteForPreview = route;
      const char = getCharacter(getPrimaryCharacterId());
      if (char) {
        const allVisible = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));
        applyCreatorLayerVisibility(char.model, allVisible);
      }
    }
  };
}

// -----------------------------------------------------------------------------
// Exported capture API (used by creator for gallery thumbnails)
// -----------------------------------------------------------------------------

/**
 * Capture a thumbnail of the 3D character with the current creator skin.
 * Uses a separate camera so the main 3D view is never modified.
 * Uses fullOutfit preset to match preview-generated thumbnails.
 */
export async function captureCreator3DThumbnail(size: number = 128): Promise<string | null> {
  const ctx = sceneContext;
  const char = getCharacter(getPrimaryCharacterId());
  if (!char || !ctx || !ctx.renderer || !ctx.scene || !ctx.container) return null;

  creatorPreviewDirty = true;
  await nextAnimationFrame();
  await nextAnimationFrame();

  const preset = getPreviewPreset('fullOutfit');
  const capturePos = new THREE.Vector3(
    preset.cameraPosition.x,
    preset.cameraPosition.y,
    preset.cameraPosition.z
  );
  const captureTarget = new THREE.Vector3(
    preset.cameraTarget.x,
    preset.cameraTarget.y,
    preset.cameraTarget.z
  );

  const captureCamera = new THREE.PerspectiveCamera(
    preset.fov ?? 35,
    1,
    0.1,
    100
  );
  captureCamera.position.copy(capturePos);
  captureCamera.lookAt(captureTarget);
  captureCamera.updateProjectionMatrix();

  const renderTarget = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  ctx.renderer.setRenderTarget(renderTarget);
  ctx.renderer.setViewport(0, 0, size, size);
  ctx.renderer.setScissor(0, 0, size, size);
  ctx.renderer.setScissorTest(true);
  ctx.renderer.render(ctx.scene, captureCamera);
  ctx.renderer.setScissorTest(false);
  ctx.renderer.setRenderTarget(null);

  const w = ctx.container.clientWidth;
  const h = ctx.container.clientHeight;
  ctx.renderer.setViewport(0, 0, w, h);
  ctx.renderer.setScissor(0, 0, w, h);
  ctx.renderer.setScissorTest(false);

  const pixels = new Uint8Array(size * size * 4);
  ctx.renderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, pixels);
  renderTarget.dispose();

  const outCanvas = document.createElement('canvas');
  outCanvas.width = size;
  outCanvas.height = size;
  const canvasCtx = outCanvas.getContext('2d');
  if (!canvasCtx) return null;

  const imgData = canvasCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    for (let x = 0; x < size; x++) {
      const src = srcRow + x * 4;
      const dst = dstRow + x * 4;
      const r = pixels[src]! / 255;
      const g = pixels[src + 1]! / 255;
      const b = pixels[src + 2]! / 255;
      const a = pixels[src + 3]! / 255;
      imgData.data[dst] = Math.round(linearToSrgb(r) * 255);
      imgData.data[dst + 1] = Math.round(linearToSrgb(g) * 255);
      imgData.data[dst + 2] = Math.round(linearToSrgb(b) * 255);
      imgData.data[dst + 3] = Math.round(a * 255);
    }
  }
  canvasCtx.putImageData(imgData, 0, 0);
  return outCanvas.toDataURL('image/png');
}

/**
 * Capture a per-part thumbnail of the 3D character using the part's preview preset.
 * Uses part-specific camera and layer visibility so only relevant layers are shown.
 */
export async function captureCreator3DPartThumbnail(
  part: PreviewPresetKey,
  size: number = 128
): Promise<string | null> {
  const ctx = sceneContext;
  const char = getCharacter(getPrimaryCharacterId());
  if (!char || !ctx || !ctx.renderer || !ctx.scene || !ctx.container) return null;

  const preset = getPreviewPreset(part);
  const layerVisible = buildLayerVisibleState(preset.visibleLayers);
  const canvas = getCreatorSkinCanvas();
  const workSize = getCreatorWorkSize();
  const maskedCanvas = skinCompositor.buildLayerMaskedCanvas(canvas, layerVisible, {}, workSize);
  if (!maskedCanvas) return null;

  creatorPreviewDirty = true;
  await nextAnimationFrame();
  await nextAnimationFrame();

  const captureTexture = new THREE.CanvasTexture(maskedCanvas);
  captureTexture.colorSpace = THREE.SRGBColorSpace;
  captureTexture.magFilter = THREE.NearestFilter;
  captureTexture.minFilter = THREE.NearestFilter;
  captureTexture.generateMipmaps = false;
  captureTexture.wrapS = captureTexture.wrapT = THREE.ClampToEdgeWrapping;
  captureTexture.flipY = true;

  applySkinToModel(char.model, captureTexture, char.texturePreset, char.alphaMode, char.currentSkin);
  applyCreatorLayerVisibilityForCapture(char.model, layerVisible, char.modelPath);

  const capturePos = new THREE.Vector3(
    preset.cameraPosition.x,
    preset.cameraPosition.y,
    preset.cameraPosition.z
  );
  const captureTarget = new THREE.Vector3(
    preset.cameraTarget.x,
    preset.cameraTarget.y,
    preset.cameraTarget.z
  );
  const captureCamera = new THREE.PerspectiveCamera(
    preset.fov ?? 35,
    1,
    0.1,
    100
  );
  captureCamera.position.copy(capturePos);
  captureCamera.lookAt(captureTarget);
  captureCamera.updateProjectionMatrix();

  const renderTarget = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  ctx.renderer.setRenderTarget(renderTarget);
  ctx.renderer.setViewport(0, 0, size, size);
  ctx.renderer.setScissor(0, 0, size, size);
  ctx.renderer.setScissorTest(true);
  ctx.renderer.render(ctx.scene, captureCamera);
  ctx.renderer.setScissorTest(false);
  ctx.renderer.setRenderTarget(null);

  const w = ctx.container.clientWidth;
  const h = ctx.container.clientHeight;
  ctx.renderer.setViewport(0, 0, w, h);
  ctx.renderer.setScissor(0, 0, w, h);
  ctx.renderer.setScissorTest(false);

  const pixels = new Uint8Array(size * size * 4);
  ctx.renderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, pixels);
  renderTarget.dispose();
  captureTexture.dispose();

  applyCreatorLayerVisibility(char.model, {});

  const outCanvas = document.createElement('canvas');
  outCanvas.width = size;
  outCanvas.height = size;
  const canvasCtx = outCanvas.getContext('2d');
  if (!canvasCtx) return null;

  const imgData = canvasCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    for (let x = 0; x < size; x++) {
      const src = srcRow + x * 4;
      const dst = dstRow + x * 4;
      const r = pixels[src]! / 255;
      const g = pixels[src + 1]! / 255;
      const b = pixels[src + 2]! / 255;
      const a = pixels[src + 3]! / 255;
      imgData.data[dst] = Math.round(linearToSrgb(r) * 255);
      imgData.data[dst + 1] = Math.round(linearToSrgb(g) * 255);
      imgData.data[dst + 2] = Math.round(linearToSrgb(b) * 255);
      imgData.data[dst + 3] = Math.round(a * 255);
    }
  }
  canvasCtx.putImageData(imgData, 0, 0);

  creatorPreviewDirty = true;
  return outCanvas.toDataURL('image/png');
}

// -----------------------------------------------------------------------------
// Arm model (slim / classic): user setting + auto-detect from the current skin
// -----------------------------------------------------------------------------

const armModelState = createArmModelState({
  initialSetting: readArmModelSetting(),
  persist: writeArmModelSetting,
});

/** Swap the primary character's rig when the resolved arm model changes. */
function applyArmModelToCharacter(): void {
  if (!characterController) return;
  const char = getCharacter(getPrimaryCharacterId());
  if (!char) return;
  const path = ARM_MODEL_PATHS[armModelState.getResolved()];
  if (char.modelPath === path) return;
  void characterController.setModel(char.id, path).then(() => {
    creatorPreviewDirty = true;
    lastAppliedPreviewSignature = null;
  });
}
armModelState.subscribe(applyArmModelToCharacter);

function detectArmModelFromCanvas(canvas: HTMLCanvasElement): ArmModel | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectArmModelFromRGBA(data, canvas.width, canvas.height);
}

async function detectArmModelFromPath(path: string): Promise<ArmModel | null> {
  try {
    const img = await loadCachedImage(path);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 64;
    canvas.height = img.naturalHeight || 64;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    return detectArmModelFromCanvas(canvas);
  } catch {
    return null;
  }
}

function setDetectedArmModel(model: ArmModel | null): void {
  armModelState.setDetected(model);
}

registerArmModelPanelContext({
  getSetting: armModelState.getSetting,
  getResolved: armModelState.getResolved,
  setSetting: armModelState.setSetting,
  subscribe: armModelState.subscribe,
});

// -----------------------------------------------------------------------------
// Main initialization
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info('general', 'App started');
  if (!container) throw new Error('Missing #three-canvas-container element in DOM.');

  // Set route attributes immediately so layout is correct before scene init.
  // Prevents 0-size canvas when loading directly to #/creator/3d or #/creator/wardrobe.
  const initialRoute = parseHashToRouteInfo();
  document.body.dataset.route = initialRoute.route;
  if (initialRoute.route === 'creator') {
    document.body.dataset.editMode = initialRoute.creatorMode ?? EDIT_MODE_WARDROBE;
  }

  sceneContext = initViewerScene(container, params) as AppSceneContext;
  initTheme();
  initAboutPanel();
  setupCreatorCameraLight(sceneContext.camera);
  bindFocusedModeAutoDisableOnMouseCameraMove();

  const controllerRefs = {
    creatorPoseController: null as CreatorPoseController | null,
    animationManager: null as ReturnType<typeof createAnimationManager> | null,
    getCharacter: ((id: string) => sceneContext?.characters[id]) as (id: string) => CharacterState | undefined,
    getCreatorTransitionInFlight: (() => false) as () => boolean,
  };

  viewerUIController = createViewerUIController({
    getCharacter: (id) => controllerRefs.getCharacter(id),
    getPrimaryCharacterId,
    getAnimationManager: () => controllerRefs.animationManager,
  });

  characterController = createCharacterController({
    getSceneContext,
    preprocessSkinTexture,
    applySkinToModel,
    applyShadowToModel,
    createDebugTexture: (w, h) => createDebugTexture(w, h),
    logMeshNames,
    logModelUVInfo,
    getSkinsList: () => skinsList,
    getAnimationsList: () => animationsList,
    getRoute,
    onFirstCharacterReady: (skins, anims, sequences) => {
      viewerUIController.setupAnimationButtons(anims);
      viewerUIController.setupSkinPreviews(skins);
      viewerUIController.setupSequenceButtons(sequences as Sequence[]);
    },
    getSequencesList: () => sequencesList,
    onPreviewRouteAfterCharacterReady: () => void syncPreviewRouteState(),
    getCreatorPoseController: () => controllerRefs.creatorPoseController,
    getCreatorTransitionInFlight: () => controllerRefs.getCreatorTransitionInFlight(),
    getAnimationManager: () => controllerRefs.animationManager,
    highlightActiveButton: (charId, action) => viewerUIController.highlightActiveButton(charId, action),
    highlightActiveSkin: (charId, path) => {
      viewerUIController.highlightActiveSkin(charId, path);
      if (armModelState.isAuto()) void detectArmModelFromPath(path).then(setDetectedArmModel);
    },
    useDebugTexture: USE_DEBUG_TEXTURE,
    logModelInfo: LOG_MODEL_INFO,
  });

  controllerRefs.getCharacter = characterController.getCharacter;
  getCharacter = characterController.getCharacter;
  fadeToAction = characterController.fadeToAction;
  const getAction = characterController.getAction;

  animationManager = createAnimationManager({
    getCharacter,
    fadeToAction,
    getAction,
    getCamera: () => sceneContext!.camera,
    clock: sceneContext!.clock,
    getTurnStrategy: () => turnStrategy,
  });
  controllerRefs.animationManager = animationManager;

  creatorPoseController = createCreatorPoseController({
    getCharacter,
    getPrimaryCharacterId,
    getEditMode,
    fadeToAction,
    getSceneContext,
    animationManager,
    creatorCameraTarget: CREATOR_CAMERA_TARGET,
    creatorCameraPosition: CREATOR_CAMERA_POSITION,
    creatorCameraOffsetFromCharacter: CREATOR_CAMERA_OFFSET_FROM_CHARACTER,
    creatorTargetOffsetFromCharacter: CREATOR_TARGET_OFFSET_FROM_CHARACTER,
    creatorIdleTransitionMinDurationSec: CREATOR_IDLE_TRANSITION_MIN_DURATION_SEC,
    easeOutCubic,
  });

  createCreatorCameraController({
    getSceneContext,
    getRoute,
    getEditMode,
    creatorPoseController,
  });

  focusedCreationController?.dispose();
  focusedCreationController = createFocusedCreationController({
    getFocusedCreationEnabled,
    getRoute,
    getEditMode,
    getWardrobeSelectedLayer,
    getWardrobeHoverPreviewLayer,
    applyFocusedSoloForWardrobeLayer,
    setLayersPanelFocusedListExpanded,
    creatorPoseController,
    getCharacter,
    getPrimaryCharacterId,
    getSceneContext,
    flushDeferredWardrobeLibraryPanelsAfterCamera,
  });

  if (getRoute() === 'creator') {
    creatorPoseController.snapCameraToCreatorView();
  } else if (getRoute() === 'preview') {
    const previewInfo = previewRouteController.getPreviewRouteInfo();
    previewCamera.activate(previewInfo);
  }

  let skins: SkinEntry[];
  try {
    const res = await fetch('/wardrobe/skins/index.json');
    const data = await res.json();
    skins = Array.isArray(data) && data.length > 0 ? data : FALLBACK_SKINS;
  } catch {
    skins = FALLBACK_SKINS;
  }
  skinsList = skins;

  let animations: AnimationEntry[];
  try {
    const res = await fetch('/animations/index.json');
    const data = await res.json();
    animations = Array.isArray(data) && data.length > 0 ? data : FALLBACK_ANIMATIONS;
  } catch {
    animations = FALLBACK_ANIMATIONS;
  }
  animationsList = animations;

  let sequences: Sequence[] = [];
  try {
    const seqRes = await fetch('/sequences/index.json');
    const seqData = await seqRes.json();
    sequences = Array.isArray(seqData?.sequences) ? seqData.sequences : [];
  } catch {
    console.warn('[Sequences] Could not load /sequences/index.json');
  }
  sequencesList = sequences;

  socketManager = createSocketManager();

  const creatorTransitionHandler = createCreatorTransitionHandler({
    getRoute,
    getEditMode,
    getCharacter,
    getCurrentActionRemainingSec: creatorPoseController.getCurrentActionRemainingSec,
    applyCreatorCharacterPose: creatorPoseController.applyCreatorCharacterPose,
    getCreatorCameraPose: creatorPoseController.getCreatorCameraPose,
    animateCameraToCreatorView: creatorPoseController.animateCameraToCreatorView,
    normalizeLayerStateForNonEditMode,
    setActiveTool,
    getCreatorHash,
    sleep,
    updateRouteButtonsState,
    logTransition,
    animationManager,
    resumeHomeMode,
    CREATOR_EXIT_ANIMATION_MS
  });
  controllerRefs.creatorPoseController = creatorPoseController;
  controllerRefs.getCreatorTransitionInFlight = creatorTransitionHandler.getTransitionInFlight;
  getCreatorTransitionInFlight = creatorTransitionHandler.getTransitionInFlight;
  setupCreatorTransitionButton(creatorTransitionHandler);
  setupViewerTransitionButton(creatorTransitionHandler);

  characterEventsController = createCharacterEventsController({
    getCharacter,
    getPrimaryCharacterId,
    getRoute,
    getCreatorTransitionInFlight,
    resolveSkinByName: characterController.resolveSkinByName,
    switchSkin: characterController.switchSkin,
    getAction,
    fadeToAction,
    getCharacterAI: () => characterAI,
    animationManager,
    highlightActiveButton: viewerUIController.highlightActiveButton,
  });

  if (isTestMode) {
    animationLoopController = createAnimationLoopController({
      getSceneContext,
      getRoute,
      getCreatorTransitionInFlight,
      getCharacter,
      getPrimaryCharacterId,
      animationManager,
      characterAI: null,
      onFrameUpdate: createOnFrameUpdate(),
    });
    setupTestControls({
      animationManager,
      getCharacter,
      getCamera: () => sceneContext!.camera,
      setPaused: animationLoopController.setPaused,
      isPaused: animationLoopController.isPaused,
      stepOneFrame: animationLoopController.stepOneFrame,
      turnStrategy,
      setTurnStrategy: (s) => { turnStrategy = s; },
      turnStrategies: TURN_STRATEGIES
    });
  } else {
    characterAI = createCharacterAI({
      getCharacter,
      fadeToAction,
      getAction,
      getCamera: () => sceneContext!.camera,
      getClock: () => sceneContext!.clock,
      animationManager: animationManager!
    });
    animationLoopController = createAnimationLoopController({
      getSceneContext,
      getRoute,
      getCreatorTransitionInFlight,
      getCharacter,
      getPrimaryCharacterId,
      animationManager,
      characterAI,
      onFrameUpdate: createOnFrameUpdate(),
    });
    setFacingLogContextProvider(() => ({
      state: characterAI?.getState(),
      isWalking: animationManager?.isWalking?.(),
      isInWalkToPhase: animationManager?.isInWalkToPhase?.(),
      isBusy: animationManager?.isBusy?.()
    }));
    setupUserActivityListeners();
    characterEventsController.setupCharacterEventSubscribers();
    characterEventsController.setupSocketEvents(socketManager);
  }

  const initialSkin = skins.find((skin) => skin.path === FALLBACK_SKINS[0]?.path) ?? skins[0]!;
  armModelState.setDetected(await detectArmModelFromPath(initialSkin.path));
  armModelState.notify(); // the creator panel may already be showing the pre-detection default
  const config = buildCharacterConfig(
    initialSkin.path,
    animations,
    undefined,
    ARM_MODEL_PATHS[armModelState.getResolved()]
  );
  characterController.loadCharacter(config, skins);
  if (getRoute() === 'creator') {
    await loadSkinFromPath(initialSkin.path);
  }

  registerCapture3DThumbnail(captureCreator3DThumbnail);
  registerCapture3DPartThumbnail(captureCreator3DPartThumbnail);

  setupCreator3DPaint({
    getControls: () => sceneContext!.controls,
    setControls: (c) => { sceneContext!.controls = c; },
    camera: sceneContext.camera,
    renderer: sceneContext.renderer,
    getCharacterModel: () => getCharacter(getPrimaryCharacterId())?.model ?? null,
    getRoute,
    onWindowResize,
    onUpdateViewPlacement: updateCreator3DViewPlacement
  });

  window.addEventListener('resize', onWindowResize);
  initElectronStatus();
  setupCreatorPreviewDirtySubscription();
  installPreviewCaptureRuntimeApi();
  animationLoopController.animate();
}

main();
