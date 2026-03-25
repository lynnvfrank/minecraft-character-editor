import {
  creatorColorSlice,
  creatorSkinLoadSlice,
  creatorSwatchHistorySlice,
  creatorSwatchPaletteSlice,
} from '../state/creatorSlices';
import { isValidHex, normalizeHex, rgbToHex, hexToRgb } from '../lib/color';
import { getCreatorPanelsContainer } from './container';
import type { SwatchesContext, SwatchPaletteId } from './api';
import type { CreatorState } from '../state';

/** Squared RGB distance between two hex colors (faster than sqrt). */
export function colorDistanceSq(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/** Extract unique colors from skin canvas, selecting a diverse subset. Returns up to maxColors hex colors. */
export function extractColorsFromSkin(canvas: HTMLCanvasElement, maxColors = 25): string[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const seen = new Set<string>();
  const alphaThreshold = 16;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < alphaThreshold) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const hex = rgbToHex(r, g, b).toLowerCase();
    seen.add(hex);
  }
  const unique = Array.from(seen);
  if (unique.length <= maxColors) return unique;
  const selected: string[] = [unique[0]!];
  const remaining = new Set(unique.slice(1));
  while (selected.length < maxColors && remaining.size > 0) {
    let bestColor = '';
    let bestMinDist = -1;
    for (const c of remaining) {
      let minDist = Infinity;
      for (const s of selected) {
        const d = colorDistanceSq(c, s);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestColor = c;
      }
    }
    if (bestColor) {
      selected.push(bestColor);
      remaining.delete(bestColor);
    } else break;
  }
  return selected;
}

export type ColorActions = {
  addToSwatch: (hex: string) => void;
  applyColorToUI: (hex: string, addToSwatchList?: boolean, markAsUserSelected?: boolean) => void;
  setSwatchAt: (index: number, hex: string) => void;
};

/** Create color actions that modify state and notify creator slices. */
export function createColorActions(state: CreatorState, swatchMax: number): ColorActions {
  function addToSwatch(hex: string): void {
    const normalized = hex.toLowerCase();
    state.swatchColors = state.swatchColors.filter((c) => c.toLowerCase() !== normalized);
    state.swatchColors.unshift(normalized);
    if (state.swatchColors.length > swatchMax) state.swatchColors.pop();
    creatorSwatchHistorySlice.notify();
  }

  function applyColorToUI(hex: string, addToSwatchList = true, markAsUserSelected = true): void {
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    if (markAsUserSelected) state.userHasSelectedColor = true;
    state.currentColor = normalized;
    if (addToSwatchList) addToSwatch(normalized);
    creatorColorSlice.notify({ color: normalized });
  }

  function setSwatchAt(index: number, hex: string): void {
    if (state.activeSwatchPalette !== 'history') return;
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    while (state.swatchColors.length <= index) state.swatchColors.push('');
    state.swatchColors[index] = normalized;
    creatorSwatchHistorySlice.notify();
  }

  return { addToSwatch, applyColorToUI, setSwatchAt };
}

const PALETTES: { id: SwatchPaletteId; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'skin', label: 'Skin' },
];

/** Create swatch slot elements once and attach listeners. Returns array of slot elements. */
function createSwatchSlots(container: Element, ctx: SwatchesContext, max: number): HTMLButtonElement[] {
  const slots: HTMLButtonElement[] = [];
  for (let i = 0; i < max; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'creator-swatch-item creator-swatch-drop-target creator-swatch-draggable';
    btn.dataset.index = String(i);
    btn.addEventListener('click', () => {
      if (btn.dataset.color) ctx.applyColor(btn.dataset.color, false);
    });
    btn.addEventListener('dragstart', (e: Event) => {
      if (e instanceof DragEvent && e.dataTransfer && btn.dataset.color) {
        e.dataTransfer.setData('text/plain', btn.dataset.color);
        e.dataTransfer.effectAllowed = 'copy';
      }
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e instanceof DragEvent && e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      btn.classList.add('creator-swatch-drag-over');
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('creator-swatch-drag-over'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      btn.classList.remove('creator-swatch-drag-over');
      const hex = e instanceof DragEvent ? e.dataTransfer?.getData('text/plain') : undefined;
      if (hex && isValidHex(hex)) ctx.setSwatchColor(i, hex);
    });
    container.appendChild(btn);
    slots.push(btn);
  }
  return slots;
}

/** Update swatch slots in place; no innerHTML, no re-binding. Only updates changed slots. */
export function updateSwatchSlots(slots: HTMLButtonElement[], ctx: SwatchesContext): void {
  const colors = ctx.getSwatchColors();
  const max = ctx.getMaxSwatchCount();
  for (let i = 0; i < max; i++) {
    const el = slots[i];
    if (!el) continue;
    const c = colors[i];
    if (c) {
      if (el.dataset.color !== c) {
        el.style.backgroundColor = c;
        el.dataset.color = c;
        el.title = c;
      }
      el.draggable = true;
      el.classList.remove('creator-swatch-item-empty');
      el.removeAttribute('aria-hidden');
    } else {
      el.style.backgroundColor = '';
      el.removeAttribute('data-color');
      el.removeAttribute('title');
      el.draggable = false;
      el.classList.add('creator-swatch-item-empty');
      el.setAttribute('aria-hidden', 'true');
    }
  }
}

export function buildSwatchesPanel(ctx: SwatchesContext): void {
  const container = getCreatorPanelsContainer();
  if (!container) return;

  let panel = document.getElementById('creator-swatches-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'creator-swatches-panel';
  panel.className = 'creator-swatches-panel';
  panel.setAttribute('aria-label', 'Color swatches');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const addShortcut = isMac ? '⌘⇧+' : 'Ctrl+Shift+';

  const header = document.createElement('div');
  header.className = 'creator-swatches-header';
  header.title = `Add current color: ${addShortcut}`;
  const tabsRow = document.createElement('div');
  tabsRow.className = 'creator-swatches-tabs';
  tabsRow.setAttribute('role', 'tablist');
  const tabButtons: HTMLButtonElement[] = [];
  for (const { id, label } of PALETTES) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'creator-swatches-tab';
    tab.dataset.palette = id;
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.addEventListener('click', () => {
      ctx.setActivePalette(id);
      updateTabsActive();
      updateSwatchSlots(slots, ctx);
      if (swatchesMinimized) updateHeaderCollapsedDisplay();
    });
    tabsRow.appendChild(tab);
    tabButtons.push(tab);
  }
  const updateTabsActive = () => {
    const active = ctx.getActivePalette();
    tabButtons.forEach((tab) => {
      const isActive = tab.dataset.palette === active;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
  };

  const titleSpan = document.createElement('span');
  titleSpan.className = 'creator-swatches-title';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'creator-swatches-toggle';
  toggleBtn.title = 'Minimize panel';
  toggleBtn.setAttribute('aria-label', 'Minimize panel');
  const minimizeIcon = document.createElement('span');
  minimizeIcon.className = 'creator-swatches-icon creator-swatches-icon-minimize';
  minimizeIcon.textContent = '▼';
  const expandIcon = document.createElement('span');
  expandIcon.className = 'creator-swatches-icon creator-swatches-icon-expand';
  expandIcon.textContent = '▲';
  toggleBtn.append(minimizeIcon, expandIcon);
  header.append(tabsRow, titleSpan, toggleBtn);

  const grid = document.createElement('div');
  grid.className = 'creator-swatch-grid';
  grid.setAttribute('role', 'group');

  const slots = createSwatchSlots(grid, ctx, ctx.getMaxSwatchCount());
  panel.append(header, grid);
  const panelEl = panel;

  const updateHeaderCollapsedDisplay = () => {
    const count = ctx.getSwatchColors().filter((c) => c && c.length > 0).length;
    if (swatchesMinimized) {
      titleSpan.textContent = `Swatches (${count})`;
    } else {
      titleSpan.textContent = '';
    }
  };

  let swatchesMinimized = false;
  const updateSwatchesCollapsedUI = () => {
    panelEl.classList.toggle('creator-swatches-panel-collapsed', swatchesMinimized);
    tabsRow.classList.toggle('creator-swatches-tabs-hidden', swatchesMinimized);
    minimizeIcon.setAttribute('aria-hidden', String(swatchesMinimized));
    expandIcon.setAttribute('aria-hidden', String(!swatchesMinimized));
    toggleBtn.title = swatchesMinimized ? 'Expand panel' : 'Minimize panel';
    toggleBtn.setAttribute('aria-label', swatchesMinimized ? 'Expand panel' : 'Minimize panel');
    updateHeaderCollapsedDisplay();
  };
  toggleBtn.addEventListener('click', () => {
    swatchesMinimized = !swatchesMinimized;
    updateSwatchesCollapsedUI();
  });
  updateSwatchesCollapsedUI();

  const refreshSlots = () => {
    updateSwatchSlots(slots, ctx);
    if (swatchesMinimized) updateHeaderCollapsedDisplay();
  };

  creatorSwatchHistorySlice.subscribe(() => {
    if (document.body.dataset.route !== 'creator') return;
    refreshSlots();
  });
  creatorSwatchPaletteSlice.subscribe(() => {
    if (document.body.dataset.route !== 'creator') return;
    updateTabsActive();
    refreshSlots();
  });
  creatorSkinLoadSlice.subscribe(() => {
    if (document.body.dataset.route !== 'creator') return;
    refreshSlots();
  });

  container.appendChild(panel);
  updateTabsActive();
  updateSwatchSlots(slots, ctx);
  ctx.applyColor(ctx.getCurrentColor(), true, false); // sync to swatch, do not mark as user-selected
}
