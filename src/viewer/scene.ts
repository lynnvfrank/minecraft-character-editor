/**
 * Three.js scene setup: camera, lights, ground, renderer.
 * Model loading helpers (applyShadowToModel, debug texture).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { RGB, Vec3 } from '../lib/dayNight';

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
  renderer.toneMappingExposure = 1.3;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);

  addLights(scene, renderer);
  addGround(scene);
  // Subtle atmospheric fade into the background. Far enough out that the whole creative zone
  // stays clear, close enough that characters walking in appear out of the haze.
  scene.fog = new THREE.Fog(0x050710, 14, 36);

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
    // Brightened 2026-11-13: more ambient + under-fill so feet, chin and arm undersides stay readable.
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.3, envIntensity: 0.7, selfShadow: true,
    background: 0x050710,
    hemi: [0xdfeaff, 0x8a7a68, 1.1],
    sun: [0xfff1d6, 2.6, 2.5, 5, 3],
    rim: [0x9ab8ff, 1.4],
    fill: [0xfff0e0, 0.9],
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
  /**
   * What the lights are set to before day/night: the startup values from addLights (slightly
   * different from the 'shader' preset), then whichever preset was last picked.
   */
  base: LightValues;
};

type LightValues = Pick<LightingPreset, 'envIntensity' | 'hemi' | 'sun' | 'rim' | 'fill'>;

let rig: LightRig | null = null;
let currentPreset: LightingPresetId = 'shader';

/**
 * Day-sky colors supplied by the app theme (ui/theme.ts). Presets with their own mood
 * (sunset, night) keep their background; the neutral presets use the theme's sky.
 */
export type SkyTheme = { background: number; ground: number };
let skyTheme: SkyTheme | null = null;
const THEMED_PRESETS: ReadonlySet<LightingPresetId> = new Set(['shader', 'classic']);

/** Background and fog color: the preset's (or theme's) sky, times day/night if set. */
function applyBackground(): void {
  if (!rig) return;
  const { scene } = rig;
  const p = LIGHTING_PRESETS[currentPreset];
  const background = skyTheme && THEMED_PRESETS.has(currentPreset) ? skyTheme.background : p.background;
  const sky = (skyColor ??= scene.background as THREE.Color).setHex(background);
  if (dayNight) {
    // Scale in sRGB (the space the hex colors are written in) so dusk reads orange, not grey.
    sky.getRGB(scratchRgb, THREE.SRGBColorSpace);
    sky.setRGB(
      Math.min(1, scratchRgb.r * dayNight.skyScale[0]),
      Math.min(1, scratchRgb.g * dayNight.skyScale[1]),
      Math.min(1, scratchRgb.b * dayNight.skyScale[2]),
      THREE.SRGBColorSpace
    );
  }
  // A stage backdrop (the dance studio) shows instead of the sky, which keeps tracking the theme underneath.
  scene.background = stageBackdrop?.background ?? sky;
  if (scene.fog) scene.fog.color.copy(stageBackdrop?.fog ?? sky);
  // Weather thickens the fog through day/night's fogScale; without one the distances are the scene's own.
  if (scene.fog instanceof THREE.Fog) {
    fogBase ??= [scene.fog.near, scene.fog.far];
    const k = dayNight?.fogScale ?? 1;
    scene.fog.near = fogBase[0] * k;
    scene.fog.far = fogBase[1] * k;
  }
}
/** The scene fog's own near and far distances (read the first time the background is applied). */
let fogBase: [number, number] | null = null;

/**
 * A backdrop shown in place of the sky (the dance studio; see viewer/studioBackdrop.ts). While set,
 * theme and preset changes keep updating the sky underneath but don't show; null puts the sky back
 * exactly. The scales multiply the active preset's ambient and sun strengths (1 = unchanged).
 */
export type StageBackdrop = {
  background: THREE.Color | THREE.Texture;
  fog: THREE.Color;
  ambientScale: number;
  sunScale: number;
};
let stageBackdrop: StageBackdrop | null = null;
/** The scene's own sky color object (scene.background unless a stage backdrop is showing). */
let skyColor: THREE.Color | null = null;

export function setStageBackdrop(backdrop: StageBackdrop | null): void {
  if (!backdrop && !stageBackdrop) return;
  stageBackdrop = backdrop;
  applyLightValues();
}

function applySky(): void {
  if (!rig) return;
  const { scene } = rig;
  applyBackground();
  const groundColor = skyTheme && THEMED_PRESETS.has(currentPreset) ? skyTheme.ground : GROUND_DEFAULT_COLOR;
  scene.traverse((obj) => {
    if (obj.name === 'ground' && (obj as THREE.Mesh).isMesh) {
      ((obj as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(groundColor);
    }
  });
}

export function setSkyTheme(sky: SkyTheme | null): void {
  skyTheme = sky;
  applySky();
}

/**
 * Day/night on top of the active preset (the home view; see controllers/dayNightController.ts and
 * lib/dayNight.ts). Everything is relative to the preset: scales of 1, white tints and
 * `presetDirection: 1` leave it exactly as it is, so `null` and "midday" look the same.
 */
export type DayNightLighting = {
  /** Per-channel multiplier on the background / fog color. */
  skyScale: RGB;
  /** Unit vector toward the key light (sun or moon). */
  lightDirection: Vec3;
  /** `lightDirection` at midday; a preset whose sun is elsewhere keeps its own direction then. */
  referenceDirection: Vec3;
  /** 1 at midday: how much of the preset's own sun direction to keep (see referenceDirection). */
  presetDirection: number;
  sunTint: RGB;
  sunScale: number;
  /** Applied to the sky/ground ambient, the rim and fill lights and the image-based ambient. */
  ambientTint: RGB;
  ambientScale: number;
  /** Multiplier on the fog's near/far distances (weather: below 1 is thicker). Default 1. */
  fogScale?: number;
};

let dayNight: DayNightLighting | null = null;
const scratchRgb = { r: 0, g: 0, b: 0 };
const scratchDir = new THREE.Vector3();

const scratchColor = new THREE.Color();

function tint(color: THREE.Color, hex: number, t: RGB | null): void {
  color.setHex(hex);
  // Light colors multiply in the renderer's (linear) working space, like stacking a gel on a lamp.
  if (t) color.multiply(scratchColor.setRGB(t[0], t[1], t[2], THREE.SRGBColorSpace));
}

/** Light colors, strengths and the sun's position: the rig's base values, times day/night if set. */
function applyLightValues(): void {
  if (!rig) return;
  const p = rig.base;
  const { scene, hemi, sun, rim, fill } = rig;
  const dn = dayNight;
  const ambient = (dn ? dn.ambientScale : 1) * (stageBackdrop?.ambientScale ?? 1);
  scene.environmentIntensity = p.envIntensity * ambient;
  applyBackground();
  tint(hemi.color, p.hemi[0], dn?.ambientTint ?? null);
  tint(hemi.groundColor, p.hemi[1], dn?.ambientTint ?? null);
  hemi.intensity = p.hemi[2] * ambient;
  tint(sun.color, p.sun[0], dn?.sunTint ?? null);
  sun.intensity = p.sun[1] * (dn ? dn.sunScale : 1) * (stageBackdrop?.sunScale ?? 1);
  if (dn) {
    // Same distance as the preset's sun, along the day/night direction (shifted by however far
    // this preset's sun is from the reference one, so midday is the preset's own direction).
    const dist = Math.hypot(p.sun[2], p.sun[3], p.sun[4]);
    const k = dn.presetDirection;
    scratchDir
      .set(
        dn.lightDirection[0] + (p.sun[2] / dist - dn.referenceDirection[0]) * k,
        dn.lightDirection[1] + (p.sun[3] / dist - dn.referenceDirection[1]) * k,
        dn.lightDirection[2] + (p.sun[4] / dist - dn.referenceDirection[2]) * k
      )
      .normalize()
      .multiplyScalar(dist);
    sun.position.set(scratchDir.x + sunFocus.x, scratchDir.y, scratchDir.z + sunFocus.z);
  } else {
    sun.position.set(p.sun[2] + sunFocus.x, p.sun[3], p.sun[4] + sunFocus.z);
  }
  tint(rim.color, p.rim[0], dn?.ambientTint ?? null);
  rim.intensity = p.rim[1] * ambient;
  rim.visible = p.rim[1] > 0;
  tint(fill.color, p.fill[0], dn?.ambientTint ?? null);
  fill.intensity = p.fill[1] * ambient;
}

/**
 * Lay day/night over the active lighting preset, or pass null to go back to the plain preset.
 * Cheap enough to call every frame the time changes (no material recompiles).
 */
export function setDayNightLighting(lighting: DayNightLighting | null): void {
  if (!lighting && !dayNight) return;
  dayNight = lighting;
  applyLightValues();
}

/**
 * Drop day/night for a moment (thumbnail captures render the plain preset) and get back a function
 * that puts it back.
 */
export function suspendDayNightLighting(): () => void {
  const was = dayNight;
  if (!was) return () => {};
  setDayNightLighting(null);
  return () => setDayNightLighting(was);
}

export function getLightingPreset(): LightingPresetId {
  return currentPreset;
}

/** Switch the whole scene's lighting look. Safe to call any time after initScene. */
export function setLightingPreset(id: LightingPresetId): void {
  currentPreset = id;
  if (!rig) return;
  const p = LIGHTING_PRESETS[id];
  const { scene, renderer } = rig;
  rig.base = p;
  if (renderer) {
    renderer.toneMapping = p.toneMapping;
    renderer.toneMappingExposure = p.exposure;
  }
  applySky();
  applyLightValues();
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
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
  }

  // Sky (cool) / ground bounce (warm) ambient.
  const hemiLight = new THREE.HemisphereLight(0xdfeaff, 0x8a7a68, 1.1);
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
  const fillLight = new THREE.DirectionalLight(0xfff0e0, 0.9);
  fillLight.position.set(0, -4, 2);
  scene.add(fillLight);

  rig = {
    scene, renderer, hemi: hemiLight, sun, rim, fill: fillLight,
    // Keep in step with the light values above.
    base: {
      envIntensity: renderer ? 0.7 : 1,
      hemi: [0xdfeaff, 0x8a7a68, 1.1],
      sun: [0xfff1d6, 2.4, 2.5, 5, 3],
      rim: [0x9ab8ff, 1.6],
      fill: [0xfff0e0, 0.9],
    },
  };
}

/** Ground point the sun's shadow frustum is centered on (see setSunFocus). */
const sunFocus = { x: 0, z: 0 };

/**
 * Center the sun's (tight) shadow frustum on a ground point, normally where the camera looks.
 * Keeps shadows crisp anywhere in the home view's creative space, not just at the origin.
 * Shifts the sun by the change in focus so lighting presets keep their direction.
 */
export function setSunFocus(x: number, z: number): void {
  if (!rig) return;
  const dx = x - sunFocus.x;
  const dz = z - sunFocus.z;
  if (dx === 0 && dz === 0) return;
  sunFocus.x = x;
  sunFocus.z = z;
  rig.sun.position.x += dx;
  rig.sun.position.z += dz;
  rig.sun.target.position.set(x, 1, z);
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

const GROUND_DEFAULT_COLOR = 0x1b1f3b;
/** Ground disc radius: past the crowd's entry circle and into the fog. */
const GROUND_RADIUS = 40;

export function addGround(scene: THREE.Scene): void {
  const geo = new THREE.CircleGeometry(GROUND_RADIUS, 96);
  const mat = new THREE.MeshStandardMaterial({
    color: GROUND_DEFAULT_COLOR,
    metalness: 0.0,
    roughness: 0.8
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

/** Show or hide the ground disc (the home view's block village replaces it). */
export function setGroundVisible(visible: boolean): void {
  rig?.scene.getObjectByName('ground')?.traverse((o) => (o.visible = visible));
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
