import { creatorModeSlice, creatorWardrobeFocusSlice } from '../state/creatorSlices';
import {
  LAYER_KEYS,
  LAYER_DISPLAY_LABELS,
  WARDROBE_COMPOSITE_KEYS,
  type LayerKey,
} from '../skin';
import modeWardrobeFullOutfit from './mode.wardrobe.fullOutfit.svg';
import modeWardrobeTop from './mode.wardrobe.top.svg';
import modeWardrobeHead from './mode.wardrobe.head.svg';
import modeWardrobeHat from './mode.wardrobe.hat.svg';
import modeWardrobeCenter from './mode.wardrobe.center.svg';
import modeWardrobeJacketGroup from './mode.wardrobe.jacketGroup.svg';
import modeWardrobeJacket from './mode.wardrobe.jacket.svg';
import modeWardrobeSleeves from './mode.wardrobe.sleeves.svg';
import modeWardrobeTorso from './mode.wardrobe.torso.svg';
import modeWardrobeBody from './mode.wardrobe.body.svg';
import modeWardrobeArms from './mode.wardrobe.arms.svg';
import modeWardrobeBottom from './mode.wardrobe.bottom.svg';
import modeWardrobePants from './mode.wardrobe.pants.svg';
import modeWardrobeLegs from './mode.wardrobe.legs.svg';
import modeWardrobeAll from './mode.wardrobe.all.svg';

const LAYER_PLACEHOLDER_URLS: Record<WardrobeLayerKey, string> = {
  fullOutfit: modeWardrobeFullOutfit,
  top: modeWardrobeTop,
  head: modeWardrobeHead,
  hat: modeWardrobeHat,
  center: modeWardrobeCenter,
  jacketGroup: modeWardrobeJacketGroup,
  jacket: modeWardrobeJacket,
  sleeves: modeWardrobeSleeves,
  torso: modeWardrobeTorso,
  body: modeWardrobeBody,
  arms: modeWardrobeArms,
  bottom: modeWardrobeBottom,
  pants: modeWardrobePants,
  legs: modeWardrobeLegs,
  all: modeWardrobeAll,
};

export type WardrobeLayerKey = 'fullOutfit' | LayerKey | (typeof WARDROBE_COMPOSITE_KEYS)[number];

export type WardrobePartKey = Exclude<WardrobeLayerKey, 'fullOutfit'>;

const WARDROBE_COMPOSITE_LABELS: Record<(typeof WARDROBE_COMPOSITE_KEYS)[number], string> = {
  torso: 'Torso',
  jacketGroup: 'Jacket (vest + sleeves)',
  bottom: 'Lower body',
  center: 'Upper body',
  top: 'Head (hat + head)',
  all: 'Full outfit',
};

export type WardrobeLayerTreeNode = {
  key: WardrobeLayerKey;
  label: string;
  children?: WardrobeLayerTreeNode[];
};

/** Hierarchical tree (body.all → body.top/center/bottom → children). Per Creator.Wardrobe plan. */
export const WARDROBE_LAYER_TREE: WardrobeLayerTreeNode = {
  key: 'fullOutfit',
  label: 'Full outfit',
  children: [
    {
      key: 'top',
      label: 'Head (hat + head)',
      children: [
        { key: 'head', label: 'Head' },
        { key: 'hat', label: 'Hat' },
      ],
    },
    {
      key: 'center',
      label: 'Upper body',
      children: [
        {
          key: 'jacketGroup',
          label: 'Jacket (vest + sleeves)',
          children: [
            { key: 'jacket', label: 'Jacket' },
            { key: 'sleeves', label: 'Sleeves' },
          ],
        },
        {
          key: 'torso',
          label: 'Torso',
          children: [
            { key: 'body', label: 'Body' },
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

/** Flat list for shortcuts; derived from tree. */
export const WARDROBE_LAYERS: readonly { key: WardrobeLayerKey; label: string }[] = (() => {
  const out: { key: WardrobeLayerKey; label: string }[] = [];
  function walk(n: WardrobeLayerTreeNode): void {
    out.push({ key: n.key, label: n.label });
    n.children?.forEach(walk);
  }
  walk(WARDROBE_LAYER_TREE);
  return out;
})();

/** All part keys for wardrobe resolution (atomics first, then composites). */
export const WARDROBE_PART_KEYS: readonly WardrobePartKey[] = [
  ...LAYER_KEYS,
  ...WARDROBE_COMPOSITE_KEYS,
];

const WARDROBE_EXPANDED_KEY = 'creator-wardrobe-expanded';

function getExpandedSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(WARDROBE_EXPANDED_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function setExpanded(key: string, expanded: boolean): void {
  const set = getExpandedSet();
  if (expanded) set.add(key);
  else set.delete(key);
  try {
    sessionStorage.setItem(WARDROBE_EXPANDED_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

function isExpanded(key: string): boolean {
  return getExpandedSet().has(key);
}

/** Expand key and all ancestors so the selected layer is visible. When body.all is selected, expand it. */
function expandAncestorsOf(key: WardrobeLayerKey, tree: WardrobeLayerTreeNode): void {
  function findPath(n: WardrobeLayerTreeNode, target: string, path: string[]): boolean {
    path.push(n.key);
    if (n.key === target) return true;
    for (const c of n.children ?? []) {
      if (findPath(c, target, path)) return true;
    }
    path.pop();
    return false;
  }
  const path: string[] = [];
  if (findPath(tree, key, path)) {
    path.forEach((k) => setExpanded(k, true));
  }
}

let shortcutHandler: ((e: KeyboardEvent) => void) | null = null;
let unbindWardrobePanelSubs: (() => void) | null = null;

export function unregisterWardrobeShortcuts(): void {
  if (shortcutHandler) {
    document.removeEventListener('keydown', shortcutHandler);
    shortcutHandler = null;
  }
  if (unbindWardrobePanelSubs) {
    unbindWardrobePanelSubs();
    unbindWardrobePanelSubs = null;
  }
}

export type WardrobePartsPanelContext = {
  getEditMode: () => 'wardrobe' | '2d' | '3d';
  getSelectedLayer: () => WardrobeLayerKey;
  setSelectedLayer: (layer: WardrobeLayerKey) => void;
};

function isTypingInInput(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function renderActive(panel: HTMLElement, layer: WardrobeLayerKey): void {
  panel.querySelectorAll<HTMLButtonElement>('.creator-wardrobe-parts-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.layer === layer);
  });
}

function focusActiveWardrobeLibraryItem(): void {
  const activePanel = document.querySelector<HTMLElement>(
    '.creator-wardrobe-library-panel:not(.creator-mode-panel-hidden)',
  );
  if (!activePanel) return;
  const activeItem =
    activePanel.querySelector<HTMLButtonElement>('.creator-wardrobe-library-item.active') ??
    activePanel.querySelector<HTMLButtonElement>('.creator-wardrobe-library-item');
  activeItem?.focus();
}

function buildTreeRec(
  node: WardrobeLayerTreeNode,
  depth: number,
  onClick: (layer: WardrobeLayerKey) => void,
  onExpandClick: (key: string) => void,
  selectedLayer: WardrobeLayerKey
): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const hasChildren = !!node.children?.length;
  const expanded = hasChildren && isExpanded(node.key);

  const row = document.createElement('div');
  row.className = 'creator-wardrobe-layer-row';
  row.dataset.layer = node.key;
  row.style.setProperty('--depth', String(depth));

  const layerBtn = document.createElement('button');
  layerBtn.type = 'button';
  layerBtn.className =
    'creator-wardrobe-parts-btn' + (selectedLayer === node.key ? ' active' : '');
  layerBtn.dataset.layer = node.key;
  layerBtn.title = node.label;

  const caret = document.createElement('span');
  caret.className = 'creator-wardrobe-layer-caret';
  caret.setAttribute('aria-hidden', 'true');
  if (hasChildren) {
    caret.textContent = expanded ? '▼' : '▶';
    caret.classList.add('creator-wardrobe-layer-caret-visible');
  } else {
    caret.textContent = ' ';
    caret.classList.add('creator-wardrobe-layer-caret-placeholder');
  }

  const label = document.createElement('span');
  label.className = 'creator-wardrobe-layer-label';
  label.textContent = node.label;

  const img = document.createElement('img');
  img.src = LAYER_PLACEHOLDER_URLS[node.key] ?? LAYER_PLACEHOLDER_URLS.fullOutfit;
  img.alt = '';
  img.className = 'creator-wardrobe-layer-placeholder';

  layerBtn.append(caret, label, img);

  layerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hitCaret = (e.target as HTMLElement).closest('.creator-wardrobe-layer-caret-visible');
    if (hitCaret && hasChildren) {
      onExpandClick(node.key);
    } else {
      onClick(node.key);
    }
  });

  row.append(layerBtn);
  rows.push(row);

  if (hasChildren && expanded) {
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'creator-wardrobe-layer-children';
    for (const child of node.children!) {
      buildTreeRec(child, depth + 1, onClick, onExpandClick, selectedLayer).forEach((r) =>
        childrenWrap.appendChild(r)
      );
    }
    rows.push(childrenWrap as unknown as HTMLElement);
  }

  return rows;
}

export function buildWardrobePartsPanel(ctx: WardrobePartsPanelContext): void {
  const host = document.getElementById('creator-upper-left-panels');
  if (!host) return;

  const old = document.getElementById('creator-wardrobe-parts-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'creator-wardrobe-parts-panel';
  panel.className = 'creator-wardrobe-parts-panel creator-wardrobe-parts-panel-tree';
  panel.setAttribute('role', 'tree');
  panel.setAttribute('aria-label', 'Wardrobe parts');

  const selectedLayer = ctx.getSelectedLayer();
  expandAncestorsOf(selectedLayer, WARDROBE_LAYER_TREE);

  const onClick = (layer: WardrobeLayerKey) => {
    ctx.setSelectedLayer(layer);
    expandAncestorsOf(layer, WARDROBE_LAYER_TREE);
    rebuildTree(panel, ctx, onClick, layer);
  };

  const onExpandClick = (key: string) => {
    setExpanded(key, !isExpanded(key));
    rebuildTree(panel, ctx, onClick, ctx.getSelectedLayer());
  };

  function rebuildTree(
    p: HTMLElement,
    c: WardrobePartsPanelContext,
    clickCb: (l: WardrobeLayerKey) => void,
    sel: WardrobeLayerKey
  ): void {
    const fragment = document.createDocumentFragment();
    buildTreeRec(WARDROBE_LAYER_TREE, 0, clickCb, onExpandClick, sel).forEach((el) =>
      fragment.appendChild(el)
    );
    p.innerHTML = '';
    p.appendChild(fragment);
    renderActive(p, c.getSelectedLayer());
  }

  rebuildTree(panel, ctx, onClick, selectedLayer);

  const modePanel = document.getElementById('creator-mode-panel');
  if (modePanel && modePanel.parentElement === host) {
    host.insertBefore(panel, modePanel.nextSibling);
  } else {
    host.insertBefore(panel, host.firstChild);
  }

  unregisterWardrobeShortcuts();
  shortcutHandler = (e: KeyboardEvent) => {
    if (document.body.dataset.route !== 'creator') return;
    if (ctx.getEditMode() !== 'wardrobe') return;
    const target = e.target as HTMLElement | null;
    const activeElement = document.activeElement as HTMLElement | null;
    const libraryContainer =
      target?.closest('.creator-wardrobe-library-selector, #creator-skin-selector') ??
      activeElement?.closest('.creator-wardrobe-library-selector, #creator-skin-selector');
    if (libraryContainer) return;
    if (isTypingInInput(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const keyNum = Number.parseInt(e.key, 10);
    if (Number.isInteger(keyNum) && keyNum >= 1 && keyNum <= WARDROBE_LAYERS.length) {
      e.preventDefault();
      const layer = WARDROBE_LAYERS[keyNum - 1]!.key;
      onClick(layer);
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = ctx.getSelectedLayer();
      const idx = Math.max(0, WARDROBE_LAYERS.findIndex((l) => l.key === cur));
      const nextIdx =
        e.key === 'ArrowUp'
          ? (idx - 1 + WARDROBE_LAYERS.length) % WARDROBE_LAYERS.length
          : (idx + 1) % WARDROBE_LAYERS.length;
      onClick(WARDROBE_LAYERS[nextIdx]!.key);
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      focusActiveWardrobeLibraryItem();
      return;
    }
  };
  document.addEventListener('keydown', shortcutHandler);

  const uMode = creatorModeSlice.subscribe((detail) => {
    if (detail.mode !== 'wardrobe') return;
    expandAncestorsOf(ctx.getSelectedLayer(), WARDROBE_LAYER_TREE);
    rebuildTree(panel, ctx, onClick, ctx.getSelectedLayer());
  });
  const uFocus = creatorWardrobeFocusSlice.subscribe(() => {
    if (ctx.getEditMode() !== 'wardrobe') return;
    expandAncestorsOf(ctx.getSelectedLayer(), WARDROBE_LAYER_TREE);
    rebuildTree(panel, ctx, onClick, ctx.getSelectedLayer());
  });
  unbindWardrobePanelSubs = () => {
    uMode();
    uFocus();
  };
}

