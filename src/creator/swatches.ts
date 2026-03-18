import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import { isValidHex } from '../types/color';
import { getCreatorPanelsContainer } from './container';
import type { SwatchesContext, SwatchPaletteId } from './api';

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
      if (btn.dataset.color) ctx.applyColor(btn.dataset.color);
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

  subscribe(CREATOR_EVENTS.SWATCH_HISTORY_CHANGE, refreshSlots);
  subscribe(CREATOR_EVENTS.SWATCH_PALETTE_CHANGE, () => {
    updateTabsActive();
    refreshSlots();
  });
  subscribe(CREATOR_EVENTS.SKIN_LOAD_CHANGE, refreshSlots);

  container.appendChild(panel);
  updateTabsActive();
  updateSwatchSlots(slots, ctx);
  ctx.applyColor(ctx.getCurrentColor());
}
