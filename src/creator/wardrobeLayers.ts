import { LAYER_KEYS, WARDROBE_COMPOSITE_KEYS, isLayerKey, type LayerKey } from '../skin';

export type WardrobeLayerKey = 'fullOutfit' | LayerKey | (typeof WARDROBE_COMPOSITE_KEYS)[number];

export type WardrobePartKey = Exclude<WardrobeLayerKey, 'fullOutfit'>;

export type WardrobeLayerTreeNode = {
  key: WardrobeLayerKey;
  label: string;
  children?: WardrobeLayerTreeNode[];
};

/** Hierarchical tree (body.all -> body.top/center/bottom -> children). */
export const WARDROBE_LAYER_TREE: WardrobeLayerTreeNode = {
  key: 'fullOutfit',
  label: 'Full outfit',
  children: [
    {
      key: 'top',
      label: 'Head (hat + head)',
      children: [
        { key: 'hat', label: 'Hat' },
        { key: 'head', label: 'Head' },
      ],
    },
    {
      key: 'center',
      label: 'Upper body',
      children: [
        {
          key: 'jacketGroup',
          label: 'Jacket',
          children: [
            { key: 'jacket', label: 'Vest' },
            { key: 'sleeves', label: 'Sleeves' },
          ],
        },
        {
          key: 'torso',
          label: 'Torso',
          children: [
            { key: 'body', label: 'Chest' },
            { key: 'arms', label: 'Arms' },
          ],
        },
      ],
    },
    {
      key: 'bottom',
      label: 'Lower body',
      children: [
        { key: 'pants', label: 'Pants' },
        { key: 'legs', label: 'Legs' },
      ],
    },
  ],
};

function collectWardrobeTreeAtomicLeaves(node: WardrobeLayerTreeNode): LayerKey[] {
  if (!node.children?.length) {
    return isLayerKey(node.key) ? [node.key] : [];
  }
  return node.children.flatMap(collectWardrobeTreeAtomicLeaves);
}

function findWardrobeTreeNode(
  root: WardrobeLayerTreeNode,
  target: WardrobeLayerKey
): WardrobeLayerTreeNode | null {
  if (root.key === target) return root;
  for (const c of root.children ?? []) {
    const found = findWardrobeTreeNode(c, target);
    if (found) return found;
  }
  return null;
}

/** Atomic `LayerKey`s covered by a wardrobe tree row (`fullOutfit`/`all` -> all parts; atomics -> self). */
export function getMemberLayerKeysForWardrobeLayer(layer: WardrobeLayerKey): LayerKey[] {
  if (layer === 'fullOutfit' || layer === 'all') {
    return [...LAYER_KEYS];
  }
  if (isLayerKey(layer)) {
    return [layer];
  }
  const node = findWardrobeTreeNode(WARDROBE_LAYER_TREE, layer);
  if (!node) return [];
  return collectWardrobeTreeAtomicLeaves(node);
}

export const WARDROBE_LAYERS: readonly { key: WardrobeLayerKey; label: string }[] = (() => {
  const out: { key: WardrobeLayerKey; label: string }[] = [];
  const walk = (node: WardrobeLayerTreeNode): void => {
    out.push({ key: node.key, label: node.label });
    node.children?.forEach(walk);
  };
  walk(WARDROBE_LAYER_TREE);
  return out;
})();

/** All part keys for wardrobe resolution (atomics first, then composites). */
export const WARDROBE_PART_KEYS: readonly WardrobePartKey[] = [
  ...LAYER_KEYS,
  ...WARDROBE_COMPOSITE_KEYS,
];

const WARDROBE_DUAL_LIBRARY_PAIRS: ReadonlyArray<readonly [LayerKey, LayerKey]> = [
  ['hat', 'head'],
  ['body', 'arms'],
  ['jacket', 'sleeves'],
  ['pants', 'legs'],
];

/** Bottom strip of each split rail ([top, bottom] order in dual-library pairs). */
export const WARDROBE_DUAL_LIBRARY_BOTTOM_ROW_KEYS: readonly WardrobeLayerKey[] =
  WARDROBE_DUAL_LIBRARY_PAIRS.map((pair) => pair[1]);

export function getWardrobeDualLibraryPair(
  layer: WardrobeLayerKey
): readonly [LayerKey, LayerKey] | null {
  for (const pair of WARDROBE_DUAL_LIBRARY_PAIRS) {
    if (pair[0] === layer || pair[1] === layer) return pair;
  }
  return null;
}

export function isWardrobeDualLibrarySplitLayer(layer: WardrobeLayerKey): boolean {
  return getWardrobeDualLibraryPair(layer) != null;
}

/** True when both keys are the same atomic or two atomics in one split rail (e.g. hat+head). */
export function areWardrobeLayersSameDualLibraryPair(
  a: WardrobeLayerKey,
  b: WardrobeLayerKey
): boolean {
  if (a === b) return true;
  const pair = getWardrobeDualLibraryPair(a);
  return pair != null && (pair[0] === b || pair[1] === b);
}
