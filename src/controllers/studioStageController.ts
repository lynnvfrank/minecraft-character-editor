/**
 * The dance studio's stage dressing and camera moves (`#/studio`), next to studioController.ts
 * (which owns the dancing):
 *
 * - Backdrop: applies the saved choice (state/studioBackdrop.ts) through viewer/studioBackdrop.ts
 *   while the route is the studio and takes it out on any other route, so the home view (and its
 *   day/night), the editor, previews and thumbnails never see it.
 * - Turntable: slowly orbits the camera around whatever the orbit controls look at, keeping the
 *   distance and height it has. With backup dancers on stage it drifts onto the middle of the
 *   group. It waits while the user drags (or zooms) and stops on leaving.
 * - Framings: smooth camera moves to presets placed at the character (lib/turntable.ts). "Full
 *   body" and "Wide" take in the backup dancers; the close-up stays on the lead.
 *
 * Driven once per frame from main.ts's onWorldUpdate, like dayNightController.
 */
import * as THREE from 'three';
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { resolveBackdrop, type BackdropSettings } from '../lib/studioBackdrop';
import {
  CAMERA_FRAMINGS,
  DEFAULT_TURNTABLE_SPEED,
  GROUP_FRAMINGS,
  approach,
  easeInOut,
  groupFramingPose,
  lerpOrbit,
  orbitFromOffset,
  orbitPosition,
  stepTurntable,
  type CameraFramingId,
  type GroupShift,
  type OrbitPose,
  type Point3,
  type TurntableSpeedId,
} from '../lib/turntable';
import { createStudioBackdropView } from '../viewer/studioBackdrop';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type StudioStageControllerDeps = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The orbit controls: what the camera looks at, and when the user is dragging. */
  controls: {
    target: THREE.Vector3;
    addEventListener: (type: 'start' | 'end', listener: () => void) => void;
  };
  backdrop: { get: () => Readonly<BackdropSettings>; subscribe: (listener: () => void) => Unsubscribe };
  /** Where the dancer stands (feet), or null before it has loaded. */
  getCharacterPosition: () => Point3 | null;
  /** Visual heading of the dancer (radians). */
  getFacing: () => number;
  /** The lead plus backup dancers as one group, or null when the lead dances alone. */
  getGroupShot?: () => GroupShift | null;
};

export type StudioCameraSnapshot = { turntable: boolean; speed: TurntableSpeedId };

/** Seconds a framing button's camera move takes. */
const FRAMING_MOVE_SEC = 0.8;
/** A long frame (tab was in the background) doesn't swing the camera. */
const MAX_STEP_SEC = 0.1;
/** How fast the turntable drifts onto the middle of the group (per second, see `approach`). */
const TURNTABLE_RECENTER_RATE = 3;

export function createStudioStageController(deps: StudioStageControllerDeps) {
  const { camera, controls } = deps;
  const view = createStudioBackdropView(deps.scene);
  const slice = createSubscribable();

  // --- Backdrop ---
  let backdropDirty = true;
  deps.backdrop.subscribe(() => {
    backdropDirty = true;
  });
  const origin = { x: 0, z: 0 };

  function updateBackdrop(): void {
    const center = deps.getCharacterPosition() ?? origin;
    if (backdropDirty || !view.isApplied()) {
      backdropDirty = false;
      const settings = deps.backdrop.get();
      view.apply(resolveBackdrop(settings), settings.floor, center);
    } else {
      view.setCenter(center);
    }
  }

  // --- Camera ---
  let onStage = false;
  let turntable = false;
  let speed: TurntableSpeedId = DEFAULT_TURNTABLE_SPEED;
  let dragging = false;
  /** Counts the times the user took the camera: a drag or zoom, a framing button, the turntable. */
  let userCameraSerial = 0;
  let move: { fromTarget: Point3; toTarget: Point3; from: OrbitPose; to: OrbitPose; time: number } | null = null;

  controls.addEventListener('start', () => {
    dragging = true;
    userCameraSerial++;
    move = null; // the user takes the camera
  });
  controls.addEventListener('end', () => {
    dragging = false;
  });

  function currentOrbit(): OrbitPose {
    const t = controls.target;
    return orbitFromOffset(camera.position.x - t.x, camera.position.y - t.y, camera.position.z - t.z);
  }

  function placeCamera(target: Point3, orbit: OrbitPose): void {
    const p = orbitPosition(target, orbit.angle, orbit.radius, orbit.height);
    controls.target.set(target.x, target.y, target.z);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(controls.target);
  }

  function updateCamera(delta: number): void {
    const dt = Math.min(Math.max(delta, 0), MAX_STEP_SEC);
    if (move) {
      move.time += dt;
      const k = easeInOut(move.time / FRAMING_MOVE_SEC);
      const a = move.fromTarget;
      const b = move.toTarget;
      placeCamera(
        { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k },
        lerpOrbit(move.from, move.to, k)
      );
      if (move.time >= FRAMING_MOVE_SEC) move = null;
      return;
    }
    if (!turntable || dragging || dt === 0) return;
    // Read the pose back from the camera every frame, so zooming or dragging between frames sticks.
    const orbit = currentOrbit();
    const t = controls.target;
    const center: Point3 = { x: t.x, y: t.y, z: t.z };
    // With backup dancers the stage turns around the middle of the group, not the lead.
    const group = deps.getGroupShot?.() ?? null;
    const lead = group ? deps.getCharacterPosition() : null;
    if (group && lead) {
      center.x = approach(center.x, lead.x + group.dx, TURNTABLE_RECENTER_RATE, dt);
      center.z = approach(center.z, lead.z + group.dz, TURNTABLE_RECENTER_RATE, dt);
    }
    placeCamera(center, { ...orbit, angle: stepTurntable(orbit.angle, speed, dt) });
  }

  function leaveStage(): void {
    onStage = false;
    view.release();
    move = null;
    dragging = false;
    if (turntable) {
      turntable = false;
      slice.notify();
    }
  }

  return {
    /** Per frame, every route. */
    update(delta: number, route: Route): void {
      if (route !== 'studio') {
        if (onStage) leaveStage();
        return;
      }
      onStage = true;
      updateBackdrop();
      updateCamera(delta);
    },
    getSnapshot: (): StudioCameraSnapshot => ({ turntable, speed }),
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
    setTurntable(on: boolean): void {
      if (on === turntable || (on && !onStage)) return;
      turntable = on;
      if (on) userCameraSerial++;
      slice.notify();
    },
    setTurntableSpeed(next: TurntableSpeedId): void {
      if (next === speed) return;
      speed = next;
      slice.notify();
    },
    /**
     * How many times the user has taken the camera. The dancers controller compares it to tell
     * whether its own late re-framing would steal the camera.
     */
    userCameraSerial: (): number => userCameraSerial,
    /**
     * Glide the camera to a framing of the dancer, or of the whole group for the framings in
     * GROUP_FRAMINGS when backup dancers are on stage. False when there is no dancer yet.
     */
    frame(id: CameraFramingId): boolean {
      const p = deps.getCharacterPosition();
      if (!onStage || !p) return false;
      userCameraSerial++;
      const group = GROUP_FRAMINGS.includes(id) ? (deps.getGroupShot?.() ?? null) : null;
      const to = groupFramingPose(CAMERA_FRAMINGS[id], { x: p.x, y: p.y, z: p.z, yaw: deps.getFacing() }, group);
      const t = controls.target;
      move = { fromTarget: { x: t.x, y: t.y, z: t.z }, toTarget: to.target, from: currentOrbit(), to: to.orbit, time: 0 };
      return true;
    },
  };
}

export type StudioStageController = ReturnType<typeof createStudioStageController>;
