/**
 * Optional scene and character configuration.
 * Code defaults are used when config is absent. Future: load from JSON and merge.
 */

/** Preferred idle animation keys in order (first available is used). */
export const PREFERRED_IDLE_KEYS = ['bored', 'shrugging', 'crying', 'laughing'] as const;

/** Default base skin path for preview composition (when part overlays need a base). */
export const DEFAULT_PREVIEW_BASE_SKIN = '/wardrobe/skins/skin-base.png';

/**
 * Build preview base skin candidates for composed previews.
 * First tries skin-base.png, then the primary skin.
 */
export function getPreviewBaseSkinCandidates(primarySkinPath?: string): string[] {
  return [DEFAULT_PREVIEW_BASE_SKIN, primarySkinPath].filter(Boolean) as string[];
}
