/**
 * The home view's block village: builds it (domain/blockWorld.ts), draws it
 * (viewer/blockWorldMesh.ts), and hands out the walk rules that keep characters out of houses,
 * trees and the pond: a CrowdNav for the crowd and planWalk/clampWalkTarget for the animation
 * manager (the selected character's Move panel and AI walks).
 *
 * The village only shows in the home view; the creator and preview keep the plain ground disc.
 * Turn it off with `?world=0`.
 */
import * as THREE from 'three';
import { buildBlockWorld, walkableCellsWithin, type BlockWorld } from '../domain/blockWorld';
import { findPath, isClearAt, isWalkableAt, nearestWalkable } from '../lib/gridPath';
import type { CrowdNav } from '../animation/crowd';
import { createBlockWorldMesh, setGroundVisible } from '../viewer';

type Route = 'creator' | 'viewer' | 'preview';

/** Half a character's width: paths keep the body this far from walls. */
const BODY_RADIUS = 0.3;
/** Wander targets stay this far inside the map edge so nobody idles on the cliff. */
const WANDER_MARGIN = 3;

export type BlockWorldController = ReturnType<typeof createBlockWorldController>;

export function createBlockWorldController(scene: THREE.Scene) {
  const world: BlockWorld = buildBlockWorld();
  const group = createBlockWorldMesh(world);
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

  let shown: boolean | null = null;
  /** Per frame: the village shows in the home view only, in place of the ground disc. */
  function update(r: Route): void {
    const show = r === 'viewer';
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
    /** Distance from the origin the camera may pan to (the map's corner). */
    roamRadius: Math.hypot(halfSize, halfSize),
  };
}
