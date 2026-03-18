import './style.css';
import * as THREE from 'three';
import {
  initCreator,
  getCreatorSkinCanvas,
  loadSkinFromPath,
  getCreatorCanvasPopulated,
  getEditMode,
  getCreatorWorkSize,
  getLayer3DVisible,
  setActiveTool,
  normalizeLayerStateForNonEditMode,
  unregisterCreatorShortcuts,
} from './creator';
import { preprocessSkinTexture } from './skinPreprocess';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createSocketManager } from './socketManager';
import { createAnimationManager, type SequenceStep, type CharacterStateLike, type TurnStrategy } from './animationManager';
import { createCharacterAI } from './characterAI';
import { createFakeChatUI } from './fakeChatUI';
import { setupTestControls } from './setupTestControls';
import { initElectronStatus } from './electronStatus';
import { logger } from './logger';
import { setFacingLogContextProvider } from './debugFacing';
import { subscribe, CREATOR_EVENTS } from './creatorEvents';
import { SKIN_LAYER_BOUNDS, LAYER_KEYS, TEXTURE_LAYER_KEYS } from './skinLayout';
import type { SkinEntry, AnimationEntry } from './types/catalog';
import {
  initScene as initViewerScene,
  applyShadowToModel,
  logModelUVInfo,
  logMeshNames,
  createDebugTexture,
  applySkinToModel,
  applyCreatorLayerVisibility,
  setupCreator3DPaint,
  updateOrbitControlsForEditMode,
  recreateOrbitControls,
  type TexturePreset,
  type AlphaMode
} from './viewer';

const FALLBACK_SKINS: SkinEntry[] = [
  { path: '/skins/RunningboyRig.png', label: 'Default' }
];

const FALLBACK_ANIMATIONS: AnimationEntry[] = [
  { path: '/animations/Bored-RunningboyRig.fbx', key: 'bored', label: 'Bored' },
  { path: '/animations/Crying-RunningboyRig.fbx', key: 'crying', label: 'Crying' }
];

type CharacterState = {
  id: string;
  /** Root container we move during walkTo (model is child at 0,0,0) — isolates root motion */
  container: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | undefined;
  texturePreset: TexturePreset;
  alphaMode: AlphaMode;
  currentSkin: string;
};

function buildCharacterConfig(skinPath: string, animations: AnimationEntry[]) {
  return {
    id: 'runningboy',
    label: 'Runningboy',
    model: '/models/RunningboyRig.fbx',
    skin: skinPath,
    texturePreset: 'clamped-flip' as TexturePreset,
    alphaMode: 'transparent' as AlphaMode,
    animations: animations.map((a) => ({ path: a.path, key: a.key })),
    position: new THREE.Vector3(0, 0, 0)
  };
}

type CharacterConfig = ReturnType<typeof buildCharacterConfig>;

const USE_DEBUG_TEXTURE = false;

/** When true, log mesh names and UV bounds to console on model load */
const LOG_MODEL_INFO = false;

const params = typeof window !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const isTestMode = params.get('movementcontrols') === '1';

const TURN_STRATEGIES: TurnStrategy[] = ['lerp', 'snap', 'reset'];
function parseTurnStrategy(p: URLSearchParams): TurnStrategy {
  const v = p.get('turn');
  if (v === 'snap' || v === 'lerp' || v === 'reset') return v;
  return 'lerp';
}
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
let creatorTransitionInFlight = false;

/** Hash-based routing: #/creator = character creator, #/ or #/home = viewer */
function getRoute(): 'creator' | 'viewer' {
  const hash = (location.hash || '#/').toLowerCase().replace(/\/$/, '') || '#/';
  if (hash === '#/creator') return 'creator';
  return 'viewer';
}

const characters: Record<string, CharacterState> = {};
let animationManager: ReturnType<typeof createAnimationManager> | null = null;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function logTransition(stage: string, extra: Record<string, unknown> = {}) {
  const char = characters['runningboy'];
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
  if (camera && controls) {
    payload.cameraPos = {
      x: Number(camera.position.x.toFixed(3)),
      y: Number(camera.position.y.toFixed(3)),
      z: Number(camera.position.z.toFixed(3))
    };
    payload.cameraTarget = {
      x: Number(controls.target.x.toFixed(3)),
      y: Number(controls.target.y.toFixed(3)),
      z: Number(controls.target.z.toFixed(3))
    };
  }
  logger.info('transition', stage, payload);
}

function updateRouteButtonsState() {
  const designBtn = document.getElementById('enter-creator-btn') as HTMLButtonElement | null;
  const homeBtn = document.getElementById('enter-viewer-btn') as HTMLButtonElement | null;
  if (designBtn) {
    designBtn.disabled = creatorTransitionInFlight;
    designBtn.textContent = creatorTransitionInFlight ? 'Designing...' : 'Design';
  }
  if (homeBtn) {
    homeBtn.disabled = creatorTransitionInFlight;
    homeBtn.textContent = 'Home';
  }
}

function lockCharacterToCreatorIdle() {
  animationManager?.stop();
  animationManager?.stopIdleWanderer?.();
  const char = characters['runningboy'];
  if (!char?.idleAction) return;
  char.idleAction.setLoop(THREE.LoopRepeat, Infinity);
  char.idleAction.clampWhenFinished = false;
  fadeToAction(char, char.idleAction, 0.25);
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

type CameraPose = { target: THREE.Vector3; position: THREE.Vector3 };

function getCreatorCameraPose(): CameraPose {
  const char = characters['runningboy'];
  if (!char) {
    return {
      target: CREATOR_CAMERA_TARGET.clone(),
      position: CREATOR_CAMERA_POSITION.clone()
    };
  }

  // Reuse the creator-mode "camera relative to character" template, then place it at the
  // character's live position/orientation at transition time.
  const yaw = char.model.rotation.y;
  const upAxis = new THREE.Vector3(0, 1, 0);
  const cameraOffset = CREATOR_CAMERA_OFFSET_FROM_CHARACTER.clone().applyAxisAngle(upAxis, yaw);
  const targetOffset = CREATOR_TARGET_OFFSET_FROM_CHARACTER.clone().applyAxisAngle(upAxis, yaw);
  const position = char.container.position.clone().add(cameraOffset);
  const target = char.container.position.clone().add(targetOffset);
  return { target, position };
}

function snapCameraToCreatorView(pose: CameraPose = getCreatorCameraPose()) {
  if (!camera || !controls) return;
  camera.position.copy(pose.position);
  controls.target.copy(pose.target);
  controls.update();
}

const CAMERA_TRAVEL_SPEED = 4; // units per second
const CAMERA_TRANSITION_DURATION_MIN_MS = 400;
const CAMERA_TRANSITION_DURATION_MAX_MS = 1500;

function animateCameraToCreatorView(pose: CameraPose = getCreatorCameraPose()): Promise<void> {
  if (!camera || !controls) return Promise.resolve();

  const startPosition = camera.position.clone();
  const endPosition = pose.position.clone();
  const startTarget = controls.target.clone();
  const endTarget = pose.target.clone();

  const distance = startPosition.distanceTo(endPosition);
  const durationMs = THREE.MathUtils.clamp(
    (distance / CAMERA_TRAVEL_SPEED) * 1000,
    CAMERA_TRANSITION_DURATION_MIN_MS,
    CAMERA_TRANSITION_DURATION_MAX_MS
  );

  const startTime = performance.now();

  return new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = easeOutCubic(t);

      camera.position.copy(startPosition).lerp(endPosition, eased);
      controls.target.copy(startTarget).lerp(endTarget, eased);
      controls.update();

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        snapCameraToCreatorView(pose);
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

async function transitionViewerToCreator() {
  if (creatorTransitionInFlight || getRoute() !== 'viewer') return;
  creatorTransitionInFlight = true;
  updateRouteButtonsState();
  const transitionStart = performance.now();
  logTransition('design-clicked');
  try {
    // Finish only the current clip cycle (bounded), not full queued sequences.
    const char = characters['runningboy'];
    if (char) {
      const remainingSec = getCurrentActionRemainingSec(char);
      const waitSec = Math.min(remainingSec, 1.2);
      if (waitSec > 0) {
        logTransition('waiting-current-clip', { waitSec: Number(waitSec.toFixed(2)) });
        await sleep(waitSec * 1000);
      }
    }

    // Prevent long transition stalls from queued home behaviors.
    animationManager?.stop();
    animationManager?.stopIdleWanderer?.();
    lockCharacterToCreatorIdle();
    const pose = getCreatorCameraPose();
    logTransition('camera-move-start', {
      elapsedMs: Math.round(performance.now() - transitionStart),
      endTarget: { x: Number(pose.target.x.toFixed(3)), y: Number(pose.target.y.toFixed(3)), z: Number(pose.target.z.toFixed(3)) },
      endPosition: { x: Number(pose.position.x.toFixed(3)), y: Number(pose.position.y.toFixed(3)), z: Number(pose.position.z.toFixed(3)) }
    });
    await animateCameraToCreatorView(pose);
    logTransition('camera-move-end', { elapsedMs: Math.round(performance.now() - transitionStart) });
    location.hash = '#/creator';
  } finally {
    creatorTransitionInFlight = false;
    updateRouteButtonsState();
  }
}

function setupCreatorTransitionButton() {
  const btn = document.getElementById('enter-creator-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', () => {
    void transitionViewerToCreator();
  });
  updateRouteButtonsState();
}

function resumeHomeMode() {
  const char = characters['runningboy'];
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

async function transitionCreatorToViewer() {
  if (creatorTransitionInFlight || getRoute() !== 'creator') return;
  creatorTransitionInFlight = true;
  normalizeLayerStateForNonEditMode();
  // Ensure creator leaves with a non-painting tool selected so we don't
  // accidentally keep brush/eraser semantics when returning.
  setActiveTool('navigate');
  updateRouteButtonsState();
  try {
    document.body.dataset.creatorExiting = '1';
    await sleep(CREATOR_EXIT_ANIMATION_MS);
    location.hash = '#/';
    document.body.removeAttribute('data-creator-exiting');
    await sleep(50);
    if (getRoute() === 'viewer') {
      resumeHomeMode();
    }
  } finally {
    creatorTransitionInFlight = false;
    updateRouteButtonsState();
  }
}

function setupViewerTransitionButton() {
  const btn = document.getElementById('enter-viewer-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', () => {
    void transitionCreatorToViewer();
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

function applyRoute(): void {
  const route = getRoute();
  document.body.dataset.route = route;
  if (route === 'creator') {
    lockCharacterToCreatorIdle();
    initCreator();
    // Re-apply creator layout for current mode (especially when returning in 2D).
    updateCreator3DViewPlacement();
    window.setTimeout(() => {
      snapCameraToCreatorView(getCreatorCameraPose());
    }, 0);
    window.setTimeout(() => {
      updateCreator3DViewPlacement();
      window.dispatchEvent(new Event('resize'));
      const c = characters['runningboy'];
      if (c?.currentSkin) {
        const shouldLoad = !getCreatorCanvasPopulated() || c.currentSkin !== lastCreatorLoadedPath;
        if (shouldLoad) {
          loadSkinFromPath(c.currentSkin);
          lastCreatorLoadedPath = c.currentSkin;
        }
      }
    }, 0);
  } else {
    unregisterCreatorShortcuts();
    ensureViewerFullWidthLayout();
    resumeHomeMode();
  }
  updateRouteButtonsState();
}

const container = document.getElementById('three-canvas-container');

if (!container) {
  throw new Error('Missing #three-canvas-container element in DOM.');
}

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let controls: OrbitControls;
const clock = new THREE.Clock();
let skinsList: SkinEntry[] = [];
let animationsList: AnimationEntry[] = [];

/** Composite sequences loaded from /sequences/index.json */
type Sequence = { id: string; label: string; steps: SequenceStep[] };
let sequencesList: Sequence[] = [];
let socketManager: ReturnType<typeof createSocketManager> | null = null;
let characterAI: ReturnType<typeof createCharacterAI> | null = null;

applyRoute();
window.addEventListener('hashchange', applyRoute);

/** Debug: pause animation loop (used when ?movementcontrols=1). */
let paused = false;

async function apiPost(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${path}?${qs}`, { method: 'POST' });
  return res.json();
}

function resolveSkinByName(name: string): string | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/\s+/g, '-').trim();
  const exact = skinsList.find((s) => s.path === name || s.path === `/${name}`.replace(/\/+/g, '/'));
  if (exact) return exact.path;
  return skinsList.find((s) => {
    const pathNorm = s.path.toLowerCase();
    const labelNorm = s.label.toLowerCase().replace(/\s+/g, '-');
    const base = pathNorm.split('/').pop()?.replace(/\.(png|jpg|jpeg)$/, '') ?? '';
    return pathNorm.endsWith(`/${n}.png`) || base === n || labelNorm === n || pathNorm.includes(n);
  })?.path;
}

function fadeToAction(
  char: CharacterStateLike,
  next: THREE.AnimationAction,
  duration: number = 0.5
): void {
  if (char.currentAction === next) return;

  const clipName = (next as unknown as { _clip?: { name?: string } })._clip?.name ?? 'unknown';
  logger.debug('animation', 'Fade to action', { action: clipName, duration });

  next.reset();
  next.enabled = true;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);

  if (char.currentAction) {
    char.currentAction.crossFadeTo(next, duration, false);
  } else {
    next.fadeIn(duration);
  }

  next.play();
  next.paused = false;
  char.currentAction = next;

  highlightActiveButton(char.id, next);
}

function loadCharacter(config: CharacterConfig, skins: SkinEntry[]) {
  const fbxLoader = new FBXLoader();
  const textureLoader = new THREE.TextureLoader();

  const loadModel = (texture: THREE.Texture | null) => {
    fbxLoader.load(
      config.model,
      (model) => {
        logger.info('general', 'Model loaded', { label: config.label });

        model.scale.setScalar(0.01);
        model.position.set(0, 0, 0);
        if (LOG_MODEL_INFO) {
          logMeshNames(model, config.label);
          logModelUVInfo(model, config.label);
        }
        if (texture) {
          const texToUse = USE_DEBUG_TEXTURE ? createDebugTexture(64, 64) : texture;
          applySkinToModel(model, texToUse, config.texturePreset, config.alphaMode, config.skin, config.model);
        }
        applyShadowToModel(model);

        const container = new THREE.Group();
        container.position.copy(config.position);
        container.add(model);
        scene.add(container);

        const mixer = new THREE.AnimationMixer(model);
        const actions: Record<string, THREE.AnimationAction> = {};
        let loadedCount = 0;

        const onClipLoaded = (
          animFbx: THREE.Group,
          key: string
        ) => {
          if (!animFbx.animations.length) return;
          animFbx.animations.forEach((clip) => {
            const action = mixer.clipAction(clip, model);
            action.setLoop(THREE.LoopRepeat, Infinity);
            actions[key] = action;
          });
          loadedCount++;
          if (loadedCount === config.animations.length) {
            logger.info('animation', 'Actions loaded', {
              count: Object.keys(actions).length,
              keys: Object.keys(actions).join(', ')
            });
            const idleKey = ['bored', 'shrugging', 'crying', 'laughing'].find((k) => actions[k]) ?? Object.keys(actions)[0];
            const idleAction = idleKey ? actions[idleKey] : Object.values(actions)[0];
            characters[config.id] = {
              id: config.id,
              container,
              model,
              mixer,
              actions,
              currentAction: null,
              idleAction,
              texturePreset: config.texturePreset,
              alphaMode: config.alphaMode,
              currentSkin: config.skin
            };

            mixer.addEventListener('finished', () => {
              const char = characters[config.id];
              if (!char) return;
              if (getRoute() === 'creator') {
                lockCharacterToCreatorIdle();
                return;
              }
              if (!char.idleAction || char.currentAction === char.idleAction) return;
              // Don't override walk/sequence — animation manager is controlling
              if (animationManager?.isInWalkToPhase?.() || animationManager?.isBusy?.()) return;
              fadeToAction(char, char.idleAction!, 0.3);
            });

            if (idleAction) fadeToAction(characters[config.id], idleAction, 0);

            if (Object.keys(characters).length === 1) {
              setupAnimationButtons(animationsList);
              setupSkinPreviews(skins);
              setupSequenceButtons(sequencesList);
            }
          }
        };

        const anims = config.animations;
        for (const { path, key } of anims) {
          fbxLoader.load(
            path,
            (animFbx) => onClipLoaded(animFbx, key),
            undefined,
            (err) => logger.error('general', 'FBX load failed', { path, error: String(err) })
          );
        }
      },
      undefined,
      (err) => logger.error('general', 'Model load error', { model: config.model, error: String(err) })
    );
  };

  if (config.skin) {
    textureLoader.load(
      config.skin,
      (texture) => loadModel(preprocessSkinTexture(texture)),
      undefined,
      () => loadModel(null)
    );
  } else {
    loadModel(null);
  }
}

function resolveAnimationByName(name: string): string | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/\s+/g, '-').trim();
  const exact = animationsList.find((a) => a.key === name || a.key === n);
  if (exact) return exact.key;
  return animationsList.find((a) => {
    const keyNorm = a.key.toLowerCase();
    const labelNorm = a.label.toLowerCase().replace(/\s+/g, '-');
    return keyNorm === n || labelNorm === n || keyNorm.includes(n) || labelNorm.includes(n);
  })?.key;
}

function getAction(charId: string, key: string): THREE.AnimationAction | undefined {
  const char = characters[charId];
  if (!char) return undefined;
  const resolved = resolveAnimationByName(key) ?? key.toLowerCase().replace(/\s+/g, '-');
  if (resolved === 'back-to-idle') return char.idleAction;
  return (
    char.actions[resolved] ??
    char.actions['bored'] ??
    char.actions['shrugging'] ??
    Object.values(char.actions)[0]
  );
}

function switchSkin(charId: string, skinPath: string) {
  const char = characters[charId];
  if (!char || char.currentSkin === skinPath) return;

  const loader = new THREE.TextureLoader();
  loader.load(
    skinPath,
    (texture) => {
      const processed = preprocessSkinTexture(texture);
      applySkinToModel(char.model, processed, char.texturePreset, char.alphaMode, skinPath);
      char.currentSkin = skinPath;
      highlightActiveSkin(charId, skinPath);
    },
    undefined,
    (err) => logger.error('general', 'Skin load error', { path: skinPath, error: String(err) })
  );
}

function highlightActiveSkin(charId: string, skinPath: string) {
  const selector = document.getElementById('skin-selector');
  if (!selector) return;
  selector.querySelectorAll<HTMLElement>('.skin-preview[data-character]').forEach((el) => {
    el.classList.toggle('active', el.dataset.character === charId && el.dataset.skin === skinPath);
  });
}

function setupSkinPreviews(skins: SkinEntry[]) {
  const container = document.getElementById('skin-selector');
  if (!container) return;

  container.innerHTML = '';
  const charId = 'runningboy';

  skins.forEach((skin) => {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'skin-preview';
    wrap.dataset.character = charId;
    wrap.dataset.skin = skin.path;
    wrap.setAttribute('aria-label', `Select skin: ${skin.label}`);

    const img = document.createElement('img');
    img.src = skin.preview ?? skin.path;
    img.alt = skin.label;
    img.loading = 'lazy';
    wrap.appendChild(img);

    wrap.addEventListener('click', () => {
      logger.debug('input', 'Skin button click', { skin: skin.path, label: skin.label });
      if (socketManager) socketManager.emitSkin(skin.path);
      else apiPost('/api/skin', { name: skin.path });
    });
    container.appendChild(wrap);
  });

  const char = characters[charId];
  if (char) highlightActiveSkin(charId, char.currentSkin);
}

function setupAnimationButtons(animations: AnimationEntry[]) {
  const container = document.getElementById('anim-selector');
  if (!container) return;

  container.innerHTML = '';
  const charId = 'runningboy';

  animations.forEach((anim) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'anim-button';
    btn.dataset.character = charId;
    btn.dataset.action = anim.key;
    btn.textContent = anim.label;
    btn.setAttribute('aria-label', `Play animation: ${anim.label}`);
    btn.addEventListener('click', () => {
      logger.debug('input', 'Animation button click', { animation: anim.key, label: anim.label });
      if (socketManager) socketManager.emitAnimation(anim.key);
      else apiPost('/api/animation', { name: anim.key });
    });
    container.appendChild(btn);
  });

  const char = characters[charId];
  if (char?.idleAction) highlightActiveButton(charId, char.idleAction);
}

function setupSequenceButtons(sequences: Sequence[]) {
  const container = document.getElementById('sequence-selector');
  if (!container || !animationManager) return;

  container.innerHTML = '';

  sequences.forEach((seq) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sequence-button';
    btn.dataset.sequence = seq.id;
    btn.textContent = seq.label;
    btn.setAttribute('aria-label', `Play sequence: ${seq.label}`);
    btn.addEventListener('click', () => {
      logger.debug('input', 'Sequence button click', { sequence: seq.id, label: seq.label });
      animationManager!.setLastActivity();
      animationManager!.playSequence(seq.steps);
    });
    container.appendChild(btn);
  });
}

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

function setupSocketEvents() {
  if (!socketManager) return;

  socketManager.on('skin', (data) => {
    const skinPath = resolveSkinByName(data.name) ?? data.name;
    logger.info('messaging', 'Skin change (socket)', { path: skinPath });
    const char = characters['runningboy'];
    if (char) switchSkin('runningboy', skinPath);
  });

  socketManager.on('animation', (data) => {
    if (getRoute() === 'creator' || creatorTransitionInFlight) return;
    const char = characters['runningboy'];
    if (!char) return;
    characterAI?.onUserActivity(true);
    animationManager?.stop();
    animationManager?.setLastActivity();
    logger.info('messaging', 'Animation command', { name: data.name });
    if (data.name === 'back-to-idle') {
      if (char.idleAction) fadeToAction(char, char.idleAction, 0.5);
      return;
    }
    const action = getAction('runningboy', data.name);
    if (action) fadeToAction(char, action, 0.5);
  });
}

function highlightActiveButton(charId: string, action: THREE.AnimationAction) {
  const char = characters[charId];
  if (!char) return;
  const matchKey = Object.entries(char.actions).find(([, a]) => a === action)?.[0];
  if (!matchKey) return;

  const btn = document.querySelector<HTMLButtonElement>(
    `.anim-button[data-character="${charId}"][data-action="${matchKey}"]`
  );
  if (!btn) return;

  document
    .querySelectorAll<HTMLButtonElement>(`.anim-button[data-character="${charId}"]`)
    .forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

function onWindowResize() {
  if (!container || !camera || !renderer) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  logger.debug('renderer', 'Resize', { width, height });
}

let creatorPreviewTexture: THREE.CanvasTexture | null = null;
let creatorPreviewDirty = false;
let lastRouteForPreview = '';
/** Path last loaded into creator (from gallery or route enter). Used to know when to reload from char.currentSkin (user picked different skin in home). */
let lastCreatorLoadedPath: string | null = null;
let creatorOverlayCanvas: HTMLCanvasElement | null = null;
let creatorOverlayTexture: THREE.CanvasTexture | null = null;

/** Build visibility texture: copy skin, zero alpha for hidden layer regions. Apply to all meshes. */
function buildVisibilityTexture(
  skinCanvas: HTMLCanvasElement,
  layerVisible: Record<string, boolean>
): THREE.Texture {
  const workSize = getCreatorWorkSize();
  const scale = workSize / 64;

  if (!creatorOverlayCanvas || creatorOverlayCanvas.width !== workSize) {
    creatorOverlayCanvas = document.createElement('canvas');
    creatorOverlayCanvas.width = workSize;
    creatorOverlayCanvas.height = workSize;
  }
  const ctx = creatorOverlayCanvas.getContext('2d');
  if (!ctx) return creatorPreviewTexture!;

  ctx.clearRect(0, 0, workSize, workSize);
  ctx.drawImage(skinCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, workSize, workSize);
  const data = imageData.data;

  for (const layerKey of TEXTURE_LAYER_KEYS) {
    if (layerVisible[layerKey] !== false) continue;
    const bounds = SKIN_LAYER_BOUNDS[layerKey];
    if (!bounds) continue;
    for (const b of bounds) {
      const x0 = Math.floor(b.x * scale);
      const y0 = Math.floor(b.y * scale);
      const x1 = Math.min(Math.ceil((b.x + b.w) * scale), workSize);
      const y1 = Math.min(Math.ceil((b.y + b.h) * scale), workSize);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * workSize + px) * 4;
          data[i + 3] = 0;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  if (!creatorOverlayTexture) {
    creatorOverlayTexture = new THREE.CanvasTexture(creatorOverlayCanvas);
    creatorOverlayTexture.colorSpace = THREE.SRGBColorSpace;
    creatorOverlayTexture.magFilter = THREE.NearestFilter;
    creatorOverlayTexture.minFilter = THREE.NearestFilter;
    creatorOverlayTexture.generateMipmaps = false;
    creatorOverlayTexture.wrapS = creatorOverlayTexture.wrapT = THREE.ClampToEdgeWrapping;
    creatorOverlayTexture.flipY = true;
  }
  creatorOverlayTexture.source.data = creatorOverlayCanvas;
  creatorOverlayTexture.needsUpdate = true;
  return creatorOverlayTexture;
}

function updateCreator3DViewPlacement() {
  if (getRoute() !== 'creator') return;
  const app = document.getElementById('app');
  const wrapper = document.getElementById('creator-view-wrapper');
  const slot = document.getElementById('creator-3d-preview-slot');
  if (!app || !wrapper || !slot) return;
  const mode = getEditMode();
  const show3DInMainArea = mode === '3d' || mode === 'wardrobe';
  if (show3DInMainArea) {
    if (app.parentElement !== wrapper) {
      wrapper.appendChild(app);
      onWindowResize();
      controls.dispose();
      controls = recreateOrbitControls(camera, renderer);
      updateOrbitControlsForEditMode(controls, getRoute);
    }
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
  const char = characters['runningboy'];
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
  // Always build texture from fresh canvas copy so eraser/paint updates show immediately
  // (direct creatorPreviewTexture can show stale pixels on base layers due to GPU/Three.js caching)
  const textureToUse = buildVisibilityTexture(canvas, layerVisible);

  applySkinToModel(char.model, textureToUse, 'clamped-flip' as TexturePreset, 'transparent' as AlphaMode);
  applyCreatorLayerVisibility(char.model, layerVisible);
}

function setupCreatorPreviewDirtySubscription() {
  const markDirty = () => { creatorPreviewDirty = true; };
  subscribe(CREATOR_EVENTS.CANVAS_CHANGE, markDirty);
  subscribe(CREATOR_EVENTS.LAYER3D_CHANGE, markDirty);
  subscribe(CREATOR_EVENTS.SKIN_LOAD_CHANGE, (e: CustomEvent) => {
    markDirty();
    const path = e.detail?.path;
    if (typeof path === 'string') {
      const char = characters['runningboy'];
      if (char) {
        char.currentSkin = path;
        lastCreatorLoadedPath = path;
        highlightActiveSkin('runningboy', path);
      }
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  const route = getRoute();
  if (route === 'creator') {
    if (lastRouteForPreview !== 'creator') creatorPreviewDirty = true;
    lastRouteForPreview = 'creator';
    if (creatorPreviewDirty) {
      updateCreatorPreviewTexture();
      creatorPreviewDirty = false;
    }
  } else {
    lastRouteForPreview = route;
    const char = characters['runningboy'];
    if (char) {
      const allVisible = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));
      applyCreatorLayerVisibility(char.model, allVisible);
    }
  }
  if (paused) return;
  const delta = clock.getDelta();
  Object.values(characters).forEach((char) => char.mixer.update(delta));
  if (animationManager) animationManager.tick(delta);
  if (getRoute() !== 'creator' && !creatorTransitionInFlight) characterAI?.update(delta);
  controls.update();
  renderer.render(scene, camera);
}

/** Pause/resume animation loop (movement controls mode debug tools). */
function setPaused(value: boolean) {
  paused = value;
}

function isPaused(): boolean {
  return paused;
}

/** Advance one frame when paused. Uses fixed delta (1/60s) for predictable stepping. */
function stepOneFrame() {
  const delta = 1 / 60;
  Object.values(characters).forEach((char) => char.mixer.update(delta));
  if (animationManager) animationManager.tick(delta);
  characterAI?.update(delta);
  controls.update();
  renderer.render(scene, camera);

  logStepFrame(delta);
}

/** Log step-frame diagnostics to each enabled system. Respects ?log=animation:debug etc. */
function logStepFrame(delta: number) {
  const char = Object.values(characters)[0] as CharacterState | undefined;
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
      delta
    };
    if (debug.activeTurn) {
      data.turnProgress = debug.activeTurn.progress.toFixed(3);
      data.turnActionTime = debug.activeTurn.actionTime.toFixed(3);
    }
    if (debug.activeWalk) {
      data.walkT = debug.activeWalk.t.toFixed(3);
      data.walkPos = debug.activeWalk.pos;
    }
    if (debug.turnStartLerpState) {
      data.turnStartT = debug.turnStartLerpState.t.toFixed(3);
      data.turnStartElapsed = debug.turnStartLerpState.elapsed.toFixed(3);
    }
    if (debug.turnLerpState) {
      data.turnLerpRemaining = debug.turnLerpState.remainingSec.toFixed(3);
    }
    logger.debug('animation', 'Step frame', data);
  }

  if (logger.isEnabled('position', 'debug') && debug) {
    const visualYaw =
      debug.modelYawDeg != null && debug.bonesCharYawDeg != null
        ? debug.modelYawDeg + debug.bonesCharYawDeg
        : debug.modelYawDeg;
    logger.debug('position', 'Step frame', {
      modelYawDeg: debug.modelYawDeg?.toFixed(1) ?? 'n/a',
      bonesCharYawDeg: debug.bonesCharYawDeg?.toFixed(1) ?? 'n/a',
      visualYawDeg: visualYaw != null ? visualYaw.toFixed(1) : 'n/a',
      containerPos: debug.containerPos
    });
  }

  if (logger.isEnabled('stateMachine', 'debug') && debug) {
    logger.debug('stateMachine', 'Step frame', {
      isInWalkToPhase: debug.isInWalkToPhase,
      isWalking: debug.isWalking,
      isBusy: debug.isBusy
    });
  }

  if (logger.isEnabled('renderer', 'debug')) {
    logger.debug('renderer', 'Step frame', { delta, deltaMs: (delta * 1000).toFixed(1) });
  }
}

async function main() {
  logger.info('general', 'App started');
  if (!container) throw new Error('Missing #three-canvas-container element in DOM.');
  const sceneContext = initViewerScene(container, params);
  scene = sceneContext.scene;
  camera = sceneContext.camera;
  renderer = sceneContext.renderer;
  controls = sceneContext.controls;
  setupCreatorTransitionButton();
  setupViewerTransitionButton();

  if (getRoute() === 'creator') {
    snapCameraToCreatorView();
  }

  let skins: SkinEntry[];
  try {
    const res = await fetch('/skins/index.json');
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
  animationManager = createAnimationManager({
    getCharacter: (id) => characters[id],
    fadeToAction,
    getAction,
    getCamera: () => camera,
    clock,
    getTurnStrategy: () => turnStrategy
  });

  if (isTestMode) {
    setupTestControls({
      animationManager,
      getCharacter: (id) => characters[id],
      getCamera: () => camera,
      setPaused,
      isPaused,
      stepOneFrame,
      turnStrategy,
      setTurnStrategy: (s) => { turnStrategy = s; },
      turnStrategies: TURN_STRATEGIES
    });
  } else {
    characterAI = createCharacterAI({
      getCharacter: (id) => characters[id],
      fadeToAction,
      getAction,
      getCamera: () => camera,
      getClock: () => clock,
      animationManager: animationManager!
    });
    setFacingLogContextProvider(() => ({
      state: characterAI?.getState(),
      isWalking: animationManager?.isWalking?.(),
      isInWalkToPhase: animationManager?.isInWalkToPhase?.(),
      isBusy: animationManager?.isBusy?.()
    }));
    setupUserActivityListeners();
    setupSocketEvents();
    createFakeChatUI({
      onPlaySequence: (seq) => animationManager!.playSequence(seq),
      onMessageSent: () => characterAI!.onUserActivity(true),
      getExampleSequences: () => sequencesList.map((s) => s.steps),
      setLastActivity: () => characterAI!.setLastActivity(),
      checkIdleTimers: () => {} // characterAI.update handles idle/wander every frame
    });
  }

  const initialSkin = skins[Math.floor(Math.random() * skins.length)]!;
  const config = buildCharacterConfig(initialSkin.path, animations);
  loadCharacter(config, skins);
  if (getRoute() === 'creator') {
    await loadSkinFromPath(initialSkin.path);
  }

  setupCreator3DPaint({
    getControls: () => controls,
    setControls: (c) => { controls = c; },
    camera,
    renderer,
    getCharacterModel: () => characters['runningboy']?.model ?? null,
    getRoute,
    onWindowResize,
    onUpdateViewPlacement: updateCreator3DViewPlacement
  });

  window.addEventListener('resize', onWindowResize);
  initElectronStatus();
  setupCreatorPreviewDirtySubscription();
  animate();
}

main();
