/**
 * Three.js scene setup: camera, lights, ground, renderer.
 * Model loading helpers (applyShadowToModel, debug texture).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type SceneContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  clock: THREE.Clock;
  characters: Record<string, unknown>;
  container: HTMLElement;
};

const DEFAULT_PARAMS = new URLSearchParams();

export function initScene(
  container: HTMLElement,
  params: URLSearchParams = DEFAULT_PARAMS
): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050710);

  const aspect = container.clientWidth / container.clientHeight || 1;
  const fov = parseFloat(params.get('fov') || '45');
  const cameraZ = parseFloat(params.get('cameraZ') || '3');
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  camera.position.set(0, 1.5, cameraZ);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Filmic tone mapping: richer contrast and soft highlight roll-off (like shader packs).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);

  addLights(scene, renderer);
  addGround(scene);
  // Subtle atmospheric fade into the background.
  scene.fog = new THREE.Fog(0x050710, 8, 18);

  const clock = new THREE.Clock();
  return { scene, camera, renderer, controls, clock, characters: {}, container };
}

/**
 * Shader-pack-style lighting: warm "sun" key light with soft self-shadows,
 * cool sky ambient, a blue-ish rim light that outlines the silhouette, and a
 * soft image-based environment so faces never go fully black.
 */
export type LightingPresetId = 'shader' | 'sunset' | 'night' | 'classic';

type LightingPreset = {
  label: string;
  title: string;
  toneMapping: THREE.ToneMapping;
  exposure: number;
  envIntensity: number;
  selfShadow: boolean;
  background: number;
  hemi: [sky: number, ground: number, intensity: number];
  sun: [color: number, intensity: number, x: number, y: number, z: number];
  rim: [color: number, intensity: number];
  fill: [color: number, intensity: number];
};

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  shader: {
    label: 'Shader', title: 'Shader-pack look: warm sun, soft self-shadows, blue rim light',
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.05, envIntensity: 0.35, selfShadow: true,
    background: 0x050710,
    hemi: [0xbfd8ff, 0x3a2a1e, 0.55],
    sun: [0xfff1d6, 2.4, 2.5, 5, 3],
    rim: [0x9ab8ff, 1.6],
    fill: [0xffe6cc, 0.25],
  },
  sunset: {
    label: 'Sunset', title: 'Golden hour: low orange sun, long shadows, purple rim',
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.1, envIntensity: 0.2, selfShadow: true,
    background: 0x1a0d1f,
    hemi: [0xff9a6b, 0x2a1030, 0.45],
    sun: [0xffa040, 3.0, 4, 1.8, 2.5],
    rim: [0xb070ff, 2.2],
    fill: [0xff7050, 0.2],
  },
  night: {
    label: 'Night', title: 'Moonlight: cool blue key light with a warm torch-like fill',
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.2, envIntensity: 0.1, selfShadow: true,
    background: 0x02030a,
    hemi: [0x304070, 0x05050a, 0.4],
    sun: [0xa8c0ff, 1.4, -2, 5, 2],
    rim: [0x6080ff, 1.2],
    fill: [0xffa050, 0.9],
  },
  classic: {
    label: 'Classic', title: 'The original flat lighting (before the shader update)',
    toneMapping: THREE.NoToneMapping, exposure: 1.0, envIntensity: 0, selfShadow: false,
    background: 0x050710,
    hemi: [0xffffff, 0x202030, 1.0],
    sun: [0xffffff, 1.2, 3, 6, 4],
    rim: [0xffffff, 0],
    fill: [0xffffff, 0.4],
  },
};

export const LIGHTING_PRESET_ORDER: LightingPresetId[] = ['shader', 'sunset', 'night', 'classic'];

type LightRig = {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
};

let rig: LightRig | null = null;
let currentPreset: LightingPresetId = 'shader';

export function getLightingPreset(): LightingPresetId {
  return currentPreset;
}

/** Switch the whole scene's lighting look. Safe to call any time after initScene. */
export function setLightingPreset(id: LightingPresetId): void {
  currentPreset = id;
  if (!rig) return;
  const p = LIGHTING_PRESETS[id];
  const { scene, renderer, hemi, sun, rim, fill } = rig;
  if (renderer) {
    renderer.toneMapping = p.toneMapping;
    renderer.toneMappingExposure = p.exposure;
  }
  scene.environmentIntensity = p.envIntensity;
  (scene.background as THREE.Color).setHex(p.background);
  if (scene.fog) scene.fog.color.setHex(p.background);
  hemi.color.setHex(p.hemi[0]); hemi.groundColor.setHex(p.hemi[1]); hemi.intensity = p.hemi[2];
  sun.color.setHex(p.sun[0]); sun.intensity = p.sun[1]; sun.position.set(p.sun[2], p.sun[3], p.sun[4]);
  rim.color.setHex(p.rim[0]); rim.intensity = p.rim[1]; rim.visible = p.rim[1] > 0;
  fill.color.setHex(p.fill[0]); fill.intensity = p.fill[1];
  // Toggle self-shadowing on every character mesh (ground keeps receiving shadows).
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.castShadow) mesh.receiveShadow = p.selfShadow;
    // Materials must recompile when tone mapping / shadow receipt changes.
    const mats = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    mats.forEach((m) => { if (m) m.needsUpdate = true; });
  });
}

export function addLights(scene: THREE.Scene, renderer?: THREE.WebGLRenderer): void {
  // Soft image-based ambient (gives gentle directional shading on every face).
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
  }

  // Sky (cool) / ground bounce (warm) ambient.
  const hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x3a2a1e, 0.55);
  hemiLight.position.set(0, 4, 0);
  scene.add(hemiLight);

  // Key light: warm late-afternoon sun.
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(2.5, 5, 3);
  sun.target.position.set(0, 1, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Tight frustum around the character = much sharper, cleaner shadows.
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 14;
  sun.shadow.camera.left = -2.5;
  sun.shadow.camera.right = 2.5;
  sun.shadow.camera.top = 3;
  sun.shadow.camera.bottom = -2;
  // These two settings remove the striped "shadow acne" on the boxy limbs,
  // which is what let us turn self-shadowing back on.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun);
  scene.add(sun.target);

  // Rim light from behind: cool edge highlight that separates the character from the background.
  const rim = new THREE.DirectionalLight(0x9ab8ff, 1.6);
  rim.position.set(-3, 3, -4);
  scene.add(rim);

  // Gentle fill from below so undersurfaces (chin, soles) stay readable while painting.
  const fillLight = new THREE.DirectionalLight(0xffe6cc, 0.25);
  fillLight.position.set(0, -4, 2);
  scene.add(fillLight);

  rig = { scene, renderer, hemi: hemiLight, sun, rim, fill: fillLight };
}

/** Default on/off for the camera-following light. Set to false to disable at startup. */
export const CREATOR_CAMERA_LIGHT_ENABLED = true;

let creatorCameraLight: THREE.PointLight | null = null;
let creatorCameraLightEnabled = CREATOR_CAMERA_LIGHT_ENABLED;

/**
 * Sets up the camera-following light for creator 3D paint mode.
 * The light moves with the camera so whatever surface the user is painting is lit.
 * Call once after scene init with the main camera.
 */
export function setupCreatorCameraLight(camera: THREE.PerspectiveCamera): void {
  if (creatorCameraLight) return;
  const light = new THREE.PointLight(0xffffff, 0.6, 8);
  light.position.set(0, 0, 2); // In camera space: 2 units in front of camera
  camera.add(light);
  creatorCameraLight = light;
  light.visible = creatorCameraLightEnabled;
}

/**
 * Toggle the camera-following light on/off (e.g. for creator 3D undersurface painting).
 * Set to true to light surfaces from the camera's viewpoint; false to use scene lights only.
 */
export function setCreatorCameraLightEnabled(enabled: boolean): void {
  creatorCameraLightEnabled = enabled;
  if (creatorCameraLight) creatorCameraLight.visible = enabled;
}

export function isCreatorCameraLightEnabled(): boolean {
  return creatorCameraLightEnabled;
}

export function addGround(scene: THREE.Scene): void {
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

export function applyShadowToModel(model: THREE.Group): void {
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      // Self-shadowing (head shading the body, arms on torso). Acne is prevented by
      // the sun's shadow.bias / normalBias in addLights.
      mesh.receiveShadow = LIGHTING_PRESETS[currentPreset].selfShadow;
    }
  });
}

export function logModelUVInfo(model: THREE.Group, label: string): void {
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

export function logMeshNames(model: THREE.Group, label: string): void {
  const names: string[] = [];
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      names.push((obj as THREE.Mesh).name || '(unnamed)');
    }
  });
  console.info(`[${label}] Mesh names:`, names);
}

export function createDebugTexture(width: number, height: number): THREE.CanvasTexture {
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
