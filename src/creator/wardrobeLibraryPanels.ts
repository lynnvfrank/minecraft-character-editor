import type { SkinEntry } from '../domain';
import { createEl } from './dom';
import { setWardrobeSelectorPanelHoverPreviewLayer } from './wardrobeHoverPreview';
import {
  getWardrobeDualLibraryPair,
  type WardrobeLayerKey,
  type WardrobePartKey,
} from './wardrobeLayers';

export type WardrobeLibraryItem = SkinEntry & { id?: string };

export type WardrobePartPanelConfig = {
  key: WardrobePartKey;
  panelId: string;
  selectorId: string;
  title: string;
  noneLabel: string;
};

export const WARDROBE_PART_PANEL_CONFIGS: readonly WardrobePartPanelConfig[] = [
  // Composite parts (taxonomy: body.top, body.center, etc.)
  {
    key: 'top',
    panelId: 'creator-wardrobe-top-panel',
    selectorId: 'creator-wardrobe-top-selector',
    title: 'Head (hat + head)',
    noneLabel: 'No head',
  },
  {
    key: 'center',
    panelId: 'creator-wardrobe-center-panel',
    selectorId: 'creator-wardrobe-center-selector',
    title: 'Upper body',
    noneLabel: 'No upper body',
  },
  {
    key: 'bottom',
    panelId: 'creator-wardrobe-bottom-panel',
    selectorId: 'creator-wardrobe-bottom-selector',
    title: 'Lower body',
    noneLabel: 'No lower body',
  },
  {
    key: 'torso',
    panelId: 'creator-wardrobe-torso-panel',
    selectorId: 'creator-wardrobe-torso-selector',
    title: 'Torso',
    noneLabel: 'No torso',
  },
  {
    key: 'jacketGroup',
    panelId: 'creator-wardrobe-jacket-group-panel',
    selectorId: 'creator-wardrobe-jacket-group-selector',
    title: 'Jacket',
    noneLabel: 'No jacket',
  },
  {
    key: 'all',
    panelId: 'creator-wardrobe-all-panel',
    selectorId: 'creator-wardrobe-all-selector',
    title: 'Full outfit',
    noneLabel: 'No outfit',
  },
  // Atomic parts
  {
    key: 'hat',
    panelId: 'creator-wardrobe-hat-panel',
    selectorId: 'creator-wardrobe-hat-selector',
    title: 'Hats',
    noneLabel: 'No hat',
  },
  {
    key: 'head',
    panelId: 'creator-wardrobe-head-panel',
    selectorId: 'creator-wardrobe-head-selector',
    title: 'Heads',
    noneLabel: 'No head',
  },
  {
    key: 'jacket',
    panelId: 'creator-wardrobe-jacket-panel',
    selectorId: 'creator-wardrobe-jacket-selector',
    title: 'Vests',
    noneLabel: 'No jacket',
  },
  {
    key: 'body',
    panelId: 'creator-wardrobe-body-panel',
    selectorId: 'creator-wardrobe-body-selector',
    title: 'Chests',
    noneLabel: 'No body',
  },
  {
    key: 'arms',
    panelId: 'creator-wardrobe-arms-panel',
    selectorId: 'creator-wardrobe-arms-selector',
    title: 'Arms',
    noneLabel: 'No arms',
  },
  {
    key: 'sleeves',
    panelId: 'creator-wardrobe-sleeves-panel',
    selectorId: 'creator-wardrobe-sleeves-selector',
    title: 'Sleeves',
    noneLabel: 'No sleeves',
  },
  {
    key: 'pants',
    panelId: 'creator-wardrobe-pants-panel',
    selectorId: 'creator-wardrobe-pants-selector',
    title: 'Pants',
    noneLabel: 'No pants',
  },
  {
    key: 'legs',
    panelId: 'creator-wardrobe-legs-panel',
    selectorId: 'creator-wardrobe-legs-selector',
    title: 'Legs',
    noneLabel: 'No legs',
  },
] as const;

export function getWardrobePanelIdForLayer(layer: WardrobeLayerKey): string | null {
  if (layer === 'fullOutfit') return 'creator-wardrobe-outfits-panel';
  return WARDROBE_PART_PANEL_CONFIGS.find((config) => config.key === layer)?.panelId ?? null;
}

function getDualLibraryPanelIdsForLayer(layer: WardrobeLayerKey): readonly string[] | null {
  const pair = getWardrobeDualLibraryPair(layer);
  if (!pair) return null;
  const topPanelId = getWardrobePanelIdForLayer(pair[0]);
  const bottomPanelId = getWardrobePanelIdForLayer(pair[1]);
  if (!topPanelId || !bottomPanelId) return null;
  return [topPanelId, bottomPanelId];
}

/**
 * DOM ids of library panels to show for the selected wardrobe layer (Creator.Wardrobe right rail).
 * Paired atomics (hat/head, body/arms, jacket/sleeves, pants/legs) show both panels; switching within a pair does not swap panels.
 * `top` and other composites use {@link getWardrobePanelIdForLayer}.
 */
export function getWardrobeLibraryPanelIdsForLayer(layer: WardrobeLayerKey | null): readonly string[] {
  if (layer == null) return [];
  if (layer === 'fullOutfit') return ['creator-wardrobe-outfits-panel'];
  const dual = getDualLibraryPanelIdsForLayer(layer);
  if (dual) return dual;
  const id = getWardrobePanelIdForLayer(layer);
  return id ? [id] : [];
}

function bindWardrobeLibraryHoverPreview(selector: HTMLElement, layerKey: WardrobeLayerKey): void {
  if (selector.dataset.wardrobeHoverBound === '1') return;
  selector.dataset.wardrobeHoverBound = '1';

  selector.addEventListener('pointerenter', () => {
    if (document.body.dataset.route !== 'creator') return;
    if (document.body.dataset.editMode !== 'wardrobe') return;
    setWardrobeSelectorPanelHoverPreviewLayer(layerKey);
  });

  selector.addEventListener('pointerleave', (e) => {
    if (document.body.dataset.route !== 'creator') return;
    if (document.body.dataset.editMode !== 'wardrobe') return;
    const rel = e.relatedTarget;
    if (rel instanceof Node && selector.contains(rel)) return;
    if (rel instanceof Element && rel.closest('.creator-wardrobe-library-selector')) {
      return;
    }
    setWardrobeSelectorPanelHoverPreviewLayer(null);
  });
}

/** Attach hover preview for Creator.Wardrobe library strips (right rail). Idempotent per selector. */
export function ensureWardrobeLibraryHoverPreviewBound(): void {
  const outfitsSelector = document.getElementById('creator-skin-selector');
  if (outfitsSelector?.classList.contains('creator-wardrobe-library-selector')) {
    bindWardrobeLibraryHoverPreview(outfitsSelector, 'fullOutfit');
  }
  for (const config of WARDROBE_PART_PANEL_CONFIGS) {
    const el = document.getElementById(config.selectorId);
    if (el) bindWardrobeLibraryHoverPreview(el, config.key);
  }
}

export function buildWardrobeLibraryPanels(): void {
  const host = document.getElementById('creator-upper-right-panels-root');
  if (!host) return;

  const outfitsPanel = document.getElementById('creator-wardrobe-outfits-panel');
  if (outfitsPanel) outfitsPanel.classList.add('creator-wardrobe-library-panel');
  const outfitsSelector = document.getElementById('creator-skin-selector');
  if (outfitsSelector) outfitsSelector.classList.add('creator-wardrobe-library-selector');

  for (const config of WARDROBE_PART_PANEL_CONFIGS) {
    if (document.getElementById(config.panelId)) continue;
    const panel = createEl(
      'div',
      {
        id: config.panelId,
        className: 'creator-wardrobe-library-panel creator-mode-panel-hidden',
        'aria-label': config.title,
      },
      createEl('div', { className: 'creator-wardrobe-library-header' }, config.title),
      createEl(
        'div',
        {
          id: config.selectorId,
          className: 'creator-wardrobe-library-selector',
          role: 'listbox',
          'aria-label': config.title,
        },
      ),
    );
    host.appendChild(panel);
  }

  ensureWardrobeLibraryHoverPreviewBound();
}

type RenderWardrobeLibraryPanelOptions = {
  partKey?: WardrobePartKey;
  selectorId: string;
  items: WardrobeLibraryItem[];
  /** Active selection: null (None for overlay) or library path */
  activeValue: string | null;
  onSelect: (value: string | null) => void;
  onHoverStart?: (value: string | null) => void;
  onHoverEnd?: () => void;
  includeNone?: boolean;
  noneLabel?: string;
};

export function renderWardrobeLibraryPanel(options: RenderWardrobeLibraryPanelOptions): void {
  const container = document.getElementById(options.selectorId);
  if (!container) return;

  container.innerHTML = '';
  bindWardrobeLibraryNavigation(container);
  container.onmouseleave = () => {
    options.onHoverEnd?.();
  };

  const entries: Array<WardrobeLibraryItem & { isNone?: boolean }> = [];

  if (options.includeNone) {
    entries.push({ id: '__none__', path: '', label: options.noneLabel ?? 'None', isNone: true });
  }
  entries.push(...options.items);

  entries.forEach((item) => {
    const isNone = item.isNone === true;
    const isActive = isNone ? options.activeValue === null : item.path === options.activeValue;

    const btn = createEl(
      'button',
      {
        type: 'button',
        className: [
          'skin-preview',
          'creator-wardrobe-library-item',
          isNone ? 'creator-wardrobe-library-item-none' : '',
          isActive ? 'active' : '',
        ].filter(Boolean).join(' '),
        'data-path': item.path,
        'data-none': isNone ? '1' : '0',
        title: item.label,
        'aria-label': isNone ? item.label : `Select ${item.label}`,
      },
    );

    if (isNone) {
      btn.appendChild(createEl('span', { className: 'creator-wardrobe-library-item-none-label' }, item.label));
    } else {
      const img = createEl('img', {
        src: item.preview ?? item.path,
        alt: item.label,
        loading: 'lazy',
      });
      btn.appendChild(img);
    }

    btn.addEventListener('click', () => {
      if (isNone) options.onSelect(null);
      else options.onSelect(item.path);
    });
    btn.addEventListener('mouseenter', () => {
      if (isNone) options.onHoverStart?.(null);
      else options.onHoverStart?.(item.path);
    });
    container.appendChild(btn);
  });
}

function bindWardrobeLibraryNavigation(container: HTMLElement): void {
  if (container.dataset.wardrobeNavBound === '1') return;
  container.dataset.wardrobeNavBound = '1';

  container.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList.contains('creator-wardrobe-library-item')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.creator-wardrobe-library-item'),
    );
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(target as HTMLButtonElement);
    if (currentIndex === -1) return;

    const cols = 4;
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight') {
      if (currentIndex < buttons.length - 1) {
        nextIndex = currentIndex + 1;
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === 'ArrowLeft') {
      if (currentIndex > 0) {
        nextIndex = currentIndex - 1;
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === 'ArrowDown') {
      const candidate = currentIndex + cols;
      if (candidate < buttons.length) {
        nextIndex = candidate;
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === 'ArrowUp') {
      const candidate = currentIndex - cols;
      if (candidate >= 0) {
        nextIndex = candidate;
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === ' ') {
      focusWardrobePartsPanel();
      e.preventDefault();
      e.stopPropagation();
    }

    if (nextIndex !== currentIndex) {
      const nextButton = buttons[nextIndex];
      nextButton?.focus();
      nextButton?.click();
    }
  });
}

function focusWardrobePartsPanel(): void {
  const wardrobePanel = document.getElementById('creator-wardrobe-parts-panel');
  if (!wardrobePanel) return;
  const activeBtn = wardrobePanel.querySelector<HTMLButtonElement>('.creator-wardrobe-parts-btn.active');
  (activeBtn ?? wardrobePanel.querySelector<HTMLButtonElement>('.creator-wardrobe-parts-btn'))?.focus();
}
