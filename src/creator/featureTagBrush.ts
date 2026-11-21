/**
 * Feature tag brush for the 2D and 3D editors (see featureTagsPanel.ts).
 *
 * Shared state between the Feature tags panel (which owns the tags and the overlay) and the
 * pointer handling of the 3D viewer (viewer/controls.ts) and the 2D grid (blockyEditor.ts),
 * which turn clicks into 64x64 skin pixels. While a brush is picked, painting tags replaces
 * painting colors.
 */
import type { FeatureLabel } from '../styler/featureMap';

export type FeatureTagBrush = FeatureLabel | 'erase';

type FeatureTagHandlers = {
  /** Stroke begins/continues at a 64x64 skin pixel. */
  paint: (skinX: number, skinY: number) => void;
  /** Stroke finished (mouse up). */
  end: () => void;
};

let brush: FeatureTagBrush | null = null;
let handlers: FeatureTagHandlers | null = null;
const listeners = new Set<() => void>();

/** The picked brush, only while the 2D or 3D editor is showing. */
export function getFeatureTagBrush(): FeatureTagBrush | null {
  const mode = document.body.dataset.editMode;
  return mode === '2d' || mode === '3d' ? brush : null;
}

export function setFeatureTagBrush(next: FeatureTagBrush | null): void {
  if (brush === next) return;
  brush = next;
  listeners.forEach((fn) => fn());
}

export function onFeatureTagBrushChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function registerFeatureTagHandlers(next: FeatureTagHandlers | null): void {
  handlers = next;
}

export function featureTagPaint(skinX: number, skinY: number): void {
  if (!getFeatureTagBrush()) return;
  handlers?.paint(skinX, skinY);
}

export function featureTagEnd(): void {
  handlers?.end();
}
