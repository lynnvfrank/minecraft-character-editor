/**
 * Blocky 2D editor: div-based pixel grid, rulers, template overlay.
 * Built because canvas pixelation was unreliable; divs give crisp 1:1 pixels.
 */

import { SKIN_SIZE, SKIN_LAYER_BOUNDS, SKIN_DEAD_ZONES, LAYER_KEYS, isLayerWithParts, WORK_SIZE, RESOLUTION_MULTIPLIER } from '../skin';
import { rgbToHex } from '../lib/color';
import * as brush from './brush';
import type { CreatorState } from '../state/creatorState';
import {
  creator2dPaintSlice,
  creatorLayerSlice,
  creatorLockFeedbackSlice,
} from '../state/creatorSlices';

const ZOOM = 4;
const DISPLAY_SIZE = WORK_SIZE * ZOOM;
const RULER_SCALE = DISPLAY_SIZE / WORK_SIZE;
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
  pushUndoStroke: (pixels: { x: number; y: number; r: number; g: number; b: number; a: number }[], isEraser: boolean, newColor: string) => void;
  pushUndoFill: (pixels: { x: number; y: number; r: number; g: number; b: number; a: number }[], fillColor: string) => void;
  updateUndoRedoButtons: () => void;
  undoLimit: number;
  /** Called when canvas pixels change (paint, fill, etc.). */
  onCanvasChange?: () => void;
}

function canPaintAt2D(ctx: BlockyEditorContext, workingX: number, workingY: number): boolean {
  if (!ctx.state.restrictToLayers) return true;
  if (ctx.state.selectedLayers.size === 0) return true;
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of ctx.state.selectedLayers) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    if (!bounds) continue;
    for (const b of bounds) {
      if (normX >= b.x && normX < b.x + b.w && normY >= b.y && normY < b.y + b.h) {
        return ctx.state.layer3DLocked[layer] !== true;
      }
    }
  }
  return false;
}

function getLayerAtCoords(ctx: BlockyEditorContext, workingX: number, workingY: number): string | null {
  const normX = Math.floor(workingX / RESOLUTION_MULTIPLIER);
  const normY = Math.floor(workingY / RESOLUTION_MULTIPLIER);
  for (const layer of LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layer];
    for (const b of bounds) {
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

/** Build the 64×64 div grid. */
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

/** Build ruler ticks and labels. */
export function buildRulers(): void {
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
      topLabel.textContent = String(s / 2);
      topLabel.style.left = `${px}px`;
      topRuler.appendChild(topLabel);

      const leftLabel = document.createElement('span');
      leftLabel.className = labelClass;
      leftLabel.textContent = String(s / 2);
      leftLabel.style.top = `${px}px`;
      leftRuler.appendChild(leftLabel);
    }
  }
}

/** Render blocky grid cells from skin canvas. */
export function renderBlockyGrid(ctx: BlockyEditorContext): void {
  const grid = document.getElementById('creator-blocky-grid');
  const skin = ctx.getSkinCanvas();
  const skinCtx = skin?.getContext('2d', { willReadFrequently: true });
  if (!grid || !skinCtx) return;
  const cells = grid.querySelectorAll<HTMLElement>('.creator-blocky-cell');
  cells.forEach((cell) => {
    const cx = parseInt(cell.dataset.cx ?? '0', 10);
    const cy = parseInt(cell.dataset.cy ?? '0', 10);
    const wx = cx * RESOLUTION_MULTIPLIER;
    const wy = cy * RESOLUTION_MULTIPLIER;
    const d = skinCtx.getImageData(wx, wy, 1, 1).data;
    const hex = rgbToHex(d[0], d[1], d[2]);
    const alpha = d[3] / 255;
    cell.style.backgroundColor = alpha < 0.01 ? 'transparent' : hex;
  });
}

/** Render rulers, template overlay, and scale. */
export function renderRulersAndGrid(ctx: BlockyEditorContext): void {
  const overlay = ctx.getOverlayCanvas();
  if (overlay) {
    const overlayCtx = overlay.getContext('2d');
    if (overlayCtx) {
      overlay.width = DISPLAY_SIZE;
      overlay.height = DISPLAY_SIZE;
      overlayCtx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
      if (ctx.state.showTemplate) {
        const templateScale = RULER_SCALE * RESOLUTION_MULTIPLIER;
        const labelPaddingX = 6;
        const labelPaddingY = 3;
        const labelInset = 0;
        const minLabelWidth = 22;
        const minLabelHeight = 16;
        overlayCtx.lineWidth = 2;
        overlayCtx.font = TEMPLATE_LABEL_FONT;
        overlayCtx.textAlign = 'left';
        overlayCtx.textBaseline = 'top';

        for (const layerKey of LAYER_KEYS) {
          const bounds = SKIN_LAYER_BOUNDS[layerKey];
          const layerVisible = ctx.state.layer3DVisible[layerKey] !== false;
          const parts = ctx.state.layer3DPartVisible[layerKey];
          for (let i = 0; i < bounds.length; i++) {
            const b = bounds[i]!;
            const partVisible = isLayerWithParts(layerKey)
              ? (i === 0 ? (parts?.R !== false) : (parts?.L !== false))
              : true;
            const isVisible = layerVisible && partVisible;
            const style = isVisible
              ? (TEMPLATE_LAYER_STYLES[layerKey] ?? DEFAULT_TEMPLATE_STYLE)
              : HIDDEN_TEMPLATE_STYLE;
            const x = b.x * templateScale;
            const y = b.y * templateScale;
            const w = b.w * templateScale;
            const h = b.h * templateScale;
            overlayCtx.strokeStyle = style.stroke;
            overlayCtx.strokeRect(x, y, w, h);
          }
        }
        overlayCtx.globalCompositeOperation = 'destination-out';
        overlayCtx.fillStyle = 'rgba(0,0,0,1)';
        for (const z of SKIN_DEAD_ZONES) {
          // Preserve full head/hat template boxes by skipping top-row dead zones.
          if (z.y < 16) continue;
          const x = z.x * templateScale;
          const y = z.y * templateScale;
          const w = z.w * templateScale;
          const h = z.h * templateScale;
          overlayCtx.fillRect(x, y, w, h);
        }
        overlayCtx.globalCompositeOperation = 'source-over';

        // Draw labels after dead-zone punch-out so text remains readable.
        for (const layerKey of LAYER_KEYS) {
          const bounds = SKIN_LAYER_BOUNDS[layerKey];
          const layerVisible = ctx.state.layer3DVisible[layerKey] !== false;
          const parts = ctx.state.layer3DPartVisible[layerKey];
          for (let i = 0; i < bounds.length; i++) {
            const partVisible = isLayerWithParts(layerKey)
              ? (i === 0 ? (parts?.R !== false) : (parts?.L !== false))
              : true;
            const isVisible = layerVisible && partVisible;
            const style = isVisible
              ? (TEMPLATE_LAYER_STYLES[layerKey] ?? DEFAULT_TEMPLATE_STYLE)
              : HIDDEN_TEMPLATE_STYLE;
            const b = bounds[i];
            const labelText = getTemplateLabelText(layerKey, b);
            const x = b.x * templateScale;
            const y = b.y * templateScale;
            const w = b.w * templateScale;
            const h = b.h * templateScale;
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
  const size = hasRulers ? 532 : 512;
  const scale = Math.min(areaRect.width / size, effectiveHeight / size);
  (wrap as HTMLElement).style.transform = `scale(${scale})`;
}

/** Client coords to blocky grid cell. */
export function clientToBlockyCell(clientX: number, clientY: number): { cx: number; cy: number } | null {
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
      renderRulersAndGrid(activeBlockyContext);
    };
    const u1 = creatorLayerSlice.subscribe(refresh);
    const u2 = creator2dPaintSlice.subscribe(refresh);
    unbindBlockyLayerSubs = () => {
      u1();
      u2();
    };
  }

  const canPaintAtBound = (wx: number, wy: number) => canPaintAt(ctx, wx, wy);
  const getCurrentColor = () => ctx.state.currentColor;
  let lastLockFeedbackMs = 0;
  const LOCK_FEEDBACK_THROTTLE_MS = 400;

  function handleBlockyPointer(e: MouseEvent): void {
    const gridRect = gridEl.getBoundingClientRect();
    const relX = e.clientX - gridRect.left;
    const relY = e.clientY - gridRect.top;
    const inGrid = relX >= 0 && relX <= gridRect.width && relY >= 0 && relY <= gridRect.height;
    overlayPointerPx = inGrid
      ? { x: (relX / gridRect.width) * DISPLAY_SIZE, y: (relY / gridRect.height) * DISPLAY_SIZE }
      : null;
    const cell = clientToBlockyCell(e.clientX, e.clientY);
    if (cell) {
      const wx = cell.cx * RESOLUTION_MULTIPLIER;
      const wy = cell.cy * RESOLUTION_MULTIPLIER;
      const part = ctx.getPartDisplayNameAtCoords(wx, wy);
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
    if (!cell) return;
    const wx = cell.cx * RESOLUTION_MULTIPLIER;
    const wy = cell.cy * RESOLUTION_MULTIPLIER;

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
      ctx.state.lastSkinX = wx;
      ctx.state.lastSkinY = wy;
      ctx.onCanvasChange?.();
      renderBlockyGrid(ctx);
    } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
      if (e.type === 'mouseup' && e.button === 0 && ctx.state.currentStroke) {
        if (ctx.state.currentStroke.pixels.length > 0) {
          ctx.pushUndoStroke(
            ctx.state.currentStroke.pixels,
            ctx.state.currentStroke.isEraser,
            ctx.state.currentStroke.newColor
          );
        }
        ctx.state.currentStroke = null;
        ctx.state.isDrawing = false;
        ctx.updateUndoRedoButtons();
      }
      if (e.type === 'mouseleave' && ctx.state.currentStroke && ctx.state.currentStroke.pixels.length > 0) {
        ctx.pushUndoStroke(
          ctx.state.currentStroke.pixels,
          ctx.state.currentStroke.isEraser,
          ctx.state.currentStroke.newColor
        );
        ctx.state.currentStroke = null;
        ctx.state.isDrawing = false;
        ctx.updateUndoRedoButtons();
      }
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
  return brush.getBrushCursorStyle2D(gridWidth, SKIN_SIZE, BLOCKY_GRID_SIZE / SKIN_SIZE);
}
