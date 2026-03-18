/**
 * Character creator: higher-res working canvas, 64×64 export.
 * Step 2–6: Route, shell, canvas, brush, eraser, fill, layers.
 * Step 7: Undo/Redo.
 * Resolution: work at WORK_SIZE (e.g. 128×128), export downscaled to 64×64.
 */

import { SKIN_LAYER_BOUNDS, SKIN_PART_BOUNDS, isInDeadZone, isLayerKey, LAYER_KEYS, partToLayer, type Bounds } from './skinLayout';
import { WORK_SIZE, RESOLUTION_MULTIPLIER } from './skinCoordinates';
import { subscribe, publish, CREATOR_EVENTS } from './creatorEvents';
import type { SkinEntry } from './types/catalog';
import { EDIT_MODE_2D, EDIT_MODE_3D, type DrawingTool, type EditMode } from './creator/api';
import { createCreatorState } from './creator/creatorState';
import { normalizeHex, rgbToHex, hexToRgb } from './types/color';
import {
  buildColorToolbar,
  buildColorPickerPanel,
  buildSwatchesPanel,
  buildSkinLayersPanel,
  buildEditorToolsPanel,
  unregisterEditorModeShortcuts,
  buildWardrobePartsPanel,
  buildWardrobeLibraryPanels,
  renderWardrobeLibraryPanel,
  unregisterWardrobeShortcuts,
  WARDROBE_PART_PANEL_CONFIGS,
  getWardrobePanelIdForLayer,
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
const MODE_TRANSITION_MS = 450;

let skinCanvas: HTMLCanvasElement | null = null;
let blockyCtx: blockyEditor.BlockyEditorContext | null = null;

/** True once a skin has been loaded into the creator (from gallery or on route enter). Used to preserve canvas when re-entering creator. */
let creatorCanvasPopulated = false;
let modePanelsBound = false;
let modePanelsCurrentMode: EditMode | null = null;
let modeTransitionToken = 0;
let savedLayerStateBeforeNonEditMode: { visible: Record<string, boolean>; locked: Record<string, boolean> } | null = null;

export function getCreatorCanvasPopulated(): boolean {
  return creatorCanvasPopulated;
}

function isCreatorEditMode(mode: EditMode): boolean {
  return mode === EDIT_MODE_2D || mode === EDIT_MODE_3D;
}

function clearLayerSoloModes(): void {
  state.layer3DSoloMode = false;
  state.layer3DSoloBeforeState = null;
  state.layer3DSoloCurrentLayer = null;
  state.layer3DSoloLockMode = false;
  state.layer3DSoloLockBeforeState = null;
  state.layer3DSoloLockCurrentLayer = null;
}

function saveLayerStateAndNormalizeForNonEditMode(): void {
  if (!savedLayerStateBeforeNonEditMode) {
    savedLayerStateBeforeNonEditMode = {
      visible: { ...state.layer3DVisible },
      locked: { ...state.layer3DLocked },
    };
  }
  clearLayerSoloModes();
  setLayer3DVisibleAll(Object.fromEntries(LAYER_KEYS.map((k) => [k, true])));
  setLayer3DLockedAll(Object.fromEntries(LAYER_KEYS.map((k) => [k, false])));
}

function restoreLayerStateForEditMode(): void {
  if (!savedLayerStateBeforeNonEditMode) return;
  clearLayerSoloModes();
  setLayer3DVisibleAll(savedLayerStateBeforeNonEditMode.visible);
  setLayer3DLockedAll(savedLayerStateBeforeNonEditMode.locked);
  savedLayerStateBeforeNonEditMode = null;
}

type PanelDirection = 'left' | 'right' | 'top';
type ModePanelConfig = {
  id: string;
  modes: readonly EditMode[];
  enterFrom: PanelDirection;
  exitTo: PanelDirection;
};

const MODE_PANEL_HIDDEN_CLASS = 'creator-mode-panel-hidden';
const MODE_PANEL_CONFIGS: readonly ModePanelConfig[] = [
  { id: 'creator-wardrobe-parts-panel', modes: ['wardrobe'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-canvas-overlays-panel', modes: ['2d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-layers-panel', modes: ['2d', '3d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-tools-panel', modes: ['2d', '3d'], enterFrom: 'top', exitTo: 'top' },
  { id: 'creator-right-panels-group', modes: ['2d', '3d'], enterFrom: 'right', exitTo: 'right' },
  { id: 'creator-3d-preview-slot', modes: ['2d'], enterFrom: 'left', exitTo: 'left' },
];

import type { WardrobeLayerKey, WardrobePartKey } from './creator/wardrobePartsPanel';
import { WARDROBE_PART_KEYS } from './creator/wardrobePartsPanel';
let wardrobeSelectedLayer: WardrobeLayerKey = 'fullOutfit';
let wardrobeCompositeToken = 0;
let creatorCurrentSkinPath: string | null = null;
let wardrobeBaseSkinPath: string | null = null;
let wardrobeBaseSkinData: ImageData | null = null;
let wardrobeLibrariesLoaded = false;
let wardrobeLibrariesPromise: Promise<void> | null = null;
const wardrobeImageCache = new Map<string, Promise<HTMLImageElement>>();
type WardrobeSelectionState = Record<WardrobePartKey, string | null>;
type WardrobeLibraryState = Record<WardrobePartKey, SkinEntry[]>;
const wardrobeSelections: WardrobeSelectionState = {
  hat: null,
  head: null,
  jacket: null,
  body: null,
  arms: null,
  sleeves: null,
  pants: null,
  legs: null,
};
const wardrobeLibraries: WardrobeLibraryState = {
  hat: [],
  head: [],
  jacket: [],
  body: [],
  arms: [],
  sleeves: [],
  pants: [],
  legs: [],
};

function clearAnim(el: HTMLElement): void {
  el.classList.remove(
    'creator-mode-anim-in-left',
    'creator-mode-anim-in-right',
    'creator-mode-anim-in-top',
    'creator-mode-anim-out-left',
    'creator-mode-anim-out-right',
    'creator-mode-anim-out-top'
  );
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  el.classList.toggle(MODE_PANEL_HIDDEN_CLASS, hidden);
}

function hideAllWardrobeLibraryPanels(): void {
  const panels = document.querySelectorAll<HTMLElement>('.creator-wardrobe-library-panel');
  panels.forEach((panel) => {
    clearAnim(panel);
    setHidden(panel, true);
  });
}

function showWardrobeLibraryPanel(layer: WardrobeLayerKey | null): void {
  const targetPanelId = layer ? getWardrobePanelIdForLayer(layer) : null;
  const targetPanel = targetPanelId ? document.getElementById(targetPanelId) as HTMLElement | null : null;
  const currentPanel = document.querySelector<HTMLElement>(
    '.creator-wardrobe-library-panel:not(.creator-mode-panel-hidden)',
  );

  if (!targetPanel) {
    hideAllWardrobeLibraryPanels();
    return;
  }

  if (!currentPanel || currentPanel === targetPanel) {
    clearAnim(targetPanel);
    setHidden(targetPanel, false);
    return;
  }

  clearAnim(currentPanel);
  setHidden(currentPanel, true);
  clearAnim(targetPanel);
  setHidden(targetPanel, false);
}

function setWardrobeSelectedLayer(layer: WardrobeLayerKey): void {
  wardrobeSelectedLayer = layer;
  showWardrobeLibraryPanel(state.editMode === 'wardrobe' ? layer : null);
}

function getAnimClass(prefix: 'in' | 'out', dir: PanelDirection): string {
  return `creator-mode-anim-${prefix}-${dir}`;
}

function clearModeAnimClasses(el: HTMLElement): void {
  el.classList.remove(
    'creator-mode-anim-in-left',
    'creator-mode-anim-in-right',
    'creator-mode-anim-in-top',
    'creator-mode-anim-out-left',
    'creator-mode-anim-out-right',
    'creator-mode-anim-out-top'
  );
}

function setModePanelHidden(el: HTMLElement, hidden: boolean): void {
  el.classList.toggle(MODE_PANEL_HIDDEN_CLASS, hidden);
}

function animateModePanelIn(el: HTMLElement, dir: PanelDirection): void {
  clearModeAnimClasses(el);
  setModePanelHidden(el, false);
  void el.offsetWidth;
  el.classList.add(getAnimClass('in', dir));
}

function animateModePanelOut(el: HTMLElement, dir: PanelDirection): void {
  clearModeAnimClasses(el);
  setModePanelHidden(el, false);
  void el.offsetWidth;
  el.classList.add(getAnimClass('out', dir));
}

function mountPreviewSlotForMode(): void {
  const previewSlot = document.getElementById('creator-3d-preview-slot');
  const lowerLeftPanels = document.getElementById('creator-lower-left-panels');
  const homePanel = document.getElementById('creator-home-panel');
  if (!previewSlot) return;

  // Keep the preview slot anchored in the lower-left stack so mode transitions
  // do not temporarily stretch the lower-right tools group width.
  if (lowerLeftPanels) {
    if (homePanel && homePanel.parentElement === lowerLeftPanels) {
      if (previewSlot.parentElement !== lowerLeftPanels || previewSlot.nextElementSibling !== homePanel) {
        lowerLeftPanels.insertBefore(previewSlot, homePanel);
      }
    } else if (previewSlot.parentElement !== lowerLeftPanels) {
      lowerLeftPanels.appendChild(previewSlot);
    }
  } else {
    // Fallback placement if lower-left is unavailable.
    const rightGroup = document.getElementById('creator-right-panels-group');
    if (rightGroup && previewSlot.parentElement !== rightGroup) rightGroup.appendChild(previewSlot);
  }
}

function applyModePanelsImmediate(mode: EditMode): void {
  modeTransitionToken += 1;
  mountPreviewSlotForMode();
  let needsResizeAfterShow = false;
  for (const cfg of MODE_PANEL_CONFIGS) {
    const el = document.getElementById(cfg.id) as HTMLElement | null;
    if (!el) continue;
    clearModeAnimClasses(el);
    const isVisibleInMode = cfg.modes.includes(mode);
    setModePanelHidden(el, !isVisibleInMode);
    if (isVisibleInMode && (cfg.id === 'creator-3d-preview-slot' || cfg.id === 'creator-right-panels-group')) {
      needsResizeAfterShow = true;
    }
  }
  if (needsResizeAfterShow) {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  modePanelsCurrentMode = mode;
}

function transitionModePanels(targetMode: EditMode): void {
  mountPreviewSlotForMode();
  if (modePanelsCurrentMode == null) {
    applyModePanelsImmediate(targetMode);
    return;
  }
  if (modePanelsCurrentMode === targetMode) {
    applyModePanelsImmediate(targetMode);
    return;
  }

  const fromMode = modePanelsCurrentMode;
  const token = ++modeTransitionToken;
  const hideNow: Array<{ el: HTMLElement; cfg: ModePanelConfig }> = [];
  const showLater: Array<{ el: HTMLElement; cfg: ModePanelConfig }> = [];

  for (const cfg of MODE_PANEL_CONFIGS) {
    const el = document.getElementById(cfg.id) as HTMLElement | null;
    if (!el) continue;
    const inFrom = cfg.modes.includes(fromMode);
    const inTarget = cfg.modes.includes(targetMode);
    if (inFrom && !inTarget) hideNow.push({ el, cfg });
    else if (!inFrom && inTarget) showLater.push({ el, cfg });
    else if (inFrom && inTarget) {
      clearModeAnimClasses(el);
      setModePanelHidden(el, false);
    } else {
      clearModeAnimClasses(el);
      setModePanelHidden(el, true);
    }
  }

  hideNow.forEach(({ el, cfg }) => animateModePanelOut(el, cfg.exitTo));

  const enterDelayMs = hideNow.length > 0 ? MODE_TRANSITION_MS : 0;
  window.setTimeout(() => {
    if (token !== modeTransitionToken) return;
    hideNow.forEach(({ el }) => {
      clearModeAnimClasses(el);
      setModePanelHidden(el, true);
    });
    showLater.forEach(({ el, cfg }) => {
      animateModePanelIn(el, cfg.enterFrom);
    });
    if (showLater.some(({ cfg }) => cfg.id === 'creator-3d-preview-slot' || cfg.id === 'creator-right-panels-group')) {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    modePanelsCurrentMode = targetMode;
  }, enterDelayMs);
}

function bindModePanelTransitions(): void {
  if (modePanelsBound) return;
  modePanelsBound = true;
  subscribe(CREATOR_EVENTS.EDIT_MODE_CHANGE, (e: CustomEvent<{ mode?: EditMode }>) => {
    const nextMode = (e.detail?.mode ?? state.editMode) as EditMode;
    transitionModePanels(nextMode);
  });
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

function captureCanvasImageData(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function cloneImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

function applyProgrammaticCanvasImage(data: ImageData): void {
  const canvas = getSkinCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.putImageData(data, 0, 0);
  creatorCanvasPopulated = true;
  state.skinSwatchColors = extractColorsFromSkin(canvas);
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  updateAllUndoRedoButtons();
  publish(CREATOR_EVENTS.CANVAS_CHANGE);
}

function resetWardrobeSelections(): void {
  wardrobeCompositeToken += 1;
  WARDROBE_PART_KEYS.forEach((part) => {
    wardrobeSelections[part] = null;
  });
}

function captureWardrobeBaseFromCurrentCanvas(path: string | null = creatorCurrentSkinPath): void {
  if (!creatorCanvasPopulated) return;
  const snapshot = captureCanvasImageData(getSkinCanvas());
  if (!snapshot) return;
  wardrobeBaseSkinData = snapshot;
  wardrobeBaseSkinPath = path;
}

function hasActiveWardrobeSelections(): boolean {
  return WARDROBE_PART_KEYS.some((part) => wardrobeSelections[part] != null);
}

function loadWardrobeImage(path: string): Promise<HTMLImageElement> {
  const cached = wardrobeImageCache.get(path);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load wardrobe part: ${path}`));
    img.src = path;
  });
  wardrobeImageCache.set(path, pending);
  return pending;
}

async function resolveWardrobeComposite(): Promise<void> {
  if (!wardrobeBaseSkinData) return;
  const token = ++wardrobeCompositeToken;
  const result = cloneImageData(wardrobeBaseSkinData);
  const destCanvas = document.createElement('canvas');
  destCanvas.width = WORK_SIZE;
  destCanvas.height = WORK_SIZE;
  const destCtx = destCanvas.getContext('2d', { willReadFrequently: true });
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = WORK_SIZE;
  srcCanvas.height = WORK_SIZE;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!destCtx || !srcCtx) return;
  destCtx.putImageData(result, 0, 0);
  srcCtx.imageSmoothingEnabled = false;

  for (const part of WARDROBE_PART_KEYS) {
    const selectedPath = wardrobeSelections[part];
    if (!selectedPath) continue;
    let img: HTMLImageElement;
    try {
      img = await loadWardrobeImage(selectedPath);
    } catch {
      continue;
    }
    if (token !== wardrobeCompositeToken) return;

    srcCtx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
    srcCtx.drawImage(img, 0, 0, WORK_SIZE, WORK_SIZE);
    const bounds = SKIN_LAYER_BOUNDS[part] ?? [];
    bounds.forEach((rect) => {
      const x = rect.x * RESOLUTION_MULTIPLIER;
      const y = rect.y * RESOLUTION_MULTIPLIER;
      const w = rect.w * RESOLUTION_MULTIPLIER;
      const h = rect.h * RESOLUTION_MULTIPLIER;
      const partData = srcCtx.getImageData(x, y, w, h);
      destCtx.putImageData(partData, x, y);
    });
  }

  if (token !== wardrobeCompositeToken) return;
  const composed = destCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
  applyProgrammaticCanvasImage(composed);
}

async function applyWardrobePartSelection(part: WardrobePartKey, path: string | null): Promise<void> {
  if (!wardrobeBaseSkinData) {
    captureWardrobeBaseFromCurrentCanvas(creatorCurrentSkinPath);
  }
  wardrobeSelections[part] = path;
  syncWardrobeLibraryActiveStates();
  await resolveWardrobeComposite();
}

async function selectWardrobeOutfit(path: string): Promise<void> {
  resetWardrobeSelections();
  await loadSkinFromPath(path);
  captureWardrobeBaseFromCurrentCanvas(path);
  syncWardrobeLibraryActiveStates();
}

function renderWardrobeLibraries(): void {
  WARDROBE_PART_PANEL_CONFIGS.forEach((config) => {
    renderWardrobeLibraryPanel({
      selectorId: config.selectorId,
      items: wardrobeLibraries[config.key],
      activePath: wardrobeSelections[config.key],
      includeNone: true,
      noneLabel: config.noneLabel,
      onSelect: (path) => {
        void applyWardrobePartSelection(config.key, path);
      },
    });
  });
  syncWardrobeLibraryActiveStates();
}

function syncWardrobeLibraryActiveStates(): void {
  const activeOutfitPath = wardrobeBaseSkinPath ?? creatorCurrentSkinPath;
  const outfitsContainer = document.getElementById('creator-skin-selector');
  if (outfitsContainer) {
    outfitsContainer.querySelectorAll<HTMLElement>('.creator-skin-preview').forEach((el) => {
      el.classList.toggle('active', el.dataset.path === activeOutfitPath);
    });
  }

  WARDROBE_PART_PANEL_CONFIGS.forEach((config) => {
    const selector = document.getElementById(config.selectorId);
    if (!selector) return;
    selector.querySelectorAll<HTMLElement>('.creator-wardrobe-library-item').forEach((el) => {
      const isNone = el.dataset.none === '1';
      const isActive = isNone
        ? wardrobeSelections[config.key] == null
        : el.dataset.path === wardrobeSelections[config.key];
      el.classList.toggle('active', isActive);
    });
  });
}

async function ensureWardrobeLibrariesLoaded(): Promise<void> {
  if (wardrobeLibrariesLoaded) {
    renderWardrobeLibraries();
    return;
  }
  if (wardrobeLibrariesPromise) {
    await wardrobeLibrariesPromise;
    return;
  }

  wardrobeLibrariesPromise = (async () => {
    buildWardrobeLibraryPanels();
    await Promise.all(
      WARDROBE_PART_PANEL_CONFIGS.map(async (config) => {
        try {
          const res = await fetch(`/wardrobe/parts/${config.key}/index.json`);
          const data = await res.json();
          wardrobeLibraries[config.key] = Array.isArray(data) ? data : [];
        } catch {
          wardrobeLibraries[config.key] = [];
        }
      }),
    );
    wardrobeLibrariesLoaded = true;
    renderWardrobeLibraries();
  })();

  try {
    await wardrobeLibrariesPromise;
  } finally {
    wardrobeLibrariesPromise = null;
  }
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

const FALLBACK_SKINS: SkinEntry[] = [{ path: '/wardrobe/skins/RunningboyRig.png', label: 'Default' }];

export async function loadSkinFromPath(path: string): Promise<void> {
  const canvas = getSkinCanvas();
  const result = await skinIO.loadSkinToCanvas(path, canvas, skinIO.captureCanvasImageData);
  if (!result) return;
  creatorCurrentSkinPath = path;
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

  // Highlight active skin in creator load-skins panel.
  const selector = document.getElementById('creator-skin-selector');
  if (selector) {
    selector.querySelectorAll<HTMLElement>('.creator-skin-preview').forEach((el) => {
      el.classList.toggle('active', el.dataset.path === (wardrobeBaseSkinPath ?? path));
    });
  }
  if (state.editMode === 'wardrobe' && !hasActiveWardrobeSelections()) {
    captureWardrobeBaseFromCurrentCanvas(path);
    syncWardrobeLibraryActiveStates();
  }
}

function setupCreatorSkinGallery(skins: SkinEntry[]): void {
  const container = document.getElementById('creator-skin-selector');
  if (!container) return;
  container.innerHTML = '';
  skins.forEach((skin, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skin-preview creator-skin-preview creator-wardrobe-library-item';
    btn.dataset.path = skin.path;
    btn.dataset.index = String(index);
    btn.setAttribute('aria-label', `Load skin: ${skin.label}`);
    const img = document.createElement('img');
    img.src = skin.preview ?? skin.path;
    img.alt = skin.label;
    img.loading = 'lazy';
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      if (state.editMode === 'wardrobe') {
        void selectWardrobeOutfit(skin.path);
        return;
      }
      void loadSkinFromPath(skin.path);
    });
    container.appendChild(btn);
  });

  // Keyboard navigation within skins grid (arrow keys).
  container.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList.contains('creator-skin-preview')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.creator-skin-preview')
    );
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(target as HTMLButtonElement);
    if (currentIndex === -1) return;

    const cols = 4; // grid width: 4 skins per row
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
      // Spacebar: return focus to wardrobe parts panel, do not change selection.
      const wardrobePanel = document.getElementById('creator-wardrobe-parts-panel');
      if (wardrobePanel) {
        const activeBtn = wardrobePanel.querySelector<HTMLButtonElement>(
          '.creator-wardrobe-parts-btn.active'
        );
        (activeBtn ?? wardrobePanel.querySelector<HTMLButtonElement>('.creator-wardrobe-parts-btn'))
          ?.focus();
        e.preventDefault();
        e.stopPropagation();
      }
    }

    if (nextIndex !== currentIndex) {
      const nextBtn = buttons[nextIndex];
      if (nextBtn) {
        nextBtn.focus();
        nextBtn.click(); // keep current skin in sync with selection
      }
    }
  });
}

/** Report texture position under pointer. Publishes event; subscribers update hover info and layers panel. */
function reportTexturePosition(part: string | null, skinX: number, skinY: number, hoverColorHint: string | null = null): void {
  const layer = part != null ? partToLayer(part) : null;
  const tool = state.activeTool;
  let hoverColor: string | null = hoverColorHint;
  if (tool === 'eyedropper' && skinX >= 0 && skinY >= 0) {
    if (hoverColor != null) {
      // 3D controls may provide a precomputed "through transparency" sample.
      publish(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, {
        part,
        layer,
        skinX,
        skinY,
        tool,
        currentColor: state.currentColor,
        hoverColor,
      });
      return;
    }
    // Hover info must never block drawing interactions; ignore sampling errors.
    try {
      const wx = Math.floor(skinX * RESOLUTION_MULTIPLIER);
      const wy = Math.floor(skinY * RESOLUTION_MULTIPLIER);
      const sample = sampleColorAtWithAlpha(wx, wy);
      if (sample && sample.alpha >= EYEDROPPER_ALPHA_THRESHOLD) hoverColor = sample.hex;
    } catch {
      hoverColor = null;
    }
  }
  publish(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, {
    part,
    layer,
    skinX,
    skinY,
    tool,
    currentColor: state.currentColor,
    hoverColor,
  });
}

/** Update hover info payload for 2D/3D views. Optional hoverColor is used by eyedropper hover in 3D. */
export function updateHoverInfo(part: string | null, skinX: number, skinY: number, hoverColor: string | null = null): void {
  reportTexturePosition(part, skinX, skinY, hoverColor);
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
    getEditMode: () => state.editMode,
    isEditMode3D: () => state.editMode === EDIT_MODE_3D,
    isRulersShown: () => state.showRulers,
    isTemplateShown: () => state.showTemplate,
    setActiveTool,
    setEditMode,
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
  buildWardrobeLibraryPanels();
  buildWardrobePartsPanel({
    getEditMode: () => state.editMode,
    getSelectedLayer: () => wardrobeSelectedLayer,
    setSelectedLayer: (layer) => setWardrobeSelectedLayer(layer),
  });
  buildTexturePositionPanel();
  applyModePanelsImmediate(state.editMode);
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
  if (isCreatorEditMode(state.editMode)) {
    restoreLayerStateForEditMode();
  }
  document.body.dataset.editMode = state.editMode;
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
  mountPreviewSlotForMode();
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
  if (state.editMode === 'wardrobe') {
    captureWardrobeBaseFromCurrentCanvas(creatorCurrentSkinPath);
  }
  showWardrobeLibraryPanel(state.editMode === 'wardrobe' ? wardrobeSelectedLayer : null);
  blockyEditor.buildBlockyGrid();
  blockyEditor.buildRulers();
  blockyEditor.setupBlockyGridEvents(blockyCtx);
  blockyEditor.renderToDisplay(blockyCtx);
  setupCanvasAreaResize();
  bindModePanelTransitions();

  (async () => {
    try {
      const res = await fetch('/wardrobe/skins/index.json');
      const data = await res.json();
      const skins: SkinEntry[] = Array.isArray(data) && data.length > 0 ? data : FALLBACK_SKINS;
      setupCreatorSkinGallery(skins);
      renderWardrobeLibraries();
    } catch {
      setupCreatorSkinGallery(FALLBACK_SKINS);
      renderWardrobeLibraries();
    }
  })();
  void ensureWardrobeLibrariesLoaded();

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
          setEditMode(getEditMode() === EDIT_MODE_3D ? EDIT_MODE_2D : EDIT_MODE_3D);
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

/** Current edit mode: 'wardrobe' | '2d' | '3d'. */
export function getEditMode(): EditMode {
  return state.editMode;
}

function syncCreatorModeUrl(mode: EditMode): void {
  if (document.body.dataset.route !== 'creator') return;
  const nextHash = `#/creator/${mode}`;
  if (location.hash.toLowerCase() === nextHash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
}

/** Whether Edit 3D mode is active (paint on 3D model). */
export function getEditMode3D(): boolean {
  return state.editMode === EDIT_MODE_3D;
}

/** Set edit mode and dispatch EDIT_MODE_CHANGE with { mode }. */
export function setEditMode(mode: EditMode, options: { syncUrl?: boolean } = {}): void {
  const wasEditMode = isCreatorEditMode(state.editMode);
  const willBeEditMode = isCreatorEditMode(mode);
  if (wasEditMode && !willBeEditMode) {
    saveLayerStateAndNormalizeForNonEditMode();
  } else if (!wasEditMode && willBeEditMode) {
    restoreLayerStateForEditMode();
  }
  state.editMode = mode;
  document.body.dataset.editMode = mode;
  publish(CREATOR_EVENTS.EDIT_MODE_CHANGE, { mode: state.editMode });

  if (mode === 'wardrobe') {
    resetWardrobeSelections();
    captureWardrobeBaseFromCurrentCanvas(creatorCurrentSkinPath);
    renderWardrobeLibraries();
    setWardrobeSelectedLayer('fullOutfit');
  } else {
    showWardrobeLibraryPanel(null);
  }
  if (options.syncUrl !== false) {
    syncCreatorModeUrl(mode);
  }
}

/** Save current layer visibility/lock and force all visible+unlocked (used when leaving creator route from 2D/3D). */
export function normalizeLayerStateForNonEditMode(): void {
  if (!isCreatorEditMode(state.editMode)) return;
  saveLayerStateAndNormalizeForNonEditMode();
}

/** Set Edit 3D mode (true = 3d, false = 2d) and dispatch change event. */
export function setEditMode3D(is3D: boolean): void {
  setEditMode(is3D ? EDIT_MODE_3D : EDIT_MODE_2D);
}

/** Remove creator mode-button number shortcuts (called when leaving creator route). */
export function unregisterCreatorShortcuts(): void {
  unregisterEditorModeShortcuts();
  unregisterWardrobeShortcuts();
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
    const previous = state.layer3DVisible[layer];
    state.layer3DVisible[layer] = visible;
    if (previous !== visible) {
      publish(CREATOR_EVENTS.LAYER3D_CHANGE, { layer, property: 'visibility', visible });
    }
  }
}

/** Set visibility for all layers at once (used by solo visibility). */
function setLayer3DVisibleAll(visible: Record<string, boolean>): void {
  let changed = false;
  for (const k of LAYER_KEYS) {
    if (visible[k] !== undefined && state.layer3DVisible[k] !== visible[k]) {
      state.layer3DVisible[k] = visible[k];
      changed = true;
    }
  }
  if (changed) {
    publish(CREATOR_EVENTS.LAYER3D_CHANGE, { property: 'visibility', all: true, visibleMap: { ...state.layer3DVisible } });
  }
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
  const row = el.closest('.creator-layers-panel-row');
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
      // Prevent browser text selection while click-dragging across layer rows.
      e.preventDefault();
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
  const indicator = panel.querySelector('.creator-layers-panel-solo-indicator');
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
