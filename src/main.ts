import './style.css';
import * as THREE from 'three';
import {
  initCreator,
  getCreatorSkinCanvas,
  loadSkinFromPath,
  getEditMode3D,
  getCreatorWorkSize,
  getActiveTool,
  getBrushSize,
  getBrushCursorStyleFor3D,
  getLayer3DVisible,
  getLayer3DLocked,
  getLayerAtCoords,
  uvToWorkingCoords,
  paintStartFrom3D,
  paintMoveFrom3D,
  paintEndFrom3D,
  sampleColorAt,
  applySampledColor,
  updateHoverInfo,
  getPartDisplayNameAtCoords
} from './creator';
import { preprocessSkinTexture } from './skinPreprocess';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createSocketManager } from './socketManager';
import { createAnimationManager, type SequenceStep, type CharacterStateLike, type TurnStrategy } from './animationManager';
import { createCharacterAI } from './characterAI';
import { createFakeChatUI } from './fakeChatUI';
import { setupTestControls } from './setupTestControls';
import { logger } from './logger';
import { setFacingLogContextProvider } from './debugFacing';
import { SKIN_LAYER_BOUNDS } from './skinLayout';

type SkinEntry = {
  path: string;
  label: string;
  preview?: string;
};

type AnimationEntry = {
  path: string;
  key: string;
  label: string;
};

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

type TexturePreset = 'clamped' | 'clamped-flip' | 'repeat' | 'repeat-flip';
type AlphaMode = 'none' | 'alphaTest' | 'transparent' | 'cutout';

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

/**
 * Overlay scale workaround: scale the 2nd_Layer mesh (jacket, sleeves, pants)
 * slightly outward so it renders above the base. Toggle off to use model geometry as-is.
 * Steve_Hat is never touched — it already has correct offset from the model.
 */
const OVERLAY_SCALE = {
  enabled: true,
  factor: 1.03,
};

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
/** Animation keys included in creator preview (idle only for now) */
const CREATOR_IDLE_KEYS = new Set([
  'idle'
]);

function getCreatorAnimationKeys(): string[] {
  return animationsList
    .filter((a) => CREATOR_IDLE_KEYS.has(a.key.toLowerCase()))
    .map((a) => a.key);
}

let creatorCyclerIndex = 0;

function startCreatorAnimationCycler() {
  animationManager?.stop();
  animationManager?.stopIdleWanderer?.();
  const char = characters['runningboy'];
  const keys = getCreatorAnimationKeys();
  if (!char || keys.length === 0) return;
  creatorCyclerIndex = 0;
  const key = keys[0]!;
  const action = getAction('runningboy', key);
  if (!action) return;
  action.setLoop(THREE.LoopOnce, 0);
  action.clampWhenFinished = true;
  action.reset();
  fadeToAction(char, action, 0.3);
}

function advanceCreatorCycler() {
  if (getRoute() !== 'creator') return;
  const char = characters['runningboy'];
  const keys = getCreatorAnimationKeys();
  if (!char || keys.length === 0) return;
  creatorCyclerIndex = (creatorCyclerIndex + 1) % keys.length;
  const key = keys[creatorCyclerIndex]!;
  const action = getAction('runningboy', key);
  if (!action) return;
  action.setLoop(THREE.LoopOnce, 0);
  action.clampWhenFinished = true;
  action.reset();
  fadeToAction(char, action, 0.3);
}

/** Hash-based routing: #/creator = character creator, #/ or #/home = viewer */
function getRoute(): 'creator' | 'viewer' {
  const hash = (location.hash || '#/').toLowerCase().replace(/\/$/, '') || '#/';
  if (hash === '#/creator') return 'creator';
  return 'viewer';
}

const characters: Record<string, CharacterState> = {};
let animationManager: ReturnType<typeof createAnimationManager> | null = null;

function applyRoute(): void {
  const route = getRoute();
  document.body.dataset.route = route;
  if (route === 'creator') {
    if (animationManager) {
      animationManager.stop();
      animationManager.stopIdleWanderer?.();
    }
    const char = characters['runningboy'];
    if (char?.currentAction) {
      char.currentAction.stop();
      char.currentAction = null;
    }
    initCreator();
    window.setTimeout(() => {
      startCreatorAnimationCycler();
    }, 0);
    window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      const c = characters['runningboy'];
      if (c?.currentSkin) loadSkinFromPath(c.currentSkin);
    }, 0);
  }
}

applyRoute();
window.addEventListener('hashchange', applyRoute);

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

function initScene() {
  if (!container) throw new Error('Missing #three-canvas-container element in DOM.');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050710);

  const aspect = container.clientWidth / container.clientHeight || 1;
  const fov = parseFloat(params.get('fov') || '45');
  const cameraZ = parseFloat(params.get('cameraZ') || '3');
  camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  camera.position.set(0, 1.5, cameraZ);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);

  addLights();
  addGround();
}

function addLights() {
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x202030, 1.0);
  hemiLight.position.set(0, 4, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(3, 6, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 20;
  dirLight.shadow.camera.left = -8;
  dirLight.shadow.camera.right = 8;
  dirLight.shadow.camera.top = 8;
  dirLight.shadow.camera.bottom = -8;
  scene.add(dirLight);
}

function addGround() {
  const geo = new THREE.CircleGeometry(8, 64);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1b1f3b,
    metalness: 0.0,
    roughness: 0.8
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function applyShadowToModel(model: THREE.Group) {
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

function logModelUVInfo(model: THREE.Group, label: string) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const meshes: { name: string; uRange: [number, number]; vRange: [number, number] }[] = [];
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const geom = mesh.geometry;
      const uvAttr = geom.getAttribute('uv');
      if (uvAttr) {
        let mu = Infinity, mU = -Infinity, mV = Infinity, MV = -Infinity;
        for (let i = 0; i < uvAttr.count; i++) {
          const u = uvAttr.getX(i);
          const v = uvAttr.getY(i);
          mu = Math.min(mu, u); mU = Math.max(mU, u);
          mV = Math.min(mV, v); MV = Math.max(MV, v);
        }
        minU = Math.min(minU, mu); maxU = Math.max(maxU, mU);
        minV = Math.min(minV, mV); maxV = Math.max(maxV, MV);
        meshes.push({ name: mesh.name || 'mesh', uRange: [mu, mU], vRange: [mV, MV] });
      }
    }
  });
  console.info(`[${label}] UV bounds: U [${minU.toFixed(4)}, ${maxU.toFixed(4)}]  V [${minV.toFixed(4)}, ${maxV.toFixed(4)}]`);
  meshes.forEach((m) => {
    console.info(`  ${m.name}: U [${m.uRange[0].toFixed(3)}, ${m.uRange[1].toFixed(3)}]  V [${m.vRange[0].toFixed(3)}, ${m.vRange[1].toFixed(3)}]`);
  });
}

function logMeshNames(model: THREE.Group, label: string) {
  const names: string[] = [];
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      names.push((obj as THREE.Mesh).name || '(unnamed)');
    }
  });
  console.info(`[${label}] Mesh names:`, names);
}

function createDebugTexture(width: number, height: number): THREE.CanvasTexture {
  const size = Math.max(width, height, 64);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grid = 8;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ff0066' : '#00ccff';
      ctx.fillRect((x * size) / grid, (y * size) / grid, size / grid, size / grid);
    }
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.fillText(`${size}x${size}`, 4, 14);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Minecraft 64x64 skin layout UVs (from minecraft-skin-layout-specification.md).
 * Normalized 0-1: U = x/64, V = 1 - y/64 (OpenGL convention, top-left image origin).
 * Face order: front, back, top, bottom, right, left — 4 verts each (bl, br, tr, tl).
 */
const MINECRAFT_SKIN_UVS: Record<string, number[]> = {
  head: [
    0.125, 0.75, 0.25, 0.75, 0.25, 0.875, 0.125, 0.875,
    0.375, 0.75, 0.5, 0.75, 0.5, 0.875, 0.375, 0.875,
    0.125, 0.875, 0.25, 0.875, 0.25, 1, 0.125, 1,
    0.25, 0.875, 0.375, 0.875, 0.375, 1, 0.25, 1,
    0, 0.75, 0.125, 0.75, 0.125, 0.875, 0, 0.875,
    0.25, 0.75, 0.375, 0.75, 0.375, 0.875, 0.25, 0.875,
  ],
  hat: [
    0.625, 0.75, 0.75, 0.75, 0.75, 0.875, 0.625, 0.875,
    0.875, 0.75, 1, 0.75, 1, 0.875, 0.875, 0.875,
    0.625, 0.875, 0.75, 0.875, 0.75, 1, 0.625, 1,
    0.75, 0.875, 0.875, 0.875, 0.875, 1, 0.75, 1,
    0.5, 0.75, 0.625, 0.75, 0.625, 0.875, 0.5, 0.875,
    0.75, 0.75, 0.875, 0.75, 0.875, 0.875, 0.75, 0.875,
  ],
  body: [
    0.3125, 0.5, 0.4375, 0.5, 0.4375, 0.6875, 0.3125, 0.6875,
    0.5, 0.5, 0.625, 0.5, 0.625, 0.6875, 0.5, 0.6875,
    0.3125, 0.6875, 0.4375, 0.6875, 0.4375, 0.75, 0.3125, 0.75,
    0.4375, 0.6875, 0.5625, 0.6875, 0.5625, 0.75, 0.4375, 0.75,
    0.25, 0.5, 0.3125, 0.5, 0.3125, 0.6875, 0.25, 0.6875,
    0.4375, 0.5, 0.5, 0.5, 0.5, 0.6875, 0.4375, 0.6875,
  ],
  jacket: [
    0.3125, 0.25, 0.4375, 0.25, 0.4375, 0.4375, 0.3125, 0.4375,
    0.5, 0.25, 0.625, 0.25, 0.625, 0.4375, 0.5, 0.4375,
    0.3125, 0.4375, 0.4375, 0.4375, 0.4375, 0.5, 0.3125, 0.5,
    0.4375, 0.4375, 0.5625, 0.4375, 0.5625, 0.5, 0.4375, 0.5,
    0.25, 0.25, 0.3125, 0.25, 0.3125, 0.4375, 0.25, 0.4375,
    0.4375, 0.25, 0.5, 0.25, 0.5, 0.4375, 0.4375, 0.4375,
  ],
  armR: [
    0.6875, 0.5, 0.75, 0.5, 0.75, 0.6875, 0.6875, 0.6875,
    0.8125, 0.5, 0.875, 0.5, 0.875, 0.6875, 0.8125, 0.6875,
    0.6875, 0.6875, 0.75, 0.6875, 0.75, 0.75, 0.6875, 0.75,
    0.75, 0.6875, 0.8125, 0.6875, 0.8125, 0.75, 0.75, 0.75,
    0.625, 0.5, 0.6875, 0.5, 0.6875, 0.6875, 0.625, 0.6875,
    0.75, 0.5, 0.8125, 0.5, 0.8125, 0.6875, 0.75, 0.6875,
  ],
  armL: [
    0.5625, 0, 0.625, 0, 0.625, 0.1875, 0.5625, 0.1875,
    0.6875, 0, 0.75, 0, 0.75, 0.1875, 0.6875, 0.1875,
    0.5625, 0.1875, 0.625, 0.1875, 0.625, 0.25, 0.5625, 0.25,
    0.625, 0.1875, 0.6875, 0.1875, 0.6875, 0.25, 0.625, 0.25,
    0.5, 0, 0.5625, 0, 0.5625, 0.1875, 0.5, 0.1875,
    0.625, 0, 0.6875, 0, 0.6875, 0.1875, 0.625, 0.1875,
  ],
  legR: [
    0.0625, 0.5, 0.125, 0.5, 0.125, 0.6875, 0.0625, 0.6875,
    0.1875, 0.5, 0.25, 0.5, 0.25, 0.6875, 0.1875, 0.6875,
    0.0625, 0.6875, 0.125, 0.6875, 0.125, 0.75, 0.0625, 0.75,
    0.125, 0.6875, 0.1875, 0.6875, 0.1875, 0.75, 0.125, 0.75,
    0, 0.5, 0.0625, 0.5, 0.0625, 0.6875, 0, 0.6875,
    0.125, 0.5, 0.1875, 0.5, 0.1875, 0.6875, 0.125, 0.6875,
  ],
  legL: [
    0.3125, 0, 0.375, 0, 0.375, 0.1875, 0.3125, 0.1875,
    0.4375, 0, 0.5, 0, 0.5, 0.1875, 0.4375, 0.1875,
    0.3125, 0.1875, 0.375, 0.1875, 0.375, 0.25, 0.3125, 0.25,
    0.375, 0.1875, 0.4375, 0.1875, 0.4375, 0.25, 0.375, 0.25,
    0.25, 0, 0.3125, 0, 0.3125, 0.1875, 0.25, 0.1875,
    0.375, 0, 0.4375, 0, 0.4375, 0.1875, 0.375, 0.1875,
  ],
  sleeveR: [
    0.6875, 0.3125, 0.75, 0.3125, 0.75, 0.5, 0.6875, 0.5,
    0.8125, 0.3125, 0.875, 0.3125, 0.875, 0.5, 0.8125, 0.5,
    0.6875, 0.5, 0.75, 0.5, 0.75, 0.5625, 0.6875, 0.5625,
    0.75, 0.5, 0.8125, 0.5, 0.8125, 0.5625, 0.75, 0.5625,
    0.625, 0.3125, 0.6875, 0.3125, 0.6875, 0.5, 0.625, 0.5,
    0.75, 0.3125, 0.8125, 0.3125, 0.8125, 0.5, 0.75, 0.5,
  ],
  sleeveL: [
    0.8125, 0, 0.875, 0, 0.875, 0.1875, 0.8125, 0.1875,
    0.9375, 0, 1, 0, 1, 0.1875, 0.9375, 0.1875,
    0.8125, 0.1875, 0.875, 0.1875, 0.875, 0.25, 0.8125, 0.25,
    0.875, 0.1875, 0.9375, 0.1875, 0.9375, 0.25, 0.875, 0.25,
    0.75, 0, 0.8125, 0, 0.8125, 0.1875, 0.75, 0.1875,
    0.875, 0, 0.9375, 0, 0.9375, 0.1875, 0.875, 0.1875,
  ],
  pantsR: [
    0.0625, 0.3125, 0.125, 0.3125, 0.125, 0.5, 0.0625, 0.5,
    0.1875, 0.3125, 0.25, 0.3125, 0.25, 0.5, 0.1875, 0.5,
    0.0625, 0.5, 0.125, 0.5, 0.125, 0.5625, 0.0625, 0.5625,
    0.125, 0.5, 0.1875, 0.5, 0.1875, 0.5625, 0.125, 0.5625,
    0, 0.3125, 0.0625, 0.3125, 0.0625, 0.5, 0, 0.5,
    0.125, 0.3125, 0.1875, 0.3125, 0.1875, 0.5, 0.125, 0.5,
  ],
  pantsL: [
    0.0625, 0, 0.125, 0, 0.125, 0.1875, 0.0625, 0.1875,
    0.1875, 0, 0.25, 0, 0.25, 0.1875, 0.1875, 0.1875,
    0.0625, 0.1875, 0.125, 0.1875, 0.125, 0.25, 0.0625, 0.25,
    0.125, 0.1875, 0.1875, 0.1875, 0.1875, 0.25, 0.125, 0.25,
    0, 0, 0.0625, 0, 0.0625, 0.1875, 0, 0.1875,
    0.125, 0, 0.1875, 0, 0.1875, 0.1875, 0.125, 0.1875,
  ],
};

function _getMinecraftPartFromMeshName(name: string): keyof typeof MINECRAFT_SKIN_UVS | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n.includes('head') && !n.includes('hat') && !n.includes('layer') && !n.includes('access')) return 'head';
  if (n.includes('hat') || (n.includes('head') && (n.includes('layer') || n.includes('access')))) return 'hat';
  if (n.includes('body') && !n.includes('layer') && !n.includes('jacket')) return 'body';
  if (n.includes('jacket') || (n.includes('body') && n.includes('layer'))) return 'jacket';
  if (n.includes('sleeve') && n.includes('r')) return 'sleeveR';
  if (n.includes('sleeve') && n.includes('l')) return 'sleeveL';
  if (n.includes('pant') && n.includes('r')) return 'pantsR';
  if (n.includes('pant') && n.includes('l')) return 'pantsL';
  if (n.includes('arm') && !n.includes('layer') && !n.includes('sleeve')) {
    if (n.includes('left') || (n.includes('l') && !n.includes('right'))) return 'armL';
    return 'armR';
  }
  if (n.includes('leg') && !n.includes('layer') && !n.includes('pant')) {
    if (n.includes('left') || (n.includes('l') && !n.includes('right'))) return 'legL';
    return 'legR';
  }
  return null;
}

/** Addendum layer keys for visibility. */
const CREATOR_LAYER_KEYS = ['hat', 'head', 'jacket', 'body', 'sleeves', 'arms', 'pants', 'legs'] as const;

function applyCreatorLayerVisibility(model: THREE.Group, _layerVisible: Record<string, boolean>) {
  // Visibility is handled by texture-region transparency; all meshes stay visible
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      (obj as THREE.Mesh).visible = true;
    }
  });
}

function configureTexture(texture: THREE.Texture, preset: TexturePreset) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  switch (preset) {
    case 'clamped':
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = false;
      break;
    case 'clamped-flip':
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = true;
      break;
    case 'repeat':
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false;
      break;
    case 'repeat-flip':
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = true;
      break;
  }
}

function applySkinToModel(
  model: THREE.Group,
  texture: THREE.Texture,
  preset: TexturePreset = 'clamped',
  alphaMode: AlphaMode = 'none',
  skinPath?: string
) {
  configureTexture(texture, preset);

  const OVERLAY_PARTS = new Set(['hat', 'jacket', 'sleeveR', 'sleeveL', 'pantsR', 'pantsL']);

  let appliedCount = 0;
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const meshName = mesh.name || '';
      const part = _getMinecraftPartFromMeshName(meshName);
      const is2ndLayer = meshName.toLowerCase().includes('2nd') && meshName.toLowerCase().includes('layer');

      mesh.renderOrder = (part && OVERLAY_PARTS.has(part)) || is2ndLayer ? 1 : 0;

      if (is2ndLayer && OVERLAY_SCALE.enabled) {
        mesh.scale.setScalar(OVERLAY_SCALE.factor);
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (!m) return;
        const mat = m as THREE.MeshPhongMaterial;
        mat.map = texture;

        switch (alphaMode) {
          case 'alphaTest':
            mat.alphaTest = 0.5;
            mat.transparent = false;
            break;
          case 'transparent':
            mat.transparent = true;
            mat.alphaTest = 0.1;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            break;
          case 'cutout':
            mat.alphaTest = 0.01;
            mat.transparent = false;
            mat.side = THREE.DoubleSide;
            break;
        }

        mat.needsUpdate = true;
        appliedCount++;
      });
    }
  });
  logger.info('messaging', 'Skin change', { path: skinPath, appliedCount, alphaMode });
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
          applySkinToModel(model, texToUse, config.texturePreset, config.alphaMode, config.skin);
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
              // In creator: cycle through non-locomotion animations
              if (getRoute() === 'creator') {
                advanceCreatorCycler();
                return;
              }
              if (!char.idleAction || char.currentAction === char.idleAction) return;
              // Don't override walk/sequence — animation manager is controlling
              if (animationManager?.isInWalkToPhase?.() || animationManager?.isBusy?.()) return;
              fadeToAction(char, char.idleAction!, 0.3);
            });

            if (idleAction) fadeToAction(characters[config.id], idleAction, 0);

            if (getRoute() === 'creator') startCreatorAnimationCycler();

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
  if (!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  logger.debug('renderer', 'Resize', { width, height });
}

let creatorPreviewTexture: THREE.CanvasTexture | null = null;
let creatorOverlayCanvas: HTMLCanvasElement | null = null;
let creatorOverlayTexture: THREE.CanvasTexture | null = null;

/** All layers using texture-region transparency (head, hat, body, jacket, sleeves, arms, legs, pants) */
const TEXTURE_LAYER_KEYS = ['head', 'hat', 'body', 'jacket', 'sleeves', 'arms', 'legs', 'pants'] as const;

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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let is3DPainting = false;

function getCharacterMeshes(): THREE.Object3D[] {
  const char = characters['runningboy'];
  if (!char) return [];
  const meshes: THREE.Object3D[] = [];
  char.model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj);
  });
  return meshes;
}

function raycastToSkinUV(clientX: number, clientY: number): { u: number; v: number } | null {
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = getCharacterMeshes();
  const intersects = raycaster.intersectObjects(meshes, false);
  if (intersects.length === 0) return null;
  const hit = intersects[0];
  const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
  if (!uv) return null;
  return { u: uv.x, v: uv.y };
}

/** Raycast and return UV for first hit that maps to a paintable layer. Passes through hidden overlays (hat, jacket, sleeves, pants) to hit base layers (head, body, arms, legs). */
function raycastToPaintableUV(clientX: number, clientY: number): { u: number; v: number } | null {
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = getCharacterMeshes();
  const intersects = raycaster.intersectObjects(meshes, false);
  const layerVisible = getLayer3DVisible();
  const layerLocked = getLayer3DLocked();
  for (const hit of intersects) {
    const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
    if (!uv) continue;
    const { x, y } = uvToWorkingCoords(uv.x, uv.y);
    const layer = getLayerAtCoords(x, y);
    if (!layer) continue;
    if (layerVisible[layer] === false) continue;
    if (layerLocked[layer] === true) continue;
    return { u: uv.x, v: uv.y };
  }
  return null;
}

function updateCreator3DCanvasCursor() {
  const canvas = renderer.domElement;
  if (getRoute() !== 'creator' || !getEditMode3D()) {
    canvas.style.cursor = '';
    return;
  }
  const tool = getActiveTool();
  if (tool === 'brush' || tool === 'eraser') {
    canvas.style.cursor = getBrushCursorStyleFor3D(getBrushSize());
  } else {
    canvas.style.cursor = '';
  }
}

function updateOrbitControlsForEditMode() {
  if (getRoute() !== 'creator') return;
  if (getEditMode3D()) {
    // Navigate: full orbit (left + right drag). Brush/Eraser/Fill: left = paint, right = orbit
    const isNavigate = getActiveTool() === 'navigate';
    controls.mouseButtons = {
      LEFT: isNavigate ? THREE.MOUSE.ROTATE : null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
  } else {
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }
}

function setupCreator3DPaint() {
  const canvas = renderer.domElement;

  function handlePointerDown(e: MouseEvent) {
    if (getRoute() !== 'creator' || !getEditMode3D()) return;
    if (e.button !== 0) return; // left only
    if (getActiveTool() === 'navigate') return; // navigate = no paint
    const uv = raycastToPaintableUV(e.clientX, e.clientY);
    if (!uv) return;
    const { x, y } = uvToWorkingCoords(uv.u, uv.v);
    if (e.altKey) {
      const hex = sampleColorAt(x, y);
      if (hex) applySampledColor(hex);
      return;
    }
    paintStartFrom3D(x, y);
    is3DPainting = true;
    e.preventDefault();
  }

  function handlePointerMove(e: MouseEvent) {
    if (getRoute() !== 'creator' || !getEditMode3D()) return;
    const uv = raycastToSkinUV(e.clientX, e.clientY);
    if (uv) {
      const { x, y } = uvToWorkingCoords(uv.u, uv.v);
      const part = getPartDisplayNameAtCoords(x, y);
      const skinX = Math.floor(x / 2);
      const skinY = Math.floor(y / 2);
      updateHoverInfo(part, skinX, skinY);
    } else {
      updateHoverInfo(null, -1, -1);
    }
    if (!is3DPainting) return;
    const paintUv = raycastToPaintableUV(e.clientX, e.clientY);
    if (!paintUv) return;
    const { x, y } = uvToWorkingCoords(paintUv.u, paintUv.v);
    paintMoveFrom3D(x, y);
    e.preventDefault();
  }

  function handle3DCanvasLeave() {
    if (getRoute() === 'creator' && getEditMode3D()) {
      updateHoverInfo(null, -1, -1);
    }
  }

  function handlePointerUp(e: MouseEvent) {
    if (e.button !== 0) return;
    if (is3DPainting) {
      paintEndFrom3D();
      is3DPainting = false;
      e.preventDefault();
    }
  }

  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  canvas.addEventListener('mouseup', handlePointerUp);
  canvas.addEventListener('mouseleave', (e) => {
    handle3DCanvasLeave();
    handlePointerUp(e);
  });

  document.addEventListener('creator-edit-mode-change', () => {
    updateOrbitControlsForEditMode();
    updateCreator3DViewPlacement();
    updateCreator3DCanvasCursor();
  });
  document.addEventListener('creator-tools-3d-change', () => {
    updateOrbitControlsForEditMode();
    updateCreator3DCanvasCursor();
  });
  updateOrbitControlsForEditMode();
  updateCreator3DViewPlacement();
  updateCreator3DCanvasCursor();
}

function updateCreator3DViewPlacement() {
  if (getRoute() !== 'creator') return;
  const app = document.getElementById('app');
  const wrapper = document.getElementById('creator-view-wrapper');
  const slot = document.getElementById('creator-3d-preview-slot');
  if (!app || !wrapper || !slot) return;
  if (getEditMode3D()) {
    if (app.parentElement !== wrapper) {
      wrapper.appendChild(app);
      onWindowResize();
      recreateOrbitControls();
    }
  } else {
    if (app.parentElement !== slot) {
      slot.appendChild(app);
      resetCameraFor2DPreview();
    }
    onWindowResize();
  }
}

/** Recreate OrbitControls after DOM move so event handling works correctly */
function recreateOrbitControls() {
  controls.dispose();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);
  updateOrbitControlsForEditMode();
}

/** Re-center and zoom out camera so the full character fits in the small 2D-mode preview */
function resetCameraFor2DPreview() {
  camera.position.set(0, 1.5, 4);
  controls.target.set(0, 1, 0);
  controls.update();
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

function animate() {
  requestAnimationFrame(animate);
  if (getRoute() === 'creator') {
    updateCreatorPreviewTexture();
  } else {
    const char = characters['runningboy'];
    if (char) {
      const allVisible = Object.fromEntries(CREATOR_LAYER_KEYS.map((k) => [k, true]));
      applyCreatorLayerVisibility(char.model, allVisible);
    }
  }
  if (paused) return;
  const delta = clock.getDelta();
  Object.values(characters).forEach((char) => char.mixer.update(delta));
  if (animationManager) animationManager.tick(delta);
  if (getRoute() !== 'creator') characterAI?.update(delta);
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
  initScene();

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

  setupCreator3DPaint();

  window.addEventListener('resize', onWindowResize);
  animate();
}

main();
