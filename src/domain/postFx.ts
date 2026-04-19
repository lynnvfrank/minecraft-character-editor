/**
 * Creator wardrobe post-processing preset ids (scene effects, not skin paint layers).
 */

export const WARDROBE_POST_FX_PRESET_IDS = ['natural', 'bloom', 'cinema'] as const;
export type WardrobePostFxPresetId = (typeof WARDROBE_POST_FX_PRESET_IDS)[number];

export function isWardrobePostFxPresetId(value: string): value is WardrobePostFxPresetId {
  return (WARDROBE_POST_FX_PRESET_IDS as readonly string[]).includes(value);
}
