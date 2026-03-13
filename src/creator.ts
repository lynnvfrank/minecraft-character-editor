/**
 * Character creator: higher-res working canvas, 64×64 export.
 * Step 2–6: Route, shell, canvas, brush, eraser, fill, layers.
 * Step 7: Undo/Redo.
 * Resolution: work at WORK_SIZE (e.g. 128×128), export downscaled to 64×64.
 */

import { SKIN_SIZE, SKIN_LAYER_BOUNDS, type Bounds } from './skinLayout';

const RESOLUTION_MULTIPLIER = 2;
const UNDO_LIMIT = 50;
const WORK_SIZE = SKIN_SIZE * RESOLUTION_MULTIPLIER;
const ZOOM = 4;
const DISPLAY_SIZE = WORK_SIZE * ZOOM;
const SWATCH_MAX = 12;
const DEFAULT_COLOR = '#8b7355';
const LAYER_KEYS = ['head', 'hat', 'body', 'jacket', 'arms', 'sleeves', 'legs', 'pants'] as const;

/** 3D mode: visibility per layer (hidden = not rendered, brush ignored). Default true. */
const layer3DVisible: Record<string, boolean> = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));
/** 3D mode: lock per layer (locked = brush ignored, part stays visible). Default false. */
const layer3DLocked: Record<string, boolean> = Object.fromEntries(LAYER_KEYS.map((k) => [k, false]));
const RULER_SIZE = 20;

/** Ruler: 0,0 upper-left to 64,64 lower-right. Toggleable. */
let showRulers = false;
/** Grid: every 4 lines by default. Toggleable. Extensible settings. */
let showGrid = false;
/** Template overlay: region outlines for model-to-2D mapping. Toggleable. Non-destructive. */
let showTemplate = false;
/** Edit mode: true = paint on 3D model, false = paint on 2D canvas */
let editMode3D = true;
const gridConfig = {
  spacingX: 4,
  spacingY: 4,
  color: 'rgba(255,255,255,0.25)',
  lineWidth: 1
};

export type Tool = 'brush' | 'eraser' | 'fill' | 'navigate';

let skinCanvas: HTMLCanvasElement | null = null;

let currentColor = DEFAULT_COLOR;
let brushSize = 2;
let swatchColors: string[] = [DEFAULT_COLOR];
let isDrawing = false;
let lastSkinX = -1;
let lastSkinY = -1;
let activeTool: Tool = 'brush';
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

function getSkinCanvas(): HTMLCanvasElement {
  if (!skinCanvas) {
    skinCanvas = document.createElement('canvas');
    skinCanvas.width = WORK_SIZE;
    skinCanvas.height = WORK_SIZE;
  }
  return skinCanvas;
}

function getDisplayCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-display-canvas') as HTMLCanvasElement | null;
}

function getOverlayCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-overlay-canvas') as HTMLCanvasElement | null;
}

function getRulerTopCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-ruler-top') as HTMLCanvasElement | null;
}

function getRulerLeftCanvas(): HTMLCanvasElement | null {
  return document.getElementById('creator-ruler-left') as HTMLCanvasElement | null;
}

/** Returns CSS cursor value for brush: box outline. Hotspot center. */
function makeBrushCursorSVG(boxPx: number): string {
  const cursorSize = 64;
  const x = (cursorSize - boxPx) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}"><rect x="${x}" y="${x}" width="${boxPx}" height="${boxPx}" fill="none" stroke="white" stroke-width="1"/></svg>`;
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27');
  return `url("data:image/svg+xml,${encoded}") ${cursorSize / 2} ${cursorSize / 2}, crosshair`;
}

/** Returns CSS cursor value for brush: box outline, size matches on-screen brush size (2D). */
function getBrushCursorStyle(size: number): string {
  const canvas = getDisplayCanvas();
  const rect = canvas?.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const boxPx = rect
    ? Math.max(2, (size * (rect.width / WORK_SIZE)) / dpr)
    : size * (DISPLAY_SIZE / WORK_SIZE) / dpr;
  return makeBrushCursorSVG(boxPx);
}

/** Returns CSS cursor for 3D viewport: fixed screen-space box (8px per brush size unit). */
export function getBrushCursorStyleFor3D(size: number): string {
  const boxPx = Math.max(8, size * 8);
  return makeBrushCursorSVG(boxPx);
}

function updateCanvasCursor(): void {
  const disp = getDisplayCanvas();
  if (!disp) return;
  disp.style.cursor = getBrushCursorStyle(brushSize);
}

/** Convert client/screen coords to working-canvas pixel coords. */
function clientToSkin(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = getDisplayCanvas();
  if (!canvas) return { x: -1, y: -1 };
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const px = Math.floor((localX / rect.width) * WORK_SIZE);
  const py = Math.floor((localY / rect.height) * WORK_SIZE);
  return { x: Math.max(0, Math.min(WORK_SIZE - 1, px)), y: Math.max(0, Math.min(WORK_SIZE - 1, py)) };
}

/**
 * Draw a square block brush at (sx, sy) on the skin canvas.
 * If stroke is provided, records previous pixel values for undo.
 */
function brushAt(
  skinCtx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  isEraser = false,
  stroke?: { pixels: PixelChange[]; isEraser: boolean; newColor: string; recorded: Set<string> } | null
): void {
  const offset = Math.floor(brushSize / 2);
  for (let dy = 0; dy < brushSize; dy++) {
    for (let dx = 0; dx < brushSize; dx++) {
      const px = sx - offset + dx;
      const py = sy - offset + dy;
      if (
        px >= 0 &&
        px < WORK_SIZE &&
        py >= 0 &&
        py < WORK_SIZE &&
        isInSelectedLayer(px, py)
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
  if (!isInSelectedLayer(sx, sy)) return changed;
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
    if (!isInSelectedLayer(x, y)) continue;
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
  const undoBtn = document.getElementById('creator-undo-btn') as HTMLButtonElement | null;
  const redoBtn = document.getElementById('creator-redo-btn') as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
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
 */
function drawLine(
  skinCtx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isEraser = false,
  stroke?: { pixels: PixelChange[]; isEraser: boolean; newColor: string; recorded: Set<string> } | null
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  while (true) {
    brushAt(skinCtx, x, y, isEraser, stroke);
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

/**
 * Render the 64×64 skin to the display canvas (zoomed, pixel-perfect).
 * Draws dim overlay on non-selected layer regions.
 */
function renderToDisplay(): void {
  const disp = getDisplayCanvas();
  const skin = getSkinCanvas();
  if (!disp || !disp.getContext('2d')) return;

  const ctx = disp.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  disp.width = DISPLAY_SIZE;
  disp.height = DISPLAY_SIZE;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
  ctx.drawImage(skin, 0, 0, WORK_SIZE, WORK_SIZE, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

  if (restrictToLayers && selectedLayers.size > 0 && selectedLayers.size < LAYER_KEYS.length) {
    const displayScale = DISPLAY_SIZE / WORK_SIZE;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (const layer of LAYER_KEYS) {
      if (selectedLayers.has(layer)) continue;
      const bounds = SKIN_LAYER_BOUNDS[layer];
      if (!bounds) continue;
      for (const b of bounds) {
        const sx = b.x * RESOLUTION_MULTIPLIER * displayScale;
        const sy = b.y * RESOLUTION_MULTIPLIER * displayScale;
        const sw = b.w * RESOLUTION_MULTIPLIER * displayScale;
        const sh = b.h * RESOLUTION_MULTIPLIER * displayScale;
        ctx.fillRect(sx, sy, sw, sh);
      }
    }
  }

  renderRulersAndGrid();
}

/** Skin space 0-64 maps to display 0..DISPLAY_SIZE. */
const RULER_SCALE = DISPLAY_SIZE / SKIN_SIZE;

function renderRulersAndGrid(): void {
  const overlay = getOverlayCanvas();
  const topRuler = getRulerTopCanvas();
  const leftRuler = getRulerLeftCanvas();

  if (overlay) {
    const ctx = overlay.getContext('2d');
    if (ctx) {
      overlay.width = DISPLAY_SIZE;
      overlay.height = DISPLAY_SIZE;
      ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
      if (showGrid) {
        ctx.strokeStyle = gridConfig.color;
        ctx.lineWidth = gridConfig.lineWidth;
        ctx.beginPath();
        for (let s = 0; s <= SKIN_SIZE; s += gridConfig.spacingX) {
          const x = s * RULER_SCALE;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, DISPLAY_SIZE);
        }
        for (let s = 0; s <= SKIN_SIZE; s += gridConfig.spacingY) {
          const y = s * RULER_SCALE;
          ctx.moveTo(0, y);
          ctx.lineTo(DISPLAY_SIZE, y);
        }
        ctx.stroke();
      }
      if (showTemplate) {
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(100, 200, 255, 0.2)';
        for (const bounds of Object.values(SKIN_LAYER_BOUNDS)) {
          for (const b of bounds) {
            const x = b.x * RULER_SCALE;
            const y = b.y * RULER_SCALE;
            const w = b.w * RULER_SCALE;
            const h = b.h * RULER_SCALE;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
          }
        }
      }
    }
  }

  const tickColor = 'rgba(255,255,255,0.7)';
  const labelColor = 'rgba(255,255,255,0.9)';

  if (showRulers && topRuler) {
    const ctx = topRuler.getContext('2d');
    if (ctx) {
      topRuler.width = DISPLAY_SIZE;
      topRuler.height = RULER_SIZE;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, DISPLAY_SIZE, RULER_SIZE);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let s = 0; s <= SKIN_SIZE; s += 4) {
        const px = s * RULER_SCALE;
        const isMajor = s % 8 === 0;
        ctx.strokeStyle = tickColor;
        ctx.fillStyle = tickColor;
        ctx.lineWidth = 1;
        if (px < DISPLAY_SIZE) {
          ctx.beginPath();
          ctx.moveTo(px, RULER_SIZE);
          ctx.lineTo(px, RULER_SIZE - (isMajor ? 10 : 5));
          ctx.stroke();
        }
        if (isMajor && px <= DISPLAY_SIZE - 4) {
          ctx.fillStyle = labelColor;
          ctx.fillText(String(s), px + (gridConfig.spacingX * RULER_SCALE) / 2, 2);
        }
      }
    }
  } else if (topRuler) {
    const ctx = topRuler.getContext('2d');
    ctx?.clearRect(0, 0, topRuler.width, topRuler.height);
  }

  if (showRulers && leftRuler) {
    const ctx = leftRuler.getContext('2d');
    if (ctx) {
      leftRuler.width = RULER_SIZE;
      leftRuler.height = DISPLAY_SIZE;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, RULER_SIZE, DISPLAY_SIZE);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let s = 0; s <= SKIN_SIZE; s += 4) {
        const py = s * RULER_SCALE;
        const isMajor = s % 8 === 0;
        ctx.strokeStyle = tickColor;
        ctx.fillStyle = tickColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE, py);
        ctx.lineTo(RULER_SIZE - (isMajor ? 10 : 5), py);
        ctx.stroke();
        if (isMajor && py <= DISPLAY_SIZE - 4) {
          ctx.fillStyle = labelColor;
          ctx.fillText(String(s), RULER_SIZE - 4, py + (gridConfig.spacingY * RULER_SCALE) / 2);
        }
      }
    }
  } else if (leftRuler) {
    const ctx = leftRuler.getContext('2d');
    ctx?.clearRect(0, 0, leftRuler.width, leftRuler.height);
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
      <span class="creator-toolbar-label">Edit</span>
      <div class="creator-undo-redo" role="group" aria-label="Undo Redo">
        <button type="button" class="creator-tool-btn" id="creator-undo-btn" title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" class="creator-tool-btn" id="creator-redo-btn" title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      <span class="creator-toolbar-label">Tools</span>
      <div class="creator-tools" role="group" aria-label="Drawing tools">
        <button type="button" class="creator-tool-btn creator-tool" data-tool="brush" title="Brush">Brush</button>
        <button type="button" class="creator-tool-btn creator-tool" data-tool="eraser" title="Eraser">Eraser</button>
        <button type="button" class="creator-tool-btn creator-tool" data-tool="fill" title="Fill">Fill</button>
      </div>
      <span class="creator-toolbar-label">Brush</span>
      <div class="creator-brush-sizes" role="group" aria-label="Brush size">
        ${[1, 2, 4, 8].map((s) => `<button type="button" class="creator-tool-btn creator-brush-size" data-size="${s}" title="${s}px">${s}</button>`).join('')}
      </div>
      <span class="creator-toolbar-label">Color</span>
      <div class="creator-current-color" title="Current color"></div>
      <input type="text" class="creator-hex-input" value="${currentColor}" maxlength="7" placeholder="#RRGGBB" aria-label="Hex color">
      <span class="creator-toolbar-label">Swatch</span>
      <div class="creator-swatch" role="group" aria-label="Color swatch"></div>
      <span class="creator-toolbar-label">View</span>
      <span class="creator-toolbar-label">Edit</span>
      <div class="creator-edit-mode" role="group" aria-label="Edit mode">
        <button type="button" class="creator-tool-btn creator-edit-mode-btn" id="creator-edit-2d-btn" data-mode="2d" title="Edit on 2D canvas">2D</button>
        <button type="button" class="creator-tool-btn creator-edit-mode-btn" id="creator-edit-3d-btn" data-mode="3d" title="Edit on 3D model">3D</button>
      </div>
      <span class="creator-toolbar-label">View</span>
      <div class="creator-view-toggles" role="group" aria-label="Canvas overlays">
        <button type="button" class="creator-tool-btn creator-toggle" id="creator-rulers-btn" data-toggle="rulers" title="Toggle rulers">Rulers</button>
        <button type="button" class="creator-tool-btn creator-toggle" id="creator-grid-btn" data-toggle="grid" title="Toggle grid">Grid</button>
        <button type="button" class="creator-tool-btn creator-toggle" id="creator-template-btn" data-toggle="template" title="Show template overlay for skin layout reference">Template</button>
      </div>
    </div>
    <div class="creator-toolbar-row creator-layers-row">
      <span class="creator-toolbar-label">Layers</span>
      <label class="creator-layer-check creator-restrict-toggle" title="When off, you can draw anywhere on the canvas">
        <input type="checkbox" id="creator-restrict-layers" ${restrictToLayers ? 'checked' : ''}>
        <span>Restrict to layers</span>
      </label>
      <div class="creator-layers" role="group" aria-label="Skin layers">
        ${LAYER_KEYS.map((l) => `<label class="creator-layer-check"><input type="checkbox" data-layer="${l}" ${selectedLayers.has(l) ? 'checked' : ''}><span>${l.charAt(0).toUpperCase() + l.slice(1)}</span></label>`).join('')}
      </div>
    </div>
  `;

  const undoBtn = document.getElementById('creator-undo-btn') as HTMLButtonElement | null;
  const redoBtn = document.getElementById('creator-redo-btn') as HTMLButtonElement | null;
  const updateUndoRedoButtons = () => {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  };
  undoBtn?.addEventListener('click', () => { performUndo(); updateUndoRedoButtons(); });
  redoBtn?.addEventListener('click', () => { performRedo(); updateUndoRedoButtons(); });
  updateUndoRedoButtons();

  toolbar.querySelectorAll('.creator-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = (btn as HTMLElement).dataset.tool as Tool;
      setActiveTool(tool);
      toolbar.querySelectorAll('.creator-tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  (toolbar.querySelector('.creator-tool[data-tool="brush"]') as HTMLElement)?.classList.add('active');

  const restrictCb = document.getElementById('creator-restrict-layers') as HTMLInputElement | null;
  restrictCb?.addEventListener('change', () => {
    restrictToLayers = restrictCb.checked;
    renderToDisplay();
  });

  toolbar.querySelectorAll('.creator-layer-check input[data-layer]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const layer = (cb as HTMLInputElement).dataset.layer;
      if (!layer) return;
      if ((cb as HTMLInputElement).checked) {
        selectedLayers.add(layer);
      } else {
        selectedLayers.delete(layer);
      }
      renderToDisplay();
    });
  });

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

  toolbar.querySelectorAll('.creator-brush-size').forEach((btn) => {
    btn.addEventListener('click', () => {
      const size = parseInt((btn as HTMLElement).dataset.size || '2', 10);
      setBrushSize(size);
      toolbar.querySelectorAll('.creator-brush-size').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateCanvasCursor();
    });
  });
  (toolbar.querySelector(`.creator-brush-size[data-size="${brushSize}"]`) as HTMLElement)?.classList.add('active');

  const updateToggleButtons = () => {
    (document.getElementById('creator-rulers-btn') as HTMLElement)?.classList.toggle('active', showRulers);
    (document.getElementById('creator-grid-btn') as HTMLElement)?.classList.toggle('active', showGrid);
    (document.getElementById('creator-template-btn') as HTMLElement)?.classList.toggle('active', showTemplate);
  };
  toolbar.querySelectorAll('.creator-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = (btn as HTMLElement).dataset.toggle;
      if (t === 'rulers') showRulers = !showRulers;
      else if (t === 'grid') showGrid = !showGrid;
      else if (t === 'template') showTemplate = !showTemplate;
      updateToggleButtons();
      renderToDisplay();
    });
  });
  toolbar.querySelectorAll('.creator-edit-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = (btn as HTMLElement).dataset.mode;
      editMode3D = m === '3d';
      document.body.dataset.editMode = editMode3D ? '3d' : '2d';
      (document.getElementById('creator-edit-2d-btn') as HTMLElement)?.classList.toggle('active', !editMode3D);
      (document.getElementById('creator-edit-3d-btn') as HTMLElement)?.classList.toggle('active', editMode3D);
      document.dispatchEvent(new CustomEvent('creator-edit-mode-change', { detail: { is3D: editMode3D } }));
    });
  });
  (document.getElementById('creator-edit-2d-btn') as HTMLElement)?.classList.toggle('active', !editMode3D);
  (document.getElementById('creator-edit-3d-btn') as HTMLElement)?.classList.toggle('active', editMode3D);
  updateToggleButtons();

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

function setupCanvasEvents(): void {
  const disp = getDisplayCanvas();
  const skin = getSkinCanvas();
  const skinCtx = skin.getContext('2d', { willReadFrequently: true });
  if (!disp || !skinCtx) return;
  const ctx = skinCtx;

  function handlePointer(e: MouseEvent): void {
    const { x, y } = clientToSkin(e.clientX, e.clientY);

    if (e.altKey) {
      const data = ctx.getImageData(x, y, 1, 1).data;
      const hex = rgbToHex(data[0], data[1], data[2]);
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

    if (e.type === 'mousedown' && e.button === 0) {
      if (activeTool === 'fill') {
        const changed = floodFill(ctx, x, y);
        if (changed.length > 0) {
          redoStack = [];
          undoStack.push({ type: 'fill', pixels: changed, fillColor: currentColor });
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        }
        renderToDisplay();
      } else {
        isDrawing = true;
        lastSkinX = x;
        lastSkinY = y;
        const isEraser = activeTool === 'eraser';
        currentStroke = { pixels: [], isEraser, newColor: currentColor, recorded: new Set<string>() };
        brushAt(ctx, x, y, isEraser, currentStroke);
        renderToDisplay();
      }
    } else if (e.type === 'mousemove' && isDrawing && activeTool !== 'fill' && currentStroke) {
      const isEraser = activeTool === 'eraser';
      drawLine(ctx, lastSkinX, lastSkinY, x, y, isEraser, currentStroke);
      lastSkinX = x;
      lastSkinY = y;
      renderToDisplay();
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
        const ub = document.getElementById('creator-undo-btn') as HTMLButtonElement | null;
        const rb = document.getElementById('creator-redo-btn') as HTMLButtonElement | null;
        if (ub) ub.disabled = undoStack.length === 0;
        if (rb) rb.disabled = redoStack.length === 0;
      }
      if (e.type === 'mouseleave') {
        if (currentStroke && currentStroke.pixels.length > 0) {
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
      }
    }
  }

  disp.addEventListener('mousedown', handlePointer);
  disp.addEventListener('mousemove', handlePointer);
  disp.addEventListener('mouseup', handlePointer);
  disp.addEventListener('mouseleave', handlePointer);

  updateCanvasCursor();
  disp.title = 'Skin canvas — drag to paint, Alt+click to pick color, use Fill tool for flood fill';
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

function buildLayersPanel3D(): void {
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!wrapper) return;

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
      ${LAYER_KEYS.map(
        (layer) =>
          `<div class="creator-layers-panel-3d-row" data-layer="${layer}">
          <span class="creator-layers-panel-3d-name">${layer.charAt(0).toUpperCase() + layer.slice(1)}</span>
          <label class="creator-layers-panel-3d-visibility" title="Visibility (eye): hide to paint underlying parts">
            <input type="checkbox" class="creator-layer-3d-visible" data-layer="${layer}" ${layer3DVisible[layer] ? 'checked' : ''}>
            <span class="creator-layer-eye" aria-hidden="true">👁</span>
          </label>
          <label class="creator-layers-panel-3d-lock" title="Lock: ignore brush/eraser/fill">
            <input type="checkbox" class="creator-layer-3d-lock" data-layer="${layer}" ${layer3DLocked[layer] ? 'checked' : ''}>
            <span class="creator-layer-lock" aria-hidden="true">🔒</span>
          </label>
        </div>`
      ).join('')}
    </div>
  `;

  panel.querySelectorAll('.creator-layer-3d-visible').forEach((cb) => {
    cb.addEventListener('change', () => {
      const layer = (cb as HTMLElement).dataset.layer;
      if (layer) setLayer3DVisible(layer, (cb as HTMLInputElement).checked);
    });
  });
  panel.querySelectorAll('.creator-layer-3d-lock').forEach((cb) => {
    cb.addEventListener('change', () => {
      const layer = (cb as HTMLElement).dataset.layer;
      if (layer) setLayer3DLocked(layer, (cb as HTMLInputElement).checked);
    });
  });

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

  wrapper.appendChild(panel);
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
    <div class="creator-tools-panel-3d-row" role="group" aria-label="Drawing tools">
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="navigate" title="Navigate: orbit/zoom, no paint">Navigate</button>
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="brush" title="Brush">Brush</button>
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="eraser" title="Eraser">Eraser</button>
      <button type="button" class="creator-tools-panel-3d-btn" data-tool="fill" title="Fill">Fill</button>
    </div>
    <div class="creator-tools-panel-3d-brush-row" data-only-when="brush" role="group" aria-label="Brush size">
      <span class="creator-tools-panel-3d-label">Brush</span>
      <div class="creator-tools-panel-3d-sizes">
        ${[1, 2, 4, 8].map((s) => `<button type="button" class="creator-tools-panel-3d-size-btn" data-size="${s}" title="${s}px"><span class="creator-tools-panel-3d-brush-icon" style="width:${s * 3}px;height:${s * 3}px"></span></button>`).join('')}
      </div>
    </div>
  `;

  const updateToolActive = () => {
    panel.querySelectorAll('.creator-tools-panel-3d-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === activeTool);
    });
  };
  const updateBrushActive = () => {
    panel.querySelectorAll('.creator-tools-panel-3d-size-btn').forEach((btn) => {
      btn.classList.toggle('active', parseInt((btn as HTMLElement).dataset.size || '0', 10) === brushSize);
    });
  };
  const updateBrushRowVisibility = () => {
    const row = panel.querySelector('.creator-tools-panel-3d-brush-row');
    if (row) row.classList.toggle('creator-tools-panel-3d-visible', activeTool === 'brush');
  };

  panel.querySelectorAll('.creator-tools-panel-3d-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTool((btn as HTMLElement).dataset.tool as Tool);
      updateToolActive();
      updateBrushRowVisibility();
    });
  });
  panel.querySelectorAll('.creator-tools-panel-3d-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const size = parseInt((btn as HTMLElement).dataset.size || '2', 10);
      setBrushSize(size);
      updateBrushActive();
    });
  });

  document.addEventListener('creator-tools-3d-change', () => {
    updateToolActive();
    updateBrushActive();
    updateBrushRowVisibility();
  });

  updateToolActive();
  updateBrushActive();
  updateBrushRowVisibility();

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
  const disp = getDisplayCanvas();
  if (!disp) return;

  const skin = getSkinCanvas();
  const ctx = skin.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  document.body.dataset.editMode = editMode3D ? '3d' : '2d';
  buildToolbar();
  buildLayersPanel3D();
  buildToolsPanel3D();
  renderToDisplay();
  setupCanvasEvents();
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
        const ub = document.getElementById('creator-undo-btn') as HTMLButtonElement | null;
        const rb = document.getElementById('creator-redo-btn') as HTMLButtonElement | null;
        if (ub) ub.disabled = undoStack.length === 0;
        if (rb) rb.disabled = redoStack.length === 0;
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

/** Brush size (1, 2, 4, 8). */
export function getBrushSize(): number {
  return brushSize;
}

/** Set brush size and dispatch change event. */
export function setBrushSize(size: number): void {
  if ([1, 2, 4, 8].includes(size)) {
    brushSize = size;
    document.dispatchEvent(new CustomEvent('creator-tools-3d-change'));
  }
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
  brushAt(ctx, workingX, workingY, isEraser, currentStroke);
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
  drawLine(ctx, lastSkinX, lastSkinY, workingX, workingY, isEraser, currentStroke);
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
  const ub = document.getElementById('creator-undo-btn') as HTMLButtonElement | null;
  const rb = document.getElementById('creator-redo-btn') as HTMLButtonElement | null;
  if (ub) ub.disabled = undoStack.length === 0;
  if (rb) rb.disabled = redoStack.length === 0;
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
