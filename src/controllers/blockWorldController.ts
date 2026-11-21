/**
 * The home view's block village: builds it (domain/blockWorld.ts), draws it
 * (viewer/blockWorldMesh.ts), and hands out the walk rules that keep characters out of houses,
 * trees and the pond: a CrowdNav for the crowd and planWalk/clampWalkTarget for the animation
 * manager (the selected character's Move panel and AI walks).
 *
 * The village shows in the home view and the editor; preview keeps the plain ground disc, and
 * thumbnail captures hide it (viewer/thumbnailCapture.ts).
 * Build mode (controllers/villageEditorController.ts) repaints it through setMap.
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

export function createBlockWorldController(scene: THREE.Scene, initialMap?: readonly string[]) {
  let world: BlockWorld = buildBlockWorld(initialMap);
  let view = createBlockWorldMesh(world);
  view.group.visible = false;
  scene.add(view.group);

  const halfSize = Math.min(world.cols, world.rows) / 2;
  const route = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    findPath(world.nav, from, to, { radius: BODY_RADIUS });

  /** The crowd's view of the village. One object for good: setMap refreshes its lists in place. */
  const crowdNav: { -readonly [K in keyof CrowdNav]: CrowdNav[K] } = {
    spots: [],
    gates: [],
    findPath: route,
    // A little under BODY_RADIUS so a sidestep along a wall isn't refused outright.
    isClear: (p) => isClearAt(world.nav, p, BODY_RADIUS * 0.8),
  };
  let lampPositions: { x: number; y: number; z: number }[] = [];

  /** Everything derived from `world` (wander spots, plaza, rest/shelter spots, gates, lamps). */
  function derive(): void {
    const spots = walkableCellsWithin(world, halfSize - WANDER_MARGIN);
    const isSpot = (p: { x: number; z: number }) => spots.some((s) => s.x === p.x && s.z === p.z);
    crowdNav.spots = spots;
    // Where gatherings meet (may be empty: the crowd then meets on any open ground), and where
    // residents like to stand after dark or in the rain (lamp posts, doorsteps).
    crowdNav.plaza = world.plaza.filter(isSpot);
    crowdNav.restSpots = [...world.lampSides, ...world.doorsteps].filter(isSpot);
    crowdNav.gates = world.gates;
    lampPositions = world.blocks.filter((b) => b.kind === 'lamp').map((b) => ({ x: b.x, y: b.y, z: b.z }));
  }
  derive();

  const changeListeners = new Set<() => void>();

  /**
   * Rebuild the village from a new map (Build mode): data, nav grid, mesh and every derived list.
   * Listeners then move anyone off newly blocked ground and refresh the lamp lights.
   */
  function setMap(map: readonly string[]): void {
    world = buildBlockWorld(map);
    const old = view;
    view = createBlockWorldMesh(world);
    view.group.visible = old.group.visible;
    scene.add(view.group);
    scene.remove(old.group);
    old.dispose();
    if (cutawayOn) view.setCutaway({ eye: lastEye, focus: lastFocus, radius: CUTAWAY_RADIUS });
    derive();
    for (const listener of changeListeners) listener();
  }

  /** Where someone standing at `p` should be: `p` itself if walkable, else the nearest walkable cell. */
  function nudgeToWalkable(p: { x: number; z: number }): { x: number; z: number } | null {
    if (isWalkableAt(world.nav, p)) return null;
    return nearestWalkable(world.nav, p);
  }

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
    view.group.visible = show;
    setGroundVisible(!show);
  }

  return {
    /** The current village data (replaced by setMap). */
    get world(): BlockWorld {
      return world;
    },
    crowdNav,
    setMap,
    nudgeToWalkable,
    /** Called after every setMap. Returns an unsubscribe. */
    onChange(listener: () => void): () => void {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    /** The ground plane's cell under a world point (col/row in the map), for Build mode. */
    cellAt: (p: { x: number; z: number }) => ({ col: Math.floor(p.x - world.originX), row: Math.floor(p.z - world.originZ) }),
    /** World center of a map cell. */
    cellCenter: (col: number, row: number) => ({ x: world.originX + col + 0.5, z: world.originZ + row + 0.5 }),
    clampWalkTarget,
    planWalk,
    update,
    updateCutaway,
    /** Is the village on screen (home view and editor)? */
    isShown: () => shown === true,
    /** Lamp block centers and their glow, for day/night (controllers/dayNightController.ts). */
    get lampPositions(): readonly { x: number; y: number; z: number }[] {
      return lampPositions;
    },
    setLampGlow: (emissiveIntensity: number) => view.setLampGlow(emissiveIntensity),
    /** Distance from the origin the camera may pan to (the map's corner). */
    roamRadius: Math.hypot(halfSize, halfSize),
  };
}
