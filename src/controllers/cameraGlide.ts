/**
 * Eased camera glides to a saved pose (camera bookmarks), shared by the home view's photo mode
 * and the dance studio. The pose math is lib/cameraBookmarks.ts (an orbit lerp around the moving
 * look-at point, from lib/turntable.ts). Grabbing the camera (orbit drag or zoom) or changing
 * route stops a glide where it is.
 *
 * Driven once per frame with the real (unfrozen) delta, before the orbit controls update.
 */
import type * as THREE from 'three';
import { glidePose, type CameraPose } from '../lib/cameraBookmarks';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type CameraGlideDeps = {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; addEventListener: (type: 'start', listener: () => void) => void };
  /** Called once when a glide arrives (not when it is interrupted). */
  onArrive?: () => void;
};

/** A long frame (tab was in the background) doesn't jump the glide. */
const MAX_STEP_SEC = 0.1;

export function createCameraGlide(deps: CameraGlideDeps) {
  const { camera, controls } = deps;
  let glide: { from: CameraPose; to: CameraPose; time: number; route: Route | null } | null = null;

  controls.addEventListener('start', () => {
    glide = null; // the user takes the camera
  });

  function currentPose(): CameraPose {
    const p = camera.position;
    const t = controls.target;
    return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z }, fov: camera.fov };
  }

  function apply(pose: CameraPose): void {
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(controls.target);
  }

  return {
    currentPose,
    /** Start gliding to a pose from wherever the camera is now. */
    to(pose: CameraPose): void {
      glide = { from: currentPose(), to: pose, time: 0, route: null };
    },
    cancel(): void {
      glide = null;
    },
    isGliding: (): boolean => glide !== null,
    /** Per frame, every route, real time. */
    update(realDelta: number, route: Route): void {
      if (!glide) return;
      if (glide.route === null) glide.route = route;
      else if (glide.route !== route) {
        glide = null;
        return;
      }
      glide.time += Math.min(Math.max(realDelta, 0), MAX_STEP_SEC);
      const { pose, done } = glidePose(glide.from, glide.to, glide.time);
      apply(pose);
      if (done) {
        glide = null;
        deps.onArrive?.();
      }
    },
  };
}

export type CameraGlide = ReturnType<typeof createCameraGlide>;
