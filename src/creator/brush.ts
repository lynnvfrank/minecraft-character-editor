/**
 * Brush, eraser, fill logic and brush cursor helpers.
 * Receives canPaintAt and getCurrentColor via context to avoid coupling to state.
 */

import { WORK_SIZE, RESOLUTION_MULTIPLIER } from '../skin';
import { hexToRgb } from '../lib/color';
import type { PixelChange } from '../state/creatorState';

export type CanPaintAt = (workingX: number, workingY: number) => boolean;
export type GetCurrentColor = () => string;

export type StrokeRecord = {
  pixels: PixelChange[];
  isEraser: boolean;
  newColor: string;
  recorded: Set<string>;
};

const CURSOR_CANVAS_PAD = 4;
/** Most engines cap custom cursors ~128×128; scale down outlines that would clip. */
const CURSOR_MAX_DIM = 120;

function fitBoxInCursorCanvas(boxW: number, boxH: number): {
  w: number;
  h: number;
  cw: number;
  ch: number;
  x: number;
  y: number;
  hotX: number;
  hotY: number;
} {
  let w = Math.round(Math.max(2, boxW));
  let h = Math.round(Math.max(2, boxH));
  const maxInner = CURSOR_MAX_DIM - CURSOR_CANVAS_PAD * 2;
  if (w > maxInner || h > maxInner) {
    const s = Math.min(maxInner / w, maxInner / h);
    w = Math.max(2, Math.round(w * s));
    h = Math.max(2, Math.round(h * s));
  }
  const cw = Math.max(64, Math.min(128, w + CURSOR_CANVAS_PAD * 2));
  const ch = Math.max(64, Math.min(128, h + CURSOR_CANVAS_PAD * 2));
  const x = Math.round((cw - w) / 2);
  const y = Math.round((ch - h) / 2);
  /** Hotspot = center of stroked box so the pointer matches the brush center (not canvas center if rounding shifts the rect). */
  const hotX = Math.round(x + w / 2);
  const hotY = Math.round(y + h / 2);
  return { w, h, cw, ch, x, y, hotX, hotY };
}

/** Returns CSS cursor value for brush: box outline. Hotspot center. Uses PNG to avoid SVG ghosting on Mac. */
export function makeBrushCursorSVG(boxPx: number): string {
  const { w, cw, ch, x, y, hotX, hotY } = fitBoxInCursorCanvas(boxPx, boxPx);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><rect x="${x}" y="${y}" width="${w}" height="${w}" fill="none" stroke="white" stroke-width="1"/></svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27');
    return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}, crosshair`;
  }
  ctx.clearRect(0, 0, cw, ch);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, w - 1));
  const png = canvas.toDataURL('image/png');
  return `url("${png}") ${hotX} ${hotY}, crosshair`;
}

/** Rectangular outline cursor (hotspot center of image). Canvas grows with box so nothing clips. */
export function makeBrushCursorSVGRect(boxW: number, boxH: number): string {
  const { w, h, cw, ch, x, y, hotX, hotY } = fitBoxInCursorCanvas(boxW, boxH);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="white" stroke-width="1"/></svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27');
    return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}, crosshair`;
  }
  ctx.clearRect(0, 0, cw, ch);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  const png = canvas.toDataURL('image/png');
  return `url("${png}") ${hotX} ${hotY}, crosshair`;
}

/** Returns CSS cursor for 3D viewport: fixed screen-space box (8px per brush size unit). */
export function getBrushCursorStyleFor3D(size: number): string {
  const boxPx = Math.max(8, size * 8);
  return makeBrushCursorSVG(boxPx);
}

/**
 * 3D viewport cursor for soft brush: {@link getBrushCursorStyleFor3D} uses 8 CSS px per 1×1 pencil
 * (one skin column on the 512px-wide reference). Soft-brush `width`/`height` are **working** texels
 * (128× canvas), so use 4 CSS px per unit — same ratio as 2D after {@link getPaintBrushCursorStyle2D}.
 */
export function getPaintBrushCursorStyleFor3D(brushW: number, brushH: number): string {
  const boxW = Math.max(8, brushW * 4);
  const boxH = Math.max(8, brushH * 4);
  return makeBrushCursorSVGRect(boxW, boxH);
}

/**
 * 2D grid cursor for soft brush. `gridWidth / skinSpan` is CSS px per **skin** column (or packed row);
 * brush `width`/`height` are **working** pixels ({@link WORK_SIZE}), so scale by 1/{@link RESOLUTION_MULTIPLIER}.
 * Do not divide by `devicePixelRatio` — that broke alignment vs the grid.
 */
export function getPaintBrushCursorStyle2D(
  gridWidth: number,
  skinSize: number,
  fallbackCellPx: number,
  brushW: number,
  brushH: number
): string {
  const cellPxSkin = gridWidth > 0 ? gridWidth / skinSize : fallbackCellPx;
  const pxPerWorking = cellPxSkin / RESOLUTION_MULTIPLIER;
  const boxW = Math.max(2, pxPerWorking * brushW);
  const boxH = Math.max(2, pxPerWorking * brushH);
  return makeBrushCursorSVGRect(boxW, boxH);
}

/** Returns CSS cursor for 2D blocky grid. Cell size from grid rect or fallback. */
export function getBrushCursorStyle2D(
  gridWidth: number,
  skinSize: number,
  fallbackCellPx: number
): string {
  const cellPx = gridWidth > 0 ? gridWidth / skinSize : fallbackCellPx;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const boxPx = Math.max(2, cellPx / dpr);
  return makeBrushCursorSVG(boxPx);
}

/**
 * Draw a square block brush at (sx, sy) on the skin canvas.
 * If stroke is provided, records previous pixel values for undo.
 */
export function brushAt(
  skinCtx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  isEraser: boolean,
  canPaintAt: CanPaintAt,
  getCurrentColor: GetCurrentColor,
  stroke?: StrokeRecord | null,
  size = 1,
  alignTopLeft = false
): void {
  const offset = alignTopLeft ? 0 : Math.floor(size / 2);
  const startX = sx - offset;
  const startY = sy - offset;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = startX + dx;
      const py = startY + dy;
      if (px >= 0 && px < WORK_SIZE && py >= 0 && py < WORK_SIZE && canPaintAt(px, py)) {
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
          skinCtx.fillStyle = stroke?.newColor ?? getCurrentColor();
          skinCtx.fillRect(px, py, 1, 1);
        }
      }
    }
  }
}

/** Stack-based flood fill. Restricts to canPaintAt. Returns changed pixels for undo. */
export function floodFill(
  skinCtx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  canPaintAt: CanPaintAt,
  getCurrentColor: GetCurrentColor
): PixelChange[] {
  const changed: PixelChange[] = [];
  if (!canPaintAt(sx, sy)) return changed;
  const imageData = skinCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
  const data = imageData.data;
  const i0 = (sy * WORK_SIZE + sx) * 4;
  const targetR = data[i0];
  const targetG = data[i0 + 1];
  const targetB = data[i0 + 2];
  const targetA = data[i0 + 3];
  const [fillR, fillG, fillB] = hexToRgb(getCurrentColor());
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
    if (!canPaintAt(x, y)) continue;
    const i = idx(x, y);
    if (!match(i)) continue;
    changed.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
    data[i] = fillR;
    data[i + 1] = fillG;
    data[i + 2] = fillB;
    data[i + 3] = fillA;

    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
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

/**
 * Draw a line from (x0,y0) to (x1,y1) using brush dabs (Bresenham).
 */
export function drawLine(
  skinCtx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isEraser: boolean,
  canPaintAt: CanPaintAt,
  getCurrentColor: GetCurrentColor,
  stroke?: StrokeRecord | null,
  size = 1,
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
      brushAt(skinCtx, bx, by, isEraser, canPaintAt, getCurrentColor, stroke, size, alignTopLeft);
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

/**
 * Draw a line from (x0,y0) to (x1,y1) with a stamp callback (Bresenham, same snapping as drawLine).
 * The callback usually closes over a canvas context to paint each dab.
 */
export function drawLineWithStamp(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alignTopLeft: boolean,
  stampAt: (bx: number, by: number) => void
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
      stampAt(bx, by);
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
