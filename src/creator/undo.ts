/**
 * Undo/redo stack and pixel change application.
 * Depends on skinIO for putImageDataFromRGBA; creator.ts wires state and render.
 */

import { WORK_SIZE } from '../skin';
import { hexToRgb } from '../lib/color';
import type { PixelChange, UndoCommand } from '../state/creatorState';
import { putImageDataFromRGBA } from './skinIO';

/** Apply pixel changes for undo/redo. */
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

export interface UndoContext {
  undoStack: UndoCommand[];
  redoStack: UndoCommand[];
  getSkinCanvas: () => HTMLCanvasElement;
  renderToDisplay: () => void;
}

/** Perform undo. Pops from undoStack, applies inverse, pushes to redoStack. */
export function performUndo(ctx: UndoContext): void {
  const cmd = ctx.undoStack.pop();
  if (!cmd) return;
  ctx.redoStack.push(cmd);
  const canvas = ctx.getSkinCanvas();
  if (cmd.type === 'load') {
    putImageDataFromRGBA(cmd.beforeData, canvas);
  } else {
    const skinCtx = canvas.getContext('2d');
    if (!skinCtx) return;
    applyPixelChanges(skinCtx, cmd.pixels, false, cmd);
  }
  ctx.renderToDisplay();
}

/** Perform redo. Pops from redoStack, applies change, pushes to undoStack. */
export function performRedo(ctx: UndoContext): void {
  const cmd = ctx.redoStack.pop();
  if (!cmd) return;
  ctx.undoStack.push(cmd);
  const canvas = ctx.getSkinCanvas();
  if (cmd.type === 'load') {
    putImageDataFromRGBA(cmd.afterData, canvas);
  } else {
    const skinCtx = canvas.getContext('2d');
    if (!skinCtx) return;
    if (cmd.type === 'stroke') {
      applyPixelChanges(skinCtx, cmd.pixels, true, cmd);
    } else {
      const [fillR, fillG, fillB] = hexToRgb(cmd.fillColor);
      const imageData = skinCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
      for (const p of cmd.pixels) {
        const i = (p.y * WORK_SIZE + p.x) * 4;
        imageData.data[i] = fillR;
        imageData.data[i + 1] = fillG;
        imageData.data[i + 2] = fillB;
        imageData.data[i + 3] = 255;
      }
      skinCtx.putImageData(imageData, 0, 0);
    }
  }
  ctx.renderToDisplay();
}

/** Update undo/redo button disabled state. */
export function updateUndoRedoButtons(undoStack: UndoCommand[], redoStack: UndoCommand[]): void {
  const ub = document.getElementById('creator-tools-undo-btn') as HTMLButtonElement | null;
  const rb = document.getElementById('creator-tools-redo-btn') as HTMLButtonElement | null;
  if (ub) ub.disabled = undoStack.length === 0;
  if (rb) rb.disabled = redoStack.length === 0;
}
