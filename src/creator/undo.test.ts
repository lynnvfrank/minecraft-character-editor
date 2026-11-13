import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';
import { performUndo, performRedo } from './undo';
import { WORK_SIZE } from '../skin/coordinates';
import type { UndoCommand } from '../state/creatorState';

function setup() {
  const canvas = createCanvas(WORK_SIZE, WORK_SIZE);
  const ctx = canvas.getContext('2d');
  const undoStack: UndoCommand[] = [];
  const redoStack: UndoCommand[] = [];
  const undoCtx = {
    undoStack,
    redoStack,
    getSkinCanvas: () => canvas as unknown as HTMLCanvasElement,
    renderToDisplay: () => {},
  };
  const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  return { ctx, undoStack, redoStack, undoCtx, px };
}

describe('undo/redo', () => {
  test('stroke: undo restores previous pixel, redo reapplies color', () => {
    const { ctx, undoStack, redoStack, undoCtx, px } = setup();
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(3, 4, 1, 1);
    undoStack.push({
      type: 'stroke',
      pixels: [{ x: 3, y: 4, r: 0, g: 0, b: 0, a: 0 }],
      isEraser: false,
      newColor: '#ff0000',
    });

    performUndo(undoCtx);
    assert.deepEqual(px(3, 4), [0, 0, 0, 0]);
    assert.equal(undoStack.length, 0);
    assert.equal(redoStack.length, 1);

    performRedo(undoCtx);
    assert.deepEqual(px(3, 4), [255, 0, 0, 255]);
    assert.equal(undoStack.length, 1);
  });

  test('eraser redo clears the pixel', () => {
    const { ctx, undoStack, undoCtx, px } = setup();
    undoStack.push({
      type: 'stroke',
      pixels: [{ x: 1, y: 1, r: 0, g: 255, b: 0, a: 255 }],
      isEraser: true,
      newColor: '#000000',
    });
    performUndo(undoCtx);
    assert.deepEqual(px(1, 1), [0, 255, 0, 255]);
    performRedo(undoCtx);
    assert.deepEqual(px(1, 1), [0, 0, 0, 0]);
    void ctx;
  });

  test('fill redo paints all recorded pixels with fill color', () => {
    const { undoStack, undoCtx, px } = setup();
    undoStack.push({
      type: 'fill',
      pixels: [
        { x: 0, y: 0, r: 0, g: 0, b: 0, a: 0 },
        { x: 1, y: 0, r: 0, g: 0, b: 0, a: 0 },
      ],
      fillColor: '#0000ff',
    });
    performUndo(undoCtx);
    performRedo(undoCtx);
    assert.deepEqual(px(0, 0), [0, 0, 255, 255]);
    assert.deepEqual(px(1, 0), [0, 0, 255, 255]);
  });

  test('undo on empty stack is a no-op', () => {
    const { undoCtx, redoStack } = setup();
    performUndo(undoCtx);
    assert.equal(redoStack.length, 0);
  });
});
