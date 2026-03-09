import './style.css';
import * as THREE from 'three';
import { preprocessSkinTexture } from './skinPreprocess';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createSocketManager } from './socketManager';
import { createAnimationManager, type SequenceStep, type CharacterStateLike } from './animationManager';
import { createCharacterAI } from './characterAI';
import { createFakeChatUI } from './fakeChatUI';
import { setFacingLogContextProvider } from './debugFacing';

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
const container = document.getElementById('three-canvas-container');

if (!container) {
  throw new Error('Missing #three-canvas-container element in DOM.');
}

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let controls: OrbitControls;
const characters: Record<string, CharacterState> = {};
const clock = new THREE.Clock();
let skinsList: SkinEntry[] = [];
let animationsList: AnimationEntry[] = [];

/** Composite sequences loaded from /sequences/index.json */
type Sequence = { id: string; label: string; steps: SequenceStep[] };
let sequencesList: Sequence[] = [];
let socketManager: ReturnType<typeof createSocketManager> | null = null;
let animationManager: ReturnType<typeof createAnimationManager> | null = null;
let characterAI: ReturnType<typeof createCharacterAI> | null = null;

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
  alphaMode: AlphaMode = 'none'
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
  console.info('[Skin] Applied texture to', appliedCount, 'material slot(s)', 'alpha=' + alphaMode);
}

function fadeToAction(
  char: CharacterStateLike,
  next: THREE.AnimationAction,
  duration: number = 0.5
): void {
  if (char.currentAction === next) return;

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
        console.info('Loaded:', config.label);

        model.scale.setScalar(0.01);
        model.position.set(0, 0, 0);
        if (LOG_MODEL_INFO) {
          logMeshNames(model, config.label);
          logModelUVInfo(model, config.label);
        }
        if (texture) {
          const texToUse = USE_DEBUG_TEXTURE ? createDebugTexture(64, 64) : texture;
          applySkinToModel(model, texToUse, config.texturePreset, config.alphaMode);
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
              if (char && char.idleAction && char.currentAction !== char.idleAction) {
                fadeToAction(char, char.idleAction!, 0.3);
              }
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
            (err) => console.error('FBX load error:', path, err)
          );
        }
      },
      undefined,
      (err) => console.error('Model load error:', config.model, err)
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
      applySkinToModel(char.model, processed, char.texturePreset, char.alphaMode);
      char.currentSkin = skinPath;
      highlightActiveSkin(charId, skinPath);
    },
    undefined,
    (err) => console.error('Skin load error:', skinPath, err)
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
      characterAI?.onUserActivity(true);
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
      characterAI?.onUserActivity(true);
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
      characterAI?.onUserActivity(true);
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
    const now = Date.now();
    if (now - lastMouseReport < MOUSE_THROTTLE_MS) return;
    lastMouseReport = now;
    characterAI?.onUserActivity(false);
  });
  document.addEventListener('keydown', () => characterAI?.onUserActivity(true));
}

function setupSocketEvents() {
  if (!socketManager) return;

  socketManager.on('skin', (data) => {
    const skinPath = resolveSkinByName(data.name) ?? data.name;
    const char = characters['runningboy'];
    if (char) switchSkin('runningboy', skinPath);
  });

  socketManager.on('animation', (data) => {
    const char = characters['runningboy'];
    if (!char) return;
    characterAI?.onUserActivity(true);
    animationManager?.stop();
    animationManager?.setLastActivity();
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
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  Object.values(characters).forEach((char) => char.mixer.update(delta));
  if (animationManager) animationManager.tick(delta);
  characterAI?.update(delta);
  controls.update();
  renderer.render(scene, camera);
}

async function main() {
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
    clock
  });
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

  const config = buildCharacterConfig(skins[0].path, animations);
  loadCharacter(config, skins);

  window.addEventListener('resize', onWindowResize);
  animate();
}

main();
