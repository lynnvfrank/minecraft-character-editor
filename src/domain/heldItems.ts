/**
 * Held items: small blocky things a character can carry in its right hand (a torch, a flower...).
 *
 * Everything here is data and rules, no 3D: the catalogue describes each item as a handful of
 * coloured boxes (our own designs, no third-party art), viewer/heldItem.ts turns that into a mesh
 * and state/heldItemsStore.ts remembers who holds what.
 *
 * Item space: units are skin pixels (the character is 32 tall, an arm is 4 wide). The origin is
 * the grip (the middle of the fist), +Y runs up the handle.
 *
 * Hand space (what `grip` is expressed in), for a character standing with its arms down:
 * +X to the character's left, +Y up toward the shoulder, +Z forward (the way it faces).
 * `grip.rotation` is in degrees, applied X then Y then Z; a positive X turn tips the handle forward.
 */

export type Vec3 = readonly [number, number, number];

export type HeldItemBox = {
  /** Centre of the box, in item space. */
  at: Vec3;
  /** Width (X), height (Y), depth (Z); all above zero. */
  size: Vec3;
  /** `#rrggbb`. */
  color: string;
  /** Glows: drawn unlit, and a little brighter at night. */
  emissive?: boolean;
};

export type HeldItemGrip = {
  /** Where the item's origin sits relative to the middle of the fist, in hand space. */
  offset: Vec3;
  /** Degrees around X, Y, Z in hand space. */
  rotation: Vec3;
};

export type HeldItem = {
  id: string;
  label: string;
  emoji: string;
  boxes: readonly HeldItemBox[];
  grip: HeldItemGrip;
};

/** Handle through the fist, pointing forward and a little up (the usual way to carry a tool). */
const CARRY: HeldItemGrip = { offset: [0, 0, 0], rotation: [65, 0, 0] };
/** Held upright just in front of the fist, so the handle isn't hidden inside the arm. */
const UPRIGHT: HeldItemGrip = { offset: [0, 0, 2.5], rotation: [8, 0, 0] };

const WOOD = '#8a5a2b';
const DARK_WOOD = '#5d3b1a';
const STEEL = '#c9d1d9';
const IRON = '#6b7280';

export const HELD_ITEMS: readonly HeldItem[] = [
  {
    id: 'torch',
    label: 'Torch',
    emoji: '🔥',
    grip: CARRY,
    boxes: [
      { at: [0, 2, 0], size: [1, 6, 1], color: WOOD },
      { at: [0, 6, 0], size: [2, 2, 2], color: '#ff9a1f', emissive: true },
      { at: [0, 7.5, 0], size: [1, 1, 1], color: '#fff2a8', emissive: true },
    ],
  },
  {
    id: 'flower',
    label: 'Flower',
    emoji: '🌼',
    grip: UPRIGHT,
    boxes: [
      { at: [0, 2, 0], size: [1, 6, 1], color: '#3f9b46' },
      { at: [1, 2.5, 0], size: [1, 1, 1], color: '#57b85e' },
      { at: [0, 6.5, 0], size: [3, 1, 1], color: '#ff8fc7' },
      { at: [0, 6.5, 0], size: [1, 3, 1], color: '#ff8fc7' },
      { at: [0, 6.5, 0.3], size: [1, 1, 1], color: '#ffd84a' },
    ],
  },
  {
    id: 'lollipop',
    label: 'Lollipop',
    emoji: '🍭',
    grip: UPRIGHT,
    boxes: [
      { at: [0, 2, 0], size: [1, 6, 1], color: '#f4f4f4' },
      { at: [0, 7, 0], size: [4, 4, 1], color: '#ff5c8a' },
      { at: [0, 7, 0], size: [2, 2, 1.4], color: '#ffffff' },
    ],
  },
  {
    id: 'balloon',
    label: 'Balloon',
    emoji: '🎈',
    grip: { offset: [0, 0, 2.5], rotation: [0, 0, 0] },
    boxes: [
      { at: [0, 5, 0], size: [0.4, 10, 0.4], color: '#e6e6e6' },
      { at: [0, 10.4, 0], size: [1, 0.8, 1], color: '#c22f2f' },
      { at: [0, 13.5, 0], size: [5, 6, 5], color: '#e84545' },
      { at: [-1.5, 14.5, 2.3], size: [1, 2, 0.6], color: '#ff9c9c' },
    ],
  },
  {
    id: 'umbrella',
    label: 'Umbrella',
    emoji: '☂️',
    grip: UPRIGHT,
    boxes: [
      { at: [0, 5.5, 0], size: [1, 13, 1], color: DARK_WOOD },
      { at: [0, 11, 0], size: [11, 1, 11], color: '#3b7dd8' },
      { at: [0, 12, 0], size: [7, 1, 7], color: '#4f93ee' },
      { at: [0, 13, 0], size: [1, 1, 1], color: '#f4f4f4' },
    ],
  },
  {
    id: 'fishing-rod',
    label: 'Fishing rod',
    emoji: '🎣',
    grip: { offset: [0, 0, 2.5], rotation: [20, 0, 0] },
    boxes: [
      { at: [0, 5.5, 0], size: [1, 13, 1], color: WOOD },
      { at: [0, 1.5, 1], size: [1, 2, 1], color: IRON },
      { at: [0, 12, 2.5], size: [0.6, 0.6, 5], color: WOOD },
      { at: [0, 8.5, 5], size: [0.3, 7, 0.3], color: '#f4f4f4' },
      { at: [0, 4.5, 5], size: [1.2, 1.2, 1.2], color: '#e84545' },
    ],
  },
  {
    id: 'lantern',
    label: 'Lantern',
    emoji: '🏮',
    // Hangs from the fist, clear of the arm.
    grip: { offset: [0, -1, 1.5], rotation: [0, 0, 0] },
    boxes: [
      { at: [0, -0.5, 0], size: [1, 2, 1], color: IRON },
      { at: [0, -2, 0], size: [4, 1, 4], color: '#3a3f47' },
      { at: [0, -4.5, 0], size: [3, 4, 3], color: '#ffd76a', emissive: true },
      { at: [0, -7, 0], size: [4, 1, 4], color: '#3a3f47' },
    ],
  },
  {
    id: 'wand',
    label: 'Magic wand',
    emoji: '🪄',
    grip: CARRY,
    boxes: [
      { at: [0, 3, 0], size: [1, 8, 1], color: '#2b2b36' },
      { at: [0, 7.5, 0], size: [1, 1, 1], color: '#f4f4f4' },
      { at: [0, 9.5, 0], size: [1, 1, 3], color: '#ffe45c', emissive: true },
      { at: [0, 9.5, 0], size: [1, 3, 1], color: '#ffe45c', emissive: true },
    ],
  },
  {
    id: 'pick',
    label: 'Pick',
    emoji: '⛏️',
    grip: CARRY,
    boxes: [
      { at: [0, 4, 0], size: [1, 10, 1], color: WOOD },
      { at: [0, 9, 0], size: [1, 1, 7], color: STEEL },
      { at: [0, 8, 3], size: [1, 1, 1], color: STEEL },
      { at: [0, 8, -3], size: [1, 1, 1], color: STEEL },
    ],
  },
  {
    id: 'toy-sword',
    label: 'Toy sword',
    emoji: '🗡️',
    grip: CARRY,
    boxes: [
      { at: [0, 0, 0], size: [1, 3, 1], color: DARK_WOOD },
      { at: [0, 2, 0], size: [1, 1, 4], color: '#e0b340' },
      { at: [0, 7, 0], size: [1, 9, 2], color: STEEL },
      { at: [0, 12, 0], size: [1, 1, 1], color: STEEL },
    ],
  },
  {
    id: 'ice-cream',
    label: 'Ice cream',
    emoji: '🍦',
    grip: UPRIGHT,
    boxes: [
      { at: [0, 0, 0], size: [1, 2, 1], color: '#d9a35a' },
      { at: [0, 2, 0], size: [2, 2, 2], color: '#e2b06a' },
      { at: [0, 3.5, 0], size: [3, 1, 3], color: '#e2b06a' },
      { at: [0, 5.5, 0], size: [3, 3, 3], color: '#ffb3d1' },
      { at: [0, 7.5, 0], size: [1, 1, 1], color: '#d62839' },
    ],
  },
  {
    id: 'flag',
    label: 'Flag',
    emoji: '🚩',
    grip: UPRIGHT,
    boxes: [
      { at: [0, 6.5, 0], size: [1, 15, 1], color: '#e6e6e6' },
      // Flies out to the character's right, away from the body.
      { at: [-4, 11.5, 0], size: [7, 5, 0.5], color: '#e84545' },
      { at: [0, 14.5, 0], size: [1.4, 1, 1.4], color: '#ffd84a' },
    ],
  },
];

const BY_ID = new Map(HELD_ITEMS.map((item) => [item.id, item]));

export function getHeldItem(id: string | null | undefined): HeldItem | null {
  return (id != null && BY_ID.get(id)) || null;
}

export function isHeldItemId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id);
}

// --- Who holds what ---------------------------------------------------------------------------

/** Holder key (bundled skin path or `outfit:<id>`) → item id. */
export type HeldItemAssignments = Record<string, string>;

/** Most holders we remember; the oldest are forgotten first. */
export const MAX_HELD_ITEM_ASSIGNMENTS = 200;
const MAX_HOLDER_KEY_LENGTH = 200;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A holder is named the way the residents roster names it: a site-relative skin path or one of
 * the user's outfits. Anything else (a data URL of an unsaved design, another site's address)
 * can't be remembered.
 */
export function isHolderKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length <= MAX_HOLDER_KEY_LENGTH &&
    (/^\/(?![/\\])[^\\\u0000-\u001f]*$/.test(key) || /^outfit:[a-z0-9][a-z0-9-]{0,39}$/.test(key))
  );
}

/**
 * Assignments from an untrusted value (a backup file, parsed localStorage): every well-formed
 * pair with a known item, newest kept when over the cap. Null if the value isn't an object at all.
 */
export function parseHeldItemAssignments(raw: unknown): HeldItemAssignments | null {
  if (!isObject(raw)) return null;
  const pairs: [string, string][] = [];
  for (const [key, id] of Object.entries(raw)) {
    if (isHolderKey(key) && isHeldItemId(id)) pairs.push([key, id]);
  }
  return Object.fromEntries(pairs.slice(-MAX_HELD_ITEM_ASSIGNMENTS));
}

/** Assignments from stored JSON text; an empty record for anything unreadable. */
export function parseStoredHeldItems(json: string | null): HeldItemAssignments {
  if (!json) return {};
  try {
    return parseHeldItemAssignments(JSON.parse(json)) ?? {};
  } catch {
    return {};
  }
}

/**
 * `assignments` with `key` holding `itemId` (null = nothing). The changed key moves to the end
 * (newest); over the cap the oldest go. Returns the same object when nothing changes or the pair
 * can't be remembered.
 */
export function withHeldItem(
  assignments: HeldItemAssignments,
  key: string,
  itemId: string | null,
  cap: number = MAX_HELD_ITEM_ASSIGNMENTS
): HeldItemAssignments {
  if (!isHolderKey(key)) return assignments;
  if (itemId === null) {
    if (!(key in assignments)) return assignments;
    const { [key]: _dropped, ...rest } = assignments;
    return rest;
  }
  if (!isHeldItemId(itemId) || assignments[key] === itemId) return assignments;
  const { [key]: _old, ...rest } = assignments;
  const pairs = [...Object.entries(rest), [key, itemId] as [string, string]];
  return Object.fromEntries(pairs.slice(-Math.max(1, cap)));
}

// --- Finding the hand -------------------------------------------------------------------------

/** What kind of bone the item hangs from; decides where the fist is relative to it. */
export type HandBoneKind = 'hand' | 'forearm-end' | 'forearm' | 'arm';

const FINGERS = /thumb|index|middle|ring|pinky|finger/;

/**
 * Is this bone a place to hang a right-hand item, and how good a one? Tolerant of naming styles:
 * `RightHand`, `mixamorig:RightHand`, `hand_r`, `Arm:Right:Lower_end`, `RightForeArm`...
 * Null for anything that isn't on the right arm.
 */
export function classifyHandBone(name: string): { kind: HandBoneKind; score: number } | null {
  const lower = name.toLowerCase().replace(/mixamorig\d*/g, '');
  const flat = lower.replace(/[^a-z0-9]/g, '');
  const right = flat.includes('right') || /(^|[^a-z])r$/.test(lower) || /(^|[^a-z])r[^a-z]/.test(lower);
  if (!right || flat.includes('left') || FINGERS.test(flat) || flat.includes('shoulder')) return null;
  const isEnd = /end$/.test(flat);
  if (flat.includes('hand')) return isEnd ? null : { kind: 'hand', score: 4 };
  if (!flat.includes('arm')) return null;
  const isLower = flat.includes('lower') || flat.includes('fore');
  if (isLower) return isEnd ? { kind: 'forearm-end', score: 3 } : { kind: 'forearm', score: 2 };
  return isEnd ? null : { kind: 'arm', score: 1 };
}
