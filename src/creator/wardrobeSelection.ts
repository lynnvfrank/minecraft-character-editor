/**
 * Wardrobe selection rules (pure, no DOM): which library picks clear each other, and the order
 * parts are painted when compositing the outfit. Used by wardrobe.ts; tested in wardrobeSelection.test.ts.
 */
import { WARDROBE_COMPOSITE_KEYS, isLayerKey } from '../skin';
import { WARDROBE_PART_KEYS, type WardrobePartKey } from './wardrobeLayers';

/** Sentinel for "use base skin" on overlay parts. Base parts use null. */
export const WARDROBE_ORIGINAL = '__original__' as const;

/** Overlay layers: with no selection they are cleared to transparent rather than kept from the base. */
const WARDROBE_OVERLAY_KEYS: readonly string[] = ['hat', 'jacket', 'sleeves', 'pants'];

export function isWardrobeOverlayPart(part: string): boolean {
  return WARDROBE_OVERLAY_KEYS.includes(part);
}

export type WardrobeSelectionState = Record<WardrobePartKey, string | null>;

/** Fresh selections: overlays show the base skin's own pixels, everything else is unselected. */
export function createDefaultWardrobeSelections(): WardrobeSelectionState {
  return Object.fromEntries(
    WARDROBE_PART_KEYS.map((part) => [part, isWardrobeOverlayPart(part) ? WARDROBE_ORIGINAL : null])
  ) as WardrobeSelectionState;
}

/** What compositing does for one part. */
export type WardrobeResolveStep =
  | { kind: 'keepBase' }
  | { kind: 'clear' }
  | { kind: 'draw'; path: string };

export function getWardrobeResolveStep(part: WardrobePartKey, selected: string | null): WardrobeResolveStep {
  if (selected === WARDROBE_ORIGINAL) return { kind: 'keepBase' };
  if (selected !== null) return { kind: 'draw', path: selected };
  const isOverlay = isWardrobeOverlayPart(part) && !(WARDROBE_COMPOSITE_KEYS as readonly string[]).includes(part);
  return isOverlay ? { kind: 'clear' } : { kind: 'keepBase' };
}

/**
 * Paint order for compositing. The default key order paints upper atomics before `torso` / `center`,
 * so composites would overwrite atomic picks. Draw `center` just before `jacket` and `torso` just
 * before `body`, so atomics paint over the composite regions they share.
 */
export function getWardrobeResolvePartOrder(): readonly WardrobePartKey[] {
  const keys: WardrobePartKey[] = WARDROBE_PART_KEYS.filter((k) => k !== 'torso' && k !== 'center');
  const jacketIdx = keys.indexOf('jacket');
  if (jacketIdx !== -1) keys.splice(jacketIdx, 0, 'center');
  const bodyIdx = keys.indexOf('body');
  if (bodyIdx !== -1) keys.splice(bodyIdx, 0, 'torso');
  return keys;
}

const UPPER_ATOMICS = new Set<WardrobePartKey>(['body', 'arms', 'jacket', 'sleeves']);

/**
 * Clear selections that conflict with picking `partBeingSet` (mutates `selections`).
 *
 * - Any pick clears `all`.
 * - Composites (`torso`, `center`, `jacketGroup`) exclude each other. Hovering `jacketGroup` keeps a
 *   committed `center` until the user commits.
 * - `head` / `hat` clear `top`; `legs` / `pants` clear `bottom`.
 * - Committing an upper atomic (body/arms/jacket/sleeves) clears `torso` and `jacketGroup` but keeps
 *   `center`, which is painted underneath. Hover previews of those atomics keep all composites.
 */
export function applyMutuallyExclusiveCompositeClears(
  selections: WardrobeSelectionState,
  partBeingSet: WardrobePartKey,
  options?: { hoverPreview?: boolean }
): void {
  const hoverPreview = options?.hoverPreview === true;
  selections.all = null;

  if (partBeingSet === 'torso' || partBeingSet === 'center' || partBeingSet === 'jacketGroup') {
    if (partBeingSet !== 'torso') selections.torso = null;
    if (partBeingSet !== 'center' && !(hoverPreview && partBeingSet === 'jacketGroup')) {
      selections.center = null;
    }
    if (partBeingSet !== 'jacketGroup') selections.jacketGroup = null;
  }

  if (!isLayerKey(partBeingSet)) return;

  if (partBeingSet === 'head' || partBeingSet === 'hat') selections.top = null;
  if (UPPER_ATOMICS.has(partBeingSet) && !hoverPreview) {
    selections.jacketGroup = null;
    selections.torso = null;
  }
  if (partBeingSet === 'legs' || partBeingSet === 'pants') selections.bottom = null;
}
