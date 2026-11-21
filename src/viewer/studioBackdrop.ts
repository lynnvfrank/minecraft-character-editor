/**
 * Draws a dance studio backdrop (lib/studioBackdrop.ts) into the scene and takes it out again.
 *
 * Nothing here is permanent: `apply` lays the backdrop over the scene's own sky through
 * scene.ts `setStageBackdrop` (the sky keeps following the theme underneath), and `release` puts
 * the scene back exactly. The ground is hidden through its *material*, not `ground.visible`, which
 * belongs to the block world, thumbnails and transparent photos.
 *
 * - solid: background and fog in one color.
 * - gradient: a small canvas texture as the (screen-filling) background; fog takes the color near
 *   the horizon so the floor fades into it.
 * - spotlight: dark background, dimmed ambient light, and in place of the ground an unlit disc with
 *   a soft pool of light painted on it plus a shadow catcher (the sun already casts shadows; no new
 *   lights).
 */
import * as THREE from 'three';
import { gradientColorAt, type BackdropDef, type GradientStop } from '../lib/studioBackdrop';
import { setStageBackdrop } from './scene';
import { STUDIO_BACKDROP_NAME } from './stagePhoto';

/** Where on a gradient (0 top, 1 bottom) the far edge of the floor usually sits on screen. */
const HORIZON_AT = 0.55;
/** Spotlight floor disc radius, and how the light falls off across it (fractions of the radius). */
const SPOT_FLOOR_RADIUS = 9;
const SPOT_POOL_STOPS: readonly [at: number, alpha: number][] = [[0, 0.9], [0.1, 0.62], [0.22, 0.24], [0.36, 0.05], [0.5, 0]];
const SPOT_AMBIENT_SCALE = 0.4;
const SPOT_SUN_SCALE = 0.9;
const SPOT_SHADOW_OPACITY = 0.5;

function gradientTexture(stops: readonly GradientStop[]): THREE.Texture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const fill = ctx.createLinearGradient(0, 0, 0, canvas.height);
  for (const s of stops) fill.addColorStop(s.at, s.color);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function spotFloorTexture(color: string, light: string): THREE.Texture | null {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  const pool = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, alpha] of SPOT_POOL_STOPS) pool.addColorStop(at, hexWithAlpha(light, alpha));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function createStudioBackdropView(scene: THREE.Scene) {
  /** Disposable things the current backdrop made. */
  let texture: THREE.Texture | null = null;
  let group: THREE.Group | null = null;
  let groundMaterial: THREE.Material | null = null;
  let applied = false;

  function disposeGroup(): void {
    if (!group) return;
    scene.remove(group);
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const m = mesh.material as THREE.Material & { map?: THREE.Texture | null };
      m.map?.dispose();
      m.dispose();
    });
    group = null;
  }

  function setGroundShown(shown: boolean): void {
    if (!groundMaterial) {
      const ground = scene.getObjectByName('ground') as THREE.Mesh | undefined;
      groundMaterial = ground?.isMesh ? (ground.material as THREE.Material) : null;
    }
    if (groundMaterial) groundMaterial.visible = shown;
  }

  function buildSpotFloor(color: string, light: string): THREE.Group {
    const g = new THREE.Group();
    g.name = STUDIO_BACKDROP_NAME;
    const geo = new THREE.CircleGeometry(SPOT_FLOOR_RADIUS, 64);
    // Unlit and not tone mapped, so its rim is exactly the background color: no visible edge.
    const floor = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: spotFloorTexture(color, light), color: 0xffffff, toneMapped: false, fog: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    const shadow = new THREE.Mesh(
      geo.clone(),
      new THREE.ShadowMaterial({ opacity: SPOT_SHADOW_OPACITY, fog: false, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    shadow.receiveShadow = true;
    shadow.renderOrder = 1;
    g.add(floor, shadow);
    return g;
  }

  /** Take the backdrop out: the scene's own sky, fog, lights and ground are back as they were. */
  function release(): void {
    if (!applied) return;
    applied = false;
    setStageBackdrop(null);
    setGroundShown(true);
    disposeGroup();
    texture?.dispose();
    texture = null;
  }

  /** Show `def` (replacing whatever backdrop was showing). `floor: false` hides the ground. */
  function apply(def: BackdropDef, floor: boolean, center: { x: number; z: number }): void {
    release();
    applied = true;
    switch (def.kind) {
      case 'default':
        setGroundShown(floor);
        break;
      case 'solid': {
        const color = new THREE.Color(def.color);
        setStageBackdrop({ background: color, fog: color.clone(), ambientScale: 1, sunScale: 1 });
        setGroundShown(floor);
        break;
      }
      case 'gradient': {
        texture = gradientTexture(def.stops);
        const horizon = new THREE.Color(gradientColorAt(def.stops, HORIZON_AT));
        setStageBackdrop({ background: texture ?? horizon.clone(), fog: horizon, ambientScale: 1, sunScale: 1 });
        setGroundShown(floor);
        break;
      }
      case 'spotlight': {
        const color = new THREE.Color(def.color);
        setStageBackdrop({ background: color, fog: color.clone(), ambientScale: SPOT_AMBIENT_SCALE, sunScale: SPOT_SUN_SCALE });
        // Its own floor stands in for the ground.
        setGroundShown(false);
        if (floor) {
          group = buildSpotFloor(def.color, def.light);
          scene.add(group);
          setCenter(center);
        }
        break;
      }
    }
  }

  /** Keep the spotlight under the dancer (cheap; call any time). */
  function setCenter(center: { x: number; z: number }): void {
    group?.position.set(center.x, 0, center.z);
  }

  return { apply, release, setCenter, isApplied: () => applied };
}

export type StudioBackdropView = ReturnType<typeof createStudioBackdropView>;
