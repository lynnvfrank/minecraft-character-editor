/**
 * In-process subscriptions for creator editor state (DOM sync + main preview dirty).
 * Camera and character commands stay on document events (see appEvents.ts).
 */

import { createSubscribable, createPayloadSubscribable } from '../lib/subscribable';
import type {
  CreatorColorPayload,
  CreatorEditModePayload,
  CreatorLockFeedbackPayload,
  CreatorSkinLoadPayload,
  CreatorTexturePositionPayload,
} from './creatorSlicePayloads';

export const creatorLayerSlice = createSubscribable();
export const creatorCanvasSlice = createSubscribable();
export const creatorModeSlice = createPayloadSubscribable<CreatorEditModePayload>();
export const creatorToolsSlice = createSubscribable();
export const creatorColorSlice = createPayloadSubscribable<CreatorColorPayload>();
export const creatorSwatchHistorySlice = createSubscribable();
export const creatorSwatchPaletteSlice = createSubscribable();
export const creatorTexturePositionSlice =
  createPayloadSubscribable<CreatorTexturePositionPayload>();
export const creatorSkinLoadSlice = createPayloadSubscribable<CreatorSkinLoadPayload>();
export const creatorLockFeedbackSlice = createPayloadSubscribable<CreatorLockFeedbackPayload>();
/** Wardrobe tree selection (not skin part picks); notify when set programmatically or from UI. */
export const creatorWardrobeFocusSlice = createSubscribable();
/**
 * 2D paint mask (selectedLayers / restrictToLayers). Call notify when those change.
 */
export const creator2dPaintSlice = createSubscribable();

/** Focused Creation toggle; notify after setFocusedCreationEnabled. */
export const creatorFocusedCreationSlice = createPayloadSubscribable<{ enabled: boolean }>();

/** Wardrobe hover-preview state (tree/library hover layer + source). */
export const creatorWardrobeHoverPreviewSlice = createPayloadSubscribable<{
  layer: import('../creator/wardrobeLayers').WardrobeLayerKey | null;
  source: 'layerPanel' | 'selectorPanel' | null;
}>();
