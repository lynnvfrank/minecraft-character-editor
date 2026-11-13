/**
 * Blocky 2D editor: div-based pixel grid, rulers, template overlay.
 * Built because canvas pixelation was unreliable; divs give crisp 1:1 pixels.
 */

import {
  SKIN_SIZE,
  SKIN_LAYER_BOUNDS,
  SKIN_DEAD_ZONES,
  LAYER_KEYS,
  isLayerKey,
  isLayerWithParts,
  RESOLUTION_MULTIPLIER,
  snapWorkingToSkinCellCenter,
  type LayerKey,
} from '../skin';
import { rgbToHex } from '../lib/color';
import * as brush from './brush';
import { paintBrushStampAt } from './paintBrushStamp';
import { buildAfterPixelsForStroke } from './undo';
import type { CreatorState } from '../state/creatorState';
import {
  creator2dPaintSlice,
  creatorFocusedCreationSlice,
  creatorLayerSlice,
  creatorLockFeedbackSlice,
  creatorModeSlice,
} from '../state/creatorSlices';

const ZOOM = 4;
const BLOCKY_GRID_SIZE = 512;
const TEMPLATE_LABEL_FONT = '600 14px Inter, system-ui, -apple-system, sans-serif';

const TEMPLATE_LAYER_STYLES: Record<string, { stroke: string }> = {
  head: { stroke: 'rgba(56, 189, 248, 0.95)' },
  hat: { stroke: 'rgba(192, 132, 252, 0.95)' },
  body: { stroke: 'rgba(34, 197, 94, 0.95)' },
  jacket: { stroke: 'rgba(249, 115, 22, 0.95)' },
  arms: { stroke: 'rgba(99, 102, 241, 0.95)' },
  sleeves: { stroke: 'rgba(236, 72, 153, 0.95)' },
  legs: { stroke: 'rgba(16, 185, 129, 0.95)' },
  pants: { stroke: 'rgba(234, 179, 8, 0.95)' },
};

const DEFAULT_TEMPLATE_STYLE = {
  stroke: 'rgba(100, 200, 255, 0.9)',
};

const HIDDEN_TEMPLATE_STYLE = {
  stroke: 'rgba(148, 163, 184, 0.95)',
};

const TEMPLATE_LABEL_TEXT_VISIBLE = 'rgba(241, 245, 249, 0.96)';
const TEMPLATE_LABEL_TEXT_HIDDEN = 'rgba(226, 232, 240, 0.82)';

let activeBlockyContext: BlockyEditorContext | null = null;
let unbindBlockyLayerSubs: (() => void) | null = null;
/** Cell element showing pencil/eraser hover tint; paint brush uses skin canvas preview only. */
let blockySkinHoverCell: HTMLElement | null = null;
let overlayPointerPx: { x: number; y: number } | null = null;
const flippedTemplateLabelKeys = new Set<string>();
const hoveredTemplateLabelKeys = new Set<string>();
const templateLabelTransitions = new Map<string, {
  fromFlipped: boolean;
  toFlipped: boolean;
  startedAtMs: number;
  durationMs: number;
}>();
const TEMPLATE_LABEL_FADE_MS = 280;
let templateAnimationFrameHandle: number | null = null;

function pointInRect(
  point: { x: number; y: number } | null,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  if (!point) return false;
  return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function getTemplateLabelText(layerKey: string, bounds: { x: number; y: number; w: number; h: number }): string {
  if (layerKey === 'arms') {
    if (bounds.x === 40 && bounds.y === 16) return 'Right Arm';
    if (bounds.x === 32 && bounds.y === 48) return 'Left Arm';
  }
  if (layerKey === 'sleeves') {
    if (bounds.x === 40 && bounds.y === 32) return 'Right Sleeve';
    if (bounds.x === 48 && bounds.y === 48) return 'Left Sleeve';
  }
  if (layerKey === 'pants') {
    if (bounds.x === 0 && bounds.y === 32) return 'Right Pants';
    if (bounds.x === 0 && bounds.y === 48) return 'Left Pants';
  }
  if (layerKey === 'legs') {
    if (bounds.x === 0 && bounds.y === 16) return 'Right Leg';
    if (bounds.x === 16 && bounds.y === 48) return 'Left Leg';
  }
  return layerKey.charAt(0).toUpperCase() + layerKey.slice(1);
}

function scheduleTemplateAnimationFrame(): void {
  if (templateAnimationFrameHandle != null) return;
  templateAnimationFrameHandle = window.requestAnimationFrame(() => {
    templateAnimationFrameHandle = null;
    if (!activeBlockyContext) return;
    renderRulersAndGrid(activeBlockyContext);
  });
}

function startLabelFlipTransition(labelKey: string, currentFlipped: boolean): void {
  const nextFlipped = !currentFlipped;
  templateLabelTransitions.set(labelKey, {
    fromFlipped: currentFlipped,
    toFlipped: nextFlipped,
    startedAtMs: performance.now(),
    durationMs: TEMPLATE_LABEL_FADE_MS,
  });
  if (nextFlipped) flippedTemplateLabelKeys.add(labelKey);
  else flippedTemplateLabelKeys.delete(labelKey);
  scheduleTemplateAnimationFrame();
}

export interface BlockyEditorContext {
  state: CreatorState;
  getSkinCanvas: () => HTMLCanvasElement;
  getOverlayCanvas: () => HTMLCanvasElement | null;
  updateHoverInfo: (part: string | null, skinX: number, skinY: number) => void;
  getPartDisplayNameAtCoords: (workingX: number, workingY: number) => string | null;
  applyColorToUI: (hex: string) => void;
  sampleColorAtWithAlpha: (workingX: number, workingY: number) => { hex: string; alpha: number } | null;
  eyedropperAlphaThreshold: number;
  pushUndoStroke: (
    pixels: { x: number; y: number; r: number; g: number; b: number; a: number }[],
    isEraser: boolean,
    newColor: string,
    afterPixels?: { x: number; y: number; r: number; g: number; b: number; a: number }[]
  ) => void;
  pushUndoFill: (pixels: { x: number; y: number; r: number; g: number; b: number; a: number }[], fillColor: string) => void;
  updateUndoRedoButtons: () => void;
  undoLimit: number;
  /** Called when canvas pixels change (paint, fill, etc.). */
  onCanvasChange?: () => void;
  /** Restore skin canvas after temporary hover preview (shared with 3D preview texture). */
  clearSkinHoverPreview: () => void;
  /** Temporary pencil / eraser / paint brush preview on skin canvas; `canPaintAt` must match 2D layer rules. */
  updateSkinHoverPreview: (
    workingX: number,
    workingY: number,
    canPaintAt: (wx: number, wy: number) => boolean
  ) => void;
}

type BlockyGridLayout = {
  skinMinX: number;
  skinMinY: number;
  skinCols: number;
  skinRows: number;
};

/** One visible skin rectangle (one part box), in 64×64 skin pixel space. */
type VisibleSkinRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  layerKey: LayerKey;
  partIndex: number;
};

/** Focused multi layout: each region’s position in texel packing space (gapTex between adjacent parts). */
type PackedVisibleSkinRegion = VisibleSkinRegion & { packX: number; packY: number };


function readGridLayout(grid: HTMLElement | null): BlockyGridLayout {
  if (!grid || grid.dataset.blockyLayout !== 'focused') {
    return { skinMinX: 0, skinMinY: 0, skinCols: SKIN_SIZE, skinRows: SKIN_SIZE };
  }
  return {
    skinMinX: parseInt(grid.dataset.skinMinX ?? '0', 10),
    skinMinY: parseInt(grid.dataset.skinMinY ?? '0', 10),
    skinCols: parseInt(grid.dataset.skinCols ?? '64', 10),
    skinRows: parseInt(grid.dataset.skinRows ?? '64', 10),
  };
}

/** The inner slot (`.creator-canvas-inner`) is always 512×512 CSS px; focused crops letterbox inside it. */
const BLOCKY_INNER_SLOT_PX = BLOCKY_GRID_SIZE;

/**
 * Display pixels per skin texel (one blocky cell). Full 64×64 view uses the legacy
 * `RESOLUTION_MULTIPLIER * ZOOM`. Focused subsets scale up so the crop fits in
 * {@link BLOCKY_INNER_SLOT_PX} with square cells (cells grow as fewer skin pixels are shown).
 */
function getBlockyPixelsPerSkinPixel(grid: HTMLElement | null): number {
  if (!grid) return RESOLUTION_MULTIPLIER * ZOOM;
  if (grid.dataset.blockyLayout === 'focused-multi') {
    const px = parseFloat(grid.dataset.blockyCellPx ?? '');
    return Number.isFinite(px) && px > 0 ? px : RESOLUTION_MULTIPLIER * ZOOM;
  }
  if (grid.dataset.blockyLayout !== 'focused') {
    return RESOLUTION_MULTIPLIER * ZOOM;
  }
  const { skinCols, skinRows } = readGridLayout(grid);
  if (skinCols <= 0 || skinRows <= 0) return RESOLUTION_MULTIPLIER * ZOOM;
  return Math.min(BLOCKY_INNER_SLOT_PX / skinCols, BLOCKY_INNER_SLOT_PX / skinRows);
}

function getBlockyDisplayPixels(grid: HTMLElement | null): { w: number; h: number } {
  if (grid?.dataset.blockyLayout === 'focused-multi') {
    const packed = parseVisibleRegionsJson(grid);
    if (packed.length === 0) return { w: BLOCKY_INNER_SLOT_PX, h: BLOCKY_INNER_SLOT_PX };
    const px = getBlockyPixelsPerSkinPixel(grid);
    let W = 0;
    let H = 0;
    for (const r of packed) {
      W = Math.max(W, r.packX + r.w);
      H = Math.max(H, r.packY + r.h);
    }
    return { w: Math.round(W * px), h: Math.round(H * px) };
  }
  const { skinCols, skinRows } = readGridLayout(grid);
  const px = getBlockyPixelsPerSkinPixel(grid);
  return {
    w: Math.round(skinCols * px),
    h: Math.round(skinRows * px),
  };
}

function getBlockyGridPaddingInInner(grid: HTMLElement | null): { padX: number; padY: number } {
  const layout = grid?.dataset.blockyLayout;
  if (!grid || (layout !== 'focused' && layout !== 'focused-multi')) {
    return { padX: 0, padY: 0 };
  }
  const { w, h } = getBlockyDisplayPixels(grid);
  return {
    padX: Math.max(0, (BLOCKY_INNER_SLOT_PX - w) / 2),
    padY: Math.max(0, (BLOCKY_INNER_SLOT_PX - h) / 2),
  };
}

function isFullSkinLayerVisibilityForBlocky(state: CreatorState): boolean {
  return LAYER_KEYS.every((k) => {
    if (state.layer3DVisible[k] !== true) return false;
    if (!isLayerWithParts(k)) return true;
    const p = state.layer3DPartVisible[k];
    return p?.L !== false && p?.R !== false;
  });
}

/** Crop/zoom blocky cells to visible skin regions in 2D whenever any layer/part is hidden (not tied to camera Focused Creation). */
function shouldUseFocusedBlockyLayout(ctx: BlockyEditorContext): boolean {
  if (ctx.state.editMode !== '2d') return false;
  return !isFullSkinLayerVisibilityForBlocky(ctx.state);
}

/** One entry per visible part rectangle (never merged). Used to lay disjoint regions side-by-side in focused 2D. */
function computeVisibleSkinRegions(state: CreatorState): VisibleSkinRegion[] {
  const out: VisibleSkinRegion[] = [];
  for (const layer of LAYER_KEYS) {
    if (state.layer3DVisible[layer] !== true) continue;
    const bounds = SKIN_LAYER_BOUNDS[layer];
    const parts = state.layer3DPartVisible[layer];
    for (let i = 0; i < bounds.length; i++) {
      const partVisible = isLayerWithParts(layer)
        ? i === 0
          ? parts?.R !== false
          : parts?.L !== false
        : true;
      if (!partVisible) continue;
      const b = bounds[i]!;
      out.push({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        layerKey: layer,
        partIndex: i,
      });
    }
  }
  return out;
}

function parseVisibleRegionsJson(grid: HTMLElement | null): PackedVisibleSkinRegion[] {
  if (!grid?.dataset.blockyRegionsJson) return [];
  try {
    const raw = JSON.parse(grid.dataset.blockyRegionsJson) as PackedVisibleSkinRegion[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function getLayerAtCoords(ctx: BlockyEditorContext, workingX: number, workingY: number): string | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of LAYER_KEYS) {
    if (ctx.state.layer3DVisible[layer] !== true) continue;
    const bounds = SKIN_LAYER_BOUNDS[layer];
    const parts = ctx.state.layer3DPartVisible[layer];
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i]!;
      if (isLayerWithParts(layer)) {
        const sideOk = i === 0 ? parts?.R !== false : parts?.L !== false;
        if (!sideOk) continue;
      }
      if (normX >= b.x && normX < b.x + b.w && normY >= b.y && normY < b.y + b.h) return layer;
    }
  }
  return null;
}

function isInSelectedLayer(ctx: BlockyEditorContext, workingX: number, workingY: number): boolean {
  if (!ctx.state.restrictToLayers) return true;
  if (ctx.state.selectedLayers.size === 0) return true;
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  const pointInBounds = (x: number, y: number, b: { x: number; y: number; w: number; h: number }) =>
    x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  for (const layer of ctx.state.selectedLayers) {
    if (!isLayerKey(layer)) continue;
    const bounds = SKIN_LAYER_BOUNDS[layer];
    if (!bounds) continue;
    for (const b of bounds) {
      if (pointInBounds(normX, normY, b)) return true;
    }
  }
  return false;
}

function canPaintAt(ctx: BlockyEditorContext, workingX: number, workingY: number): boolean {
  if (!isInSelectedLayer(ctx, workingX, workingY)) return false;
  const layer = getLayerAtCoords(ctx, workingX, workingY);
  return layer != null && !ctx.state.layer3DLocked[layer];
}

function triggerLockFeedbackIfNeeded(ctx: BlockyEditorContext, workingX: number, workingY: number): void {
  if (!isInSelectedLayer(ctx, workingX, workingY)) return;
  const layer = getLayerAtCoords(ctx, workingX, workingY);
  if (layer != null && ctx.state.layer3DLocked[layer]) {
    creatorLockFeedbackSlice.notify({ layer });
  }
}

function clearFocusedGridDataset(grid: HTMLElement): void {
  delete grid.dataset.blockyLayout;
  delete grid.dataset.skinMinX;
  delete grid.dataset.skinMinY;
  delete grid.dataset.skinCols;
  delete grid.dataset.skinRows;
  delete grid.dataset.blockyCellPx;
  delete grid.dataset.blockyRegionsJson;
  grid.classList.remove('creator-blocky-grid--multi');
}

/** Build or rebuild the blocky grid (full 64×64, single focused bbox, or side-by-side focused parts). */
export function rebuildBlockyGrid(ctx: BlockyEditorContext): void {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid) return;

  clearFocusedGridDataset(grid);

  let skinMinX = 0;
  let skinMinY = 0;
  let cols = SKIN_SIZE;
  let rows = SKIN_SIZE;
  let layoutMode: 'full' | 'focused' = 'full';
  let visibleRegions: VisibleSkinRegion[] | null = null;

  if (shouldUseFocusedBlockyLayout(ctx)) {
    visibleRegions = computeVisibleSkinRegions(ctx.state);
    if (visibleRegions.length > 0) {
      // Crop to the bounding box of all visible parts, keeping each part at its real skin
      // position so cells stay aligned with the (skin-coordinate) rulers.
      let minX = SKIN_SIZE;
      let minY = SKIN_SIZE;
      let maxX = 0;
      let maxY = 0;
      for (const r of visibleRegions) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      const w = maxX - minX;
      const h = maxY - minY;
      if (w > 0 && h > 0 && (w < SKIN_SIZE || h < SKIN_SIZE)) {
        skinMinX = minX;
        skinMinY = minY;
        cols = w;
        rows = h;
        layoutMode = 'focused';
      }
    }
  }
  const isVisibleCell = (sx: number, sy: number): boolean =>
    visibleRegions == null ||
    visibleRegions.some((r) => sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h);

  grid.innerHTML = '';
  if (layoutMode === 'focused') {
    grid.dataset.blockyLayout = 'focused';
    grid.dataset.skinMinX = String(skinMinX);
    grid.dataset.skinMinY = String(skinMinY);
    grid.dataset.skinCols = String(cols);
    grid.dataset.skinRows = String(rows);
  }

  const { w: dispW, h: dispH } = getBlockyDisplayPixels(grid);
  grid.style.width = `${dispW}px`;
  grid.style.height = `${dispH}px`;
  const { padX, padY } = getBlockyGridPaddingInInner(grid);
  grid.style.left = `${padX}px`;
  grid.style.top = `${padY}px`;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const sx = skinMinX + i;
      const sy = skinMinY + j;
      const cell = document.createElement('div');
      cell.className = 'creator-blocky-cell';
      if (!isVisibleCell(sx, sy)) cell.classList.add('creator-blocky-cell--outside');
      cell.dataset.cx = String(sx);
      cell.dataset.cy = String(sy);
      cell.setAttribute('role', 'presentation');
      grid.appendChild(cell);
    }
  }
  buildRulers();
}

/** @deprecated Prefer rebuildBlockyGrid(ctx) after context exists. */
export function buildBlockyGrid(): void {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid || grid.children.length > 0) return;
  grid.innerHTML = '';
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'creator-blocky-cell';
      cell.dataset.cx = String(x);
      cell.dataset.cy = String(y);
      cell.setAttribute('role', 'presentation');
      grid.appendChild(cell);
    }
  }
}

/**
 * Build ruler ticks and labels in skin-pixel coordinates, matched to the current grid crop
 * (full 64×64 or focused bounding box) so ticks line up with the cells below them.
 */
export function buildRulers(): void {
  const topRuler = document.getElementById('creator-ruler-top');
  const leftRuler = document.getElementById('creator-ruler-left');
  if (!topRuler || !leftRuler) return;

  topRuler.innerHTML = '';
  leftRuler.innerHTML = '';

  const grid = document.getElementById('creator-blocky-grid');
  const { skinMinX, skinMinY, skinCols, skinRows } = readGridLayout(grid);
  const cellPx = getBlockyPixelsPerSkinPixel(grid);
  const { padX, padY } = getBlockyGridPaddingInInner(grid);

  // Label every 8 skin px normally; every 4 when zoomed in on a small crop.
  const labelStep = cellPx >= 16 ? 4 : 8;
  const minorStep = labelStep / 2;

  const buildAxis = (
    ruler: HTMLElement,
    start: number,
    count: number,
    pad: number,
    prop: 'left' | 'top'
  ): void => {
    const end = start + count;
    for (let s = start; s <= end; s++) {
      const px = Math.round(pad + (s - start) * cellPx);
      const isEdge = s === start || s === end;
      const isMajor = s % labelStep === 0 || isEdge;
      const isMinor = !isMajor && s % minorStep === 0;
      const tick = document.createElement('div');
      tick.className =
        isMajor ? 'creator-ruler-tick creator-ruler-tick-major' :
        isMinor ? 'creator-ruler-tick creator-ruler-tick-minor' :
        'creator-ruler-tick creator-ruler-tick-cell';
      tick.style[prop] = `${px}px`;
      ruler.appendChild(tick);
      if (isMajor) {
        // Skip an aligned label if an edge label sits right next to it.
        if (!isEdge && (s - start < 2 || end - s < 2)) continue;
        const label = document.createElement('span');
        label.className = 'creator-ruler-label' + (s === end ? ' creator-ruler-label-last' : '');
        label.textContent = String(s);
        label.style[prop] = `${px}px`;
        ruler.appendChild(label);
      }
    }
  };

  buildAxis(topRuler, skinMinX, skinCols, padX, 'left');
  buildAxis(leftRuler, skinMinY, skinRows, padY, 'top');
}

/** Render blocky grid cells from skin canvas. */
export function renderBlockyGrid(ctx: BlockyEditorContext): void {
  const grid = document.getElementById('creator-blocky-grid');
  const skin = ctx.getSkinCanvas();
  const skinCtx = skin?.getContext('2d', { willReadFrequently: true });
  if (!grid || !skinCtx) return;
  // Do not clear skin hover preview here: renderToDisplay → renderBlockyGrid runs
  // after paint-brush hover updates, and clearing would erase the preview before sync.
  blockySkinHoverCell = null;
  const cells = grid.querySelectorAll<HTMLElement>('.creator-blocky-cell');
  cells.forEach((cell) => {
    syncBlockyCellFromSkin(ctx, cell);
  });
}

/** Render rulers, template overlay, and scale. */
export function renderRulersAndGrid(ctx: BlockyEditorContext): void {
  const gridEl = document.getElementById('creator-blocky-grid');
  const { w: dispW, h: dispH } = getBlockyDisplayPixels(gridEl);
  const layout = readGridLayout(gridEl);
  const overlay = ctx.getOverlayCanvas();
  const { padX, padY } = getBlockyGridPaddingInInner(gridEl);
  if (overlay) {
    overlay.style.left = `${padX}px`;
    overlay.style.top = `${padY}px`;
    const overlayCtx = overlay.getContext('2d');
    if (overlayCtx) {
      overlay.width = dispW;
      overlay.height = dispH;
      overlayCtx.clearRect(0, 0, dispW, dispH);
      if (ctx.state.showTemplate) {
        const templateScale = getBlockyPixelsPerSkinPixel(gridEl);
        const labelPaddingX = 6;
        const labelPaddingY = 3;
        const labelInset = 0;
        const minLabelWidth = 22;
        const minLabelHeight = 16;
        overlayCtx.lineWidth = 2;
        overlayCtx.font = TEMPLATE_LABEL_FONT;
        overlayCtx.textAlign = 'left';
        overlayCtx.textBaseline = 'top';

        if (gridEl?.dataset.blockyLayout === 'focused-multi') {
          const regions = parseVisibleRegionsJson(gridEl);
          for (let ri = 0; ri < regions.length; ri++) {
            const r = regions[ri]!;
            const w = r.w * templateScale;
            const h = r.h * templateScale;
            const x = r.packX * templateScale;
            const y = r.packY * templateScale;
            const layerKey = r.layerKey;
            const b = { x: r.x, y: r.y, w: r.w, h: r.h };
            const style = TEMPLATE_LAYER_STYLES[layerKey] ?? DEFAULT_TEMPLATE_STYLE;
            overlayCtx.strokeStyle = style.stroke;
            overlayCtx.strokeRect(x, y, w, h);
            const labelText = getTemplateLabelText(layerKey, b);
            const maxLabelW = w - labelInset * 2;
            const maxLabelH = h - labelInset * 2;
            if (maxLabelW >= minLabelWidth && maxLabelH >= minLabelHeight) {
              const desiredLabelW = overlayCtx.measureText(labelText).width + labelPaddingX * 2;
              const labelW = Math.min(desiredLabelW, maxLabelW);
              const labelH = Math.min(14 + labelPaddingY * 2, maxLabelH);
              const topLeftX = x + labelInset;
              const topLeftY = y + labelInset;
              const bottomRightX = x + w - labelW - labelInset;
              const bottomRightY = y + h - labelH - labelInset;
              const labelKey = `fm:${ri}:${layerKey}:${r.x}:${r.y}:${r.w}:${r.h}`;
              const pointerInBox = pointInRect(overlayPointerPx, x, y, w, h);
              if (!pointerInBox) {
                flippedTemplateLabelKeys.delete(labelKey);
                hoveredTemplateLabelKeys.delete(labelKey);
                templateLabelTransitions.delete(labelKey);
              } else {
                const wasFlipped = flippedTemplateLabelKeys.has(labelKey);
                const currentLabelX = wasFlipped ? bottomRightX : topLeftX;
                const currentLabelY = wasFlipped ? bottomRightY : topLeftY;
                const pointerInCurrentLabel = pointInRect(overlayPointerPx, currentLabelX, currentLabelY, labelW, labelH);
                const wasHoveringLabel = hoveredTemplateLabelKeys.has(labelKey);
                if (pointerInCurrentLabel && !wasHoveringLabel) {
                  startLabelFlipTransition(labelKey, wasFlipped);
                }
                if (pointerInCurrentLabel) hoveredTemplateLabelKeys.add(labelKey);
                else hoveredTemplateLabelKeys.delete(labelKey);
              }
              const flipped = flippedTemplateLabelKeys.has(labelKey);
              const labelX = flipped ? bottomRightX : topLeftX;
              const labelY = flipped ? bottomRightY : topLeftY;
              const transition = templateLabelTransitions.get(labelKey);
              const drawLabel = (drawX: number, drawY: number, alpha: number) => {
                if (alpha <= 0) return;
                overlayCtx.save();
                overlayCtx.globalAlpha = alpha;
                overlayCtx.fillStyle = style.stroke;
                overlayCtx.fillRect(drawX, drawY, labelW, labelH);
                overlayCtx.fillStyle = TEMPLATE_LABEL_TEXT_VISIBLE;
                overlayCtx.beginPath();
                overlayCtx.rect(drawX, drawY, labelW, labelH);
                overlayCtx.clip();
                overlayCtx.fillText(labelText, drawX + labelPaddingX, drawY + labelPaddingY);
                overlayCtx.restore();
              };
              if (transition) {
                const elapsed = performance.now() - transition.startedAtMs;
                const t = clamp01(elapsed / transition.durationMs);
                const fromX = transition.fromFlipped ? bottomRightX : topLeftX;
                const fromY = transition.fromFlipped ? bottomRightY : topLeftY;
                const toX = transition.toFlipped ? bottomRightX : topLeftX;
                const toY = transition.toFlipped ? bottomRightY : topLeftY;
                drawLabel(fromX, fromY, 1 - t);
                drawLabel(toX, toY, t);
                if (t >= 1) {
                  templateLabelTransitions.delete(labelKey);
                } else {
                  scheduleTemplateAnimationFrame();
                }
              } else {
                drawLabel(labelX, labelY, 1);
              }
            }
          }
        } else {
        const ox = layout.skinMinX * templateScale;
        const oy = layout.skinMinY * templateScale;
        /** Focused 2D crop: only outline visible layers/parts (hide clutter from solo-off regions). */
        const templateFocusedCrop = gridEl?.dataset.blockyLayout === 'focused';

        for (const layerKey of LAYER_KEYS) {
          const bounds = SKIN_LAYER_BOUNDS[layerKey];
          const layerOn = ctx.state.layer3DVisible[layerKey] === true;
          const parts = ctx.state.layer3DPartVisible[layerKey];
          for (let i = 0; i < bounds.length; i++) {
            const b = bounds[i]!;
            const partVisible = isLayerWithParts(layerKey)
              ? (i === 0 ? (parts?.R !== false) : (parts?.L !== false))
              : true;
            if (templateFocusedCrop && (!layerOn || !partVisible)) continue;
            const isVisible = layerOn && partVisible;
            const style = isVisible
              ? (TEMPLATE_LAYER_STYLES[layerKey] ?? DEFAULT_TEMPLATE_STYLE)
              : HIDDEN_TEMPLATE_STYLE;
            const x = b.x * templateScale - ox;
            const y = b.y * templateScale - oy;
            const w = b.w * templateScale;
            const h = b.h * templateScale;
            if (x + w <= 0 || y + h <= 0 || x >= dispW || y >= dispH) continue;
            overlayCtx.strokeStyle = style.stroke;
            overlayCtx.strokeRect(x, y, w, h);
          }
        }
        overlayCtx.globalCompositeOperation = 'destination-out';
        overlayCtx.fillStyle = 'rgba(0,0,0,1)';
        for (const z of SKIN_DEAD_ZONES) {
          // Preserve full head/hat template boxes by skipping top-row dead zones.
          if (z.y < 16) continue;
          const x = z.x * templateScale - ox;
          const y = z.y * templateScale - oy;
          const w = z.w * templateScale;
          const h = z.h * templateScale;
          if (x + w <= 0 || y + h <= 0 || x >= dispW || y >= dispH) continue;
          overlayCtx.fillRect(x, y, w, h);
        }
        overlayCtx.globalCompositeOperation = 'source-over';

        // Draw labels after dead-zone punch-out so text remains readable.
        for (const layerKey of LAYER_KEYS) {
          const bounds = SKIN_LAYER_BOUNDS[layerKey];
          const layerOn = ctx.state.layer3DVisible[layerKey] === true;
          const parts = ctx.state.layer3DPartVisible[layerKey];
          for (let i = 0; i < bounds.length; i++) {
            const partVisible = isLayerWithParts(layerKey)
              ? (i === 0 ? (parts?.R !== false) : (parts?.L !== false))
              : true;
            if (templateFocusedCrop && (!layerOn || !partVisible)) continue;
            const isVisible = layerOn && partVisible;
            const style = isVisible
              ? (TEMPLATE_LAYER_STYLES[layerKey] ?? DEFAULT_TEMPLATE_STYLE)
              : HIDDEN_TEMPLATE_STYLE;
            const b = bounds[i];
            const labelText = getTemplateLabelText(layerKey, b);
            const x = b.x * templateScale - ox;
            const y = b.y * templateScale - oy;
            const w = b.w * templateScale;
            const h = b.h * templateScale;
            if (x + w <= 0 || y + h <= 0 || x >= dispW || y >= dispH) continue;
            const maxLabelW = w - labelInset * 2;
            const maxLabelH = h - labelInset * 2;
            if (maxLabelW < minLabelWidth || maxLabelH < minLabelHeight) continue;
            const desiredLabelW = overlayCtx.measureText(labelText).width + labelPaddingX * 2;
            const labelW = Math.min(desiredLabelW, maxLabelW);
            const labelH = Math.min(14 + labelPaddingY * 2, maxLabelH);
            const topLeftX = x + labelInset;
            const topLeftY = y + labelInset;
            const bottomRightX = x + w - labelW - labelInset;
            const bottomRightY = y + h - labelH - labelInset;
            const labelKey = `${layerKey}:${i}:${b.x}:${b.y}:${b.w}:${b.h}`;
            const pointerInBox = pointInRect(overlayPointerPx, x, y, w, h);
            if (!pointerInBox) {
              flippedTemplateLabelKeys.delete(labelKey);
              hoveredTemplateLabelKeys.delete(labelKey);
              templateLabelTransitions.delete(labelKey);
            } else {
              const wasFlipped = flippedTemplateLabelKeys.has(labelKey);
              const currentLabelX = wasFlipped ? bottomRightX : topLeftX;
              const currentLabelY = wasFlipped ? bottomRightY : topLeftY;
              const pointerInCurrentLabel = pointInRect(overlayPointerPx, currentLabelX, currentLabelY, labelW, labelH);
              const wasHoveringLabel = hoveredTemplateLabelKeys.has(labelKey);
              if (pointerInCurrentLabel && !wasHoveringLabel) {
                startLabelFlipTransition(labelKey, wasFlipped);
              }
              if (pointerInCurrentLabel) hoveredTemplateLabelKeys.add(labelKey);
              else hoveredTemplateLabelKeys.delete(labelKey);
            }
            const flipped = flippedTemplateLabelKeys.has(labelKey);
            const labelX = flipped ? bottomRightX : topLeftX;
            const labelY = flipped ? bottomRightY : topLeftY;
            const transition = templateLabelTransitions.get(labelKey);

            const drawLabel = (drawX: number, drawY: number, alpha: number) => {
              if (alpha <= 0) return;
              overlayCtx.save();
              overlayCtx.globalAlpha = alpha;
              overlayCtx.fillStyle = style.stroke;
              overlayCtx.fillRect(drawX, drawY, labelW, labelH);
              overlayCtx.fillStyle = isVisible ? TEMPLATE_LABEL_TEXT_VISIBLE : TEMPLATE_LABEL_TEXT_HIDDEN;
              overlayCtx.beginPath();
              overlayCtx.rect(drawX, drawY, labelW, labelH);
              overlayCtx.clip();
              overlayCtx.fillText(labelText, drawX + labelPaddingX, drawY + labelPaddingY);
              overlayCtx.restore();
            };

            if (transition) {
              const elapsed = performance.now() - transition.startedAtMs;
              const t = clamp01(elapsed / transition.durationMs);
              const fromX = transition.fromFlipped ? bottomRightX : topLeftX;
              const fromY = transition.fromFlipped ? bottomRightY : topLeftY;
              const toX = transition.toFlipped ? bottomRightX : topLeftX;
              const toY = transition.toFlipped ? bottomRightY : topLeftY;
              drawLabel(fromX, fromY, 1 - t);
              drawLabel(toX, toY, t);
              if (t >= 1) {
                templateLabelTransitions.delete(labelKey);
              } else {
                scheduleTemplateAnimationFrame();
              }
            } else {
              drawLabel(labelX, labelY, 1);
            }
          }
        }
        }
      }
    }
  }

  const wrap = document.getElementById('creator-canvas-wrap');
  if (wrap) wrap.toggleAttribute('data-rulers', ctx.state.showRulers);
  fitCanvasAreaScale();
}

/** Refresh blocky grid and overlays. */
export function renderToDisplay(ctx: BlockyEditorContext): void {
  renderBlockyGrid(ctx);
  renderRulersAndGrid(ctx);
}

const TOOLBAR_CLEARANCE_PX = 24;

/** Fit the canvas wrap to the area. In Creator.2D, reserves space above the bottom toolbar so the canvas does not overlap it. Maintains aspect ratio. */
export function fitCanvasAreaScale(): void {
  const area = document.getElementById('creator-canvas-area');
  const wrap = document.getElementById('creator-canvas-wrap');
  if (!area || !wrap) return;
  const areaRect = area.getBoundingClientRect();
  if (areaRect.width <= 0 || areaRect.height <= 0) return;

  let effectiveHeight = areaRect.height;
  if (document.body.dataset.editMode === '2d') {
    const bottomPanels = document.getElementById('creator-bottom-center-panels');
    if (bottomPanels) {
      const panelsRect = bottomPanels.getBoundingClientRect();
      const maxBottom = panelsRect.top - TOOLBAR_CLEARANCE_PX;
      if (maxBottom > areaRect.top && maxBottom < areaRect.top + areaRect.height) {
        effectiveHeight = Math.max(0, maxBottom - areaRect.top);
      }
    }
  }

  const hasRulers = wrap.hasAttribute('data-rulers');
  // Always fit the full wrap box (512×512 or 532×532 with rulers). Focused 2D crops the *grid* inside
  // `.creator-canvas-inner` but must not change this scale — using the smaller grid size here blew up
  // `scale()` and clipped the editor (focused mode / partial skin layers).
  const layoutW = hasRulers ? 532 : 512;
  const layoutH = hasRulers ? 532 : 512;
  const scale = Math.min(areaRect.width / layoutW, effectiveHeight / layoutH);
  (wrap as HTMLElement).style.transform = `scale(${scale})`;
}

/**
 * Resolve skin cell from pointer position. Prefer the actual `.creator-blocky-cell` under the point so
 * layout matches painting (CSS Grid subpixels, `transform: scale` on the wrap, and rounding in focused
 * mode otherwise skew index math vs real cell bounds).
 */
function pickBlockyCellFromDomUnderPoint(
  grid: HTMLElement,
  clientX: number,
  clientY: number
): { cx: number; cy: number } | null {
  const top = document.elementFromPoint(clientX, clientY);
  if (!top) return null;
  const cell = top.closest('.creator-blocky-cell');
  if (!(cell instanceof HTMLElement) || !grid.contains(cell)) return null;
  const cx = parseInt(cell.dataset.cx ?? '', 10);
  const cy = parseInt(cell.dataset.cy ?? '', 10);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { cx, cy };
}

function pickBlockyCellElementUnderPoint(grid: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  const top = document.elementFromPoint(clientX, clientY);
  if (!top) return null;
  const cell = top.closest('.creator-blocky-cell');
  if (!(cell instanceof HTMLElement) || !grid.contains(cell)) return null;
  return cell;
}

function syncBlockyCellFromSkin(ctx: BlockyEditorContext, cell: HTMLElement): void {
  const skin = ctx.getSkinCanvas();
  const skinCtx = skin?.getContext('2d', { willReadFrequently: true });
  if (!skinCtx) return;
  const cx = parseInt(cell.dataset.cx ?? '0', 10);
  const cy = parseInt(cell.dataset.cy ?? '0', 10);
  const wx = cx * RESOLUTION_MULTIPLIER;
  const wy = cy * RESOLUTION_MULTIPLIER;
  const d = skinCtx.getImageData(wx, wy, 1, 1).data;
  const hex = rgbToHex(d[0], d[1], d[2]);
  const alpha = d[3] / 255;
  cell.style.backgroundColor = alpha < 0.01 ? 'transparent' : hex;
}

/** Fallback mapping when the pointer is inside the grid but not on a cell (e.g. flex gap). */
function clientToBlockyCellFromMath(
  grid: HTMLElement,
  relX: number,
  relY: number,
  gridRect: DOMRect
): { cx: number; cy: number } | null {
  if (grid.dataset.blockyLayout === 'focused-multi') {
    const packed = parseVisibleRegionsJson(grid);
    if (packed.length === 0) return null;
    const cellPx = parseFloat(grid.dataset.blockyCellPx ?? '');
    if (!Number.isFinite(cellPx) || cellPx <= 0) return null;
    for (const r of packed) {
      const ox = r.packX * cellPx;
      const oy = r.packY * cellPx;
      const rw = r.w * cellPx;
      const rh = r.h * cellPx;
      if (relX >= ox && relX < ox + rw && relY >= oy && relY < oy + rh) {
        const lx = (relX - ox) / rw;
        const ly = (relY - oy) / rh;
        const ix = Math.floor(lx * r.w);
        const iy = Math.floor(ly * r.h);
        return {
          cx: r.x + Math.max(0, Math.min(r.w - 1, ix)),
          cy: r.y + Math.max(0, Math.min(r.h - 1, iy)),
        };
      }
    }
    return null;
  }

  const lx = relX / gridRect.width;
  const ly = relY / gridRect.height;
  const { skinMinX, skinMinY, skinCols, skinRows } = readGridLayout(grid);
  const ix = Math.floor(lx * skinCols);
  const iy = Math.floor(ly * skinRows);
  const cx = skinMinX + Math.max(0, Math.min(skinCols - 1, ix));
  const cy = skinMinY + Math.max(0, Math.min(skinRows - 1, iy));
  return { cx, cy };
}

/**
 * Map pointer to working pixels for the soft brush: center of the skin cell under the cursor
 * (aligned with 64×64 export / 3D paint — no half-working-pixel placement).
 */
function clientToContinuousWorkingPaintBrush(
  grid: HTMLElement,
  clientX: number,
  clientY: number
): { wx: number; wy: number; cx: number; cy: number } | null {
  const gridRect = grid.getBoundingClientRect();
  const relX = clientX - gridRect.left;
  const relY = clientY - gridRect.top;
  if (relX < 0 || relY < 0 || relX > gridRect.width || relY > gridRect.height) return null;

  if (grid.dataset.blockyLayout === 'focused-multi') {
    const packed = parseVisibleRegionsJson(grid);
    const cellPx = parseFloat(grid.dataset.blockyCellPx ?? '');
    if (packed.length === 0 || !Number.isFinite(cellPx) || cellPx <= 0) return null;
    for (const r of packed) {
      const ox = r.packX * cellPx;
      const oy = r.packY * cellPx;
      const rw = r.w * cellPx;
      const rh = r.h * cellPx;
      if (relX >= ox && relX < ox + rw && relY >= oy && relY < oy + rh) {
        const lx = (relX - ox) / rw;
        const ly = (relY - oy) / rh;
        const skinXf = r.x + lx * r.w;
        const skinYf = r.y + ly * r.h;
        const sx = Math.max(r.x, Math.min(r.x + r.w - 1, Math.floor(skinXf)));
        const sy = Math.max(r.y, Math.min(r.y + r.h - 1, Math.floor(skinYf)));
        const snapped = snapWorkingToSkinCellCenter(
          sx * RESOLUTION_MULTIPLIER,
          sy * RESOLUTION_MULTIPLIER
        );
        return { wx: snapped.x, wy: snapped.y, cx: sx, cy: sy };
      }
    }
    return null;
  }

  const lx = relX / gridRect.width;
  const ly = relY / gridRect.height;
  const { skinMinX, skinMinY, skinCols, skinRows } = readGridLayout(grid);
  const skinXf = skinMinX + lx * skinCols;
  const skinYf = skinMinY + ly * skinRows;
  const sx = Math.max(skinMinX, Math.min(skinMinX + skinCols - 1, Math.floor(skinXf)));
  const sy = Math.max(skinMinY, Math.min(skinMinY + skinRows - 1, Math.floor(skinYf)));
  const snapped = snapWorkingToSkinCellCenter(sx * RESOLUTION_MULTIPLIER, sy * RESOLUTION_MULTIPLIER);
  return { wx: snapped.x, wy: snapped.y, cx: sx, cy: sy };
}

/** Client coords to blocky grid cell (skin coordinates 0–63). */
export function clientToBlockyCell(clientX: number, clientY: number): { cx: number; cy: number } | null {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid) return null;
  const gridRect = grid.getBoundingClientRect();
  const relX = clientX - gridRect.left;
  const relY = clientY - gridRect.top;
  if (relX < 0 || relY < 0 || relX > gridRect.width || relY > gridRect.height) return null;

  const fromDom = pickBlockyCellFromDomUnderPoint(grid, clientX, clientY);
  if (fromDom) return fromDom;

  return clientToBlockyCellFromMath(grid, relX, relY, gridRect);
}

/** Setup pointer events on the blocky grid. */
export function setupBlockyGridEvents(ctx: BlockyEditorContext): void {
  const grid = document.getElementById('creator-blocky-grid');
  const skin = ctx.getSkinCanvas();
  const skinCtx = skin?.getContext('2d', { willReadFrequently: true });
  if (!grid || !skinCtx) return;
  const gridEl: HTMLElement = grid;
  const drawCtx: CanvasRenderingContext2D = skinCtx;
  activeBlockyContext = ctx;
  if (!unbindBlockyLayerSubs) {
    const refresh = () => {
      if (!activeBlockyContext) return;
      rebuildBlockyGrid(activeBlockyContext);
      renderToDisplay(activeBlockyContext);
    };
    const u1 = creatorLayerSlice.subscribe(refresh);
    const u2 = creator2dPaintSlice.subscribe(refresh);
    const u3 = creatorModeSlice.subscribe(refresh);
    const u4 = creatorFocusedCreationSlice.subscribe(refresh);
    unbindBlockyLayerSubs = () => {
      u1();
      u2();
      u3();
      u4();
    };
  }

  const canPaintAtBound = (wx: number, wy: number) => canPaintAt(ctx, wx, wy);
  const getCurrentColor = () => ctx.state.currentColor;
  let lastLockFeedbackMs = 0;
  const LOCK_FEEDBACK_THROTTLE_MS = 400;

  function clearBlockySkinHover(): void {
    ctx.clearSkinHoverPreview();
    if (blockySkinHoverCell) {
      syncBlockyCellFromSkin(ctx, blockySkinHoverCell);
      blockySkinHoverCell = null;
    }
    /** Soft-brush hover writes the skin canvas; blocky divs read from skin — refresh like pencil DOM tint. */
    renderToDisplay(ctx);
  }

  function applyBlockySkinHoverPreview(
    e: MouseEvent,
    cell: { cx: number; cy: number } | null,
    paintBrushWorking: { wx: number; wy: number } | null
  ): void {
    if (e.altKey) {
      clearBlockySkinHover();
      return;
    }
    const tool = ctx.state.activeTool;
    const showsSkinHover = tool === 'pencil' || tool === 'eraser' || tool === 'paintBrush';

    if (e.type === 'mouseleave') {
      clearBlockySkinHover();
      return;
    }

    if (!showsSkinHover || ctx.state.isDrawing) {
      clearBlockySkinHover();
      return;
    }

    if (e.type === 'mousedown' && e.button === 0) {
      clearBlockySkinHover();
      return;
    }

    if (e.type !== 'mousemove' && e.type !== 'mouseup') return;

    let wx: number;
    let wy: number;
    if (tool === 'paintBrush' && paintBrushWorking) {
      wx = paintBrushWorking.wx;
      wy = paintBrushWorking.wy;
    } else if (cell) {
      wx = cell.cx * RESOLUTION_MULTIPLIER;
      wy = cell.cy * RESOLUTION_MULTIPLIER;
    } else {
      clearBlockySkinHover();
      return;
    }

    if (!canPaintAtBound(wx, wy)) {
      clearBlockySkinHover();
      return;
    }

    ctx.updateSkinHoverPreview(wx, wy, canPaintAtBound);

    if (tool === 'paintBrush') {
      blockySkinHoverCell = null;
      renderToDisplay(ctx);
      return;
    }

    const cellEl = pickBlockyCellElementUnderPoint(gridEl, e.clientX, e.clientY);
    if (!cellEl) {
      clearBlockySkinHover();
      return;
    }

    if (blockySkinHoverCell && blockySkinHoverCell !== cellEl) {
      syncBlockyCellFromSkin(ctx, blockySkinHoverCell);
    }
    if (tool === 'pencil') {
      cellEl.style.backgroundColor = ctx.state.currentColor;
    } else {
      cellEl.style.backgroundColor = 'transparent';
    }
    blockySkinHoverCell = cellEl;
  }

  function handleBlockyPointer(e: MouseEvent): void {
    const gridRect = gridEl.getBoundingClientRect();
    const relX = e.clientX - gridRect.left;
    const relY = e.clientY - gridRect.top;
    const inGrid = relX >= 0 && relX <= gridRect.width && relY >= 0 && relY <= gridRect.height;
    const { w: odw, h: odh } = getBlockyDisplayPixels(gridEl);
    overlayPointerPx = inGrid
      ? { x: (relX / gridRect.width) * odw, y: (relY / gridRect.height) * odh }
      : null;
    const cell = clientToBlockyCell(e.clientX, e.clientY);
    const paintBrushPos =
      ctx.state.activeTool === 'paintBrush'
        ? clientToContinuousWorkingPaintBrush(gridEl, e.clientX, e.clientY)
        : null;

    if (paintBrushPos) {
      const part = ctx.getPartDisplayNameAtCoords(paintBrushPos.wx, paintBrushPos.wy);
      ctx.updateHoverInfo(part, paintBrushPos.cx, paintBrushPos.cy);
      if (ctx.state.showTemplate) renderRulersAndGrid(ctx);
    } else if (cell) {
      const wx0 = cell.cx * RESOLUTION_MULTIPLIER;
      const wy0 = cell.cy * RESOLUTION_MULTIPLIER;
      const part = ctx.getPartDisplayNameAtCoords(wx0, wy0);
      ctx.updateHoverInfo(part, cell.cx, cell.cy);
      if (ctx.state.showTemplate) renderRulersAndGrid(ctx);
    } else if (e.type === 'mouseleave') {
      overlayPointerPx = null;
      flippedTemplateLabelKeys.clear();
      hoveredTemplateLabelKeys.clear();
      templateLabelTransitions.clear();
      ctx.updateHoverInfo(null, -1, -1);
      if (ctx.state.showTemplate) renderRulersAndGrid(ctx);
    }
    try {
      if (!cell && !paintBrushPos) return;
      const wx = paintBrushPos ? paintBrushPos.wx : cell!.cx * RESOLUTION_MULTIPLIER;
      const wy = paintBrushPos ? paintBrushPos.wy : cell!.cy * RESOLUTION_MULTIPLIER;

      if (e.altKey) {
        const sample = ctx.sampleColorAtWithAlpha(wx, wy);
        if (sample && sample.alpha >= ctx.eyedropperAlphaThreshold) ctx.applyColorToUI(sample.hex);
        return;
      }

      if (ctx.state.activeTool === 'navigate') return;

      if (ctx.state.activeTool === 'eyedropper' && e.type === 'mousedown' && e.button === 0) {
        const sample = ctx.sampleColorAtWithAlpha(wx, wy);
        if (sample && sample.alpha >= ctx.eyedropperAlphaThreshold) ctx.applyColorToUI(sample.hex);
        return;
      }

      if (e.type === 'mousedown' && e.button === 0) {
        ctx.clearSkinHoverPreview();
        if (ctx.state.activeTool === 'fill') {
          if (!canPaintAtBound(wx, wy)) {
            const now = Date.now();
            if (now - lastLockFeedbackMs >= LOCK_FEEDBACK_THROTTLE_MS) {
              lastLockFeedbackMs = now;
              triggerLockFeedbackIfNeeded(ctx, wx, wy);
            }
          }
          const changed = brush.floodFill(drawCtx, wx, wy, canPaintAtBound, getCurrentColor);
          if (changed.length > 0) {
            ctx.pushUndoFill(changed, ctx.state.currentColor);
            ctx.onCanvasChange?.();
          }
          renderBlockyGrid(ctx);
        } else {
          if (!canPaintAtBound(wx, wy)) {
            const now = Date.now();
            if (now - lastLockFeedbackMs >= LOCK_FEEDBACK_THROTTLE_MS) {
              lastLockFeedbackMs = now;
              triggerLockFeedbackIfNeeded(ctx, wx, wy);
            }
          }
          ctx.state.isDrawing = true;
          ctx.state.lastSkinX = wx;
          ctx.state.lastSkinY = wy;
          if (ctx.state.activeTool === 'paintBrush') {
            ctx.state.currentStroke = {
              pixels: [],
              isEraser: false,
              newColor: ctx.state.currentColor,
              recorded: new Set<string>(),
            };
            paintBrushStampAt(
              drawCtx,
              wx,
              wy,
              ctx.state.paintBrushSize,
              ctx.state.paintBrushSoftness,
              ctx.state.currentColor,
              canPaintAtBound,
              ctx.state.currentStroke,
              false
            );
          } else {
            const isEraser = ctx.state.activeTool === 'eraser';
            ctx.state.currentStroke = {
              pixels: [],
              isEraser,
              newColor: ctx.state.currentColor,
              recorded: new Set<string>(),
            };
            brush.brushAt(
              drawCtx,
              wx,
              wy,
              isEraser,
              canPaintAtBound,
              getCurrentColor,
              ctx.state.currentStroke,
              RESOLUTION_MULTIPLIER,
              true
            );
          }
          ctx.onCanvasChange?.();
          renderBlockyGrid(ctx);
        }
      } else if (e.type === 'mousemove' && ctx.state.isDrawing && ctx.state.activeTool !== 'fill' && ctx.state.currentStroke) {
        if (!canPaintAtBound(wx, wy)) {
          const now = Date.now();
          if (now - lastLockFeedbackMs >= LOCK_FEEDBACK_THROTTLE_MS) {
            lastLockFeedbackMs = now;
            triggerLockFeedbackIfNeeded(ctx, wx, wy);
          }
        }
        if (ctx.state.activeTool === 'paintBrush') {
          brush.drawLineWithStamp(ctx.state.lastSkinX, ctx.state.lastSkinY, wx, wy, false, (bx, by) => {
            const s = snapWorkingToSkinCellCenter(bx, by);
            paintBrushStampAt(
              drawCtx,
              s.x,
              s.y,
              ctx.state.paintBrushSize,
              ctx.state.paintBrushSoftness,
              ctx.state.currentColor,
              canPaintAtBound,
              ctx.state.currentStroke,
              false
            );
          });
        } else {
          const isEraser = ctx.state.currentStroke.isEraser;
          brush.drawLine(
            drawCtx,
            ctx.state.lastSkinX,
            ctx.state.lastSkinY,
            wx,
            wy,
            isEraser,
            canPaintAtBound,
            getCurrentColor,
            ctx.state.currentStroke,
            RESOLUTION_MULTIPLIER,
            true
          );
        }
        ctx.state.lastSkinX = wx;
        ctx.state.lastSkinY = wy;
        ctx.onCanvasChange?.();
        renderBlockyGrid(ctx);
      } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
        if (e.type === 'mouseup' && e.button === 0 && ctx.state.currentStroke) {
          if (ctx.state.currentStroke.pixels.length > 0) {
            let afterPixels: ReturnType<typeof buildAfterPixelsForStroke> | undefined;
            if (ctx.state.activeTool === 'paintBrush') {
              afterPixels = buildAfterPixelsForStroke(drawCtx, ctx.state.currentStroke.pixels);
            }
            ctx.pushUndoStroke(
              ctx.state.currentStroke.pixels,
              ctx.state.currentStroke.isEraser,
              ctx.state.currentStroke.newColor,
              afterPixels
            );
          }
          ctx.state.currentStroke = null;
          ctx.state.isDrawing = false;
          ctx.updateUndoRedoButtons();
        }
        if (e.type === 'mouseleave' && ctx.state.currentStroke && ctx.state.currentStroke.pixels.length > 0) {
          let afterPixels: ReturnType<typeof buildAfterPixelsForStroke> | undefined;
          if (ctx.state.activeTool === 'paintBrush') {
            afterPixels = buildAfterPixelsForStroke(drawCtx, ctx.state.currentStroke.pixels);
          }
          ctx.pushUndoStroke(
            ctx.state.currentStroke.pixels,
            ctx.state.currentStroke.isEraser,
            ctx.state.currentStroke.newColor,
            afterPixels
          );
          ctx.state.currentStroke = null;
          ctx.state.isDrawing = false;
          ctx.updateUndoRedoButtons();
        }
      }
    } finally {
      applyBlockySkinHoverPreview(
        e,
        cell,
        paintBrushPos ? { wx: paintBrushPos.wx, wy: paintBrushPos.wy } : null
      );
    }
  }

  gridEl.addEventListener('mousedown', handleBlockyPointer);
  gridEl.addEventListener('mousemove', handleBlockyPointer);
  gridEl.addEventListener('mouseup', handleBlockyPointer);
  gridEl.addEventListener('mouseleave', handleBlockyPointer);
  gridEl.title = 'Blocky 64×64 grid — drag to paint, Alt+click to pick color';
}

/** Get brush cursor style for 2D grid. Uses grid rect for cell size. */
export function getBrushCursorStyle2D(): string {
  const grid = document.getElementById('creator-blocky-grid');
  const rect = grid?.getBoundingClientRect();
  const gridWidth = rect?.width ?? BLOCKY_GRID_SIZE;
  if (grid?.dataset.blockyLayout === 'focused-multi') {
    const packed = parseVisibleRegionsJson(grid);
    let wTex = 0;
    for (const r of packed) {
      wTex = Math.max(wTex, r.packX + r.w);
    }
    const cellPx = getBlockyPixelsPerSkinPixel(grid);
    return brush.getBrushCursorStyle2D(gridWidth, Math.max(1, wTex), cellPx);
  }
  const { skinCols } = readGridLayout(grid);
  const colCount = Math.max(1, skinCols);
  return brush.getBrushCursorStyle2D(gridWidth, colCount, gridWidth / colCount);
}

/** Soft brush outline on 2D grid — same layout metrics as {@link getBrushCursorStyle2D}. */
export function getPaintBrushCursorStyle2D(brushW: number, brushH: number): string {
  const grid = document.getElementById('creator-blocky-grid');
  const rect = grid?.getBoundingClientRect();
  const gridWidth = rect?.width ?? BLOCKY_GRID_SIZE;
  if (grid?.dataset.blockyLayout === 'focused-multi') {
    const packed = parseVisibleRegionsJson(grid);
    let wTex = 0;
    for (const r of packed) {
      wTex = Math.max(wTex, r.packX + r.w);
    }
    const cellPx = getBlockyPixelsPerSkinPixel(grid);
    return brush.getPaintBrushCursorStyle2D(gridWidth, Math.max(1, wTex), cellPx, brushW, brushH);
  }
  const { skinCols } = readGridLayout(grid);
  const colCount = Math.max(1, skinCols);
  return brush.getPaintBrushCursorStyle2D(gridWidth, colCount, gridWidth / colCount, brushW, brushH);
}
