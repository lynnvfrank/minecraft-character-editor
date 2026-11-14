/**
 * Hair spot-correction brush for the Me tab.
 *
 * Shared state between the Make it me panel (which owns the corrections and restyles) and
 * the 3D viewer's pointer handling (which turns clicks on the model into skin pixels).
 */

export type HairBrushMode = 'add' | 'remove';

type HairBrushHandlers = {
  /** Stroke begins/continues at a 64x64 skin pixel. */
  paint: (skinX: number, skinY: number) => void;
  /** Stroke finished (mouse up). */
  end: () => void;
};

let mode: HairBrushMode | null = null;
let handlers: HairBrushHandlers | null = null;
const listeners = new Set<() => void>();

export function getHairBrushMode(): HairBrushMode | null {
  return document.body.dataset.editMode === 'style' ? mode : null;
}

export function setHairBrushMode(next: HairBrushMode | null): void {
  if (mode === next) return;
  mode = next;
  listeners.forEach((fn) => fn());
}

export function onHairBrushModeChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function registerHairBrushHandlers(next: HairBrushHandlers | null): void {
  handlers = next;
}

export function hairBrushPaint(skinX: number, skinY: number): void {
  if (!getHairBrushMode()) return;
  handlers?.paint(skinX, skinY);
}

export function hairBrushEnd(): void {
  handlers?.end();
}
