import { creatorModeSlice, creatorWardrobeFocusSlice } from '../state/creatorSlices';
import modeWardrobeFullOutfit from './icons/mode.wardrobe.fullOutfit.svg';
import modeWardrobeTop from './icons/mode.wardrobe.top.svg';
import modeWardrobeHead from './icons/mode.wardrobe.head.svg';
import modeWardrobeHat from './icons/mode.wardrobe.hat.svg';
import modeWardrobeCenter from './icons/mode.wardrobe.center.svg';
import modeWardrobeJacketGroup from './icons/mode.wardrobe.jacketGroup.svg';
import modeWardrobeJacket from './icons/mode.wardrobe.jacket.svg';
import modeWardrobeSleeves from './icons/mode.wardrobe.sleeves.svg';
import modeWardrobeTorso from './icons/mode.wardrobe.torso.svg';
import modeWardrobeBody from './icons/mode.wardrobe.body.svg';
import modeWardrobeArms from './icons/mode.wardrobe.arms.svg';
import modeWardrobeBottom from './icons/mode.wardrobe.bottom.svg';
import modeWardrobePants from './icons/mode.wardrobe.pants.svg';
import modeWardrobeLegs from './icons/mode.wardrobe.legs.svg';
import modeWardrobeAll from './icons/mode.wardrobe.all.svg';
import {
  getWardrobeLibraryPanelIdsForLayer,
  getWardrobePanelIdForLayer,
} from './wardrobeLibraryPanels';
import { WARDROBE_LIBRARY_SELECTOR_CLOSEST } from './wardrobeDom';
import { setWardrobeLayerPanelHoverPreviewLayer } from './wardrobeHoverPreview';
import {
  isWardrobeDualLibrarySplitLayer,
  WARDROBE_DUAL_LIBRARY_BOTTOM_ROW_KEYS,
  WARDROBE_LAYERS,
  WARDROBE_LAYER_TREE,
  type WardrobeLayerKey,
  type WardrobeLayerTreeNode,
} from './wardrobeLayers';

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

/** Expand the path from root to `key` so the selected row is visible in the tree. */
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

function focusActiveWardrobeLibraryItem(ctx: WardrobePartsPanelContext): void {
  const layer = ctx.getSelectedLayer();
  let panelId: string | null = null;
  if (isWardrobeDualLibrarySplitLayer(layer)) {
    const pair = getWardrobeLibraryPanelIdsForLayer(layer);
    const topId = pair[0];
    const bottomId = pair[1];
    panelId =
      (WARDROBE_DUAL_LIBRARY_BOTTOM_ROW_KEYS as readonly string[]).includes(layer) && bottomId
        ? bottomId
        : topId ?? null;
  } else {
    panelId = getWardrobePanelIdForLayer(layer);
  }
  let panel = panelId ? document.getElementById(panelId) : null;
  if (panel?.classList.contains('creator-mode-panel-hidden')) {
    panel = null;
  }
  const activePanel =
    panel ??
    document.querySelector<HTMLElement>('.creator-wardrobe-library-panel:not(.creator-mode-panel-hidden)');
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

  const caret = document.createElement('span');
  caret.className = 'creator-wardrobe-layer-caret';
  caret.setAttribute('aria-hidden', 'true');
  if (hasChildren) {
    caret.textContent = expanded ? '▼' : '▶';
    caret.classList.add('creator-wardrobe-layer-caret-visible');
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      onExpandClick(node.key);
    });
  } else {
    caret.textContent = ' ';
    caret.classList.add('creator-wardrobe-layer-caret-placeholder');
  }

  const layerBtn = document.createElement('button');
  layerBtn.type = 'button';
  layerBtn.className =
    'creator-wardrobe-parts-btn' + (selectedLayer === node.key ? ' active' : '');
  layerBtn.dataset.layer = node.key;
  layerBtn.title = node.label;

  const label = document.createElement('span');
  label.className = 'creator-wardrobe-layer-label';
  label.textContent = node.label;

  const img = document.createElement('img');
  img.src = LAYER_PLACEHOLDER_URLS[node.key] ?? LAYER_PLACEHOLDER_URLS.fullOutfit;
  img.alt = '';
  img.className = 'creator-wardrobe-layer-placeholder';

  layerBtn.append(label, img);

  layerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(node.key);
  });
  row.addEventListener('pointerenter', () => {
    if (document.body.dataset.route !== 'creator') return;
    if (document.body.dataset.editMode !== 'wardrobe') return;
    setWardrobeLayerPanelHoverPreviewLayer(node.key);
  });

  row.append(caret, layerBtn);
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
  panel.addEventListener('pointerleave', (e) => {
    if (document.body.dataset.route !== 'creator') return;
    if (document.body.dataset.editMode !== 'wardrobe') return;
    const rel = e.relatedTarget as Node | null;
    if (rel && panel.contains(rel)) return;
    setWardrobeLayerPanelHoverPreviewLayer(null);
  });

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
      target?.closest(WARDROBE_LIBRARY_SELECTOR_CLOSEST) ??
      activeElement?.closest(WARDROBE_LIBRARY_SELECTOR_CLOSEST);
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
      focusActiveWardrobeLibraryItem(ctx);
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

