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
  exportTo64x64DataURL,
} from './creator';
import { EDIT_MODE_WARDROBE, type EditMode } from './creator/api';
import { createCharacterController } from './controllers/character';
import {
  type CharacterState,
  buildCharacterConfig,
} from './controllers/characterTypes';
import { createCharacterEventsController } from './controllers/characterEvents';
import { createCrowdController, type CrowdController } from './controllers/crowdController';
import { createBlockWorldController } from './controllers/blockWorldController';
import { createDayNightController } from './controllers/dayNightController';
import { createSelectionController, type SelectionController } from './controllers/selectionController';
import { DEFAULT_CROWD_CONFIG } from './animation/crowd';
import { createAnimationLoopController } from './controllers/animationLoop';
import { createCreatorPoseController, type CreatorPoseController } from './controllers/creatorPose';
import { createCreatorCameraController } from './controllers/creatorCameraController';
import {
  createFocusedCreationController,
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
import { createPreviewRouteRuntime } from './controllers/previewRouteRuntime';
import { createCreatorPreviewController } from './controllers/creatorPreview';
import { createRouter } from './controllers/router';
import { createAppContext } from './controllers/appContext';
import { createRouteButtons } from './ui/routeButtons';
import { createArmModelState } from './state/armModelState';
import { initTheme } from './ui/theme';
import { initAboutPanel } from './ui/aboutPanel';
import { createMovePanel } from './ui/movePanel';
import { createResidentsPanel } from './ui/residentsPanel';
import { createResidentsStore } from './state/residentsStore';
import { getOutfitsStore } from './state/outfitsStore';
import { createOutfitResidents } from './controllers/outfitResidents';
import { createCreatorToWorld } from './controllers/creatorToWorld';
import { outfitIdFromKey } from './domain/residents';
import { createStudioPanel } from './ui/studioPanel';
import { createStudioCapturePanel } from './ui/studioCapturePanel';
import { createStudioDancersPanel } from './ui/studioDancersPanel';
import { createStudioDancersController } from './controllers/studioDancersController';
import { createGroupDanceStore } from './state/groupDanceStore';
import { createStudioStagePanel } from './ui/studioStagePanel';
import { createStudioStageController } from './controllers/studioStageController';
import { createStudioBackdropStore } from './state/studioBackdrop';
import { captureStagePhoto } from './viewer/stagePhoto';
import { createStudioController, type StudioController } from './controllers/studioController';
import { createSavedSequencesStore } from './state/savedSequences';
import { createTimeOfDayStore } from './state/timeOfDay';
import { createTimeOfDayPanel } from './ui/timeOfDayPanel';
import {
  initElectronStatus,
} from './ui';
import { createThumbnailCapture } from './viewer/thumbnailCapture';
import { createSkinCompositor, loadCachedImage } from './viewer/skinCompositor';
import { registerCapture3DThumbnail, registerCapture3DPartThumbnail } from './viewer/capture3DThumbnail';
import {
  initScene as initViewerScene,
  applyShadowToModel,
  logModelUVInfo,
  logMeshNames,
  createDebugTexture,
  applySkinToModel,
  setupCreator3DPaint,
  setupCreatorCameraLight,
  updateOrbitControlsForEditMode,
  recreateOrbitControls,
  setSunFocus,
  type SceneContext,
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

type AppRoute = 'creator' | 'viewer' | 'preview' | 'studio';
type RouteInfo = { route: AppRoute; creatorMode: EditMode | null };
/** Extended scene context with typed characters. Populated in main() after initViewerScene. */
type AppSceneContext = SceneContext & { characters: Record<string, CharacterState> };
/** Services main() builds at startup; read them via `app` (see controllers/appContext.ts). */
type AppServices = {
  scene: AppSceneContext;
  characters: ReturnType<typeof createCharacterController>;
  animation: ReturnType<typeof createAnimationManager>;
  creatorPose: CreatorPoseController;
  viewerUI: ReturnType<typeof createViewerUIController>;
  transitions: { getTransitionInFlight: () => boolean };
  characterAI: ReturnType<typeof createCharacterAI> | null;
  crowd: CrowdController;
  selection: SelectionController;
  studio: StudioController;
};
const app = createAppContext<AppServices>();
/** Composite sequences loaded from /sequences/index.json */
type Sequence = { id: string; label: string; steps: SequenceStep[] };
// -----------------------------------------------------------------------------
// Module state (mutable refs resolved during init)
// -----------------------------------------------------------------------------

/** Resolved after main() creates the transition handler. */
function getCreatorTransitionInFlight(): boolean {
  return app.tryGet('transitions')?.getTransitionInFlight() ?? false;
}

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


function getSceneContext(): AppSceneContext {
  return app.get('scene');
}

function getCharacter(id: string): CharacterState | undefined {
  return app.tryGet('scene')?.characters[id] as CharacterState | undefined;
}

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
  const ctx = app.tryGet('scene');
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


function resumeHomeMode() {
  const char = getCharacter(getPrimaryCharacterId());
  if (char?.idleAction) {
    char.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    char.idleAction.clampWhenFinished = false;
    app.tryGet('characters')?.fadeToAction(char, char.idleAction, 0.3);
  }
  // Still selected after the creator: stay put and wait for the user.
  if (app.tryGet('selection')?.isSelected()) return;
  const reacted = app.tryGet('characterAI')?.onUserActivity(true) ?? false;
  if (!reacted) {
    app.tryGet('animation')?.runOneWanderStep?.();
  }
}

const CREATOR_EXIT_ANIMATION_MS = 450;

/** localStorage, or null where it's blocked (private mode, sandboxed iframes). */
function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function ensureViewerFullWidthLayout() {
  const appEl = document.getElementById('app');
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!appEl || !wrapper) return;
  if (appEl.parentElement !== wrapper) {
    wrapper.appendChild(appEl);
  }
  onWindowResize();
}

function applyRoute(routeInfo?: RouteInfo): void {
  router.apply(routeInfo ?? getRouteInfo());
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
    app.tryGet('characterAI')?.onUserActivity(false);
  });
  document.addEventListener('keydown', () => {
    if (getRoute() !== 'viewer') return;
    app.tryGet('characterAI')?.onUserActivity(true);
  });
}

function onWindowResize() {
  const ctx = app.tryGet('scene');
  if (!ctx || !ctx.container || !ctx.camera || !ctx.renderer) return;
  const width = ctx.container.clientWidth;
  const height = ctx.container.clientHeight;
  ctx.camera.aspect = width / height;
  ctx.camera.updateProjectionMatrix();
  ctx.renderer.setSize(width, height);
  logger.debug('renderer', 'Resize', { width, height });
}

/** Path last loaded into creator (from gallery or route enter). Used to know when to reload from char.currentSkin (user picked different skin in home). */
const skinCompositor = createSkinCompositor();
const previewCamera = createPreviewCameraController({
  getSceneContext: () => app.tryGet('scene') ?? null,
  defaultFov: DEFAULT_SCENE_FOV,
  showDebugPanel: SHOW_PREVIEW_CAMERA_CONTROLS,
  isPreviewRoute: () => getRoute() === 'preview',
});
const creatorPreview = createCreatorPreviewController({
  compositor: skinCompositor,
  getPrimaryCharacter: () => getCharacter(getPrimaryCharacterId()),
  getSkinCanvas: getCreatorSkinCanvas,
  getLayerVisible: getLayer3DVisible,
  getLayerPartVisible: getLayer3DPartVisible,
  getWorkSize: getCreatorWorkSize,
  onPreviewFrame: () => previewCamera.update(),
});
const previewRuntime = createPreviewRouteRuntime({
  routeController: previewRouteController,
  camera: previewCamera,
  compositor: skinCompositor,
  getSceneContext: () => app.tryGet('scene') ?? null,
  getPrimaryCharacter: () => getCharacter(getPrimaryCharacterId()),
  isPreviewRoute: () => getRoute() === 'preview',
  getSkinPaths: () => skinsList.map((skin) => skin.path),
  baseSkinCandidates: PREVIEW_BASE_SKIN_CANDIDATES,
  fallbackSkinPath: FALLBACK_SKINS[0]?.path ?? null,
});
const routeButtons = createRouteButtons(() => getCreatorTransitionInFlight());
const router = createRouter({
  creator: {
    init: initCreator,
    getEditMode,
    setEditMode,
    getFocusedCreationEnabled,
    getCanvasPopulated: getCreatorCanvasPopulated,
    loadSkinFromPath,
  },
  defaultCreatorMode: EDIT_MODE_WARDROBE,
  creatorPose: () => app.get('creatorPose'),
  previewRuntime,
  getRoute,
  getPrimaryCharacter: () => getCharacter(getPrimaryCharacterId()),
  getSceneContext: () => app.tryGet('scene') ?? null,
  updateCreatorViewPlacement: updateCreator3DViewPlacement,
  ensureViewerLayout: ensureViewerFullWidthLayout,
  resumeHome: resumeHomeMode,
  onApplied: () => routeButtons.update(),
  studio: {
    enter: () => app.tryGet('studio')?.enter(),
    exit: () => app.tryGet('studio')?.exit(),
  },
});
const focusAutoDisableBoundControls = new WeakSet<object>();
let lastCreatorCameraInputWasMouse = false;

function bindFocusedModeAutoDisableOnMouseCameraMove(): void {
  const ctx = app.tryGet('scene');
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

// -----------------------------------------------------------------------------
// Preview route: skin composition, camera, capture
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Creator: 3D view placement and preview texture
// -----------------------------------------------------------------------------

function updateCreator3DViewPlacement() {
  if (getRoute() !== 'creator' || !app.tryGet('scene')) return;
  const appEl = document.getElementById('app');
  const wrapper = document.getElementById('creator-view-wrapper');
  const slot = document.getElementById('creator-3d-preview-slot');
  if (!appEl || !wrapper || !slot) return;
  const mode = getEditMode();
  const show3DInMainArea = mode === '3d' || mode === 'wardrobe';
  if (show3DInMainArea) {
    const ctx = app.get('scene');
    if (appEl.parentElement !== wrapper) {
      wrapper.appendChild(appEl);
      const prevControls = ctx.controls;
      ctx.controls = recreateOrbitControls(ctx.camera, ctx.renderer, prevControls);
      prevControls.dispose();
      updateOrbitControlsForEditMode(ctx.controls, getRoute);
      bindFocusedModeAutoDisableOnMouseCameraMove();
    }
    onWindowResize();
  } else {
    if (appEl.parentElement !== slot) {
      slot.appendChild(appEl);
    }
    onWindowResize();
  }
}

function setupCreatorPreviewDirtySubscription(): void {
  const markDirty = creatorPreview.markDirty;

  creatorCanvasSlice.subscribe(() => markDirty());
  creatorLayerSlice.subscribe(() => markDirty());
  creatorModeSlice.subscribe((detail) => {
    if (getRoute() !== 'creator') return;
    app.get('creatorPose').applyCreatorCharacterPose(detail);
  });
  creatorSkinLoadSlice.subscribe((detail) => {
    markDirty();
    setDetectedArmModel(detectArmModelFromCanvas(getCreatorSkinCanvas()));
    const path = detail.path;
    if (typeof path === 'string') {
      const char = getCharacter(getPrimaryCharacterId());
      if (char) {
        char.currentSkin = path;
        router.noteCreatorLoadedPath(path);
        app.get('viewerUI').highlightActiveSkin(getPrimaryCharacterId(), path);
        app.tryGet('selection')?.refresh();
      }
    }
  });
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
  const characterController = app.tryGet('characters');
  if (!characterController) return;
  const char = getCharacter(getPrimaryCharacterId());
  if (!char) return;
  const path = ARM_MODEL_PATHS[armModelState.getResolved()];
  if (char.modelPath === path) return;
  void characterController.setModel(char.id, path).then(() => {
    creatorPreview.markDirty();
    previewRuntime.invalidate();
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

  const sceneContext = app.provide('scene', initViewerScene(container, params) as AppSceneContext);
  initTheme();
  initAboutPanel();
  const savedSequences = createSavedSequencesStore(getLocalStorage());
  const residents = createResidentsStore(getLocalStorage());
  // My outfits (kept in the creator) can live in the village: roster entries `outfit:<id>`.
  const outfits = getOutfitsStore();
  const outfitResidents = createOutfitResidents(outfits);
  const movePanel = createMovePanel({
    getRoute,
    getCamera: () => sceneContext?.camera ?? null,
    getCharacterPosition: () => getCharacter(getPrimaryCharacterId())?.container.position ?? null,
    getAnimationManager: () => app.tryGet('animation') ?? null,
    onUserControl: () => app.tryGet('characterAI')?.userTookControl(),
    canControl: () => app.tryGet('selection')?.isSelected() ?? false,
    savedSequences,
  });
  setupCreatorCameraLight(sceneContext.camera);
  bindFocusedModeAutoDisableOnMouseCameraMove();

  const viewerUIController = app.provide('viewerUI', createViewerUIController({
    getCharacter,
    getPrimaryCharacterId,
    getAnimationManager: () => app.tryGet('animation') ?? null,
  }));

  const characterController = createCharacterController({
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
      movePanel.setMoves(anims, sequences as Sequence[]);
      studioPanel.setAnimations(anims);
    },
    getSequencesList: () => sequencesList,
    onPreviewRouteAfterCharacterReady: () => void previewRuntime.sync(),
    getCreatorPoseController: () => app.tryGet('creatorPose') ?? null,
    getCreatorTransitionInFlight,
    getAnimationManager: () => app.tryGet('animation') ?? null,
    highlightActiveButton: (charId, action) => viewerUIController.highlightActiveButton(charId, action),
    highlightActiveSkin: (charId, path) => {
      viewerUIController.highlightActiveSkin(charId, path);
      if (armModelState.isAuto()) void detectArmModelFromPath(path).then(setDetectedArmModel);
    },
    useDebugTexture: USE_DEBUG_TEXTURE,
    logModelInfo: LOG_MODEL_INFO,
  });

  app.provide('characters', characterController);
  const fadeToAction = characterController.fadeToAction;
  const getAction = characterController.getAction;

  // Home view block village (?world=0 for the old open stage). Walks route around its buildings.
  const blockWorld = params.get('world') === '0' ? null : createBlockWorldController(sceneContext.scene);

  // Home view day and night: a time-of-day control, and lighting laid over the active preset.
  const timeOfDay = createTimeOfDayStore(getLocalStorage());
  createTimeOfDayPanel({ store: timeOfDay });
  const dayNight = createDayNightController({
    scene: sceneContext.scene,
    store: timeOfDay,
    lamps: blockWorld && { positions: blockWorld.lampPositions, setGlow: blockWorld.setLampGlow, isShown: blockWorld.isShown },
  });

  const animationManager = createAnimationManager({
    getCharacter,
    fadeToAction,
    getAction,
    getCamera: () => sceneContext!.camera,
    clock: sceneContext!.clock,
    getTurnStrategy: () => turnStrategy,
    clampWalkTarget:
      blockWorld?.clampWalkTarget ??
      ((target) => {
        // Keep walks inside the creative zone (round, centered on the origin).
        const r = Math.hypot(target.x, target.z);
        const max = DEFAULT_CROWD_CONFIG.zoneRadius;
        if (r > max) target.multiplyScalar(max / r);
        target.y = 0;
      }),
    planWalk: blockWorld?.planWalk,
  });
  app.provide('animation', animationManager);

  // Dance studio (#/studio): mixes clips on the primary character. Its own stage: the crowd and
  // village are hidden there and the idle AI doesn't run (both are viewer-only).
  const studio = app.provide('studio', createStudioController({
    getCharacter: () => getCharacter(getPrimaryCharacterId()),
    stopSequences: () => {
      animationManager.stop();
      app.tryGet('characterAI')?.userTookControl();
    },
    getSceneContext: () => sceneContext,
    getFacing: () => animationManager.getFacing(),
  }));
  const studioPanel = createStudioPanel({
    studio,
    savedSequences,
    onExit: () => {
      location.hash = '#/';
    },
  });
  // The route may have been applied (e.g. a direct #/studio load) before the controller existed.
  if (getRoute() === 'studio') studio.enter();
  // Studio "Camera" section (photo + video); a recording stops by itself when the route changes.
  createStudioCapturePanel({
    mount: document.getElementById('studio-panel'),
    getCanvas: () => sceneContext.renderer.domElement,
    takePhoto: (options) => captureStagePhoto(sceneContext, options),
    isOnStage: () => getRoute() === 'studio',
  });
  // Studio "Backdrop" and "Camera moves" sections; both apply on the studio route only.
  const studioBackdrop = createStudioBackdropStore(getLocalStorage());
  const studioStage = createStudioStageController({
    scene: sceneContext.scene,
    camera: sceneContext.camera,
    controls: {
      target: sceneContext.controls.target,
      addEventListener: (type, listener) => sceneContext.controls.addEventListener(type, listener),
    },
    backdrop: studioBackdrop,
    getCharacterPosition: () => getCharacter(getPrimaryCharacterId())?.container.position ?? null,
    getFacing: () => animationManager.getFacing(),
  });
  createStudioStagePanel({ mount: document.getElementById('studio-panel'), backdrop: studioBackdrop, camera: studioStage });

  const crowd = app.provide('crowd', createCrowdController({
    getSceneContext,
    getPrimaryCharacterId,
    loadCharacter: characterController.loadCharacter,
    fadeToAction,
    getAction,
    getSkins: () => skinsList,
    getAnimations: () => animationsList,
    resolveModelPath: async (skinPath) =>
      ARM_MODEL_PATHS[(await detectArmModelFromPath(skinPath)) ?? 'classic'],
    getRoster: () => residents.get(),
    outfits: outfitResidents,
    getCombos: () => savedSequences.list(),
    getTimeOfDay: () => timeOfDay.get().time,
    config: blockWorld ? { nav: blockWorld.crowdNav } : undefined,
  }));
  // Residents panel: who lives in the village. The store holds the choice; the crowd applies it.
  residents.subscribe(() => crowd.syncRoster());
  createResidentsPanel({
    getSkins: () => [...outfitResidents.entries(), ...skinsList],
    store: residents,
    getPresentSkins: crowd.presentSkins,
    getPrimarySkin: crowd.primarySkin,
    cap: crowd.residentsCap,
    onRemoveOutfit: (key) => void outfits.remove(outfitIdFromKey(key) ?? ''),
    subscribeSkins: outfits.subscribe,
  });
  /** Everything a roster may name; drops residents whose skin or outfit no longer exists. */
  const rosterSkins = () => [...skinsList.map((s) => s.path), ...outfitResidents.keys()];
  const pruneResidents = () => {
    if (skinsList.length > 0) residents.prune(rosterSkins(), crowd.residentsCap);
  };
  outfits.subscribe(pruneResidents); // a deleted outfit takes its resident with it

  // Studio "Dancers" section: backup dancers that copy the lead. They live only on the studio stage.
  const groupDance = createGroupDanceStore(getLocalStorage());
  createStudioDancersPanel({ mount: document.getElementById('studio-panel'), store: groupDance });
  const studioDancers = createStudioDancersController({
    getSceneContext,
    getLead: () => getCharacter(getPrimaryCharacterId()),
    getLeadWeights: () => studio.getSnapshot().applied,
    getFacing: () => animationManager.getFacing(),
    getSettings: groupDance.get,
    loadCharacter: characterController.loadCharacter,
    getSkins: () => skinsList,
    getAnimations: () => animationsList,
    resolveModelPath: async (skinPath) =>
      ARM_MODEL_PATHS[(await detectArmModelFromPath(skinPath)) ?? 'classic'],
    getRoster: () => residents.get(),
  });

  const creatorPoseController = createCreatorPoseController({
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
    getCharacterYaw: () => animationManager.getFacing(),
    easeOutCubic,
  });

  app.provide('creatorPose', creatorPoseController);

  createCreatorCameraController({
    getSceneContext,
    getRoute,
    getEditMode,
    creatorPoseController,
  });

  createFocusedCreationController({
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
  pruneResidents();

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

  const socketManager = createSocketManager();

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
    updateRouteButtonsState: routeButtons.update,
    logTransition,
    animationManager,
    resumeHomeMode,
    CREATOR_EXIT_ANIMATION_MS
  });
  app.provide('transitions', { getTransitionInFlight: creatorTransitionHandler.getTransitionInFlight });
  routeButtons.setup(creatorTransitionHandler);
  // Creator "Send to village" / "Dance in studio" (buttons in the creator's Keep/Save panel).
  createCreatorToWorld({
    getRoute,
    hasSkin: getCreatorCanvasPopulated,
    exportSkin: exportTo64x64DataURL,
    getArmModel: armModelState.getResolved,
    outfits,
    residents,
    getPresentSkins: crowd.presentSkins,
    getAvailableSkins: rosterSkins,
    cap: crowd.residentsCap,
    wearOutfit: (dataUrl) => {
      const char = getCharacter(getPrimaryCharacterId());
      if (!char) return;
      char.currentSkin = dataUrl;
      router.noteCreatorLoadedPath(dataUrl);
      viewerUIController.highlightActiveSkin(char.id, dataUrl);
    },
    exitCreator: creatorTransitionHandler.exitCreator,
  }).start();

  const characterEventsController = createCharacterEventsController({
    getCharacter,
    getPrimaryCharacterId,
    getRoute,
    getCreatorTransitionInFlight,
    resolveSkinByName: characterController.resolveSkinByName,
    switchSkin: characterController.switchSkin,
    getAction,
    fadeToAction,
    getCharacterAI: () => app.tryGet('characterAI') ?? null,
    animationManager,
    highlightActiveButton: viewerUIController.highlightActiveButton,
  });

  const cutawayFocus = new THREE.Vector3();
  /** Crowd, selection and camera follow. The world stops while the creator is open. */
  function onWorldUpdate(delta: number, route: AppRoute): void {
    if (route === 'studio') studio.update(delta);
    studioStage.update(delta, route);
    blockWorld?.update(route);
    dayNight.update(delta, route);
    if (blockWorld) {
      // Editor (and the camera move into it): keep walls and trees out from between camera and character.
      const editing = route === 'creator' || (route === 'viewer' && getCreatorTransitionInFlight());
      const char = editing ? getCharacter(getPrimaryCharacterId()) : undefined;
      if (char) {
        cutawayFocus.copy(char.container.position);
        cutawayFocus.y += 1; // chest height
        blockWorld.updateCutaway(sceneContext.camera.position, cutawayFocus);
      } else {
        blockWorld.updateCutaway(null, null);
      }
    }
    crowd.update(delta, route, !getCreatorTransitionInFlight());
    app.tryGet('selection')?.update(delta, route);
    studioDancers.update(delta, route); // after studio.update: mirrors what it applied this frame
    const target = sceneContext.controls.target;
    setSunFocus(target.x, target.z);
  }

  let animationLoopController: ReturnType<typeof createAnimationLoopController>;
  if (isTestMode) {
    app.provide('characterAI', null);
    animationLoopController = createAnimationLoopController({
      getSceneContext,
      getRoute,
      getCreatorTransitionInFlight,
      getCharacter,
      getPrimaryCharacterId,
      animationManager,
      characterAI: null,
      onFrameUpdate: creatorPreview.onFrame,
      shouldUpdateCharacter: (char) => crowd.shouldUpdateCharacter(char, getRoute()),
      onWorldUpdate,
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
    const characterAI = createCharacterAI({
      getCharacter,
      fadeToAction,
      getAction,
      getCamera: () => sceneContext!.camera,
      getClock: () => sceneContext!.clock,
      animationManager,
    });
    app.provide('characterAI', characterAI);
    animationLoopController = createAnimationLoopController({
      getSceneContext,
      getRoute,
      getCreatorTransitionInFlight,
      getCharacter,
      getPrimaryCharacterId,
      animationManager,
      characterAI,
      onFrameUpdate: creatorPreview.onFrame,
      shouldUpdateCharacter: (char) => crowd.shouldUpdateCharacter(char, getRoute()),
      onWorldUpdate,
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

  app.provide('selection', createSelectionController({
    getSceneContext,
    getRoute,
    getTransitionInFlight: getCreatorTransitionInFlight,
    getPrimaryCharacterId,
    crowd,
    animationManager,
    characterAI: app.tryGet('characterAI') ?? null,
    fadeToAction,
    onPrimaryChanged: (char) => {
      viewerUIController.highlightActiveSkin(char.id, char.currentSkin);
      previewRuntime.invalidate();
      if (armModelState.isAuto()) {
        void detectArmModelFromPath(char.currentSkin).then((model) => {
          setDetectedArmModel(model);
          applyArmModelToCharacter();
        });
      } else {
        applyArmModelToCharacter();
      }
    },
    getSkinLabel: (path) =>
      outfitResidents.labelOf(path) ?? skinsList.find((s) => s.path === path)?.label ?? path.split('/').pop()?.replace(/[.]png$/i, '') ?? 'Character',
    roamRadius: blockWorld?.roamRadius ?? DEFAULT_CROWD_CONFIG.edgeRadius + 6,
  }));

  if (import.meta.env.DEV) {
    // Dev-only handle for poking at the home world from the console.
    (window as unknown as Record<string, unknown>).__world = {
      crowd,
      blockWorld,
      animation: animationManager,
      selection: app.get('selection'),
      characters: sceneContext.characters,
      scene: sceneContext,
    };
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

  const thumbnails = createThumbnailCapture({
    getSceneContext: () => sceneContext,
    getPrimaryCharacter: () => getCharacter(getPrimaryCharacterId()),
    getSkinCanvas: getCreatorSkinCanvas,
    getWorkSize: getCreatorWorkSize,
    compositor: skinCompositor,
    markPreviewDirty: creatorPreview.markDirty,
    getCharacterAnchor: () => {
      const p = getCharacter(getPrimaryCharacterId())?.container.position;
      return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, yaw: creatorPoseController.getCharacterYaw() };
    },
  });
  registerCapture3DThumbnail(thumbnails.captureFull);
  registerCapture3DPartThumbnail(thumbnails.capturePart);

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
  previewRuntime.installCaptureApi();
  animationLoopController.animate();
}

main();
