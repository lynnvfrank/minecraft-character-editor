/**
 * Keeps every character's hand in line with the held-items store (state/heldItemsStore.ts).
 *
 * One call per frame (`update`) checks each character on stage: the primary, the crowd and the
 * studio's backup dancers. When what it holds differs from what its skin should hold, the item is
 * swapped (viewer/heldItem.ts). That one check covers every way a character changes: a new crowd
 * spawn, a swap into the primary slot, a skin or rig change (a new rig has an empty hand), a
 * restored backup and a reload.
 *
 * Items only show in the home view and the studio. On the creator and preview routes every hand
 * is emptied (the item would be in the way of painting the arm, and preview and wardrobe captures
 * show the bare character); they come back on return.
 */
import type * as THREE from 'three';
import { getHeldItem } from '../domain/heldItems';
import { skyStateAt } from '../lib/dayNight';
import { attachHeldItem, heldItemIdOf, setHeldItemNight } from '../viewer/heldItem';
import type { CharacterState } from './characterTypes';
import type { HeldItemsStore } from '../state/heldItemsStore';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';
type Holder = Pick<CharacterState, 'model' | 'container' | 'currentSkin'>;

export type HeldItemsControllerDeps = {
  store: Pick<HeldItemsStore, 'get'>;
  /** Characters in the scene record (primary and crowd). */
  getCharacters: () => Iterable<Holder>;
  /** Characters kept outside that record (studio backup dancers). */
  getExtraCharacters?: () => Iterable<Holder>;
  /** Holder key for a worn skin: an outfit's key for its image, any other skin unchanged. */
  keyOf: (skin: string) => string;
  getTimeOfDay?: () => number;
};

const SHOWN_ON: ReadonlySet<Route> = new Set(['viewer', 'studio']);
/** A rig with no hand bone: don't search it again every frame. */
const noHand = new WeakSet<THREE.Object3D>();

export function createHeldItemsController(deps: HeldItemsControllerDeps) {
  function wanted(char: Holder, route: Route): string | null {
    if (!SHOWN_ON.has(route) || !char.currentSkin) return null;
    return deps.store.get(deps.keyOf(char.currentSkin));
  }

  function sync(char: Holder, route: Route, night: number): void {
    const want = wanted(char, route);
    if (heldItemIdOf(char.model) !== want && !(want && noHand.has(char.model))) {
      if (!attachHeldItem(char.model, getHeldItem(want), char.container)) noHand.add(char.model);
    }
    if (want) setHeldItemNight(char.model, night);
  }

  return {
    /** Per frame, on every route. */
    update(route: Route): void {
      const night = route === 'viewer' && deps.getTimeOfDay ? skyStateAt(deps.getTimeOfDay()).night : 0;
      for (const char of deps.getCharacters()) sync(char, route, night);
      for (const char of deps.getExtraCharacters?.() ?? []) sync(char, route, night);
    },
  };
}

export type HeldItemsController = ReturnType<typeof createHeldItemsController>;
