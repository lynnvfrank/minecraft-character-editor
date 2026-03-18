import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import { createEl } from './dom';
import type { CreatorEditModeDetail } from '../creatorEvents';

export type WardrobeLayerKey =
  | 'fullOutfit'
  | 'hat'
  | 'head'
  | 'jacket'
  | 'body'
  | 'arms'
  | 'sleeves'
  | 'pants'
  | 'legs';

export type WardrobePartKey = Exclude<WardrobeLayerKey, 'fullOutfit'>;

export const WARDROBE_LAYERS: readonly { key: WardrobeLayerKey; label: string }[] = [
  { key: 'fullOutfit', label: 'Full outfit' },
  { key: 'hat', label: 'Hat' },
  { key: 'head', label: 'Head' },
  { key: 'jacket', label: 'Jacket' },
  { key: 'body', label: 'Body' },
  { key: 'sleeves', label: 'Sleeves' },
  { key: 'arms', label: 'Arms' },
  { key: 'pants', label: 'Pants' },
  { key: 'legs', label: 'Legs' },
];

export const WARDROBE_PART_KEYS: readonly WardrobePartKey[] = WARDROBE_LAYERS
  .filter((layer): layer is { key: WardrobePartKey; label: string } => layer.key !== 'fullOutfit')
  .map((layer) => layer.key);

let shortcutHandler: ((e: KeyboardEvent) => void) | null = null;
let unbindModeChange: (() => void) | null = null;

export function unregisterWardrobeShortcuts(): void {
  if (shortcutHandler) {
    document.removeEventListener('keydown', shortcutHandler);
    shortcutHandler = null;
  }
  if (unbindModeChange) {
    unbindModeChange();
    unbindModeChange = null;
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

export function buildWardrobePartsPanel(ctx: WardrobePartsPanelContext): void {
  const host = document.getElementById('creator-upper-left-panels');
  if (!host) return;

  const old = document.getElementById('creator-wardrobe-parts-panel');
  if (old) old.remove();

  const panel = createEl(
    'div',
    { id: 'creator-wardrobe-parts-panel', className: 'creator-wardrobe-parts-panel', role: 'group', 'aria-label': 'Wardrobe parts' },
    ...WARDROBE_LAYERS.map((l) =>
      createEl(
        'button',
        {
          type: 'button',
          className: 'creator-wardrobe-parts-btn',
          'data-layer': l.key,
          title: l.label,
        },
        l.label
      )
    )
  );

  // Place below the creator mode panel if present, otherwise at top.
  const modePanel = document.getElementById('creator-mode-panel');
  if (modePanel && modePanel.parentElement === host) {
    host.insertBefore(panel, modePanel.nextSibling);
  } else {
    host.insertBefore(panel, host.firstChild);
  }

  const onClick = (layer: WardrobeLayerKey) => {
    ctx.setSelectedLayer(layer);
    renderActive(panel, layer);
  };

  panel.querySelectorAll<HTMLButtonElement>('.creator-wardrobe-parts-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer as WardrobeLayerKey | undefined;
      if (!layer) return;
      onClick(layer);
    });
  });

  renderActive(panel, ctx.getSelectedLayer());

  // Shortcuts are enabled only when edit mode is wardrobe.
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

    // 1..9 selects layer (and keep focus in wardrobe panel)
    const keyNum = Number.parseInt(e.key, 10);
    if (Number.isInteger(keyNum) && keyNum >= 1 && keyNum <= WARDROBE_LAYERS.length) {
      e.preventDefault();
      const layer = WARDROBE_LAYERS[keyNum - 1]!.key;
      onClick(layer);
      return;
    }

    // ArrowUp/ArrowDown cycle layers
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = ctx.getSelectedLayer();
      const idx = Math.max(0, WARDROBE_LAYERS.findIndex((l) => l.key === cur));
      const nextIdx = e.key === 'ArrowUp'
        ? (idx - 1 + WARDROBE_LAYERS.length) % WARDROBE_LAYERS.length
        : (idx + 1) % WARDROBE_LAYERS.length;
      onClick(WARDROBE_LAYERS[nextIdx]!.key);
      return;
    }

    // Spacebar: move focus into the active outfits/parts panel.
    if (e.key === ' ') {
      e.preventDefault();
      focusActiveWardrobeLibraryItem();
      return;
    }
  };
  document.addEventListener('keydown', shortcutHandler);

  unbindModeChange = subscribe(CREATOR_EVENTS.EDIT_MODE_CHANGE, (e: CustomEvent<CreatorEditModeDetail>) => {
    if (e.detail?.mode !== 'wardrobe') return;
    renderActive(panel, ctx.getSelectedLayer());
  });
}

