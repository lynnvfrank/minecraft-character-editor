import type { SkinEntry } from '../types/catalog';
import { createEl } from './dom';
import type { WardrobeLayerKey, WardrobePartKey } from './wardrobePartsPanel';

export type WardrobeLibraryItem = SkinEntry & { id?: string };

export type WardrobePartPanelConfig = {
  key: WardrobePartKey;
  panelId: string;
  selectorId: string;
  title: string;
  noneLabel: string;
};

export const WARDROBE_PART_PANEL_CONFIGS: readonly WardrobePartPanelConfig[] = [
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
    title: 'Jackets',
    noneLabel: 'No jacket',
  },
  {
    key: 'body',
    panelId: 'creator-wardrobe-body-panel',
    selectorId: 'creator-wardrobe-body-selector',
    title: 'Bodies',
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
}

type RenderWardrobeLibraryPanelOptions = {
  selectorId: string;
  items: WardrobeLibraryItem[];
  activePath: string | null;
  onSelect: (path: string | null) => void;
  includeNone?: boolean;
  noneLabel?: string;
};

export function renderWardrobeLibraryPanel(options: RenderWardrobeLibraryPanelOptions): void {
  const container = document.getElementById(options.selectorId);
  if (!container) return;

  container.innerHTML = '';
  bindWardrobeLibraryNavigation(container);

  const entries: Array<WardrobeLibraryItem & { isNone?: boolean }> = options.includeNone
    ? [{ id: '__none__', path: '', label: options.noneLabel ?? 'None', isNone: true }, ...options.items]
    : [...options.items];

  entries.forEach((item) => {
    const isNone = item.isNone === true;
    const isActive = isNone ? options.activePath == null : item.path === options.activePath;
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

    btn.addEventListener('click', () => options.onSelect(isNone ? null : item.path));
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
