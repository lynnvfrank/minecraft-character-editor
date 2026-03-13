/**
 * Character creator: higher-res working canvas, 64×64 export.
 * Step 2–6: Route, shell, canvas, brush, eraser, fill, layers.
 * Step 7: Undo/Redo.
 * Resolution: work at WORK_SIZE (e.g. 128×128), export downscaled to 64×64.
 */

import { SKIN_SIZE, SKIN_LAYER_BOUNDS, SKIN_PART_BOUNDS, SKIN_DEAD_ZONES, isInDeadZone, type Bounds } from './skinLayout';

const RESOLUTION_MULTIPLIER = 2;
const UNDO_LIMIT = 50;
const WORK_SIZE = SKIN_SIZE * RESOLUTION_MULTIPLIER;
const ZOOM = 4;
const DISPLAY_SIZE = WORK_SIZE * ZOOM;
const SWATCH_MAX = 12;
const DEFAULT_COLOR = '#8b7355';
const LAYER_KEYS = ['hat', 'head', 'jacket', 'body', 'sleeves', 'arms', 'pants', 'legs'] as const;
/** Groups for layers panel display; separator shown after each group. */
const LAYER_GROUPS: readonly (readonly string[])[] = [
  ['hat', 'head'],
  ['jacket', 'body'],
  ['sleeves', 'arms'],
  ['pants', 'legs'],
];

/** 3D mode: visibility per layer (hidden = not rendered, brush ignored). Default true. */
const layer3DVisible: Record<string, boolean> = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));
/** 3D mode: lock per layer (locked = brush ignored, part stays visible). Default false. */
const layer3DLocked: Record<string, boolean> = Object.fromEntries(LAYER_KEYS.map((k) => [k, false]));
/** Solo mode: Alt+click eye shows only one layer. Stored visibility to restore on exit. */
let layer3DSoloMode = false;
let layer3DSoloBeforeState: Record<string, boolean> | null = null;
let layer3DSoloCurrentLayer: string | null = null;

/** Ruler: 0,0 upper-left to 64,64 lower-right. Toggleable. */
let showRulers = false;
/** Template overlay: region outlines for model-to-2D mapping. Toggleable. Non-destructive. */
let showTemplate = false;
/** Edit mode: true = paint on 3D model, false = paint on 2D blocky grid */
let editMode3D = true;

export type Tool = 'brush' | 'eraser' | 'fill' | 'navigate';

let skinCanvas: HTMLCanvasElement | null = null;

let currentColor = DEFAULT_COLOR;
const BRUSH_SIZE = 1;
let swatchColors: string[] = [DEFAULT_COLOR];
let isDrawing = false;
let lastSkinX = -1;
let lastSkinY = -1;
let activeTool: Tool = 'navigate';
let selectedLayers = new Set<string>(LAYER_KEYS);
/** When false, allow drawing anywhere on the canvas (ignore layer mask). */
let restrictToLayers = true;

type PixelChange = { x: number; y: number; r: number; g: number; b: number; a: number };
type UndoCommand =
  | { type: 'stroke'; pixels: PixelChange[]; isEraser: boolean; newColor: string }
  | { type: 'fill'; pixels: PixelChange[]; fillColor: string }
  | { type: 'load'; beforeData: Uint8ClampedArray; afterData: Uint8ClampedArray };

type SkinEntry = { path: string; label: string; preview?: string };

let undoStack: UndoCommand[] = [];
let redoStack: UndoCommand[] = [];
let currentStroke: {
  pixels: PixelChange[];
  isEraser: boolean;
  newColor: string;
  /** Tracks (x,y) already recorded so we only store the original value, not overwrites from overlapping dabs */
  recorded: Set<string>;
} | null = null;

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

function addToSwatch(hex: string): void {
  const normalized = hex.toLowerCase();
  swatchColors = swatchColors.filter((c) => c.toLowerCase() !== normalized);
  swatchColors.unshift(normalized);
  if (swatchColors.length > SWATCH_MAX) swatchColors.pop();
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
  if (!layer3DVisible[layer]) return false;
  if (layer3DLocked[layer]) return false;
  return true;
}

/** 3D mode: is the pixel at (workingX, workingY) in a paintable layer? */
function isInPaintable3DLayer(workingX: number, workingY: number): boolean {
  return canPaintOn3DLayer(getLayerAtCoords(workingX, workingY));
}


/** Check if working-canvas coord (0..WORK_SIZE-1) is in a selected layer. */
function isInSelectedLayer(workingX: number, workingY: number): boolean {
  if (!restrictToLayers) return true;
  if (selectedLayers.size === 0) return true;
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of selectedLayers) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    if (!bounds) continue;
    for (const b of bounds) {
      if (pointInBounds(normX, normY, b)) return true;
    }
  }
  return false;
}

/** 2D view: can we paint at this coord? (selected layer and not locked) */
function canPaintAt2D(workingX: number, workingY: number): boolean {
  if (!isInSelectedLayer(workingX, workingY)) return false;
  const layer = getLayerAtCoords(workingX, workingY);
  return layer != null && !layer3DLocked[layer];
}

function getSkinCanvas(): HTMLCanvasElement {
  if (!skinCanvas) {
    skinCanvas = document.createElement('canvas');
    skinCanvas.width = WORK_SIZE;
    skinCanvas.height = WORK_SIZE;
  }
  return skinCanvas;
}

function getOverlayCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-overlay-canvas') as HTMLCanvasElement | null;
}


/** Returns CSS cursor value for brush: box outline. Hotspot center. Uses PNG to avoid SVG ghosting on Mac. */
function makeBrushCursorSVG(boxPx: number): string {
  const cursorSize = 64;
  const x = Math.round((cursorSize - boxPx) / 2);
  const w = Math.round(boxPx);
  const canvas = document.createElement('canvas');
  canvas.width = cursorSize;
  canvas.height = cursorSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}"><rect x="${x}" y="${x}" width="${w}" height="${w}" fill="none" stroke="white" stroke-width="1"/></svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27');
    return `url("data:image/svg+xml,${encoded}") ${cursorSize / 2} ${cursorSize / 2}, crosshair`;
  }
  ctx.clearRect(0, 0, cursorSize, cursorSize);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, x + 0.5, Math.max(0, w - 1), Math.max(0, w - 1));
  const png = canvas.toDataURL('image/png');
  return `url("${png}") ${cursorSize / 2} ${cursorSize / 2}, crosshair`;
}

/** Returns CSS cursor value for brush: box outline, size = 1 cell (2D blocky). */
function getBrushCursorStyle(_size: number): string {
  const grid = document.getElementById('creator-blocky-grid');
  const rect = grid?.getBoundingClientRect();
  const cellPx = rect ? rect.width / SKIN_SIZE : BLOCKY_GRID_SIZE / SKIN_SIZE;
  // On Mac Retina/Safari, the OS scales the cursor 2x; divide by DPR so it matches 1 cell.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const boxPx = Math.max(2, cellPx / dpr);
  return makeBrushCursorSVG(boxPx);
}

/** Returns CSS cursor for 3D viewport: fixed screen-space box (8px per brush size unit). */
export function getBrushCursorStyleFor3D(size: number): string {
  const boxPx = Math.max(8, size * 8);
  return makeBrushCursorSVG(boxPx);
}

function updateCanvasCursor(): void {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid) return;
  const el = grid as HTMLElement;
  el.style.cursor =
    activeTool === 'navigate' ? 'default' : getBrushCursorStyle(BRUSH_SIZE);
}

/**
 * Draw a square block brush at (sx, sy) on the skin canvas.
 * If stroke is provided, records previous pixel values for undo.
 * @param size - Brush size in pixels (default BRUSH_SIZE). Use 2 for blocky 2D to paint 1 grid cell.
 * @param alignTopLeft - If true, (sx,sy) is top-left corner; if false, brush is centered on (sx,sy).
 */
function brushAt(
  skinCtx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  isEraser = false,
  stroke?: { pixels: PixelChange[]; isEraser: boolean; newColor: string; recorded: Set<string> } | null,
  size = BRUSH_SIZE,
  alignTopLeft = false
): void {
  const offset = alignTopLeft ? 0 : Math.floor(size / 2);
  const startX = sx - offset;
  const startY = sy - offset;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = startX + dx;
      const py = startY + dy;
      if (
        px >= 0 &&
        px < WORK_SIZE &&
        py >= 0 &&
        py < WORK_SIZE &&
        canPaintAt2D(px, py)
      ) {
        if (stroke) {
          const key = `${px},${py}`;
          if (!stroke.recorded.has(key)) {
            stroke.recorded.add(key);
            const d = skinCtx.getImageData(px, py, 1, 1).data;
            stroke.pixels.push({ x: px, y: py, r: d[0], g: d[1], b: d[2], a: d[3] });
          }
        }
        if (isEraser) {
          skinCtx.clearRect(px, py, 1, 1);
        } else {
          skinCtx.fillStyle = stroke?.newColor ?? currentColor;
          skinCtx.fillRect(px, py, 1, 1);
        }
      }
    }
  }
}

/**
 * Stack-based flood fill. Restricts to selected layers. Returns changed pixels for undo.
 */
function floodFill(skinCtx: CanvasRenderingContext2D, sx: number, sy: number): PixelChange[] {
  const changed: PixelChange[] = [];
  if (!canPaintAt2D(sx, sy)) return changed;
  const imageData = skinCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
  const data = imageData.data;
  const targetR = data[((sy * WORK_SIZE + sx) * 4) + 0];
  const targetG = data[((sy * WORK_SIZE + sx) * 4) + 1];
  const targetB = data[((sy * WORK_SIZE + sx) * 4) + 2];
  const targetA = data[((sy * WORK_SIZE + sx) * 4) + 3];
  const [fillR, fillG, fillB] = hexToRgb(currentColor);
  const fillA = 255;

  const match = (idx: number) =>
    data[idx] === targetR &&
    data[idx + 1] === targetG &&
    data[idx + 2] === targetB &&
    data[idx + 3] === targetA;

  const idx = (x: number, y: number) => (y * WORK_SIZE + x) * 4;

  const stack: [number, number][] = [[sx, sy]];
  const visited = new Set<number>();
  visited.add(sy * WORK_SIZE + sx);

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (!canPaintAt2D(x, y)) continue;
    const i = idx(x, y);
    if (!match(i)) continue;
    changed.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
    data[i] = fillR;
    data[i + 1] = fillG;
    data[i + 2] = fillB;
    data[i + 3] = fillA;

    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= WORK_SIZE || ny < 0 || ny >= WORK_SIZE) continue;
      const key = ny * WORK_SIZE + nx;
      if (visited.has(key)) continue;
      visited.add(key);
      stack.push([nx, ny]);
    }
  }

  skinCtx.putImageData(imageData, 0, 0);
  return changed;
}

function putImageDataFromRGBA(data: Uint8ClampedArray): void {
  const ctx = getSkinCanvas().getContext('2d');
  if (!ctx) return;
  const imgData = ctx.createImageData(WORK_SIZE, WORK_SIZE);
  imgData.data.set(data);
  ctx.putImageData(imgData, 0, 0);
}

function captureCanvasImageData(): Uint8ClampedArray {
  const ctx = getSkinCanvas().getContext('2d');
  if (!ctx) return new Uint8ClampedArray(0);
  const imgData = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
  return new Uint8ClampedArray(imgData.data);
}

function applyPixelChanges(
  skinCtx: CanvasRenderingContext2D,
  pixels: PixelChange[],
  useNew: boolean,
  cmd: UndoCommand
): void {
  if (pixels.length === 0) return;
  const imageData = skinCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
  const data = imageData.data;
  const idx = (x: number, y: number) => (y * WORK_SIZE + x) * 4;
  for (const p of pixels) {
    const i = idx(p.x, p.y);
    if (cmd.type === 'stroke') {
      if (useNew) {
        if (cmd.isEraser) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 0;
        } else {
          const [r, g, b] = hexToRgb(cmd.newColor);
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      } else {
        data[i] = p.r;
        data[i + 1] = p.g;
        data[i + 2] = p.b;
        data[i + 3] = p.a;
      }
    } else {
      data[i] = p.r;
      data[i + 1] = p.g;
      data[i + 2] = p.b;
      data[i + 3] = p.a;
    }
  }
  skinCtx.putImageData(imageData, 0, 0);
}

function performUndo(): void {
  const cmd = undoStack.pop();
  if (!cmd) return;
  redoStack.push(cmd);
  if (cmd.type === 'load') {
    putImageDataFromRGBA(cmd.beforeData);
  } else {
    const ctx = getSkinCanvas().getContext('2d');
    if (!ctx) return;
    applyPixelChanges(ctx, cmd.pixels, false, cmd);
  }
  renderToDisplay();
}

function updateAllUndoRedoButtons(): void {
  const ub = document.getElementById('creator-tools-undo-btn') as HTMLButtonElement | null;
  const rb = document.getElementById('creator-tools-redo-btn') as HTMLButtonElement | null;
  if (ub) ub.disabled = undoStack.length === 0;
  if (rb) rb.disabled = redoStack.length === 0;
}

function performRedo(): void {
  const cmd = redoStack.pop();
  if (!cmd) return;
  undoStack.push(cmd);
  if (cmd.type === 'load') {
    putImageDataFromRGBA(cmd.afterData);
  } else {
    const ctx = getSkinCanvas().getContext('2d');
    if (!ctx) return;
    if (cmd.type === 'stroke') {
      applyPixelChanges(ctx, cmd.pixels, true, cmd);
    } else {
      const [fillR, fillG, fillB] = hexToRgb(cmd.fillColor);
      const imageData = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
      for (const p of cmd.pixels) {
        const i = (p.y * WORK_SIZE + p.x) * 4;
        imageData.data[i] = fillR;
        imageData.data[i + 1] = fillG;
        imageData.data[i + 2] = fillB;
        imageData.data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    }
  }
  renderToDisplay();
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.slice(1).match(/.{2}/g);
  if (!m) return [0, 0, 0];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

const FALLBACK_SKINS: SkinEntry[] = [{ path: '/skins/RunningboyRig.png', label: 'Default' }];

export async function loadSkinFromPath(path: string): Promise<void> {
  const ctx = getSkinCanvas().getContext('2d');
  if (!ctx) return;
  const beforeData = captureCanvasImageData();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load skin: ${path}`));
      img.src = path.startsWith('/') ? path : `/${path}`.replace(/\/+/g, '/');
    });
  } catch {
    return;
  }
  const sw = img.width;
  const sh = img.height;
  if (sw <= 0 || sh <= 0) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  // Use full source rect so 64×64 skins include jacket/sleeves/pants (lower half).
  // 64×32 legacy skins: draw upper half only; jacket/sleeves/pants stay transparent.
  if (sh < sw) {
    // Legacy 64×32: put upper half in top of canvas, leave lower half (overlay) empty
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, WORK_SIZE, (WORK_SIZE * sh) / sw);
  } else {
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, WORK_SIZE, WORK_SIZE);
  }
  const afterData = captureCanvasImageData();
  redoStack = [];
  undoStack.push({ type: 'load', beforeData, afterData });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  renderToDisplay();
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

/**
 * Draw a line from (x0,y0) to (x1,y1) using brush dabs (Bresenham).
 * @param size - Brush size (default BRUSH_SIZE).
 * @param alignTopLeft - If true, snap to cell grid and paint from top-left (for blocky 2D).
 */
function drawLine(
  skinCtx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isEraser = false,
  stroke?: { pixels: PixelChange[]; isEraser: boolean; newColor: string; recorded: Set<string> } | null,
  size = BRUSH_SIZE,
  alignTopLeft = false
): void {
  const cellSize = alignTopLeft ? RESOLUTION_MULTIPLIER : 1;
  const snap = (v: number) => (alignTopLeft ? Math.floor(v / cellSize) * cellSize : v);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;
  let lastCellKey = '';

  while (true) {
    const bx = snap(x);
    const by = snap(y);
    const cellKey = `${bx},${by}`;
    if (!alignTopLeft || cellKey !== lastCellKey) {
      lastCellKey = cellKey;
      brushAt(skinCtx, bx, by, isEraser, stroke, size, alignTopLeft);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Refresh blocky grid and overlays (rulers, grid, template). */
function renderToDisplay(): void {
  renderBlockyGrid();
  renderRulersAndGrid();
}

/** Display pixels per working pixel. Rulers use WORK_SIZE so they match the 128×128 draw grid. */
const RULER_SCALE = DISPLAY_SIZE / WORK_SIZE;

function buildRulers(): void {
  const topRuler = document.getElementById('creator-ruler-top');
  const leftRuler = document.getElementById('creator-ruler-left');
  if (!topRuler || !leftRuler) return;
  if (topRuler.children.length > 0) return;

  topRuler.innerHTML = '';
  leftRuler.innerHTML = '';

  for (let s = 0; s <= WORK_SIZE; s += 2) {
    const px = Math.round(s * RULER_SCALE);
    const isMajor = s % 16 === 0;
    const isMinor = s % 8 === 0 && !isMajor;
    const isCell = !isMajor && !isMinor;
    const label = String(s / 2);

    const tickClass =
      isMajor ? 'creator-ruler-tick creator-ruler-tick-major' :
      isMinor ? 'creator-ruler-tick creator-ruler-tick-minor' :
      'creator-ruler-tick creator-ruler-tick-cell';

    const topTick = document.createElement('div');
    topTick.className = tickClass;
    topTick.style.left = `${px}px`;
    topRuler.appendChild(topTick);

    const leftTick = document.createElement('div');
    leftTick.className = tickClass;
    leftTick.style.top = `${px}px`;
    leftRuler.appendChild(leftTick);

    if (isMajor) {
      const isLast = s === WORK_SIZE;
      const labelClass = 'creator-ruler-label' + (isLast ? ' creator-ruler-label-last' : '');
      const topLabel = document.createElement('span');
      topLabel.className = labelClass;
      topLabel.textContent = label;
      topLabel.style.left = `${px}px`;
      topRuler.appendChild(topLabel);

      const leftLabel = document.createElement('span');
      leftLabel.className = labelClass;
      leftLabel.textContent = label;
      leftLabel.style.top = `${px}px`;
      leftRuler.appendChild(leftLabel);
    }
  }
}

function renderRulersAndGrid(): void {
  const overlay = getOverlayCanvas();

  if (overlay) {
    const ctx = overlay.getContext('2d');
    if (ctx) {
      overlay.width = DISPLAY_SIZE;
      overlay.height = DISPLAY_SIZE;
      ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
      if (showTemplate) {
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(100, 200, 255, 0.2)';
        const templateScale = RULER_SCALE * RESOLUTION_MULTIPLIER;
        for (const bounds of Object.values(SKIN_LAYER_BOUNDS)) {
          for (const b of bounds) {
            const x = b.x * templateScale;
            const y = b.y * templateScale;
            const w = b.w * templateScale;
            const h = b.h * templateScale;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
          }
        }
        // Erase dead zones from template (reference diagram areas with meta-info, not skin)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        for (const z of SKIN_DEAD_ZONES) {
          const x = z.x * templateScale;
          const y = z.y * templateScale;
          const w = z.w * templateScale;
          const h = z.h * templateScale;
          ctx.fillRect(x, y, w, h);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  const wrap = document.getElementById('creator-canvas-wrap');
  if (wrap) wrap.toggleAttribute('data-rulers', showRulers);
  fitCanvasAreaScale();
}

function buildToolbar(): void {
  const toolbar = document.querySelector('.creator-toolbar');
  if (!toolbar) return;

  toolbar.innerHTML = `
    <div class="creator-toolbar-row">
      <span class="creator-toolbar-label">Color</span>
      <div class="creator-current-color" title="Current color"></div>
      <input type="text" class="creator-hex-input" value="${currentColor}" maxlength="7" placeholder="#RRGGBB" aria-label="Hex color">
      <span class="creator-toolbar-label">Swatch</span>
      <div class="creator-swatch" role="group" aria-label="Color swatch"></div>
    </div>
  `;

  const currentColorEl = toolbar.querySelector('.creator-current-color') as HTMLElement;
  const hexInput = toolbar.querySelector('.creator-hex-input') as HTMLInputElement;
  const swatchEl = toolbar.querySelector('.creator-swatch') as HTMLElement;

  function updateCurrentColorUI(): void {
    if (currentColorEl) {
      currentColorEl.style.backgroundColor = currentColor;
    }
    if (hexInput) hexInput.value = currentColor;
  }

  function renderSwatch(): void {
    if (!swatchEl) return;
    swatchEl.innerHTML = swatchColors
      .map((c) => `<button type="button" class="creator-swatch-item" style="background-color:${c}" data-color="${c}" title="${c}"></button>`)
      .join('');
    swatchEl.querySelectorAll('.creator-swatch-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentColor = (btn as HTMLElement).dataset.color || currentColor;
        addToSwatch(currentColor);
        updateCurrentColorUI();
        renderSwatch();
      });
    });
  }

  hexInput?.addEventListener('change', () => {
    const v = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      currentColor = v.toLowerCase();
      addToSwatch(currentColor);
      updateCurrentColorUI();
      renderSwatch();
    } else {
      hexInput.value = currentColor;
    }
  });

  updateCurrentColorUI();
  renderSwatch();
}

const BLOCKY_GRID_SIZE = 512;

function buildBlockyGrid(): void {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid || grid.children.length > 0) return;
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${SKIN_SIZE}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${SKIN_SIZE}, 1fr)`;
  grid.style.width = `${BLOCKY_GRID_SIZE}px`;
  grid.style.height = `${BLOCKY_GRID_SIZE}px`;
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

function renderBlockyGrid(): void {
  const grid = document.getElementById('creator-blocky-grid');
  const skin = getSkinCanvas();
  const ctx = skin?.getContext('2d', { willReadFrequently: true });
  if (!grid || !ctx) return;
  const cells = grid.querySelectorAll<HTMLElement>('.creator-blocky-cell');
  cells.forEach((cell) => {
    const cx = parseInt(cell.dataset.cx ?? '0', 10);
    const cy = parseInt(cell.dataset.cy ?? '0', 10);
    const wx = cx * RESOLUTION_MULTIPLIER;
    const wy = cy * RESOLUTION_MULTIPLIER;
    const d = ctx.getImageData(wx, wy, 1, 1).data;
    const hex = rgbToHex(d[0], d[1], d[2]);
    const alpha = d[3] / 255;
    cell.style.backgroundColor = alpha < 0.01 ? 'transparent' : hex;
  });
}

function clientToBlockyCell(clientX: number, clientY: number): { cx: number; cy: number } | null {
  const grid = document.getElementById('creator-blocky-grid');
  if (!grid) return null;
  const rect = grid.getBoundingClientRect();
  const lx = (clientX - rect.left) / rect.width;
  const ly = (clientY - rect.top) / rect.height;
  if (lx < 0 || lx >= 1 || ly < 0 || ly >= 1) return null;
  const cx = Math.floor(lx * SKIN_SIZE);
  const cy = Math.floor(ly * SKIN_SIZE);
  return { cx: Math.max(0, Math.min(SKIN_SIZE - 1, cx)), cy: Math.max(0, Math.min(SKIN_SIZE - 1, cy)) };
}

function setupBlockyGridEvents(): void {
  const grid = document.getElementById('creator-blocky-grid');
  const skin = getSkinCanvas();
  const skinCtx = skin?.getContext('2d', { willReadFrequently: true });
  if (!grid || !skinCtx) return;
  const ctx = skinCtx;

  function handleBlockyPointer(e: MouseEvent): void {
    const cell = clientToBlockyCell(e.clientX, e.clientY);
    if (cell) {
      const wx = cell.cx * RESOLUTION_MULTIPLIER;
      const wy = cell.cy * RESOLUTION_MULTIPLIER;
      const part = getPartDisplayNameAtCoords(wx, wy);
      updateHoverInfo(part, cell.cx, cell.cy);
    } else if (e.type === 'mouseleave') {
      updateHoverInfo(null, -1, -1);
    }
    if (!cell) return;
    const wx = cell.cx * RESOLUTION_MULTIPLIER;
    const wy = cell.cy * RESOLUTION_MULTIPLIER;

    if (e.altKey) {
      const d = ctx.getImageData(wx, wy, 1, 1).data;
      const hex = rgbToHex(d[0], d[1], d[2]);
      currentColor = hex;
      addToSwatch(hex);
      const currentColorEl = document.querySelector('.creator-current-color') as HTMLElement;
      const hexInput = document.querySelector('.creator-hex-input') as HTMLInputElement;
      const swatchEl = document.querySelector('.creator-swatch');
      if (currentColorEl) currentColorEl.style.backgroundColor = hex;
      if (hexInput) hexInput.value = hex;
      if (swatchEl) {
        swatchEl.innerHTML = swatchColors
          .map((c) => `<button type="button" class="creator-swatch-item" style="background-color:${c}" data-color="${c}" title="${c}"></button>`)
          .join('');
        swatchEl.querySelectorAll('.creator-swatch-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            currentColor = (btn as HTMLElement).dataset.color || currentColor;
            addToSwatch(currentColor);
            (document.querySelector('.creator-current-color') as HTMLElement)!.style.backgroundColor = currentColor;
            ((document.querySelector('.creator-hex-input') as HTMLInputElement)!).value = currentColor;
          });
        });
      }
      return;
    }

    if (activeTool === 'navigate') return;

    if (e.type === 'mousedown' && e.button === 0) {
      if (activeTool === 'fill') {
        const changed = floodFill(ctx, wx, wy);
        if (changed.length > 0) {
          redoStack = [];
          undoStack.push({ type: 'fill', pixels: changed, fillColor: currentColor });
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        }
        renderBlockyGrid();
      } else {
        isDrawing = true;
        lastSkinX = wx;
        lastSkinY = wy;
        const isEraser = activeTool === 'eraser';
        currentStroke = { pixels: [], isEraser, newColor: currentColor, recorded: new Set<string>() };
        brushAt(ctx, wx, wy, isEraser, currentStroke, RESOLUTION_MULTIPLIER, true);
        renderBlockyGrid();
      }
    } else if (e.type === 'mousemove' && isDrawing && activeTool !== 'fill' && currentStroke) {
      const isEraser = currentStroke.isEraser;
      drawLine(ctx, lastSkinX, lastSkinY, wx, wy, isEraser, currentStroke, RESOLUTION_MULTIPLIER, true);
      lastSkinX = wx;
      lastSkinY = wy;
      renderBlockyGrid();
    } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
      if (e.type === 'mouseup' && e.button === 0 && currentStroke) {
        if (currentStroke.pixels.length > 0) {
          redoStack = [];
          undoStack.push({
            type: 'stroke',
            pixels: currentStroke.pixels,
            isEraser: currentStroke.isEraser,
            newColor: currentStroke.newColor,
          });
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        }
        currentStroke = null;
        isDrawing = false;
        updateAllUndoRedoButtons();
      }
      if (e.type === 'mouseleave' && currentStroke && currentStroke.pixels.length > 0) {
        redoStack = [];
        undoStack.push({
          type: 'stroke',
          pixels: currentStroke.pixels,
          isEraser: currentStroke.isEraser,
          newColor: currentStroke.newColor,
        });
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        currentStroke = null;
        isDrawing = false;
        updateAllUndoRedoButtons();
      }
    }
  }

  grid.addEventListener('mousedown', handleBlockyPointer);
  grid.addEventListener('mousemove', handleBlockyPointer);
  grid.addEventListener('mouseup', handleBlockyPointer);
  grid.addEventListener('mouseleave', handleBlockyPointer);
  grid.title = 'Blocky 64×64 grid — drag to paint, Alt+click to pick color';
}

function fitCanvasAreaScale(): void {
  const area = document.getElementById('creator-canvas-area');
  const wrap = document.getElementById('creator-canvas-wrap');
  if (!area || !wrap) return;
  const areaRect = area.getBoundingClientRect();
  const hasRulers = wrap.hasAttribute('data-rulers');
  const size = hasRulers ? 532 : 512;
  const scale = Math.min(areaRect.width / size, areaRect.height / size);
  (wrap as HTMLElement).style.transform = `scale(${scale})`;
}

let layersPanel3DCollapsed = false;

/** Map part display name (e.g. "Right sleeve") to layer key (e.g. "sleeves"). */
function partToLayer(part: string): string | null {
  const m: Record<string, string> = {
    Head: 'head',
    Hat: 'hat',
    Body: 'body',
    Jacket: 'jacket',
    'Right leg': 'legs',
    'Left leg': 'legs',
    'Right pants': 'pants',
    'Left pants': 'pants',
    'Right arm': 'arms',
    'Left arm': 'arms',
    'Right sleeve': 'sleeves',
    'Left sleeve': 'sleeves',
  };
  return m[part] ?? null;
}

/** Update the hover info panel with current part and skin coords. Pass null to clear. */
export function updateHoverInfo(part: string | null, skinX: number, skinY: number): void {
  const panel = document.getElementById('creator-hover-info-panel');
  if (!panel) return;
  const textEl = panel.querySelector('.creator-hover-info-text');
  if (!textEl) return;
  if (part == null || skinX < 0 || skinY < 0) {
    textEl.textContent = '—';
  } else {
    textEl.textContent = `${part} (${skinX},${skinY})`;
  }
  const layersPanel = document.getElementById('creator-layers-panel-3d');
  if (layersPanel) {
    layersPanel.querySelectorAll('.creator-layers-panel-3d-row').forEach((row) => {
      const layer = (row as HTMLElement).dataset.layer;
      const shouldHighlight = part != null && partToLayer(part) === layer;
      row.classList.toggle('creator-layers-panel-3d-row-highlight', !!shouldHighlight);
    });
  }
}

function buildHoverInfoPanel(): void {
  const container = document.getElementById('creator-lower-right-panels') ?? document.getElementById('creator-view-wrapper');
  if (!container) return;

  let panel = document.getElementById('creator-hover-info-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'creator-hover-info-panel';
  panel.className = 'creator-hover-info-panel';
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Current skin part and coordinates');
  panel.innerHTML = '<span class="creator-hover-info-text">—</span>';

  container.appendChild(panel);
}

function buildLayersPanel3D(): void {
  const container = document.getElementById('creator-lower-right-panels') ?? document.getElementById('creator-view-wrapper');
  if (!container) return;

  let panel = document.getElementById('creator-layers-panel-3d');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'creator-layers-panel-3d';
  panel.className = 'creator-layers-panel-3d';
  panel.setAttribute('aria-label', '3D layers');
  panel.innerHTML = `
    <div class="creator-layers-panel-3d-header">
      <span class="creator-layers-panel-3d-title">Layers</span>
      <button type="button" class="creator-layers-panel-3d-toggle" title="Minimize panel" aria-label="Minimize panel">
        <span class="creator-layers-panel-3d-icon creator-layers-panel-3d-icon-minimize">▼</span>
        <span class="creator-layers-panel-3d-icon creator-layers-panel-3d-icon-expand">▲</span>
      </button>
    </div>
    <div class="creator-layers-panel-3d-list" role="group">
      ${LAYER_GROUPS.flatMap((group, i) => {
        const rows = group.map(
          (layer) =>
            `<div class="creator-layers-panel-3d-row" data-layer="${layer}">
            <span class="creator-layers-panel-3d-name">${layer.charAt(0).toUpperCase() + layer.slice(1)}</span>
            <label class="creator-layers-panel-3d-visibility" title="Visibility (eye): hide to paint underlying parts. Alt+click: solo this layer">
              <input type="checkbox" class="creator-layer-3d-visible" data-layer="${layer}" ${layer3DVisible[layer] ? 'checked' : ''}>
              <span class="creator-layer-eye" aria-hidden="true">👁</span>
            </label>
            <label class="creator-layers-panel-3d-lock" title="Lock: ignore brush/eraser/fill">
              <input type="checkbox" class="creator-layer-3d-lock" data-layer="${layer}" ${layer3DLocked[layer] ? 'checked' : ''}>
              <span class="creator-layer-lock" aria-hidden="true">🔒</span>
            </label>
          </div>`
        );
        const sep = i < LAYER_GROUPS.length - 1 ? '<div class="creator-layers-panel-3d-separator" aria-hidden="true"></div>' : '';
        return [...rows, sep];
      }).join('')}
    </div>
  `;

  panel.querySelectorAll('.creator-layers-panel-3d-visibility').forEach((label) => {
    const input = label.querySelector('.creator-layer-3d-visible') as HTMLInputElement;
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('click', (e) => {
      if ((e as MouseEvent).altKey) {
        e.preventDefault();
        handleVisibilityAltClick(layer);
        if (panel) {
          syncVisibilityCheckboxes(panel);
          updateSoloIndicator(panel);
        }
        return;
      }
    });
    input.addEventListener('change', () => {
      setLayer3DVisible(layer, input.checked);
    });
  });
  panel.querySelectorAll('.creator-layer-3d-lock').forEach((cb) => {
    cb.addEventListener('change', () => {
      const layer = (cb as HTMLElement).dataset.layer;
      if (layer) setLayer3DLocked(layer, (cb as HTMLInputElement).checked);
    });
  });

  setupDragToToggle(
    panel,
    '.creator-layers-panel-3d-visibility',
    '.creator-layer-3d-visible',
    (l) => layer3DVisible[l],
    (l, v) => setLayer3DVisible(l, v),
    (p) => {
      syncVisibilityCheckboxes(p);
      updateSoloIndicator(p);
    },
    (e) => !(e as MouseEvent).altKey
  );
  setupDragToToggle(
    panel,
    '.creator-layers-panel-3d-lock',
    '.creator-layer-3d-lock',
    (l) => layer3DLocked[l],
    (l, v) => setLayer3DLocked(l, v),
    syncLockCheckboxes
  );

  const toggleBtn = panel.querySelector('.creator-layers-panel-3d-toggle') as HTMLButtonElement;
  const updateCollapsedUI = () => {
    panel.classList.toggle('creator-layers-panel-3d-collapsed', layersPanel3DCollapsed);
    const minimizeIcon = panel.querySelector('.creator-layers-panel-3d-icon-minimize');
    const expandIcon = panel.querySelector('.creator-layers-panel-3d-icon-expand');
    if (minimizeIcon && expandIcon) {
      minimizeIcon.setAttribute('aria-hidden', String(layersPanel3DCollapsed));
      expandIcon.setAttribute('aria-hidden', String(!layersPanel3DCollapsed));
    }
    if (toggleBtn) {
      toggleBtn.title = layersPanel3DCollapsed ? 'Expand panel' : 'Minimize panel';
      toggleBtn.setAttribute('aria-label', layersPanel3DCollapsed ? 'Expand panel' : 'Minimize panel');
    }
  };
  toggleBtn?.addEventListener('click', () => {
    layersPanel3DCollapsed = !layersPanel3DCollapsed;
    updateCollapsedUI();
  });
  updateCollapsedUI();

  container.appendChild(panel);
}

function buildToolsPanel3D(): void {
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!wrapper) return;

  let panel = document.getElementById('creator-tools-panel-3d');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'creator-tools-panel-3d';
  panel.className = 'creator-tools-panel-3d';
  panel.setAttribute('aria-label', '3D tools');
  panel.innerHTML = `
    <div class="creator-tools-panel-3d-row creator-tools-panel-3d-edit-mode" role="group" aria-label="Edit mode">
      <button type="button" class="creator-tools-panel-3d-btn creator-tools-panel-3d-mode-btn" data-mode="2d" title="Edit on 2D canvas">2D</button>
      <button type="button" class="creator-tools-panel-3d-btn creator-tools-panel-3d-mode-btn" data-mode="3d" title="Edit on 3D model">3D</button>
    </div>
    <div class="creator-tools-panel-3d-row creator-tools-panel-3d-tools-row" role="group" aria-label="Drawing tools">
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="navigate" title="Navigate: orbit/zoom, no paint">Navigate</button>
      <div class="creator-tools-panel-3d-divider" aria-hidden="true"></div>
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="brush" title="Brush">Brush</button>
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="eraser" title="Eraser">Eraser</button>
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="fill" title="Fill">Fill</button>
    </div>
    <div class="creator-tools-panel-3d-row creator-tools-panel-3d-view-toggles" data-only-when="2d" role="group" aria-label="Canvas overlays">
      <div class="creator-tools-panel-3d-divider creator-tools-panel-3d-divider-2d-only" aria-hidden="true"></div>
      <button type="button" class="creator-tools-panel-3d-btn creator-tools-panel-3d-toggle-btn" data-toggle="rulers" title="Toggle rulers">Rulers</button>
      <button type="button" class="creator-tools-panel-3d-btn creator-tools-panel-3d-toggle-btn" data-toggle="template" title="Show template overlay">Template</button>
    </div>
    <div class="creator-tools-panel-3d-divider" aria-hidden="true"></div>
    <div class="creator-tools-panel-3d-row creator-tools-panel-3d-undo-redo" role="group" aria-label="Undo Redo">
      <button type="button" class="creator-tools-panel-3d-btn creator-tools-panel-3d-undo-btn" id="creator-tools-undo-btn" title="Undo (Ctrl+Z)" aria-label="Undo">↩</button>
      <button type="button" class="creator-tools-panel-3d-btn creator-tools-panel-3d-redo-btn" id="creator-tools-redo-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↪</button>
    </div>
  `;

  const updateToolActive = () => {
    panel.querySelectorAll('.creator-tools-panel-3d-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === activeTool);
    });
  };
  const updateViewTogglesRowVisibility = () => {
    const row = panel.querySelector('.creator-tools-panel-3d-view-toggles');
    if (row) row.classList.toggle('creator-tools-panel-3d-visible', !editMode3D);
  };
  const updateViewToggleButtons = () => {
    panel.querySelectorAll('.creator-tools-panel-3d-toggle-btn').forEach((btn) => {
      const t = (btn as HTMLElement).dataset.toggle;
      const isActive = (t === 'rulers' && showRulers) || (t === 'template' && showTemplate);
      btn.classList.toggle('active', !!isActive);
    });
  };
  const updateEditModeButtons = () => {
    panel.querySelectorAll('.creator-tools-panel-3d-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === (editMode3D ? '3d' : '2d'));
    });
  };

  panel.querySelectorAll('.creator-tools-panel-3d-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = (btn as HTMLElement).dataset.mode;
      editMode3D = m === '3d';
      document.body.dataset.editMode = editMode3D ? '3d' : '2d';
      (document.getElementById('creator-edit-2d-btn') as HTMLElement)?.classList.toggle('active', !editMode3D);
      (document.getElementById('creator-edit-3d-btn') as HTMLElement)?.classList.toggle('active', editMode3D);
      updateEditModeButtons();
      document.dispatchEvent(new CustomEvent('creator-edit-mode-change', { detail: { is3D: editMode3D } }));
    });
  });
  panel.querySelectorAll('.creator-tools-panel-3d-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTool((btn as HTMLElement).dataset.tool as Tool);
      updateToolActive();
    });
  });
  panel.querySelectorAll('.creator-tools-panel-3d-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = (btn as HTMLElement).dataset.toggle;
      if (t === 'rulers') showRulers = !showRulers;
      else if (t === 'template') showTemplate = !showTemplate;
      updateViewToggleButtons();
      renderToDisplay();
    });
  });
  (panel.querySelector('#creator-tools-undo-btn') as HTMLButtonElement)?.addEventListener('click', () => {
    performUndo();
    updateAllUndoRedoButtons();
  });
  (panel.querySelector('#creator-tools-redo-btn') as HTMLButtonElement)?.addEventListener('click', () => {
    performRedo();
    updateAllUndoRedoButtons();
  });

  document.addEventListener('creator-tools-3d-change', () => {
    updateToolActive();
    updateCanvasCursor();
  });
  document.addEventListener('creator-edit-mode-change', () => {
    updateEditModeButtons();
    updateViewTogglesRowVisibility();
  });

  updateToolActive();
  updateEditModeButtons();
  updateViewTogglesRowVisibility();
  updateViewToggleButtons();
  updateAllUndoRedoButtons();

  wrapper.appendChild(panel);
}

function setupCanvasAreaResize(): void {
  const area = document.getElementById('creator-canvas-area');
  if (!area) return;
  const update = () => {
    fitCanvasAreaScale();
    updateCanvasCursor();
  };
  fitCanvasAreaScale();
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

  ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  document.body.dataset.editMode = editMode3D ? '3d' : '2d';
  buildToolbar();
  const wrapper = document.getElementById('creator-view-wrapper');
  if (wrapper && !document.getElementById('creator-lower-right-panels')) {
    const container = document.createElement('div');
    container.id = 'creator-lower-right-panels';
    container.className = 'creator-lower-right-panels';
    wrapper.appendChild(container);
  }
  buildLayersPanel3D();
  buildHoverInfoPanel();
  buildToolsPanel3D();
  buildBlockyGrid();
  buildRulers();
  setupBlockyGridEvents();
  renderToDisplay();
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
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          performRedo();
        } else {
          performUndo();
        }
        updateAllUndoRedoButtons();
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
  return editMode3D;
}

/** 3D layers panel: visibility state (layer hidden = not rendered, brush ignored). */
export function getLayer3DVisible(): Record<string, boolean> {
  return { ...layer3DVisible };
}

/** 3D layers panel: lock state (locked = brush ignored, part stays visible). */
export function getLayer3DLocked(): Record<string, boolean> {
  return { ...layer3DLocked };
}

/** Set visibility for a layer and dispatch change event. */
export function setLayer3DVisible(layer: string, visible: boolean): void {
  if (LAYER_KEYS.includes(layer as (typeof LAYER_KEYS)[number])) {
    layer3DVisible[layer] = visible;
    document.dispatchEvent(new CustomEvent('creator-layer3d-change'));
  }
}

/** Set visibility for all layers at once (used by solo mode). */
function setLayer3DVisibleAll(visible: Record<string, boolean>): void {
  for (const k of LAYER_KEYS) {
    if (visible[k] !== undefined) layer3DVisible[k] = visible[k];
  }
  document.dispatchEvent(new CustomEvent('creator-layer3d-change'));
}

/** Sync visibility checkboxes from layer3DVisible (after batch changes). */
function syncVisibilityCheckboxes(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLInputElement>('.creator-layer-3d-visible').forEach((cb) => {
    const layer = cb.dataset.layer;
    if (layer && layer3DVisible[layer] !== undefined) cb.checked = layer3DVisible[layer];
  });
}

/** Sync lock checkboxes from layer3DLocked (after batch changes). */
function syncLockCheckboxes(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLInputElement>('.creator-layer-3d-lock').forEach((cb) => {
    const layer = cb.dataset.layer;
    if (layer && layer3DLocked[layer] !== undefined) cb.checked = layer3DLocked[layer];
  });
}

/** Get layer name from element under client coords, or null. */
function getLayerUnderPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest('.creator-layers-panel-3d-row');
  return (row as HTMLElement)?.dataset?.layer ?? null;
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
    const input = label.querySelector(inputSelector) as HTMLInputElement;
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('mousedown', (e) => {
      const me = e as MouseEvent;
      if (me.button !== 0 || !canStartDrag(me)) return;
      const startX = me.clientX;
      const startY = me.clientY;
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
        if (targetLayer && LAYER_KEYS.includes(targetLayer as (typeof LAYER_KEYS)[number])) {
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

/** Show "Solo: LayerName" in panel header when in solo mode. */
function updateSoloIndicator(panel: HTMLElement): void {
  let indicator = panel.querySelector('.creator-layers-panel-3d-solo-indicator') as HTMLElement | null;
  if (layer3DSoloMode && layer3DSoloCurrentLayer) {
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'creator-layers-panel-3d-solo-indicator';
      const title = panel.querySelector('.creator-layers-panel-3d-title');
      if (title) title.after(indicator);
    }
    indicator.textContent = `Solo: ${layer3DSoloCurrentLayer.charAt(0).toUpperCase() + layer3DSoloCurrentLayer.slice(1)}`;
  } else if (indicator) {
    indicator.textContent = '';
  }
}

/** Handle Alt+click on visibility: solo this layer or restore. */
function handleVisibilityAltClick(layer: string): void {
  if (layer3DSoloMode) {
    if (layer3DSoloCurrentLayer === layer) {
      if (layer3DSoloBeforeState) setLayer3DVisibleAll(layer3DSoloBeforeState);
      layer3DSoloMode = false;
      layer3DSoloBeforeState = null;
      layer3DSoloCurrentLayer = null;
    } else {
      layer3DSoloCurrentLayer = layer;
      const soloState = Object.fromEntries(LAYER_KEYS.map((k) => [k, k === layer]));
      setLayer3DVisibleAll(soloState);
    }
  } else {
    layer3DSoloBeforeState = { ...layer3DVisible };
    layer3DSoloCurrentLayer = layer;
    const soloState = Object.fromEntries(LAYER_KEYS.map((k) => [k, k === layer]));
    setLayer3DVisibleAll(soloState);
    layer3DSoloMode = true;
  }
}

/** Set lock for a layer and dispatch change event. */
export function setLayer3DLocked(layer: string, locked: boolean): void {
  if (LAYER_KEYS.includes(layer as (typeof LAYER_KEYS)[number])) {
    layer3DLocked[layer] = locked;
    document.dispatchEvent(new CustomEvent('creator-layer3d-change'));
  }
}

/** Active drawing tool (navigate = no paint, full orbit). */
export function getActiveTool(): Tool {
  return activeTool;
}

/** Set active tool and dispatch change event. */
export function setActiveTool(tool: Tool): void {
  activeTool = tool;
  document.dispatchEvent(new CustomEvent('creator-tools-3d-change'));
}

/** Brush size (fixed at 1 pixel for 3D; 1 grid cell for 2D blocky). */
export function getBrushSize(): number {
  return BRUSH_SIZE;
}

/** WORK_SIZE for UV→pixel mapping (texture is WORK_SIZE×WORK_SIZE). */
export function getCreatorWorkSize(): number {
  return WORK_SIZE;
}

/** UV (0–1) to working canvas coords. Texture uses flipY. */
export function uvToWorkingCoords(u: number, v: number): { x: number; y: number } {
  const x = Math.floor(u * WORK_SIZE);
  const y = Math.floor((1 - v) * WORK_SIZE);
  return {
    x: Math.max(0, Math.min(WORK_SIZE - 1, x)),
    y: Math.max(0, Math.min(WORK_SIZE - 1, y))
  };
}

/** Start paint/eraser stroke at working coords (or do fill if fill tool). Returns true if anything was done. */
export function paintStartFrom3D(workingX: number, workingY: number): boolean {
  if (activeTool === 'navigate') return false;
  if (!isInPaintable3DLayer(workingX, workingY)) return false;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  if (activeTool === 'fill') {
    const changed = floodFill(ctx, workingX, workingY);
    if (changed.length > 0) {
      redoStack = [];
      undoStack.push({ type: 'fill', pixels: changed, fillColor: currentColor });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    renderToDisplay();
    return changed.length > 0;
  }
  isDrawing = true;
  lastSkinX = workingX;
  lastSkinY = workingY;
  const isEraser = activeTool === 'eraser';
  currentStroke = { pixels: [], isEraser, newColor: currentColor, recorded: new Set<string>() };
  // Snap to cell top-left so we paint 2×2 = one full skin pixel (matches 2D blocky)
  const baseX = Math.floor(workingX / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
  const baseY = Math.floor(workingY / RESOLUTION_MULTIPLIER) * RESOLUTION_MULTIPLIER;
  brushAt(ctx, baseX, baseY, isEraser, currentStroke, RESOLUTION_MULTIPLIER, true);
  renderToDisplay();
  return true;
}

/** Continue paint stroke (call during drag). */
export function paintMoveFrom3D(workingX: number, workingY: number): void {
  if (!currentStroke || !isDrawing) return;
  if (!isInPaintable3DLayer(workingX, workingY)) return;
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const isEraser = currentStroke.isEraser;
  drawLine(ctx, lastSkinX, lastSkinY, workingX, workingY, isEraser, currentStroke, RESOLUTION_MULTIPLIER, true);
  lastSkinX = workingX;
  lastSkinY = workingY;
  renderToDisplay();
}

/** End paint stroke and push to undo stack. */
export function paintEndFrom3D(): void {
  if (currentStroke && currentStroke.pixels.length > 0) {
    redoStack = [];
    undoStack.push({
      type: 'stroke',
      pixels: currentStroke.pixels,
      isEraser: currentStroke.isEraser,
      newColor: currentStroke.newColor
    });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  currentStroke = null;
  isDrawing = false;
  renderToDisplay();
  updateAllUndoRedoButtons();
}

/** Sample color at working coords (eyedropper). Returns hex or null. */
export function sampleColorAt(workingX: number, workingY: number): string | null {
  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (workingX < 0 || workingX >= WORK_SIZE || workingY < 0 || workingY >= WORK_SIZE) return null;
  const d = ctx.getImageData(workingX, workingY, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
}

/** Apply sampled color to swatch and UI (call after sampleColorAt when user picked a color). */
export function applySampledColor(hex: string): void {
  currentColor = hex;
  addToSwatch(hex);
  const currentColorEl = document.querySelector('.creator-current-color') as HTMLElement;
  const hexInput = document.querySelector('.creator-hex-input') as HTMLInputElement;
  const swatchEl = document.querySelector('.creator-swatch');
  if (currentColorEl) currentColorEl.style.backgroundColor = hex;
  if (hexInput) hexInput.value = hex;
  if (swatchEl) {
    swatchEl.innerHTML = swatchColors
      .map((c) => `<button type="button" class="creator-swatch-item" style="background-color:${c}" data-color="${c}" title="${c}"></button>`)
      .join('');
    swatchEl.querySelectorAll('.creator-swatch-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentColor = (btn as HTMLElement).dataset.color || currentColor;
        addToSwatch(currentColor);
        (document.querySelector('.creator-current-color') as HTMLElement)!.style.backgroundColor = currentColor;
        ((document.querySelector('.creator-hex-input') as HTMLInputElement)!).value = currentColor;
      });
    });
  }
}

/**
 * Export the skin downscaled to 64×64 PNG. Uses nearest-neighbor for pixel-perfect output.
 */
export function exportTo64x64DataURL(): string {
  const working = getSkinCanvas();
  const out = document.createElement('canvas');
  out.width = SKIN_SIZE;
  out.height = SKIN_SIZE;
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(working, 0, 0, WORK_SIZE, WORK_SIZE, 0, 0, SKIN_SIZE, SKIN_SIZE);
  return out.toDataURL('image/png');
}
