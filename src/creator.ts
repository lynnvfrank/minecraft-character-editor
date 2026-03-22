/**
 * Character creator: higher-res working canvas, 64×64 export.
 *
 * Facade that wires wardrobe, modePanels, layerVisibility, canvasCoords,
 * skinGallery, and swatches. Exposes initCreator, setEditMode, loadSkinFromPath,
 * and other public APIs.
 */

// --- Imports: skin & domain ---
import { partToLayer, WORK_SIZE, RESOLUTION_MULTIPLIER } from './skin';
import type { SkinEntry } from './domain';

// --- Imports: creator modules ---
import {
  getSkinCanvas,
  getLayerAndPartAtCoords,
  getPartDisplayNameAtCoords,
  captureCanvasImageData,
} from './creator/canvasCoords';
import {
  buildColorToolbar,
  buildColorPickerPanel,
  buildSwatchesPanel,
  buildSkinLayersPanel,
  buildEditorToolsPanel,
  buildTexturePositionPanel,
  unregisterEditorToolShortcuts,
  buildWardrobePartsPanel,
  buildWardrobeLibraryPanels,
  unregisterWardrobeShortcuts,
} from './creator/index';
import { buildSaveDownloadPanel } from './creator/saveDownloadPanel';
import * as skinIO from './creator/skinIO';
import * as undo from './creator/undo';
import * as brush from './creator/brush';
import * as blockyEditor from './creator/blockyEditor';
import { createEditorToolKeyBindings } from './creator/shortcuts';
import { createModePanelTransitions } from './creator/modePanels';
import { createLayerVisibilityApi } from './creator/layerVisibility';
import { createWardrobeApi, WARDROBE_ORIGINAL } from './creator/wardrobe';
import { createColorActions, extractColorsFromSkin } from './creator/swatches';
import { createSkinGalleryApi } from './creator/skinGallery';

// --- Imports: events, state, lib, viewer ---
import { subscribe, publish, CREATOR_EVENTS } from './events/appEvents';
import { createCreatorState } from './state';
import { EDIT_MODE_2D, EDIT_MODE_3D, type DrawingTool, type EditMode, type PartSide } from './creator/api';
import { rgbToHex } from './lib/color';
import { getCapture3DThumbnail, getCapture3DPartThumbnail } from './viewer/capture3DThumbnail';
import { buildCameraControls } from './viewer/CameraControls';

// --- Constants ---
const UNDO_LIMIT = 50;
const SWATCH_MAX = 25;
const BRUSH_SIZE = 1;
/** Alpha threshold for eyedropper to treat a pixel as opaque (2/255). */
export const EYEDROPPER_ALPHA_THRESHOLD = 2 / 255;

const FALLBACK_SKINS: SkinEntry[] = [{ path: '/wardrobe/skins/RunningboyRig.png', label: 'Default' }];

/** Groups for layers panel display; separator shown after each group. */
const LAYER_GROUPS: readonly (readonly string[])[] = [
  ['hat', 'head'],
  ['jacket', 'body'],
  ['sleeves', 'arms'],
  ['pants', 'legs'],
];

// --- Module state ---
const state = createCreatorState();

const modePanelTransitions = createModePanelTransitions();
const layerVisibilityApi = createLayerVisibilityApi(state, publish);
const colorActions = createColorActions(state, publish, SWATCH_MAX);
const { addToSwatch, applyColorToUI, setSwatchAt } = colorActions;

let blockyCtx: blockyEditor.BlockyEditorContext | null = null;
let creatorCanvasPopulated = false;
let creatorCurrentSkinPath: string | null = null;

let loadSkinFromPathFn: (path: string) => Promise<void> = async () => {};

const wardrobeApi = createWardrobeApi({
  getSkinCanvas,
  captureCanvasImageData,
  applyProgrammaticCanvasImage: (data: ImageData) => {
    const canvas = getSkinCanvas();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.putImageData(data, 0, 0);
    creatorCanvasPopulated = true;
    state.skinSwatchColors = extractColorsFromSkin(canvas, SWATCH_MAX);
    if (!state.userHasSelectedColor && state.skinSwatchColors.length > 0) {
      applyColorToUI(state.skinSwatchColors[0]!, false, false);
    }
    if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
    updateAllUndoRedoButtons();
    publish(CREATOR_EVENTS.CANVAS_CHANGE);
  },
  onLoadSkin: (path) => loadSkinFromPathFn(path),
  getCapture3DThumbnail,
  getCapture3DPartThumbnail,
  getCreatorCanvasPopulated: () => creatorCanvasPopulated,
  getCreatorCurrentSkinPath: () => creatorCurrentSkinPath,
  getEditMode: () => state.editMode,
  updateAllUndoRedoButtons,
  renderToDisplay: () => { if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx); },
  animateModePanelIn: modePanelTransitions.animateModePanelIn,
  animateModePanelOut: modePanelTransitions.animateModePanelOut,
});

const skinGalleryApi = createSkinGalleryApi({
  getSkinCanvas,
  state,
  setCreatorCanvasPopulated: (v) => { creatorCanvasPopulated = v; },
  setCreatorCurrentSkinPath: (path) => { creatorCurrentSkinPath = path; },
  wardrobeApi,
  publish,
  applyColorToUI,
  updateAllUndoRedoButtons,
  renderToDisplay: () => { if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx); },
  exportTo64x64DataURL: () => skinIO.exportTo64x64DataURL(getSkinCanvas()),
  getCapture3DThumbnail,
  loadSkinToCanvas: skinIO.loadSkinToCanvas,
  captureCanvasForUndo: skinIO.captureCanvasImageData,
  pushUndoLoad: (beforeData, afterData) => {
    state.redoStack = [];
    state.undoStack.push({ type: 'load', beforeData, afterData });
    if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  },
  swatchMax: SWATCH_MAX,
  getWardrobeBaseSkinPath: wardrobeApi.getWardrobeBaseSkinPath,
});

loadSkinFromPathFn = skinGalleryApi.loadSkinFromPath;

// --- Re-exports ---
export { WARDROBE_ORIGINAL };
export { getLayerAtCoords, getLayerAndPartAtCoords, getPartDisplayNameAtCoords } from './creator/canvasCoords';
export { getBrushCursorStyleFor3D } from './creator/brush';
export { uvToWorkingCoords } from './skin';

// --- Private helpers ---
function isCreatorEditMode(mode: EditMode): boolean {
  return mode === EDIT_MODE_2D || mode === EDIT_MODE_3D;
}

function getOverlayCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-overlay-canvas') as HTMLCanvasElement | null;
}

export function getCreatorCanvasPopulated(): boolean {
  return creatorCanvasPopulated;
}

/** 3D mode: can we paint on this layer/part? (visible and not locked) */
function canPaintOn3DLayer(info: { layer: string; side?: PartSide } | null): boolean {
  if (!info) return false;
  const { layer, side } = info;
  if (!state.layer3DVisible[layer]) return false;
  if (state.layer3DLocked[layer]) return false;
  if (side !== undefined) {
    const partVisible = state.layer3DPartVisible[layer];
    const sideVisible = side === 'R' ? (partVisible?.R !== false) : (partVisible?.L !== false);
    if (!sideVisible) return false;
  }
  return true;
}

function isInPaintable3DLayer(workingX: number, workingY: number): boolean {
  return canPaintOn3DLayer(getLayerAndPartAtCoords(workingX, workingY));
}

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

function reportTexturePosition(part: string | null, skinX: number, skinY: number, hoverColorHint: string | null = null): void {
  const layer = part != null ? partToLayer(part) : null;
  const tool = state.activeTool;
  let hoverColor: string | null = hoverColorHint;
  if (tool === 'eyedropper' && skinX >= 0 && skinY >= 0) {
    if (hoverColor != null) {
      publish(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, {
        part, layer, skinX, skinY, tool,
        currentColor: state.currentColor,
        hoverColor,
      });
      return;
    }
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
    part, layer, skinX, skinY, tool,
    currentColor: state.currentColor,
    hoverColor,
  });
}

/** Update hover info and publish texture position; used by 2D/3D editors. */
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
    layerPartVisible: state.layer3DPartVisible,
    layerLocked: state.layer3DLocked,
    isLayersPanelCollapsed: () => state.layersPanel3DCollapsed,
    setLayersPanelCollapsed: (collapsed: boolean) => { state.layersPanel3DCollapsed = collapsed; },
    setLayerVisible: layerVisibilityApi.setLayer3DVisible,
    setLayerPartVisible: layerVisibilityApi.setLayerPartVisible,
    getPartVisible: layerVisibilityApi.getPartVisible,
    setLayerLocked: layerVisibilityApi.setLayer3DLocked,
    onVisibilitySoloClick: layerVisibilityApi.onVisibilitySoloClick,
    onLockSoloClick: layerVisibilityApi.onLockSoloClick,
    syncVisibilityCheckboxes: layerVisibilityApi.syncVisibilityCheckboxes,
    syncLockCheckboxes: layerVisibilityApi.syncLockCheckboxes,
    clearSoloIndicator: layerVisibilityApi.clearSoloIndicator,
    setupDragToToggle: layerVisibilityApi.setupDragToToggle,
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
    getSelectedLayer: () => wardrobeApi.getWardrobeSelectedLayer(),
    setSelectedLayer: (layer) => wardrobeApi.setWardrobeSelectedLayer(layer),
  });
  buildSaveDownloadPanel({
    onSave: skinGalleryApi.saveCurrentSkinToOutfits,
    onDownload: skinGalleryApi.downloadCurrentSkin,
  });
  buildTexturePositionPanel();
  buildCameraControls();
  modePanelTransitions.applyModePanelsImmediate(state.editMode);
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
  subscribe(CREATOR_EVENTS.EDIT_MODE_CHANGE, (e: CustomEvent<{ mode?: EditMode }>) => {
    if ((e.detail?.mode ?? state.editMode) === EDIT_MODE_2D) {
      requestAnimationFrame(() => requestAnimationFrame(update));
    }
  });
}

// --- Public API: initialization ---

/** Initialize the creator: DOM, panels, blocky grid, keyboard shortcuts. */
export function initCreator(): void {
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  if (!creatorCanvasPopulated) {
    ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  }
  if (isCreatorEditMode(state.editMode)) {
    layerVisibilityApi.restoreLayerStateForEditMode();
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
  modePanelTransitions.mountPreviewSlotForMode();
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
    wardrobeApi.captureWardrobeBaseFromCurrentCanvas(creatorCurrentSkinPath);
  }
  wardrobeApi.showWardrobeLibraryPanel(state.editMode === 'wardrobe' ? wardrobeApi.getWardrobeSelectedLayer() : null);
  blockyEditor.buildBlockyGrid();
  blockyEditor.buildRulers();
  blockyEditor.setupBlockyGridEvents(blockyCtx);
  blockyEditor.renderToDisplay(blockyCtx);
  setupCanvasAreaResize();
  modePanelTransitions.bindModePanelTransitions(() => state.editMode);

  (async () => {
    try {
      const res = await fetch('/wardrobe/skins/index.json');
      const data = await res.json();
      const skins: SkinEntry[] = Array.isArray(data) && data.length > 0 ? data : FALLBACK_SKINS;
      skinGalleryApi.setupCreatorSkinGallery(skins);
      wardrobeApi.renderWardrobeLibraries();
    } catch {
      skinGalleryApi.setupCreatorSkinGallery(FALLBACK_SKINS);
      wardrobeApi.renderWardrobeLibraries();
    }
  })();
  void wardrobeApi.ensureWardrobeLibrariesLoaded();

  const downloadBtn = document.getElementById('creator-download-btn');
  downloadBtn?.addEventListener('click', () => skinGalleryApi.downloadCurrentSkin());

  const { keyBindings, ctrlKeyBindings } = createEditorToolKeyBindings({
    getEditMode: () => state.editMode,
    setEditMode,
    setActiveTool,
    performUndo,
    performRedo,
    addToSwatch,
    getCurrentColor: () => state.currentColor,
    updateAllUndoRedoButtons,
  });

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.route !== 'creator') return;
    const target = e.target as HTMLElement;
    const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (inInput) return;

    if (e.ctrlKey || e.metaKey) {
      const ctrlHandler = ctrlKeyBindings[e.key];
      if (ctrlHandler) {
        ctrlHandler(e);
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const handler = keyBindings[e.key];
      if (handler) handler(e);
    }
  });
}

/** Load a skin from a path (e.g. /wardrobe/skins/...). */
export async function loadSkinFromPath(path: string): Promise<void> {
  return skinGalleryApi.loadSkinFromPath(path);
}

export function getCreatorSkinCanvas(): HTMLCanvasElement {
  return getSkinCanvas();
}

// --- Public API: mode & routing ---
export function getEditMode(): EditMode {
  return state.editMode;
}

function syncCreatorModeUrl(mode: EditMode): void {
  if (document.body.dataset.route !== 'creator') return;
  const nextHash = `#/creator/${mode}`;
  if (location.hash.toLowerCase() === nextHash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
}

export function getEditMode3D(): boolean {
  return state.editMode === EDIT_MODE_3D;
}

/** Set edit mode (wardrobe, 2d, 3d). Optionally sync URL hash. */
export function setEditMode(mode: EditMode, options: { syncUrl?: boolean } = {}): void {
  const previousMode = state.editMode;
  const wasEditMode = isCreatorEditMode(previousMode);
  const willBeEditMode = isCreatorEditMode(mode);
  if (wasEditMode && !willBeEditMode) {
    layerVisibilityApi.saveLayerStateAndNormalizeForNonEditMode();
  } else if (!wasEditMode && willBeEditMode) {
    layerVisibilityApi.restoreLayerStateForEditMode();
  }
  state.editMode = mode;
  document.body.dataset.editMode = mode;
  publish(CREATOR_EVENTS.EDIT_MODE_CHANGE, { mode: state.editMode, previousMode });

  if (mode === 'wardrobe') {
    wardrobeApi.resetWardrobeSelections();
    wardrobeApi.captureWardrobeBaseFromCurrentCanvas(creatorCurrentSkinPath);
    void wardrobeApi.resolveWardrobeComposite();
    wardrobeApi.renderWardrobeLibraries();
    wardrobeApi.showWardrobeLibraryPanel(wardrobeApi.getWardrobeSelectedLayer());
  } else {
    wardrobeApi.showWardrobeLibraryPanel(null);
  }
  if (options.syncUrl !== false) {
    syncCreatorModeUrl(mode);
  }
}

export function normalizeLayerStateForNonEditMode(): void {
  if (!isCreatorEditMode(state.editMode)) return;
  layerVisibilityApi.saveLayerStateAndNormalizeForNonEditMode();
}

export function setEditMode3D(is3D: boolean): void {
  setEditMode(is3D ? EDIT_MODE_3D : EDIT_MODE_2D);
}

export function unregisterCreatorShortcuts(): void {
  unregisterEditorToolShortcuts();
  unregisterWardrobeShortcuts();
}

// --- Public API: layer visibility ---
export function getLayer3DVisible(): Record<string, boolean> {
  return { ...state.layer3DVisible };
}

export function getLayer3DPartVisible(): Record<string, { L?: boolean; R?: boolean }> {
  return JSON.parse(JSON.stringify(state.layer3DPartVisible));
}

export function getPartVisible(layer: string, side: PartSide): boolean {
  return layerVisibilityApi.getPartVisible(layer, side);
}

export function getLayer3DLocked(): Record<string, boolean> {
  return { ...state.layer3DLocked };
}

export function setLayer3DVisible(layer: string, visible: boolean): void {
  layerVisibilityApi.setLayer3DVisible(layer, visible);
}

export function setLayerPartVisible(layer: string, side: PartSide, visible: boolean): void {
  layerVisibilityApi.setLayerPartVisible(layer, side, visible);
}

export function setLayer3DLocked(layer: string, locked: boolean): void {
  layerVisibilityApi.setLayer3DLocked(layer, locked);
}

// --- Public API: tools ---
export function getActiveTool(): DrawingTool {
  return state.activeTool;
}

export function setActiveTool(tool: DrawingTool): void {
  state.activeTool = tool;
  publish(CREATOR_EVENTS.TOOLS_CHANGE);
}

export function getBrushSize(): number {
  return BRUSH_SIZE;
}

export function getCreatorWorkSize(): number {
  return WORK_SIZE;
}

// --- Public API: 3D painting ---
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

// --- Public API: color sampling ---
/** Sample color and alpha at working-space coords; returns null if out of bounds. */
export function sampleColorAtWithAlpha(workingX: number, workingY: number): { hex: string; alpha: number } | null {
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (workingX < 0 || workingX >= WORK_SIZE || workingY < 0 || workingY >= WORK_SIZE) return null;
  const d = ctx.getImageData(workingX, workingY, 1, 1).data;
  return { hex: rgbToHex(d[0], d[1], d[2]), alpha: d[3] / 255 };
}

export function sampleColorAt(workingX: number, workingY: number): string | null {
  const result = sampleColorAtWithAlpha(workingX, workingY);
  return result ? result.hex : null;
}

export function applySampledColor(hex: string): void {
  applyColorToUI(hex);
}

// --- Public API: export ---
/** Export current skin as 64×64 data URL. */
export function exportTo64x64DataURL(): string {
  return skinIO.exportTo64x64DataURL(getSkinCanvas());
}
