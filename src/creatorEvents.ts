/**
 * Creator event bus: universal events for character creator state changes.
 * Use subscribe() for components that need to react; use publish() when state changes.
 */

export const CREATOR_EVENTS = {
  CURRENT_COLOR_CHANGE: 'creator-current-color-change',
  TEXTURE_POSITION_CHANGE: 'creator-texture-position-change',
  SWATCH_HISTORY_CHANGE: 'creator-swatch-history-change',
  SKIN_LOAD_CHANGE: 'creator-skin-load-change',
  SWATCH_PALETTE_CHANGE: 'creator-swatch-palette-change',
  EDIT_MODE_CHANGE: 'creator-edit-mode-change',
  TOOLS_CHANGE: 'creator-tools-3d-change',
  LAYER3D_CHANGE: 'creator-layer3d-change',
  CANVAS_CHANGE: 'creator-canvas-change',
} as const;

export type CreatorCurrentColorDetail = { color: string };

export type CreatorEditModeDetail = { mode: 'wardrobe' | '2d' | '3d' };

export type CreatorTexturePositionDetail = {
  part: string | null;
  layer: string | null;
  skinX: number;
  skinY: number;
};

/** Publish an event. Subscribers will be notified. */
export function publish(
  event: string,
  detail?: unknown
): void {
  document.dispatchEvent(new CustomEvent(event, { detail }));
}

/** Subscribe to an event. Returns an unsubscribe function. */
export function subscribe(
  event: string,
  handler: (e: CustomEvent) => void
): () => void {
  const wrapped = (e: Event) => handler(e as CustomEvent);
  document.addEventListener(event, wrapped);
  return () => document.removeEventListener(event, wrapped);
}
