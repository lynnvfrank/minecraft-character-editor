/**
 * Photo mode in the home view (the village). Owns the mode's state; the bar is ui/photoModeBar.ts.
 *
 * - Entering sets `body[data-photo-mode]`; styles/_photo-mode.scss hides every bit of chrome
 *   except the photo bar and toasts. Exiting (button, Escape, or leaving the home view) removes it.
 * - Lens (field of view) and Tilt (camera roll) apply while in photo mode; the lens is restored
 *   and the roll dropped on exit.
 * - The camera may go lower (max polar angle 89°, re-applied every frame after the selection
 *   controller sets the home limit; the selection controller puts 84° back on the next frame
 *   after exit).
 * - Freeze stops the world, not the camera: `timeScale()` is 0, and the animation loop scales the
 *   world's delta by it (mixers, crowd, character AI, day/night auto, weather particles), while
 *   the orbit controls, glides and rendering keep running on real time.
 * - The selection ring is hidden each frame just before render, so it is never in a shot.
 */
import type * as THREE from 'three';
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { PHOTO_MAX_POLAR_DEG, clampFov, clampTilt } from '../lib/photoMode';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type PhotoModeDeps = {
  camera: THREE.PerspectiveCamera;
  controls: { maxPolarAngle: number };
  scene: THREE.Scene;
  getRoute: () => Route;
  /** Called on entering and leaving (e.g. to stop a recording). */
  onExit?: () => void;
};

export type PhotoModeSnapshot = { active: boolean; frozen: boolean; fov: number; tilt: number };

const SELECTION_RING_NAME = 'selection-ring';
const DEG = Math.PI / 180;

export function createPhotoModeController(deps: PhotoModeDeps) {
  const { camera } = deps;
  const slice = createSubscribable();
  let active = false;
  let frozen = false;
  let tilt = 0;
  let savedFov = camera.fov;

  function setBodyFlag(): void {
    if (active) document.body.dataset.photoMode = frozen ? 'frozen' : 'on';
    else delete document.body.dataset.photoMode;
  }

  function setLens(fov: number): void {
    if (camera.fov === fov) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  function enter(): void {
    if (active || deps.getRoute() !== 'viewer') return;
    active = true;
    savedFov = camera.fov;
    frozen = false;
    tilt = 0;
    setBodyFlag();
    slice.notify();
  }

  function exit(): void {
    if (!active) return;
    active = false;
    frozen = false;
    tilt = 0;
    setLens(savedFov);
    setBodyFlag();
    deps.onExit?.();
    slice.notify();
  }

  return {
    enter,
    exit,
    isActive: () => active,
    getSnapshot: (): PhotoModeSnapshot => ({ active, frozen, fov: camera.fov, tilt }),
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
    setFrozen(on: boolean): void {
      if (!active || on === frozen) return;
      frozen = on;
      setBodyFlag();
      slice.notify();
    },
    setFov(fov: number): void {
      if (!active) return;
      setLens(clampFov(fov, camera.fov));
      slice.notify();
    },
    setTilt(degrees: number): void {
      if (!active) return;
      tilt = clampTilt(degrees);
      slice.notify();
    },
    /** A glide changed the lens: let the bar catch up. */
    refresh: () => slice.notify(),
    /** For the animation loop: 0 while frozen. */
    timeScale: (): number => (active && frozen ? 0 : 1),
    /** Per frame, real time, after the world update and before the orbit controls update. */
    update(route: Route): void {
      if (!active) return;
      if (route !== 'viewer') {
        exit();
        return;
      }
      deps.controls.maxPolarAngle = PHOTO_MAX_POLAR_DEG * DEG;
    },
    /** Per frame, after the orbit controls update (which resets the camera's roll). */
    beforeRender(): void {
      if (!active) return;
      if (tilt !== 0) camera.rotateZ(-tilt * DEG);
      const ring = deps.scene.getObjectByName(SELECTION_RING_NAME);
      if (ring) ring.visible = false;
    },
  };
}

export type PhotoModeController = ReturnType<typeof createPhotoModeController>;
