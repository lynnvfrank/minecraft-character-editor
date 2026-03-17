/**
 * Character creator: higher-res working canvas, 64×64 export.
 * Step 2–6: Route, shell, canvas, brush, eraser, fill, layers.
 * Step 7: Undo/Redo.
 * Resolution: work at WORK_SIZE (e.g. 128×128), export downscaled to 64×64.
 */

import { SKIN_LAYER_BOUNDS, SKIN_PART_BOUNDS, isInDeadZone, isLayerKey, LAYER_KEYS, partToLayer, type Bounds } from './skinLayout';
import { WORK_SIZE, RESOLUTION_MULTIPLIER } from './skinCoordinates';
import { publish, CREATOR_EVENTS } from './creatorEvents';
import type { SkinEntry } from './types/catalog';
import { EDIT_MODE_2D, EDIT_MODE_3D, type DrawingTool } from './creator/api';
import { createCreatorState } from './creator/creatorState';
import { normalizeHex, rgbToHex, hexToRgb } from './types/color';
import {
  buildColorToolbar,
  buildColorPickerPanel,
  buildSwatchesPanel,
  buildSkinLayersPanel,
  buildEditorToolsPanel,
  buildTexturePositionPanel,
} from './creator/index';
import * as skinIO from './creator/skinIO';
import * as undo from './creator/undo';
import * as brush from './creator/brush';
import * as blockyEditor from './creator/blockyEditor';

const UNDO_LIMIT = 50;
const SWATCH_MAX = 25; /* 5 columns × 5 rows */
/** Groups for layers panel display; separator shown after each group. */
const LAYER_GROUPS: readonly (readonly string[])[] = [
  ['hat', 'head'],
  ['jacket', 'body'],
  ['sleeves', 'arms'],
  ['pants', 'legs'],
];

const state = createCreatorState();
const BRUSH_SIZE = 1;

let skinCanvas: HTMLCanvasElement | null = null;
let blockyCtx: blockyEditor.BlockyEditorContext | null = null;

/** True once a skin has been loaded into the creator (from gallery or on route enter). Used to preserve canvas when re-entering creator. */
let creatorCanvasPopulated = false;

export function getCreatorCanvasPopulated(): boolean {
  return creatorCanvasPopulated;
}

function addToSwatch(hex: string): void {
  const normalized = hex.toLowerCase();
  state.swatchColors = state.swatchColors.filter((c) => c.toLowerCase() !== normalized);
  state.swatchColors.unshift(normalized);
  if (state.swatchColors.length > SWATCH_MAX) state.swatchColors.pop();
  publish(CREATOR_EVENTS.SWATCH_HISTORY_CHANGE);
}

function pointInBounds(x: number, y: number, b: Bounds): boolean {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

/** Return which layer (head, hat, body, etc.) contains the given working coords, or null. */
export function getLayerAtCoords(workingX: number, workingY: number): string | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    if (!bounds) continue;
    for (const b of bounds) {
      if (pointInBounds(normX, normY, b)) return layer;
    }
  }
  return null;
}

/** Return the specific part display name (Right leg, Left pants, etc.) at coords, or null. */
export function getPartDisplayNameAtCoords(workingX: number, workingY: number): string | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  if (isInDeadZone(normX, normY)) return null;
  for (const { part, bounds } of SKIN_PART_BOUNDS) {
    for (const b of bounds) {
      if (pointInBounds(normX, normY, b)) return part;
    }
  }
  return null;
}

/** 3D mode: can we paint on this layer? (visible and not locked) */
function canPaintOn3DLayer(layer: string | null): boolean {
  if (!layer) return false;
  if (!state.layer3DVisible[layer]) return false;
  if (state.layer3DLocked[layer]) return false;
  return true;
}

/** 3D mode: is the pixel at (workingX, workingY) in a paintable layer? */
function isInPaintable3DLayer(workingX: number, workingY: number): boolean {
  return canPaintOn3DLayer(getLayerAtCoords(workingX, workingY));
}


function getSkinCanvas(): HTMLCanvasElement {
  if (!skinCanvas) {
    skinCanvas = document.createElement('canvas');
    skinCanvas.width = WORK_SIZE;
    skinCanvas.height = WORK_SIZE;
    // Establish context with willReadFrequently so readback (getImageData, etc.) is efficient.
    skinCanvas.getContext('2d', { willReadFrequently: true });
  }
  return skinCanvas;
}

function getOverlayCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-overlay-canvas') as HTMLCanvasElement | null;
}


export { getBrushCursorStyleFor3D } from './creator/brush';

function updateCanvasCursor(): void {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid) return;
  if (state.activeTool === 'navigate') grid.style.cursor = 'default';
  else if (state.activeTool === 'eyedropper') grid.style.cursor = 'crosshair';
  else if (state.activeTool === 'fill') grid.style.cursor = 'default';
  else grid.style.cursor = blockyEditor.getBrushCursorStyle2D();
}

function performUndo(): void {
  if (!blockyCtx) return;
  undo.performUndo({
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    getSkinCanvas,
    renderToDisplay: () => blockyEditor.renderToDisplay(blockyCtx!),
  });
  publish(CREATOR_EVENTS.CANVAS_CHANGE);
}

function updateAllUndoRedoButtons(): void {
  undo.updateUndoRedoButtons(state.undoStack, state.redoStack);
}

function performRedo(): void {
  if (!blockyCtx) return;
  undo.performRedo({
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    getSkinCanvas,
    renderToDisplay: () => blockyEditor.renderToDisplay(blockyCtx!),
  });
  publish(CREATOR_EVENTS.CANVAS_CHANGE);
}

/** Apply a color to currentColor and publish. If addToSwatchList is true, prepends to swatch list. Subscribers handle UI updates. */
function applyColorToUI(hex: string, addToSwatchList = true): void {
  const normalized = normalizeHex(hex);
  if (!normalized) return;
  state.currentColor = normalized;
  if (addToSwatchList) addToSwatch(normalized);
  publish(CREATOR_EVENTS.CURRENT_COLOR_CHANGE, { color: normalized });
}

/** Set swatch at index (for drag-drop). Only applies to History palette; no-op for Skin. */
function setSwatchAt(index: number, hex: string): void {
  if (state.activeSwatchPalette !== 'history') return;
  const normalized = normalizeHex(hex);
  if (!normalized) return;
  while (state.swatchColors.length <= index) state.swatchColors.push('');
  state.swatchColors[index] = normalized;
  publish(CREATOR_EVENTS.SWATCH_HISTORY_CHANGE);
}

/** Squared RGB distance between two hex colors (faster than sqrt). */
function colorDistanceSq(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/** Extract unique colors from skin canvas, selecting a diverse subset. Returns up to SWATCH_MAX hex colors. */
function extractColorsFromSkin(canvas: HTMLCanvasElement): string[] {
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
  if (unique.length <= SWATCH_MAX) return unique;
  const selected: string[] = [unique[0]!];
  const remaining = new Set(unique.slice(1));
  while (selected.length < SWATCH_MAX && remaining.size > 0) {
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

const FALLBACK_SKINS: SkinEntry[] = [{ path: '/skins/RunningboyRig.png', label: 'Default' }];

export async function loadSkinFromPath(path: string): Promise<void> {
  const canvas = getSkinCanvas();
  const result = await skinIO.loadSkinToCanvas(path, canvas, skinIO.captureCanvasImageData);
  if (!result) return;
  creatorCanvasPopulated = true;
  const { beforeData, afterData } = result;
  state.redoStack = [];
  state.undoStack.push({ type: 'load', beforeData, afterData });
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.skinSwatchColors = extractColorsFromSkin(canvas);
  publish(CREATOR_EVENTS.SKIN_LOAD_CHANGE, { path });
  publish(CREATOR_EVENTS.CANVAS_CHANGE);
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  updateAllUndoRedoButtons();
}

function setupCreatorSkinGallery(skins: SkinEntry[]): void {
  const container = document.getElementById('creator-skin-selector');
  if (!container) return;
  container.innerHTML = '';
  skins.forEach((skin) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skin-preview creator-skin-preview';
    btn.dataset.path = skin.path;
    btn.setAttribute('aria-label', `Load skin: ${skin.label}`);
    const img = document.createElement('img');
    img.src = skin.preview ?? skin.path;
    img.alt = skin.label;
    img.loading = 'lazy';
    btn.appendChild(img);
    btn.addEventListener('click', () => loadSkinFromPath(skin.path));
    container.appendChild(btn);
  });
}

/** Report texture position under pointer. Publishes event; subscribers update hover info and layers panel. */
function reportTexturePosition(part: string | null, skinX: number, skinY: number): void {
  const layer = part != null ? partToLayer(part) : null;
  publish(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, {
    part,
    layer,
    skinX,
    skinY,
  });
}

/** Update the hover info panel with current part and skin coords. Pass null to clear. Public API for 2D/3D views. */
export function updateHoverInfo(part: string | null, skinX: number, skinY: number): void {
  reportTexturePosition(part, skinX, skinY);
}

function buildCreatorPanels(): void {
  const colorToolbarCtx = {
    getCurrentColor: () => state.currentColor,
    applyColor: applyColorToUI,
  };
  const colorPickerCtx = {
    getCurrentColor: () => state.currentColor,
    applyColor: applyColorToUI,
  };
  const swatchesCtx = {
    getSwatchColors: () =>
      state.activeSwatchPalette === 'history' ? state.swatchColors : state.skinSwatchColors,
    getSwatchColorsForPalette: (paletteId: 'history' | 'skin') =>
      paletteId === 'history' ? state.swatchColors : state.skinSwatchColors,
    getCurrentColor: () => state.currentColor,
    getMaxSwatchCount: () => SWATCH_MAX,
    getActivePalette: () => state.activeSwatchPalette,
    setActivePalette: (paletteId: 'history' | 'skin') => {
      state.activeSwatchPalette = paletteId;
      publish(CREATOR_EVENTS.SWATCH_PALETTE_CHANGE);
    },
    applyColor: applyColorToUI,
    setSwatchColor: setSwatchAt,
  };
  const skinLayersCtx = {
    layerVisibility: state.layer3DVisible,
    layerLocked: state.layer3DLocked,
    isLayersPanelCollapsed: () => state.layersPanel3DCollapsed,
    setLayersPanelCollapsed: (collapsed: boolean) => { state.layersPanel3DCollapsed = collapsed; },
    setLayerVisible: setLayer3DVisible,
    setLayerLocked: setLayer3DLocked,
    onVisibilitySoloClick: handleVisibilityAltClick,
    onLockSoloClick: handleLockAltClick,
    syncVisibilityCheckboxes,
    syncLockCheckboxes,
    clearSoloIndicator: updateSoloIndicator,
    setupDragToToggle,
    layerGroups: LAYER_GROUPS,
  };
  const editorToolsCtx = {
    getActiveTool: () => state.activeTool,
    isEditMode3D: () => state.editMode3D,
    isRulersShown: () => state.showRulers,
    isTemplateShown: () => state.showTemplate,
    setActiveTool,
    setEditMode3D,
    setRulersShown: (show: boolean) => { state.showRulers = show; },
    setTemplateShown: (show: boolean) => { state.showTemplate = show; },
    performUndo,
    performRedo,
    updateUndoRedoButtons: updateAllUndoRedoButtons,
    renderCanvas: () => blockyCtx && blockyEditor.renderToDisplay(blockyCtx),
    updateCanvasCursor,
  };

  buildColorToolbar(colorToolbarCtx);
  buildColorPickerPanel(colorPickerCtx);
  buildSwatchesPanel(swatchesCtx);
  buildSkinLayersPanel(skinLayersCtx);
  buildEditorToolsPanel(editorToolsCtx);
  buildTexturePositionPanel();
}

function setupCanvasAreaResize(): void {
  const area = document.getElementById('creator-canvas-area');
  if (!area) return;
  const update = () => {
    blockyEditor.fitCanvasAreaScale();
    updateCanvasCursor();
  };
  blockyEditor.fitCanvasAreaScale();
  updateCanvasCursor();
  new ResizeObserver(update).observe(area);
  requestAnimationFrame(update);
}

/**
 * Initialize the creator: 64×64 skin state, display canvas, toolbar, brush.
 * Call when the creator panel is shown.
 */
export function initCreator(): void {
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  if (!creatorCanvasPopulated) {
    ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  }
  document.body.dataset.editMode = state.editMode3D ? EDIT_MODE_3D : EDIT_MODE_2D;
  const wrapper = document.getElementById('creator-view-wrapper');
  if (wrapper && !document.getElementById('creator-lower-right-panels')) {
    const container = document.createElement('div');
    container.id = 'creator-lower-right-panels';
    container.className = 'creator-lower-right-panels';
    const group = document.createElement('div');
    group.id = 'creator-right-panels-group';
    group.className = 'creator-right-panels-group';
    container.appendChild(group);
    wrapper.appendChild(container);
  } else {
    const container = document.getElementById('creator-lower-right-panels');
    if (container && !document.getElementById('creator-right-panels-group')) {
      const group = document.createElement('div');
      group.id = 'creator-right-panels-group';
      group.className = 'creator-right-panels-group';
      while (container.firstChild) group.appendChild(container.firstChild);
      container.appendChild(group);
    }
  }
  blockyCtx = {
    state,
    getSkinCanvas,
    getOverlayCanvas,
    updateHoverInfo,
    getPartDisplayNameAtCoords,
    applyColorToUI: (hex: string) => applyColorToUI(hex),
    sampleColorAtWithAlpha,
    eyedropperAlphaThreshold: EYEDROPPER_ALPHA_THRESHOLD,
    pushUndoStroke: (pixels, isEraser, newColor) => {
      state.redoStack = [];
      state.undoStack.push({ type: 'stroke', pixels, isEraser, newColor });
      if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    },
    pushUndoFill: (pixels, fillColor) => {
      state.redoStack = [];
      state.undoStack.push({ type: 'fill', pixels, fillColor });
      if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    },
    onCanvasChange: () => publish(CREATOR_EVENTS.CANVAS_CHANGE),
    updateUndoRedoButtons: updateAllUndoRedoButtons,
    undoLimit: UNDO_LIMIT,
  };
  buildCreatorPanels();
  blockyEditor.buildBlockyGrid();
  blockyEditor.buildRulers();
  blockyEditor.setupBlockyGridEvents(blockyCtx);
  blockyEditor.renderToDisplay(blockyCtx);
  setupCanvasAreaResize();

  (async () => {
    try {
      const res = await fetch('/skins/index.json');
      const data = await res.json();
      const skins: SkinEntry[] = Array.isArray(data) && data.length > 0 ? data : FALLBACK_SKINS;
      setupCreatorSkinGallery(skins);
    } catch {
      setupCreatorSkinGallery(FALLBACK_SKINS);
    }
  })();

  const downloadBtn = document.getElementById('creator-download-btn');
  downloadBtn?.addEventListener('click', () => {
    const dataUrl = exportTo64x64DataURL();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `skin-${Date.now()}.png`;
    a.click();
  });

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.route !== 'creator') return;
    const target = e.target as HTMLElement;
    const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (inInput) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          performRedo();
        } else {
          performUndo();
        }
        updateAllUndoRedoButtons();
        return;
      }
      if (e.shiftKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        addToSwatch(state.currentColor);
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          setEditMode3D(!getEditMode3D());
          return;
        case 'h':
        case 'H':
          e.preventDefault();
          setActiveTool('navigate');
          return;
        case 'b':
        case 'B':
          e.preventDefault();
          setActiveTool('brush');
          return;
        case 'e':
        case 'E':
          e.preventDefault();
          setActiveTool('eraser');
          return;
        case 'g':
        case 'G':
          e.preventDefault();
          setActiveTool('fill');
          return;
      }
    }
  });
}

/** Returns the working canvas (WORK_SIZE × WORK_SIZE). */
export function getCreatorSkinCanvas(): HTMLCanvasElement {
  return getSkinCanvas();
}

/** Whether Edit 3D mode is active (paint on 3D model). */
export function getEditMode3D(): boolean {
  return state.editMode3D;
}

/** Set Edit 3D mode and dispatch change event. */
export function setEditMode3D(is3D: boolean): void {
  state.editMode3D = is3D;
  document.body.dataset.editMode = state.editMode3D ? EDIT_MODE_3D : EDIT_MODE_2D;
  publish(CREATOR_EVENTS.EDIT_MODE_CHANGE, { is3D: state.editMode3D });
}

/** 3D layers panel: visibility state (layer hidden = not rendered, brush ignored). */
export function getLayer3DVisible(): Record<string, boolean> {
  return { ...state.layer3DVisible };
}

/** 3D layers panel: lock state (locked = brush ignored, part stays visible). */
export function getLayer3DLocked(): Record<string, boolean> {
  return { ...state.layer3DLocked };
}

/** Set visibility for a layer and dispatch change event. */
export function setLayer3DVisible(layer: string, visible: boolean): void {
  if (isLayerKey(layer)) {
    state.layer3DVisible[layer] = visible;
    publish(CREATOR_EVENTS.LAYER3D_CHANGE);
  }
}

/** Set visibility for all layers at once (used by solo visibility). */
function setLayer3DVisibleAll(visible: Record<string, boolean>): void {
  for (const k of LAYER_KEYS) {
    if (visible[k] !== undefined) state.layer3DVisible[k] = visible[k];
  }
  publish(CREATOR_EVENTS.LAYER3D_CHANGE);
}

/** Set lock for all layers at once (used by solo lock). */
function setLayer3DLockedAll(locked: Record<string, boolean>): void {
  for (const k of LAYER_KEYS) {
    if (locked[k] !== undefined) state.layer3DLocked[k] = locked[k];
  }
  publish(CREATOR_EVENTS.LAYER3D_CHANGE);
}

/** Sync visibility checkboxes from layer3DVisible (after batch changes). */
function syncVisibilityCheckboxes(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLInputElement>('.creator-layer-3d-visible').forEach((cb) => {
    const layer = cb.dataset.layer;
    if (layer && state.layer3DVisible[layer] !== undefined) cb.checked = state.layer3DVisible[layer];
  });
}

/** Sync lock checkboxes from layer3DLocked (after batch changes). */
function syncLockCheckboxes(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLInputElement>('.creator-layer-3d-lock').forEach((cb) => {
    const layer = cb.dataset.layer;
    if (layer && state.layer3DLocked[layer] !== undefined) cb.checked = state.layer3DLocked[layer];
  });
}

/** Get layer name from element under client coords, or null. */
function getLayerUnderPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest('.creator-layers-panel-3d-row');
  return row instanceof HTMLElement ? row.dataset.layer ?? null : null;
}

const DRAG_THRESHOLD_PX = 4;

/** Setup drag-to-toggle: mousedown on label, drag over rows to apply same value. */
function setupDragToToggle(
  panel: HTMLElement,
  labelSelector: string,
  inputSelector: string,
  getValue: (layer: string) => boolean,
  setValue: (layer: string, value: boolean) => void,
  sync: (panel: HTMLElement) => void,
  canStartDrag: (e: Event) => boolean = () => true
): void {
  panel.querySelectorAll(labelSelector).forEach((label) => {
    const input = label.querySelector<HTMLInputElement>(inputSelector);
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('mousedown', (e) => {
      if (!(e instanceof MouseEvent) || e.button !== 0 || !canStartDrag(e)) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const dragValue = !getValue(layer);
      let hasDragged = false;
      const handleMove = (moveEv: MouseEvent) => {
        if (!hasDragged) {
          const dx = moveEv.clientX - startX;
          const dy = moveEv.clientY - startY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
          hasDragged = true;
          setValue(layer, dragValue);
          sync(panel);
        }
        const targetLayer = getLayerUnderPoint(moveEv.clientX, moveEv.clientY);
        if (targetLayer != null && isLayerKey(targetLayer)) {
          setValue(targetLayer, dragValue);
          sync(panel);
        }
      };
      const handleClick = (clickEv: Event) => {
        label.removeEventListener('click', handleClick, true);
        if (hasDragged) {
          clickEv.preventDefault();
          clickEv.stopPropagation();
        }
      };
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp, true);
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp, true);
      label.addEventListener('click', handleClick, true);
    });
  });
}

/** Sync UI after solo visibility/lock changes. Solo label text is not shown. */
function updateSoloIndicator(panel: HTMLElement): void {
  const indicator = panel.querySelector('.creator-layers-panel-3d-solo-indicator');
  indicator?.remove();
}

/** Handle Alt+click on visibility: solo this layer or restore. */
function handleVisibilityAltClick(layer: string): void {
  if (state.layer3DSoloMode) {
    if (state.layer3DSoloCurrentLayer === layer) {
      if (state.layer3DSoloBeforeState) setLayer3DVisibleAll(state.layer3DSoloBeforeState);
      state.layer3DSoloMode = false;
      state.layer3DSoloBeforeState = null;
      state.layer3DSoloCurrentLayer = null;
    } else {
      state.layer3DSoloCurrentLayer = layer;
      const soloState = Object.fromEntries(LAYER_KEYS.map((k) => [k, k === layer]));
      setLayer3DVisibleAll(soloState);
    }
  } else {
    state.layer3DSoloBeforeState = { ...state.layer3DVisible };
    state.layer3DSoloCurrentLayer = layer;
    const soloState = Object.fromEntries(LAYER_KEYS.map((k) => [k, k === layer]));
    setLayer3DVisibleAll(soloState);
    state.layer3DSoloMode = true;
  }
}

/** Handle Alt+click on lock: solo this layer (unlock only this, lock all others) or restore. */
function handleLockAltClick(layer: string): void {
  if (state.layer3DSoloLockMode) {
    if (state.layer3DSoloLockCurrentLayer === layer) {
      if (state.layer3DSoloLockBeforeState) setLayer3DLockedAll(state.layer3DSoloLockBeforeState);
      state.layer3DSoloLockMode = false;
      state.layer3DSoloLockBeforeState = null;
      state.layer3DSoloLockCurrentLayer = null;
    } else {
      state.layer3DSoloLockCurrentLayer = layer;
      const soloState = Object.fromEntries(LAYER_KEYS.map((k) => [k, k !== layer]));
      setLayer3DLockedAll(soloState);
    }
  } else {
    state.layer3DSoloLockBeforeState = { ...state.layer3DLocked };
    state.layer3DSoloLockCurrentLayer = layer;
    const soloState = Object.fromEntries(LAYER_KEYS.map((k) => [k, k !== layer]));
    setLayer3DLockedAll(soloState);
    state.layer3DSoloLockMode = true;
  }
}

/** Set lock for a layer and dispatch change event. */
export function setLayer3DLocked(layer: string, locked: boolean): void {
  if (isLayerKey(layer)) {
    state.layer3DLocked[layer] = locked;
    publish(CREATOR_EVENTS.LAYER3D_CHANGE);
  }
}

/** Active drawing tool (navigate = no paint, full orbit). */
export function getActiveTool(): DrawingTool {
  return state.activeTool;
}

/** Set active tool and dispatch change event. */
export function setActiveTool(tool: DrawingTool): void {
  state.activeTool = tool;
  publish(CREATOR_EVENTS.TOOLS_CHANGE);
}

/** Brush size (fixed at 1 pixel for 3D; 1 grid cell for 2D blocky). */
export function getBrushSize(): number {
  return BRUSH_SIZE;
}

/** WORK_SIZE for UV→pixel mapping. */
export function getCreatorWorkSize(): number {
  return WORK_SIZE;
}

/** UV to working coords. Re-exported from skinCoordinates. */
export { uvToWorkingCoords } from './skinCoordinates';

/** Start paint/eraser stroke at working coords (or do fill if fill tool). Returns true if anything was done. */
export function paintStartFrom3D(workingX: number, workingY: number): boolean {
  if (state.activeTool === 'navigate' || state.activeTool === 'eyedropper') return false;
  if (!isInPaintable3DLayer(workingX, workingY)) return false;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const canPaintAt = (x: number, y: number) => isInPaintable3DLayer(x, y);
  const getCurrentColor = () => state.currentColor;
  if (state.activeTool === 'fill') {
    const changed = brush.floodFill(ctx, workingX, workingY, canPaintAt, getCurrentColor);
    if (changed.length > 0) {
      state.redoStack = [];
      state.undoStack.push({ type: 'fill', pixels: changed, fillColor: state.currentColor });
      if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
      publish(CREATOR_EVENTS.CANVAS_CHANGE);
    }
    if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
    return changed.length > 0;
  }
  state.isDrawing = true;
  state.lastSkinX = workingX;
  state.lastSkinY = workingY;
  const isEraser = state.activeTool === 'eraser';
  state.currentStroke = { pixels: [], isEraser, newColor: state.currentColor, recorded: new Set<string>() };
  const baseX = Math.floor(workingX / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
  const baseY = Math.floor(workingY / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
  brush.brushAt(ctx, baseX, baseY, isEraser, canPaintAt, getCurrentColor, state.currentStroke, RESOLUTION_MULTIPLIER, true);
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  publish(CREATOR_EVENTS.CANVAS_CHANGE);
  return true;
}

/** Continue paint stroke (call during drag). */
export function paintMoveFrom3D(workingX: number, workingY: number): void {
  if (!state.currentStroke || !state.isDrawing) return;
  if (!isInPaintable3DLayer(workingX, workingY)) return;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const canPaintAt = (x: number, y: number) => isInPaintable3DLayer(x, y);
  const getCurrentColor = () => state.currentColor;
  brush.drawLine(
    ctx,
    state.lastSkinX,
    state.lastSkinY,
    workingX,
    workingY,
    state.currentStroke.isEraser,
    canPaintAt,
    getCurrentColor,
    state.currentStroke,
    RESOLUTION_MULTIPLIER,
    true
  );
  state.lastSkinX = workingX;
  state.lastSkinY = workingY;
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  publish(CREATOR_EVENTS.CANVAS_CHANGE);
}

/** End paint stroke and push to undo stack. */
export function paintEndFrom3D(): void {
  if (state.currentStroke && state.currentStroke.pixels.length > 0) {
    state.redoStack = [];
    state.undoStack.push({
      type: 'stroke',
      pixels: state.currentStroke.pixels,
      isEraser: state.currentStroke.isEraser,
      newColor: state.currentStroke.newColor
    });
    if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  }
  state.currentStroke = null;
  state.isDrawing = false;
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  updateAllUndoRedoButtons();
}

/** Alpha threshold below which a pixel is considered transparent (eyedropper ignores these). */
export const EYEDROPPER_ALPHA_THRESHOLD = 2 / 255;

/** Sample color at working coords. Returns hex and alpha (0–1), or null if out of bounds. */
export function sampleColorAtWithAlpha(workingX: number, workingY: number): { hex: string; alpha: number } | null {
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (workingX < 0 || workingX >= WORK_SIZE || workingY < 0 || workingY >= WORK_SIZE) return null;
  const d = ctx.getImageData(workingX, workingY, 1, 1).data;
  return { hex: rgbToHex(d[0], d[1], d[2]), alpha: d[3] / 255 };
}

/** Sample color at working coords (eyedropper). Returns hex or null. */
export function sampleColorAt(workingX: number, workingY: number): string | null {
  const result = sampleColorAtWithAlpha(workingX, workingY);
  return result ? result.hex : null;
}

/** Apply sampled color to swatch and UI (call after sampleColorAt when user picked a color). */
export function applySampledColor(hex: string): void {
  applyColorToUI(hex);
}

/** Export the skin downscaled to 64×64 PNG. Uses nearest-neighbor for pixel-perfect output. */
export function exportTo64x64DataURL(): string {
  return skinIO.exportTo64x64DataURL(getSkinCanvas());
}
