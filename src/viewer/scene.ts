/**
 * Three.js scene setup: camera, lights, ground, renderer.
 * Model loading helpers (applyShadowToModel, debug texture).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);

  addLights(scene);
  addGround(scene);

  const clock = new THREE.Clock();
  return { scene, camera, renderer, controls, clock, characters: {}, container };
}

export function addLights(scene: THREE.Scene): void {
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

  // Fill light from below: illuminates undersurfaces (bottom of head, legs, soles).
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(0, -4, 2);
  scene.add(fillLight);
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
      mesh.receiveShadow = true;
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
