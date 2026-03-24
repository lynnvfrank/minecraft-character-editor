/**
 * Minecraft 64×64 skin layout pixel bounds.
 * Origin (0,0) is top-left. Per minecraft-skin-layout-specification.md
 */

export type Bounds = { x: number; y: number; w: number; h: number };

/**
 * Canonical layer keys for visibility, lock, and UI. Order: hat/head, jacket/body, sleeves/arms, pants/legs.
 * Single source of truth — import this instead of defining locally.
 */
export const LAYER_KEYS = ['hat', 'head', 'jacket', 'body', 'sleeves', 'arms', 'pants', 'legs'] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

export function isLayerKey(s: string | undefined): s is LayerKey {
  return s != null && (LAYER_KEYS as readonly string[]).includes(s);
}

/**
 * Layer keys in base-before-overlay order for texture/UV operations.
 * head→hat, body→jacket, arms→sleeves, legs→pants. Use when iterating for visibility texture.
 */
export const TEXTURE_LAYER_KEYS = ['head', 'hat', 'body', 'jacket', 'sleeves', 'arms', 'legs', 'pants'] as const;

/**
 * Pixel bounds for each layer (single source of truth for 64×64 skin layout).
 * Face positions in the spec extend beyond the high-level "Bounds" — e.g. BACK BODY at X:32,
 * BACK JACKET at X:32, and the right strip X:56-64.
 */
export const SKIN_LAYER_BOUNDS: Record<LayerKey, Bounds[]> = {
  head: [{ x: 0, y: 0, w: 32, h: 16 }],
  hat: [{ x: 32, y: 0, w: 32, h: 16 }],
  body: [{ x: 16, y: 16, w: 24, h: 16 }],
  jacket: [{ x: 16, y: 32, w: 24, h: 16 }],
  arms: [
    { x: 40, y: 16, w: 16, h: 16 },
    { x: 32, y: 48, w: 16, h: 16 },
  ],
  sleeves: [
    { x: 40, y: 32, w: 16, h: 16 },
    { x: 48, y: 48, w: 16, h: 16 },
  ],
  legs: [
    { x: 0, y: 16, w: 16, h: 16 },
    { x: 16, y: 48, w: 16, h: 16 },
  ],
  pants: [
    { x: 0, y: 32, w: 16, h: 16 },
    { x: 0, y: 48, w: 16, h: 16 },
  ],
};

/**
 * Display name for each rect in a layer (same order as SKIN_LAYER_BOUNDS[layer]).
 * Used to derive SKIN_PART_BOUNDS and for hover/labels.
 */
/** Layers that have left/right parts (bounds[0]=Right, bounds[1]=Left). */
export const LAYERS_WITH_PARTS = ['arms', 'sleeves', 'legs', 'pants'] as const;
export type LayerWithParts = (typeof LAYERS_WITH_PARTS)[number];

export function isLayerWithParts(layer: string): layer is LayerWithParts {
  return (LAYERS_WITH_PARTS as readonly string[]).includes(layer);
}

export const LAYER_TO_PART_DISPLAY_NAMES: Record<LayerKey, string[]> = {
  head: ['Head'],
  hat: ['Hat'],
  body: ['Body'],
  jacket: ['Jacket'],
  arms: ['Right arm', 'Left arm'],
  sleeves: ['Right sleeve', 'Left sleeve'],
  legs: ['Right leg', 'Left leg'],
  pants: ['Right pants', 'Left pants'],
};

/**
 * Dead zones / non-skin zones from reference diagrams (minecraft-skin-layout-specification.md).
 * These areas contain meta-information (cropping instructions, legend, etc.), not skin texture.
 * Excluded from template overlay and hover info (reported as "not over skin").
 */
export const SKIN_DEAD_ZONES: Bounds[] = [
  { x: 0, y: 0, w: 8, h: 8 },    // top-left: cropping instructions
  { x: 24, y: 0, w: 16, h: 8 },   // top-middle: source/provenance
  { x: 56, y: 16, w: 8, h: 32 },  // right-side legend
];

/** True if (normX, normY) is inside any dead zone (norm coords 0–63). */
export function isInDeadZone(normX: number, normY: number): boolean {
  for (const z of SKIN_DEAD_ZONES) {
    if (normX >= z.x && normX < z.x + z.w && normY >= z.y && normY < z.y + z.h) return true;
  }
  return false;
}

/**
 * Part display name (e.g. "Right sleeve") → layer key. Derived from LAYER_TO_PART_DISPLAY_NAMES.
 */
export const PART_TO_LAYER: Record<string, LayerKey> = (() => {
  const out: Record<string, LayerKey> = {};
  for (const layer of LAYER_KEYS) {
    for (const name of LAYER_TO_PART_DISPLAY_NAMES[layer]) {
      out[name] = layer;
    }
  }
  return out;
})();

/** UV part keys used by MINECRAFT_SKIN_UVS in main.ts. */
export type UVPartKey = 'head' | 'hat' | 'body' | 'jacket' | 'armR' | 'armL' | 'sleeveR' | 'sleeveL' | 'legR' | 'legL' | 'pantsR' | 'pantsL';

/** Layer key → UV part keys for texture/mesh mapping. */
export const LAYER_TO_UV_PARTS: Partial<Record<LayerKey, UVPartKey[]>> = {
  head: ['head'],
  hat: ['hat'],
  body: ['body'],
  jacket: ['jacket'],
  arms: ['armR', 'armL'],
  sleeves: ['sleeveR', 'sleeveL'],
  legs: ['legR', 'legL'],
  pants: ['pantsR', 'pantsL'],
};

/** UV part key → layer key. For mesh visibility during per-part capture. */
export const UV_PART_TO_LAYER: Record<UVPartKey, LayerKey> = (() => {
  const out = {} as Record<UVPartKey, LayerKey>;
  for (const layer of LAYER_KEYS) {
    const parts = LAYER_TO_UV_PARTS[layer];
    if (parts) for (const p of parts) out[p] = layer;
  }
  return out;
})();

/** Map part display name to layer key. Returns null if unknown. */
export function partToLayer(part: string): LayerKey | null {
  return (PART_TO_LAYER[part] as LayerKey) ?? null;
}

/**
 * Specific part bounds for hover display (right/left legs, pants, arms, sleeves).
 * Derived from SKIN_LAYER_BOUNDS + LAYER_TO_PART_DISPLAY_NAMES.
 */
export const SKIN_PART_BOUNDS: { part: string; bounds: Bounds[] }[] = (() => {
  const out: { part: string; bounds: Bounds[] }[] = [];
  for (const layer of LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    const names = LAYER_TO_PART_DISPLAY_NAMES[layer];
    for (let i = 0; i < bounds.length; i++) {
      out.push({ part: names[i]!, bounds: [bounds[i]!] });
    }
  }
  return out;
})();

/**
 * Returns layer bounds keyed by layer (for scripts/wardrobe that need part name → rects).
 * Use this when you need Record<string, Bounds[]> keyed by LayerKey.
 */
export function getLayerBoundsByKey(): Record<LayerKey, Bounds[]> {
  return SKIN_LAYER_BOUNDS;
}

/** Returns bounds for any wardrobe part (atomic or composite). For unknown parts, returns []. */
export function getPartBounds(part: string): Bounds[] {
  if (part in WARDROBE_COMPOSITE_BOUNDS) {
    return WARDROBE_COMPOSITE_BOUNDS[part as WardrobeCompositeKey];
  }
  if (isLayerKey(part)) {
    return SKIN_LAYER_BOUNDS[part];
  }
  return [];
}

/**
 * Wardrobe composite part keys (taxonomy: body.torso, body.jacket, etc.).
 * Used for part-only skin generation and previews.
 */
export const WARDROBE_COMPOSITE_KEYS = [
  'torso',
  'jacketGroup',
  'bottom',
  'center',
  'top',
  'all',
] as const;
export type WardrobeCompositeKey = (typeof WARDROBE_COMPOSITE_KEYS)[number];

/**
 * All wardrobe part keys (atomic + composite) for generation scripts.
 */
export const WARDROBE_PART_KEYS = [...LAYER_KEYS, ...WARDROBE_COMPOSITE_KEYS] as const;
export type WardrobePartKey = (typeof WARDROBE_PART_KEYS)[number];

/**
 * Bounds for composite parts (union of child regions).
 * Used by generate-wardrobe-parts.ts.
 */
export const WARDROBE_COMPOSITE_BOUNDS: Record<WardrobeCompositeKey, Bounds[]> = {
  torso: [...SKIN_LAYER_BOUNDS.body, ...SKIN_LAYER_BOUNDS.arms],
  jacketGroup: [...SKIN_LAYER_BOUNDS.jacket, ...SKIN_LAYER_BOUNDS.sleeves],
  bottom: [...SKIN_LAYER_BOUNDS.legs, ...SKIN_LAYER_BOUNDS.pants],
  center: [
    ...SKIN_LAYER_BOUNDS.jacket,
    ...SKIN_LAYER_BOUNDS.body,
    ...SKIN_LAYER_BOUNDS.sleeves,
    ...SKIN_LAYER_BOUNDS.arms,
  ],
  top: [...SKIN_LAYER_BOUNDS.head, ...SKIN_LAYER_BOUNDS.hat],
  all: [{ x: 0, y: 0, w: 64, h: 64 }],
};

/**
 * Camera preset to use for each composite part (per Creator.Wardrobe plan).
 * body.head for top; body.chest for center/torso/jacket; body.legs for bottom.
 */
export const WARDROBE_COMPOSITE_CAMERA_PRESET: Record<WardrobeCompositeKey, LayerKey | 'fullOutfit'> = {
  torso: 'body',
  jacketGroup: 'jacket',
  bottom: 'legs',
  center: 'body',
  top: 'head',
  all: 'fullOutfit',
};

/**
 * Human-readable label per layer for UI (wardrobe panel, etc.).
 */
export const LAYER_DISPLAY_LABELS: Record<LayerKey, string> = {
  hat: 'Hat',
  head: 'Head',
  jacket: 'Jacket',
  body: 'Body',
  sleeves: 'Sleeves',
  arms: 'Arms',
  pants: 'Pants',
  legs: 'Legs',
};
