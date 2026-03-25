/**
 * Payload types for creator in-process slices (see creatorSlices.ts).
 * Kept separate from the document event bus.
 */

export type CreatorEditModePayload = {
  mode: 'wardrobe' | '2d' | '3d';
  previousMode?: 'wardrobe' | '2d' | '3d';
};

export type CreatorColorPayload = { color: string };

export type CreatorTexturePositionPayload = {
  part: string | null;
  layer: string | null;
  skinX: number;
  skinY: number;
  tool?: 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'navigate';
  currentColor?: string | null;
  hoverColor?: string | null;
};

export type CreatorSkinLoadPayload = { path: string };

export type CreatorLockFeedbackPayload = { layer: string };
