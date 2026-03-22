/**
 * Creator camera controller: subscribes to camera events, performs OrbitControls tweens.
 * State: zoom level (0=closest, 1=in, 2=standard, 3=out). Uses rAF-based tween (like creatorPose).
 */

import * as THREE from 'three';
import { subscribe, publish, CREATOR_EVENTS } from '../events/appEvents';
import type { CreatorPoseController } from './creatorPose';
import type { EditMode } from '../creator/api';

const TWEEN_BUTTON_MS = 350;
const PHI_MIN = 0.01;
const PHI_MAX = Math.PI - 0.01;

/** Radius per zoom level: 0=closest, 1=in, 2=standard, 3=out */
const ZOOM_RADIUS: [number, number, number, number] = [2.0, 2.8, 4, 5.6];

export type CreatorCameraControllerDeps = {
  getSceneContext: () => {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; update: () => void };
  };
  getRoute: () => 'creator' | 'viewer' | 'preview';
  getEditMode: () => EditMode;
  creatorPoseController: CreatorPoseController;
};

export type CreatorCameraController = {
  dispose: () => void;
};

function getSphericalFromCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3
): THREE.Spherical {
  const offset = camera.position.clone().sub(target);
  return new THREE.Spherical().setFromVector3(offset);
}

function applySphericalToCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  spherical: THREE.Spherical
): void {
  const offset = new THREE.Vector3().setFromSpherical(spherical);
  camera.position.copy(target).add(offset);
}

function clampToZoomLevel(radius: number): 0 | 1 | 2 | 3 {
  const d0 = Math.abs(radius - ZOOM_RADIUS[0]);
  const d1 = Math.abs(radius - ZOOM_RADIUS[1]);
  const d2 = Math.abs(radius - ZOOM_RADIUS[2]);
  const d3 = Math.abs(radius - ZOOM_RADIUS[3]);
  if (d0 <= d1 && d0 <= d2 && d0 <= d3) return 0;
  if (d1 <= d2 && d1 <= d3) return 1;
  if (d2 <= d3) return 2;
  return 3;
}

export function createCreatorCameraController(
  deps: CreatorCameraControllerDeps
): CreatorCameraController {
  let zoomLevel: 0 | 1 | 2 | 3 = 2;
  let isTweening = false;
  const unsubs: Array<() => void> = [];

  function guard(): boolean {
    if (deps.getRoute() !== 'creator') return false;
    const mode = deps.getEditMode();
    if (mode !== 'wardrobe' && mode !== '3d') return false;
    const ctx = deps.getSceneContext();
    if (!ctx?.camera || !ctx?.controls) return false;
    if (isTweening) return false;
    return true;
  }

  function startTween(): void {
    isTweening = true;
    publish(CREATOR_EVENTS.CAMERA_MOVE_START);
  }

  function endTween(): void {
    isTweening = false;
    publish(CREATOR_EVENTS.CAMERA_MOVE_END);
  }

  /** BackOut-like overshoot easing (plan: 350ms snap animation) */
  function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function tweenSpherical(
    endSpherical: { radius: number; phi: number; theta: number },
    durationMs: number
  ): void {
    const ctx = deps.getSceneContext();
    if (!ctx) return;
    const { camera, controls } = ctx;
    const start = getSphericalFromCamera(camera, controls.target);
    const end = { ...endSpherical };

    startTween();
    const startTime = performance.now();

    const tick = () => {
      const c = deps.getSceneContext();
      if (!c) return;
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = easeOutBack(t);

      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(start.radius, end.radius, eased),
        THREE.MathUtils.lerp(start.phi, end.phi, eased),
        THREE.MathUtils.lerp(start.theta, end.theta, eased)
      );
      applySphericalToCamera(c.camera, c.controls.target, s);
      c.controls.update();

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        endTween();
      }
    };
    requestAnimationFrame(tick);
  }

  function handleYawLeft(e: CustomEvent<{ degrees?: number }>): void {
    if (!guard()) return;
    const ctx = deps.getSceneContext()!;
    const s = getSphericalFromCamera(ctx.camera, ctx.controls.target);
    const deg = (e.detail?.degrees ?? 45) * (Math.PI / 180);
    tweenSpherical(
      { radius: s.radius, phi: s.phi, theta: s.theta + deg },
      TWEEN_BUTTON_MS
    );
  }

  function handleYawRight(e: CustomEvent<{ degrees?: number }>): void {
    if (!guard()) return;
    const ctx = deps.getSceneContext()!;
    const s = getSphericalFromCamera(ctx.camera, ctx.controls.target);
    const deg = (e.detail?.degrees ?? 45) * (Math.PI / 180);
    tweenSpherical(
      { radius: s.radius, phi: s.phi, theta: s.theta - deg },
      TWEEN_BUTTON_MS
    );
  }

  function handlePitchUp(e: CustomEvent<{ degrees?: number }>): void {
    if (!guard()) return;
    const ctx = deps.getSceneContext()!;
    const s = getSphericalFromCamera(ctx.camera, ctx.controls.target);
    const deg = (e.detail?.degrees ?? 30) * (Math.PI / 180);
    let newPhi = s.phi - deg;
    let newTheta = s.theta;
    if (newPhi < PHI_MIN) {
      newTheta = s.theta + Math.PI;
      newPhi = -newPhi;
    }
    tweenSpherical({ radius: s.radius, phi: newPhi, theta: newTheta }, TWEEN_BUTTON_MS);
  }

  function handlePitchDown(e: CustomEvent<{ degrees?: number }>): void {
    if (!guard()) return;
    const ctx = deps.getSceneContext()!;
    const s = getSphericalFromCamera(ctx.camera, ctx.controls.target);
    const deg = (e.detail?.degrees ?? 30) * (Math.PI / 180);
    let newPhi = s.phi + deg;
    let newTheta = s.theta;
    if (newPhi > PHI_MAX) {
      newTheta = s.theta + Math.PI;
      newPhi = 2 * Math.PI - newPhi;
    }
    tweenSpherical({ radius: s.radius, phi: newPhi, theta: newTheta }, TWEEN_BUTTON_MS);
  }

  function handleZoomIn(): void {
    if (!guard()) return;
    const ctx = deps.getSceneContext()!;
    const s = getSphericalFromCamera(ctx.camera, ctx.controls.target);
    zoomLevel = clampToZoomLevel(s.radius);
    const nextLevel = Math.max(0, zoomLevel - 1) as 0 | 1 | 2 | 3;
    zoomLevel = nextLevel;
    tweenSpherical(
      { radius: ZOOM_RADIUS[nextLevel], phi: s.phi, theta: s.theta },
      TWEEN_BUTTON_MS
    );
  }

  function handleZoomOut(): void {
    if (!guard()) return;
    const ctx = deps.getSceneContext()!;
    const s = getSphericalFromCamera(ctx.camera, ctx.controls.target);
    zoomLevel = clampToZoomLevel(s.radius);
    const nextLevel = Math.min(3, zoomLevel + 1) as 0 | 1 | 2 | 3;
    zoomLevel = nextLevel;
    tweenSpherical(
      { radius: ZOOM_RADIUS[nextLevel], phi: s.phi, theta: s.theta },
      TWEEN_BUTTON_MS
    );
  }

  function handleRecenter(): void {
    if (!guard()) return;
    startTween();
    zoomLevel = 2;
    deps.creatorPoseController
      .animateCameraToCreatorView()
      .then(() => endTween());
  }

  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_YAW_LEFT, handleYawLeft));
  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_YAW_RIGHT, handleYawRight));
  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_PITCH_UP, handlePitchUp));
  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_PITCH_DOWN, handlePitchDown));
  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_ZOOM_IN, handleZoomIn));
  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_ZOOM_OUT, handleZoomOut));
  unsubs.push(subscribe(CREATOR_EVENTS.CAMERA_RECENTER, handleRecenter));

  return {
    dispose() {
      unsubs.forEach((u) => u());
    },
  };
}
