/**
 * Character creator: higher-res working canvas, 64×64 export.
 *
 * Facade that wires wardrobe, modePanels, layerVisibility, canvasCoords,
 * skinGallery, and swatches. Exposes initCreator, setEditMode, loadSkinFromPath,
 * and other public APIs.
 */

// --- Imports: skin & domain ---
import { partToLayer, WORK_SIZE, RESOLUTION_MULTIPLIER, snapWorkingToSkinCellCenter } from './skin';
import type { SkinEntry } from './domain';

// --- Imports: creator modules ---
import {
  getSkinCanvas,
  getLayerAndPartAtCoords,
  getPartDisplayNameAtCoordsRespectingLayerVisibility,
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
import {
  paintBrushStampAt,
  listPaintBrushStampPixels,
  paintBrushWorkingDimensions,
} from './creator/paintBrushStamp';
import * as blockyEditor from './creator/blockyEditor';
import { createEditorToolKeyBindings } from './creator/shortcuts';
import { createModePanelTransitions, MODE_TRANSITION_MS } from './creator/modePanels';
import { createLayerVisibilityApi } from './creator/layerVisibility';
import { createWardrobeApi, WARDROBE_ORIGINAL } from './creator/wardrobe';
import {
  getWardrobeHoverPreviewLayer,
  setWardrobeLayerPanelHoverPreviewLayer,
} from './creator/wardrobeHoverPreview';
import type { WardrobeLayerKey } from './creator/wardrobeLayers';
import { createColorActions, extractColorsFromSkin } from './creator/swatches';
import { createSkinGalleryApi } from './creator/skinGallery';

// --- Imports: events, state, lib, viewer ---
import { createCreatorState } from './state';
import {
  creatorCanvasSlice,
  creatorFocusedCreationSlice,
  creatorModeSlice,
  creatorSwatchPaletteSlice,
  creatorTexturePositionSlice,
  creatorToolsSlice,
} from './state/creatorSlices';
import { EDIT_MODE_2D, EDIT_MODE_3D, type DrawingTool, type EditMode, type PartSide } from './creator/api';
import {
  PAINT_BRUSH_SCHEMA_VERSION,
  PAINT_BRUSH_TOOL_CONFIG,
  type PaintBrushSize,
} from './config/paintBrushTool';
import { rgbToHex } from './lib/color';
import { getCapture3DThumbnail } from './viewer/capture3DThumbnail';
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

const FOCUSED_CREATION_STORAGE_KEY = 'creator:focusedCreation';
const PAINT_BRUSH_SCHEMA_STORAGE_KEY = 'creator:paintBrushSchema';

/** One-time reset so HMR / long-lived tabs pick up new brush semantics and defaults. */
function applyPaintBrushSchemaIfStale(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(PAINT_BRUSH_SCHEMA_STORAGE_KEY) === PAINT_BRUSH_SCHEMA_VERSION) return;
    state.paintBrushSize = { ...PAINT_BRUSH_TOOL_CONFIG.defaultSize };
    localStorage.setItem(PAINT_BRUSH_SCHEMA_STORAGE_KEY, PAINT_BRUSH_SCHEMA_VERSION);
  } catch {
    state.paintBrushSize = { ...PAINT_BRUSH_TOOL_CONFIG.defaultSize };
  }
}

function readFocusedCreationEnabledFromStorage(): boolean {
  try {
    const v = localStorage.getItem(FOCUSED_CREATION_STORAGE_KEY);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    // ignore
  }
  return true;
}

// --- Module state ---
const state = createCreatorState();
applyPaintBrushSchemaIfStale();
state.focusedCreationEnabled = readFocusedCreationEnabledFromStorage();

const modePanelTransitions = createModePanelTransitions();
const layerVisibilityApi = createLayerVisibilityApi(state);
const colorActions = createColorActions(state, SWATCH_MAX);
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
    creatorCanvasSlice.notify();
  },
  onLoadSkin: (path) => loadSkinFromPathFn(path),
  getCapture3DThumbnail,
  getCreatorCanvasPopulated: () => creatorCanvasPopulated,
  getCreatorCurrentSkinPath: () => creatorCurrentSkinPath,
  getEditMode: () => state.editMode,
  updateAllUndoRedoButtons,
  renderToDisplay: () => { if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx); },
  animateModePanelIn: modePanelTransitions.animateModePanelIn,
  animateModePanelOut: modePanelTransitions.animateModePanelOut,
  getFocusedCreationEnabled: () => state.focusedCreationEnabled,
});

const skinGalleryApi = createSkinGalleryApi({
  getSkinCanvas,
  state,
  setCreatorCanvasPopulated: (v) => { creatorCanvasPopulated = v; },
  setCreatorCurrentSkinPath: (path) => { creatorCurrentSkinPath = path; },
  wardrobeApi,
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
export type { WardrobeLayerKey } from './creator/wardrobeLayers';
export {
  getLayerAtCoords,
  getLayerAndPartAtCoords,
  getPartDisplayNameAtCoords,
  getPartDisplayNameAtCoordsRespectingLayerVisibility,
} from './creator/canvasCoords';
export { getBrushCursorStyleFor3D, getPaintBrushCursorStyleFor3D } from './creator/brush';
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
  else if (state.activeTool === 'paintBrush') {
    const { w, h } = paintBrushWorkingDimensions(state.paintBrushSize);
    grid.style.cursor = blockyEditor.getPaintBrushCursorStyle2D(w, h);
  } else grid.style.cursor = blockyEditor.getBrushCursorStyle2D();
}

function performUndo(): void {
  if (!blockyCtx) return;
  undo.performUndo({
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    getSkinCanvas,
    renderToDisplay: () => blockyEditor.renderToDisplay(blockyCtx!),
  });
  creatorCanvasSlice.notify();
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
  creatorCanvasSlice.notify();
}

function reportTexturePosition(part: string | null, skinX: number, skinY: number, hoverColorHint: string | null = null): void {
  const layer = part != null ? partToLayer(part) : null;
  const tool = state.activeTool;
  let hoverColor: string | null = hoverColorHint;
  if (tool === 'eyedropper' && skinX >= 0 && skinY >= 0) {
    if (hoverColor != null) {
      creatorTexturePositionSlice.notify({
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
  creatorTexturePositionSlice.notify({
    part, layer, skinX, skinY, tool,
    currentColor: state.currentColor,
    hoverColor,
  });
}

/** Update hover info and notify texture-position slice; used by 2D/3D editors. */
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
      creatorSwatchPaletteSlice.notify();
    },
    applyColor: applyColorToUI,
    setSwatchColor: setSwatchAt,
  };
  const skinLayersCtx = {
    layerVisibility: state.layer3DVisible,
    isLayer3DVisible: (layer: string) => state.layer3DVisible[layer] === true,
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
    getEditMode: () => state.editMode,
    getFocusedCreationEnabled: () => state.focusedCreationEnabled,
    getLayersPanelFocusedListExpanded: () => state.layersPanelFocusedListExpanded,
    setLayersPanelFocusedListExpanded,
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
  buildCameraControls({
    getFocusedCreationEnabled: () => state.focusedCreationEnabled,
    setFocusedCreationEnabled,
    subscribeFocusedCreationChanged: (cb) =>
      creatorFocusedCreationSlice.subscribe(() => cb()),
  });
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
  const bottomPanels = document.getElementById('creator-bottom-center-panels');
  if (bottomPanels) {
    new ResizeObserver(update).observe(bottomPanels);
  }
  window.addEventListener('resize', update);
  requestAnimationFrame(update);
  creatorModeSlice.subscribe((detail) => {
    if ((detail.mode ?? state.editMode) === EDIT_MODE_2D) {
      requestAnimationFrame(() => requestAnimationFrame(update));
      // Bottom toolbar slides in over MODE_TRANSITION_MS; early fit uses a stale `panelsRect.top`
      // and scales the canvas too large until something refits (e.g. mousemove → renderRulersAndGrid).
      window.setTimeout(update, MODE_TRANSITION_MS + 50);
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
    getPartDisplayNameAtCoords: (wx, wy) =>
      getPartDisplayNameAtCoordsRespectingLayerVisibility(wx, wy, state.layer3DVisible, state.layer3DPartVisible),
    applyColorToUI: (hex: string) => applyColorToUI(hex),
    sampleColorAtWithAlpha,
    eyedropperAlphaThreshold: EYEDROPPER_ALPHA_THRESHOLD,
    pushUndoStroke: (pixels, isEraser, newColor, afterPixels) => {
      state.redoStack = [];
      state.undoStack.push({
        type: 'stroke',
        pixels,
        isEraser,
        newColor,
        ...(afterPixels && afterPixels.length > 0 ? { afterPixels } : {}),
      });
      if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    },
    pushUndoFill: (pixels, fillColor) => {
      state.redoStack = [];
      state.undoStack.push({ type: 'fill', pixels, fillColor });
      if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    },
    onCanvasChange: () => creatorCanvasSlice.notify(),
    updateUndoRedoButtons: updateAllUndoRedoButtons,
    undoLimit: UNDO_LIMIT,
    getFocusedCreationEnabled: () => state.focusedCreationEnabled,
    clearSkinHoverPreview,
    updateSkinHoverPreview,
  };
  buildCreatorPanels();
  if (state.editMode === 'wardrobe') {
    wardrobeApi.captureWardrobeBaseFromCurrentCanvas(creatorCurrentSkinPath);
  }
  wardrobeApi.showWardrobeLibraryPanel(state.editMode === 'wardrobe' ? wardrobeApi.getWardrobeSelectedLayer() : null);
  blockyEditor.rebuildBlockyGrid(blockyCtx);
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
export function getWardrobeSelectedLayer(): WardrobeLayerKey {
  return wardrobeApi.getWardrobeSelectedLayer();
}

export function flushDeferredWardrobeLibraryPanelsAfterCamera(): void {
  wardrobeApi.flushDeferredWardrobeLibraryPanelsAfterCamera();
}

export { getWardrobeHoverPreviewLayer };

export function applyFocusedSoloForWardrobeLayer(layer: WardrobeLayerKey): void {
  layerVisibilityApi.applyFocusedSoloForWardrobeLayer(layer);
}

export function getFocusedCreationEnabled(): boolean {
  return state.focusedCreationEnabled;
}

export function setFocusedCreationEnabled(enabled: boolean): void {
  if (state.focusedCreationEnabled === enabled) return;
  state.focusedCreationEnabled = enabled;
  try {
    localStorage.setItem(FOCUSED_CREATION_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
  creatorFocusedCreationSlice.notify({ enabled });
}

export function getLayersPanelFocusedListExpanded(): boolean {
  return state.layersPanelFocusedListExpanded;
}

export function setLayersPanelFocusedListExpanded(expanded: boolean): void {
  state.layersPanelFocusedListExpanded = expanded;
  creatorFocusedCreationSlice.notify({ enabled: state.focusedCreationEnabled });
}

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
export function setEditMode(
  mode: EditMode,
  options: { syncUrl?: boolean; fromUserModeNavigation?: boolean } = {}
): void {
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
  if (previousMode !== mode && (previousMode === EDIT_MODE_2D || previousMode === EDIT_MODE_3D)) {
    clearSkinHoverPreview();
  }
  if (mode !== 'wardrobe') {
    setWardrobeLayerPanelHoverPreviewLayer(null);
  }
  creatorModeSlice.notify({
    mode: state.editMode,
    previousMode,
    fromUserModeNavigation: options.fromUserModeNavigation === true,
  });

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
  setEditMode(is3D ? EDIT_MODE_3D : EDIT_MODE_2D, { fromUserModeNavigation: true });
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
  /** Paint brush is not exposed in the toolbar; reject selection (API / stale state). */
  if (tool === 'paintBrush') {
    tool = 'pencil';
  }
  state.activeTool = tool;
  creatorToolsSlice.notify();
}

export function getBrushSize(): number {
  return BRUSH_SIZE;
}

export function getCreatorWorkSize(): number {
  return WORK_SIZE;
}

/** Backs up texels while showing a temporary paint preview on the shared skin canvas (2D or 3D). */
let skinHoverPreviewBackup: { x: number; y: number; r: number; g: number; b: number; a: number }[] = [];

/** Restores skin canvas pixels after hover preview; no-op if nothing backed up. */
export function clearSkinHoverPreview(): void {
  if (skinHoverPreviewBackup.length === 0) return;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    skinHoverPreviewBackup = [];
    return;
  }
  for (const p of skinHoverPreviewBackup) {
    const img = new ImageData(1, 1);
    img.data[0] = p.r;
    img.data[1] = p.g;
    img.data[2] = p.b;
    img.data[3] = p.a;
    ctx.putImageData(img, p.x, p.y);
  }
  skinHoverPreviewBackup = [];
  creatorCanvasSlice.notify();
}

/**
 * Temporary preview of pencil, eraser, or paint brush on the skin canvas.
 * `canPaintAt` must match the active editor (2D layer mask vs 3D visibility).
 */
export function updateSkinHoverPreview(
  workingX: number,
  workingY: number,
  canPaintAt: (wx: number, wy: number) => boolean
): void {
  clearSkinHoverPreview();
  const tool = state.activeTool;
  if (tool !== 'pencil' && tool !== 'eraser' && tool !== 'paintBrush') return;
  if (tool !== 'paintBrush' && !canPaintAt(workingX, workingY)) return;

  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  if (tool === 'paintBrush') {
    const { x: cx, y: cy } = snapWorkingToSkinCellCenter(workingX, workingY);
    if (!canPaintAt(cx, cy)) return;
    const coords = listPaintBrushStampPixels(cx, cy, state.paintBrushSize, false);
    const backup: typeof skinHoverPreviewBackup = [];
    for (const { px, py } of coords) {
      if (!canPaintAt(px, py)) continue;
      const d = ctx.getImageData(px, py, 1, 1).data;
      backup.push({ x: px, y: py, r: d[0], g: d[1], b: d[2], a: d[3] });
    }
    if (backup.length === 0) return;
    skinHoverPreviewBackup = backup;
    paintBrushStampAt(
      ctx,
      cx,
      cy,
      state.paintBrushSize,
      state.paintBrushSoftness,
      state.currentColor,
      canPaintAt,
      null,
      false
    );
    creatorCanvasSlice.notify();
    return;
  }

  const baseX = Math.floor(workingX / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
  const baseY = Math.floor(workingY / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;

  const size = RESOLUTION_MULTIPLIER;
  const backup: typeof skinHoverPreviewBackup = [];

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = baseX + dx;
      const py = baseY + dy;
      if (px < 0 || px >= WORK_SIZE || py < 0 || py >= WORK_SIZE) continue;
      if (!canPaintAt(px, py)) continue;
      const d = ctx.getImageData(px, py, 1, 1).data;
      backup.push({ x: px, y: py, r: d[0], g: d[1], b: d[2], a: d[3] });
    }
  }
  if (backup.length === 0) return;

  skinHoverPreviewBackup = backup;
  const isEraser = tool === 'eraser';
  for (const p of backup) {
    if (isEraser) {
      ctx.clearRect(p.x, p.y, 1, 1);
    } else {
      ctx.fillStyle = state.currentColor;
      ctx.fillRect(p.x, p.y, 1, 1);
    }
  }
  creatorCanvasSlice.notify();
}

/** Creator.3D: hover preview using 3D layer visibility rules. */
export function update3DSkinHoverPreview(workingX: number, workingY: number): void {
  updateSkinHoverPreview(workingX, workingY, (wx, wy) => isInPaintable3DLayer(wx, wy));
}

export function getPaintBrushSize(): PaintBrushSize {
  return state.paintBrushSize;
}

/** Working-texel stamp size for cursors; `paintBrushSize` is in skin pixels (×2 → working). */
export function getPaintBrushWorkingDimensions(): { w: number; h: number } {
  return paintBrushWorkingDimensions(state.paintBrushSize);
}

// --- Public API: 3D painting ---
export function paintStartFrom3D(workingX: number, workingY: number): boolean {
  clearSkinHoverPreview();
  if (state.activeTool === 'navigate' || state.activeTool === 'eyedropper') return false;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const canPaintAt = (x: number, y: number) => isInPaintable3DLayer(x, y);
  const getCurrentColor = () => state.currentColor;
  if (state.activeTool === 'fill') {
    if (!isInPaintable3DLayer(workingX, workingY)) return false;
    const changed = brush.floodFill(ctx, workingX, workingY, canPaintAt, getCurrentColor);
    if (changed.length > 0) {
      state.redoStack = [];
      state.undoStack.push({ type: 'fill', pixels: changed, fillColor: state.currentColor });
      if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
      creatorCanvasSlice.notify();
    }
    if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
    return changed.length > 0;
  }

  const wx =
    state.activeTool === 'paintBrush'
      ? snapWorkingToSkinCellCenter(workingX, workingY).x
      : workingX;
  const wy =
    state.activeTool === 'paintBrush'
      ? snapWorkingToSkinCellCenter(workingX, workingY).y
      : workingY;
  if (!isInPaintable3DLayer(wx, wy)) return false;

  state.isDrawing = true;
  state.lastSkinX = wx;
  state.lastSkinY = wy;

  if (state.activeTool === 'paintBrush') {
    state.currentStroke = { pixels: [], isEraser: false, newColor: state.currentColor, recorded: new Set<string>() };
    paintBrushStampAt(
      ctx,
      wx,
      wy,
      state.paintBrushSize,
      state.paintBrushSoftness,
      state.currentColor,
      canPaintAt,
      state.currentStroke,
      false
    );
  } else {
    const baseX = Math.floor(workingX / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
    const baseY = Math.floor(workingY / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
    const isEraser = state.activeTool === 'eraser';
    state.currentStroke = { pixels: [], isEraser, newColor: state.currentColor, recorded: new Set<string>() };
    brush.brushAt(ctx, baseX, baseY, isEraser, canPaintAt, getCurrentColor, state.currentStroke, RESOLUTION_MULTIPLIER, true);
  }
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  creatorCanvasSlice.notify();
  return true;
}

export function paintMoveFrom3D(workingX: number, workingY: number): void {
  if (!state.currentStroke || !state.isDrawing) return;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const canPaintAt = (x: number, y: number) => isInPaintable3DLayer(x, y);
  const getCurrentColor = () => state.currentColor;
  if (state.activeTool === 'paintBrush') {
    const { x: wx, y: wy } = snapWorkingToSkinCellCenter(workingX, workingY);
    if (!isInPaintable3DLayer(wx, wy)) return;
    brush.drawLineWithStamp(state.lastSkinX, state.lastSkinY, wx, wy, false, (bx, by) => {
      const s = snapWorkingToSkinCellCenter(bx, by);
      paintBrushStampAt(
        ctx,
        s.x,
        s.y,
        state.paintBrushSize,
        state.paintBrushSoftness,
        state.currentColor,
        canPaintAt,
        state.currentStroke,
        false
      );
    });
    state.lastSkinX = wx;
    state.lastSkinY = wy;
  } else {
    if (!isInPaintable3DLayer(workingX, workingY)) return;
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
  }
  if (blockyCtx) blockyEditor.renderToDisplay(blockyCtx);
  creatorCanvasSlice.notify();
}

export function paintEndFrom3D(): void {
  if (state.currentStroke && state.currentStroke.pixels.length > 0) {
    const skin = getSkinCanvas();
    const ctx = skin.getContext('2d', { willReadFrequently: true });
    const afterPixels =
      state.activeTool === 'paintBrush' && ctx
        ? undo.buildAfterPixelsForStroke(ctx, state.currentStroke.pixels)
        : undefined;
    state.redoStack = [];
    state.undoStack.push({
      type: 'stroke',
      pixels: state.currentStroke.pixels,
      isEraser: state.currentStroke.isEraser,
      newColor: state.currentStroke.newColor,
      ...(afterPixels && afterPixels.length > 0 ? { afterPixels } : {}),
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
