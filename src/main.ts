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
  type PreviewRoutePartKey,
} from './controllers/previewRoute';
import { createCreatorTransitionHandler } from './controllers/transitions/creatorTransitionHandler';
import { createViewerUIController } from './controllers/viewerUI';
import { setupTestControls, setFacingLogContextProvider } from './debug';
import type { SkinEntry, AnimationEntry } from './domain';
import { getPrimaryCharacterId } from './domain';
import { subscribe, CREATOR_EVENTS } from './events/appEvents';
import { logger, easeOutCubic } from './lib';
import { createSocketManager, createCharacterAI } from './services';
import { preprocessSkinTexture } from './skin';
import { SKIN_LAYER_BOUNDS, LAYER_KEYS, TEXTURE_LAYER_KEYS, isLayerWithParts, type LayerKey } from './skin';
import {
  ensurePreviewCameraPanel,
  removePreviewCameraPanel,
  updatePreviewCameraInfo,
  createFakeChatUI,
  initElectronStatus,
} from './ui';
import { linearToSrgb } from './viewer/captureHelpers';
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
  { path: '/animations/Bored-RunningboyRig.fbx', key: 'bored', label: 'Bored' },
  { path: '/animations/Crying-RunningboyRig.fbx', key: 'crying', label: 'Crying' }
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
type EventHandlerEntry = {
  event: string;
  handler: (e: CustomEvent) => void;
  guard?: () => boolean;
};

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
    removePreviewPanelsContainer();
    previewRouteController.setPreviewRouteOverride(null);
    activePreviewCameraPreset = null;
    lastAppliedPreviewSignature = null;
    restoreDefaultCameraFov();
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
    window.setTimeout(() => {
      creatorPoseController.snapCameraToCreatorView(creatorPoseController.getCreatorCameraPose());
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
    removePreviewPanelsContainer();
    previewRouteController.setPreviewRouteOverride(null);
    activePreviewCameraPreset = null;
    lastAppliedPreviewSignature = null;
    restoreDefaultCameraFov();
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
let creatorOverlayCanvas: HTMLCanvasElement | null = null;
let creatorOverlayTexture: THREE.CanvasTexture | null = null;
let previewRouteCanvas: HTMLCanvasElement | null = null;
let previewRouteTexture: THREE.CanvasTexture | null = null;
let lastAppliedPreviewSignature: string | null = null;
let previewRouteSyncToken = 0;
const previewImageCache = new Map<string, Promise<HTMLImageElement>>();
let activePreviewCameraPreset: PreviewPresetKey | null = null;
let lastPreviewCameraPanelSignature = '';

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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

function ensurePreviewPanelsContainer(): HTMLElement | null {
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!wrapper) return null;

  let container = document.getElementById('preview-lower-right-panels');
  if (!container) {
    container = document.createElement('div');
    container.id = 'preview-lower-right-panels';
    container.className = 'preview-lower-right-panels';
    wrapper.appendChild(container);
  }

  let group = document.getElementById('preview-right-panels-group');
  if (!group) {
    group = document.createElement('div');
    group.id = 'preview-right-panels-group';
    group.className = 'preview-right-panels-group';
    container.appendChild(group);
  }

  return group;
}

function removePreviewPanelsContainer(): void {
  removePreviewCameraPanel();
  document.getElementById('preview-lower-right-panels')?.remove();
  lastPreviewCameraPanelSignature = '';
}

// -----------------------------------------------------------------------------
// Preview route: skin composition, camera, capture
// -----------------------------------------------------------------------------

function buildLayerVisibleState(visibleLayers: readonly LayerKey[]): Record<string, boolean> {
  const visibleSet = new Set<string>(visibleLayers);
  return Object.fromEntries(LAYER_KEYS.map((layer) => [layer, visibleSet.has(layer)]));
}

function loadPreviewImage(path: string): Promise<HTMLImageElement> {
  const cached = previewImageCache.get(path);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load preview image: ${path}`));
    img.src = path;
  });
  previewImageCache.set(path, pending);
  return pending;
}

function getImageSourceSize(source: HTMLCanvasElement | HTMLImageElement): number {
  if (source instanceof HTMLCanvasElement) return source.width;
  return source.naturalWidth || source.width || 64;
}

function buildLayerMaskedCanvas(
  source: HTMLCanvasElement | HTMLImageElement,
  layerVisible: Record<string, boolean>,
  layerPartVisible: Record<string, { L?: boolean; R?: boolean }>,
  workSize: number
): HTMLCanvasElement | null {
  const sourceSize = getImageSourceSize(source);
  if (!sourceSize) return null;
  const scale = workSize / 64;

  if (!creatorOverlayCanvas || creatorOverlayCanvas.width !== workSize || creatorOverlayCanvas.height !== workSize) {
    creatorOverlayCanvas = document.createElement('canvas');
    creatorOverlayCanvas.width = workSize;
    creatorOverlayCanvas.height = workSize;
  }
  const ctx = creatorOverlayCanvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, workSize, workSize);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, sourceSize, sourceSize, 0, 0, workSize, workSize);
  const imageData = ctx.getImageData(0, 0, workSize, workSize);
  const data = imageData.data;

  for (const layerKey of TEXTURE_LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layerKey];
    if (!bounds) continue;
    const layerHidden = layerVisible[layerKey] === false;
    const parts = layerPartVisible[layerKey];
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i]!;
      const side: 'L' | 'R' = i === 0 ? 'R' : 'L';
      const partHidden = isLayerWithParts(layerKey)
        ? (side === 'R' ? parts?.R === false : parts?.L === false)
        : false;
      const shouldMask = layerHidden || partHidden;
      if (!shouldMask) continue;
      const x0 = Math.floor(b.x * scale);
      const y0 = Math.floor(b.y * scale);
      const x1 = Math.min(Math.ceil((b.x + b.w) * scale), workSize);
      const y1 = Math.min(Math.ceil((b.y + b.h) * scale), workSize);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = (py * workSize + px) * 4;
          data[idx + 3] = 0;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return creatorOverlayCanvas;
}

/** Build visibility texture: copy skin, zero alpha for hidden layer regions. Apply to all meshes. */
function buildVisibilityTexture(
  skinCanvas: HTMLCanvasElement,
  layerVisible: Record<string, boolean>,
  layerPartVisible: Record<string, { L?: boolean; R?: boolean }>
): THREE.Texture {
  const workSize = getCreatorWorkSize();
  const maskedCanvas = buildLayerMaskedCanvas(skinCanvas, layerVisible, layerPartVisible, workSize);
  if (!maskedCanvas) return creatorPreviewTexture!;

  if (!creatorOverlayTexture) {
    creatorOverlayTexture = new THREE.CanvasTexture(maskedCanvas);
    creatorOverlayTexture.colorSpace = THREE.SRGBColorSpace;
    creatorOverlayTexture.magFilter = THREE.NearestFilter;
    creatorOverlayTexture.minFilter = THREE.NearestFilter;
    creatorOverlayTexture.generateMipmaps = false;
    creatorOverlayTexture.wrapS = creatorOverlayTexture.wrapT = THREE.ClampToEdgeWrapping;
    creatorOverlayTexture.flipY = true;
  }
  creatorOverlayTexture.source.data = maskedCanvas;
  creatorOverlayTexture.needsUpdate = true;
  return creatorOverlayTexture;
}

function composePreviewSkinCanvas(
  baseImage: HTMLImageElement | null,
  skinImage: HTMLImageElement,
  part: PreviewRoutePartKey | null
): HTMLCanvasElement {
  if (!previewRouteCanvas) {
    previewRouteCanvas = document.createElement('canvas');
    previewRouteCanvas.width = 64;
    previewRouteCanvas.height = 64;
  }
  const ctx = previewRouteCanvas.getContext('2d');
  if (!ctx) return previewRouteCanvas;

  ctx.clearRect(0, 0, 64, 64);
  ctx.imageSmoothingEnabled = false;

  if (baseImage) {
    const baseSize = baseImage.naturalWidth || baseImage.width || 64;
    ctx.drawImage(baseImage, 0, 0, baseSize, baseSize, 0, 0, 64, 64);
  }

  const skinSize = skinImage.naturalWidth || skinImage.width || 64;
  if (!part) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(skinImage, 0, 0, skinSize, skinSize, 0, 0, 64, 64);
    return previewRouteCanvas;
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 64;
  sourceCanvas.height = 64;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) return previewRouteCanvas;
  sourceCtx.imageSmoothingEnabled = false;
  sourceCtx.drawImage(skinImage, 0, 0, skinSize, skinSize, 0, 0, 64, 64);

  const bounds = SKIN_LAYER_BOUNDS[part] ?? [];
  bounds.forEach((rect) => {
    const partImageData = sourceCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
    ctx.putImageData(partImageData, rect.x, rect.y);
  });
  return previewRouteCanvas;
}

function applyPreviewTextureFromCanvas(char: CharacterState, canvas: HTMLCanvasElement, skinPath: string): void {
  if (!previewRouteTexture) {
    previewRouteTexture = new THREE.CanvasTexture(canvas);
    previewRouteTexture.colorSpace = THREE.SRGBColorSpace;
    previewRouteTexture.magFilter = THREE.NearestFilter;
    previewRouteTexture.minFilter = THREE.NearestFilter;
    previewRouteTexture.generateMipmaps = false;
    previewRouteTexture.wrapS = previewRouteTexture.wrapT = THREE.ClampToEdgeWrapping;
    previewRouteTexture.flipY = true;
  }
  previewRouteTexture.source.data = canvas;
  previewRouteTexture.needsUpdate = true;
  applySkinToModel(char.model, previewRouteTexture, char.texturePreset, char.alphaMode, skinPath);
  char.currentSkin = skinPath;
}

function applyPreviewCameraPreset(previewInfo: PreviewRouteInfo): void {
  const ctx = sceneContext;
  if (!ctx?.camera || !ctx?.controls) return;
  const preset = getPreviewPreset(previewInfo.cameraPreset);
  ctx.camera.position.set(preset.cameraPosition.x, preset.cameraPosition.y, preset.cameraPosition.z);
  ctx.controls.target.set(preset.cameraTarget.x, preset.cameraTarget.y, preset.cameraTarget.z);
  ctx.camera.fov = preset.fov ?? DEFAULT_SCENE_FOV;
  ctx.camera.updateProjectionMatrix();
  ctx.controls.update();
}

function updatePreviewCameraDebugPanel(): void {
  const ctx = sceneContext;
  if (!SHOW_PREVIEW_CAMERA_CONTROLS || getRoute() !== 'preview' || !ctx?.camera || !ctx?.controls) return;
  if (activePreviewCameraPreset) {
    const preset = getPreviewPreset(activePreviewCameraPreset);
    const matchesPreset =
      Math.abs(ctx.camera.position.x - preset.cameraPosition.x) < 0.0005 &&
      Math.abs(ctx.camera.position.y - preset.cameraPosition.y) < 0.0005 &&
      Math.abs(ctx.camera.position.z - preset.cameraPosition.z) < 0.0005 &&
      Math.abs(ctx.controls.target.x - preset.cameraTarget.x) < 0.0005 &&
      Math.abs(ctx.controls.target.y - preset.cameraTarget.y) < 0.0005 &&
      Math.abs(ctx.controls.target.z - preset.cameraTarget.z) < 0.0005 &&
      Math.abs(ctx.camera.fov - (preset.fov ?? DEFAULT_SCENE_FOV)) < 0.0005;
    if (!matchesPreset) {
      activePreviewCameraPreset = null;
    }
  }
  const signature = [
    activePreviewCameraPreset ?? 'custom',
    ctx.camera.position.x.toFixed(3),
    ctx.camera.position.y.toFixed(3),
    ctx.camera.position.z.toFixed(3),
    ctx.controls.target.x.toFixed(3),
    ctx.controls.target.y.toFixed(3),
    ctx.controls.target.z.toFixed(3),
    ctx.camera.fov.toFixed(3),
  ].join('|');
  if (signature === lastPreviewCameraPanelSignature) return;
  lastPreviewCameraPanelSignature = signature;
  updatePreviewCameraInfo({
    activePreset: activePreviewCameraPreset,
    position: ctx.camera.position,
    target: ctx.controls.target,
    fov: ctx.camera.fov,
  });
}

function ensurePreviewCameraDebugPanel(previewInfo: PreviewRouteInfo): void {
  if (!SHOW_PREVIEW_CAMERA_CONTROLS || getRoute() !== 'preview') {
    removePreviewPanelsContainer();
    return;
  }
  const container = ensurePreviewPanelsContainer();
  if (!container) return;
  ensurePreviewCameraPanel({
    container,
    activePreset: activePreviewCameraPreset ?? previewInfo.cameraPreset,
    onSelectPreset: (preset) => {
      activePreviewCameraPreset = preset;
      applyPreviewCameraPreset({ ...previewInfo, cameraPreset: preset });
      updatePreviewCameraDebugPanel();
    },
  });
  updatePreviewCameraDebugPanel();
}

function restoreDefaultCameraFov(): void {
  const ctx = sceneContext;
  if (!ctx?.camera) return;
  if (ctx.camera.fov === DEFAULT_SCENE_FOV) return;
  ctx.camera.fov = DEFAULT_SCENE_FOV;
  ctx.camera.updateProjectionMatrix();
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
  activePreviewCameraPreset = previewInfo.cameraPreset;
  applyPreviewCameraPreset(previewInfo);
  ensurePreviewCameraDebugPanel(previewInfo);

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
    loadPreviewImage(previewInfo.skinPath),
    baseSkinPath ? loadPreviewImage(baseSkinPath).catch(() => null) : Promise.resolve(null),
  ]);
  if (token !== previewRouteSyncToken) return;

  const composedCanvas = composePreviewSkinCanvas(baseImage, skinImage, previewInfo.part);
  const maskedCanvas = buildLayerMaskedCanvas(composedCanvas, layerVisible, {}, 64) ?? composedCanvas;
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
      ctx.controls.dispose();
      ctx.controls = recreateOrbitControls(ctx.camera, ctx.renderer);
      updateOrbitControlsForEditMode(ctx.controls, getRoute);
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
  const textureToUse = buildVisibilityTexture(canvas, layerVisible, layerPartVisible);

  applySkinToModel(char.model, textureToUse, 'clamped-flip' as TexturePreset, 'transparent' as AlphaMode);
  applyCreatorLayerVisibility(char.model, layerVisible);
}

function setupCreatorPreviewDirtySubscription(): void {
  const markDirty = () => { creatorPreviewDirty = true; };

  const EVENT_HANDLERS: EventHandlerEntry[] = [
    { event: CREATOR_EVENTS.CANVAS_CHANGE, handler: () => markDirty() },
    { event: CREATOR_EVENTS.LAYER3D_CHANGE, handler: () => markDirty() },
    {
      event: CREATOR_EVENTS.EDIT_MODE_CHANGE,
      handler: (e) => creatorPoseController.applyCreatorCharacterPose(e.detail),
      guard: () => getRoute() === 'creator',
    },
    {
      event: CREATOR_EVENTS.SKIN_LOAD_CHANGE,
      handler: (e) => {
        markDirty();
        const path = (e.detail as { path?: string })?.path;
        if (typeof path === 'string') {
          const char = getCharacter(getPrimaryCharacterId());
          if (char) {
            char.currentSkin = path;
            lastCreatorLoadedPath = path;
            viewerUIController.highlightActiveSkin(getPrimaryCharacterId(), path);
          }
        }
      },
    },
  ];

  EVENT_HANDLERS.forEach(({ event, handler, guard }) => {
    subscribe(event, (e) => {
      if (guard && !guard()) return;
      handler(e as CustomEvent);
    });
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
      updatePreviewCameraDebugPanel();
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
  const maskedCanvas = buildLayerMaskedCanvas(canvas, layerVisible, {}, workSize);
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
  applyCreatorLayerVisibilityForCapture(char.model, layerVisible, '/models/RunningboyRig.fbx');

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
  setupCreatorCameraLight(sceneContext.camera);

  const controllerRefs = {
    creatorPoseController: null as CreatorPoseController | null,
    animationManager: null as ReturnType<typeof createAnimationManager> | null,
    getCharacter: ((id: string) => sceneContext?.characters[id]) as (id: string) => CharacterState | undefined,
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
    getAnimationManager: () => controllerRefs.animationManager,
    highlightActiveButton: (charId, action) => viewerUIController.highlightActiveButton(charId, action),
    highlightActiveSkin: (charId, path) => viewerUIController.highlightActiveSkin(charId, path),
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

  if (getRoute() === 'creator') {
    creatorPoseController.snapCameraToCreatorView();
  } else if (getRoute() === 'preview') {
    const previewInfo = previewRouteController.getPreviewRouteInfo();
    activePreviewCameraPreset = previewInfo.cameraPreset;
    applyPreviewCameraPreset(previewInfo);
    ensurePreviewCameraDebugPanel(previewInfo);
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
    createFakeChatUI({
      onPlaySequence: (seq) => animationManager!.playSequence(seq),
      onMessageSent: () => characterAI!.onUserActivity(true),
      getExampleSequences: () => sequencesList.map((s) => s.steps),
      setLastActivity: () => characterAI!.setLastActivity(),
      checkIdleTimers: () => {} // characterAI.update handles idle/wander every frame
    });
  }

  const initialSkin = skins.find((skin) => skin.path === FALLBACK_SKINS[0]?.path) ?? skins[0]!;
  const config = buildCharacterConfig(initialSkin.path, animations);
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
