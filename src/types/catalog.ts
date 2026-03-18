/**
 * Shared catalog types for skins and animations.
 * Used by main.ts (viewer) and creator.ts (skin gallery).
 * Matches API response shapes: /skins/index.json, /animations/index.json.
 */

export type SkinEntry = {
  path: string;
  label: string;
  preview?: string;
};

export type AnimationEntry = {
  path: string;
  key: string;
  label: string;
};
