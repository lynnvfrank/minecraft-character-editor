/**
 * The home view's block village: builds it (domain/blockWorld.ts), draws it
 * (viewer/blockWorldMesh.ts), and hands out the walk rules that keep characters out of houses,
 * trees and the pond: a CrowdNav for the crowd and planWalk/clampWalkTarget for the animation
 * manager (the selected character's Move panel and AI walks).
 *
 * The village shows in the home view and the editor; preview keeps the plain ground disc, and
 * thumbnail captures hide it (viewer/thumbnailCapture.ts).
 * Turn it off with `?world=0`.
 */
import * as THREE from 'three';
import { buildBlockWorld, walkableCellsWithin, type BlockWorld } from '../domain/blockWorld';
import { findPath, isClearAt, isWalkableAt, nearestWalkable } from '../lib/gridPath';
import type { CrowdNav } from '../animation/crowd';
import { createBlockWorldMesh, setGroundVisible } from '../viewer';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

/** Half a character's width: paths keep the body this far from walls. */
const BODY_RADIUS = 0.3;
/** Wander targets stay this far inside the map edge so nobody idles on the cliff. */
const WANDER_MARGIN = 3;

export type BlockWorldController = ReturnType<typeof createBlockWorldController>;

export function createBlockWorldController(scene: THREE.Scene) {
  const world: BlockWorld = buildBlockWorld();
  const view = createBlockWorldMesh(world);
  const group = view.group;
  group.visible = false;
  scene.add(group);

  const halfSize = Math.min(world.cols, world.rows) / 2;
  const route = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    findPath(world.nav, from, to, { radius: BODY_RADIUS });

  const crowdNav: CrowdNav = {
    spots: walkableCellsWithin(world, halfSize - WANDER_MARGIN),
    gates: world.gates,
    findPath: route,
    // A little under BODY_RADIUS so a sidestep along a wall isn't refused outright.
    isClear: (p) => isClearAt(world.nav, p, BODY_RADIUS * 0.8),
  };

  /** Keep a walk target on the map and on walkable ground (in place). */
  function clampWalkTarget(target: THREE.Vector3): void {
    target.y = 0;
    const max = halfSize - 0.5;
    target.x = THREE.MathUtils.clamp(target.x, -max, max);
    target.z = THREE.MathUtils.clamp(target.z, -max, max);
    if (!isWalkableAt(world.nav, target)) {
      const near = nearestWalkable(world.nav, target);
      if (near) target.set(near.x, 0, near.z);
    }
  }

  function planWalk(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const path = route(from, to);
    return path ? path.map((p) => new THREE.Vector3(p.x, 0, p.z)) : null;
  }

  /** Editor camera: hide blocks between it and the character (see setCutaway). */
  const CUTAWAY_RADIUS = 0.9;
  const lastEye = new THREE.Vector3(Infinity, 0, 0);
  const lastFocus = new THREE.Vector3(Infinity, 0, 0);
  let cutawayOn = false;

  /** Per frame, editor only: keep the view from the camera to `focus` clear of walls and trees. */
  function updateCutaway(eye: THREE.Vector3 | null, focus: THREE.Vector3 | null): void {
    if (!eye || !focus) {
      if (cutawayOn) view.setCutaway(null);
      cutawayOn = false;
      return;
    }
    if (cutawayOn && eye.distanceToSquared(lastEye) < 1e-6 && focus.distanceToSquared(lastFocus) < 1e-6) return;
    lastEye.copy(eye);
    lastFocus.copy(focus);
    cutawayOn = true;
    view.setCutaway({ eye, focus, radius: CUTAWAY_RADIUS });
  }

  let shown: boolean | null = null;
  /**
   * Per frame: the village shows in the home view and the editor (the character stays where it
   * was), in place of the ground disc. Preview renders keep the plain ground.
   */
  function update(r: Route): void {
    const show = r === 'viewer' || r === 'creator';
    if (show === shown) return;
    shown = show;
    group.visible = show;
    setGroundVisible(!show);
  }

  return {
    world,
    crowdNav,
    clampWalkTarget,
    planWalk,
    update,
    updateCutaway,
    /** Is the village on screen (home view and editor)? */
    isShown: () => shown === true,
    /** Lamp block centers and their glow, for day/night (controllers/dayNightController.ts). */
    lampPositions: world.blocks.filter((b) => b.kind === 'lamp').map((b) => ({ x: b.x, y: b.y, z: b.z })),
    setLampGlow: view.setLampGlow,
    /** Distance from the origin the camera may pan to (the map's corner). */
    roamRadius: Math.hypot(halfSize, halfSize),
  };
}
