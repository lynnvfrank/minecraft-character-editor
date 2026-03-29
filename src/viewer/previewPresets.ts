import fullOutfitPreviewConfig from '../config/preview/skins/preview.config.json';
import allPreviewConfig from '../config/preview/parts/all/preview.config.json';
import armsPreviewConfig from '../config/preview/parts/arms/preview.config.json';
import bodyPreviewConfig from '../config/preview/parts/body/preview.config.json';
import bottomPreviewConfig from '../config/preview/parts/bottom/preview.config.json';
import centerPreviewConfig from '../config/preview/parts/center/preview.config.json';
import hatPreviewConfig from '../config/preview/parts/hat/preview.config.json';
import headPreviewConfig from '../config/preview/parts/head/preview.config.json';
import jacketPreviewConfig from '../config/preview/parts/jacket/preview.config.json';
import jacketGroupPreviewConfig from '../config/preview/parts/jacketGroup/preview.config.json';
import legsPreviewConfig from '../config/preview/parts/legs/preview.config.json';
import pantsPreviewConfig from '../config/preview/parts/pants/preview.config.json';
import sleevesPreviewConfig from '../config/preview/parts/sleeves/preview.config.json';
import topPreviewConfig from '../config/preview/parts/top/preview.config.json';
import torsoPreviewConfig from '../config/preview/parts/torso/preview.config.json';
import type { PreviewPreset, PreviewPresetKey } from '../domain';

export type { PreviewPreset, PreviewPresetKey, PreviewVector, PreviewViewport } from '../domain';

export const PREVIEW_PRESET_KEYS = [
  'fullOutfit',
  'hat',
  'head',
  'jacket',
  'body',
  'arms',
  'sleeves',
  'pants',
  'legs',
  'torso',
  'jacketGroup',
  'bottom',
  'center',
  'top',
  'all',
] as const satisfies readonly PreviewPresetKey[];

const PREVIEW_PRESET_LABELS: Record<PreviewPresetKey, string> = {
  fullOutfit: 'Full outfit',
  hat: 'Hat',
  head: 'Head',
  jacket: 'Jacket',
  body: 'Body',
  arms: 'Arms',
  sleeves: 'Sleeves',
  pants: 'Pants',
  legs: 'Legs',
  torso: 'Torso',
  jacketGroup: 'Jacket',
  bottom: 'Lower body',
  center: 'Upper body',
  top: 'Head (hat + head)',
  all: 'Full outfit',
};

export const WARDROBE_PART_PREVIEW_PRESETS: Record<PreviewPresetKey, PreviewPreset> = {
  fullOutfit: fullOutfitPreviewConfig as PreviewPreset,
  hat: hatPreviewConfig as PreviewPreset,
  head: headPreviewConfig as PreviewPreset,
  jacket: jacketPreviewConfig as PreviewPreset,
  body: bodyPreviewConfig as PreviewPreset,
  arms: armsPreviewConfig as PreviewPreset,
  sleeves: sleevesPreviewConfig as PreviewPreset,
  pants: pantsPreviewConfig as PreviewPreset,
  legs: legsPreviewConfig as PreviewPreset,
  torso: torsoPreviewConfig as PreviewPreset,
  jacketGroup: jacketGroupPreviewConfig as PreviewPreset,
  bottom: bottomPreviewConfig as PreviewPreset,
  center: centerPreviewConfig as PreviewPreset,
  top: topPreviewConfig as PreviewPreset,
  all: allPreviewConfig as PreviewPreset,
};

export function isPreviewPresetKey(value: string | null | undefined): value is PreviewPresetKey {
  return value != null && value in WARDROBE_PART_PREVIEW_PRESETS;
}

export function getPreviewPreset(key: PreviewPresetKey | string | null | undefined): PreviewPreset {
  return isPreviewPresetKey(key) ? WARDROBE_PART_PREVIEW_PRESETS[key] : WARDROBE_PART_PREVIEW_PRESETS.fullOutfit;
}

export function getPreviewPresetLabel(key: PreviewPresetKey | string | null | undefined): string {
  return isPreviewPresetKey(key) ? PREVIEW_PRESET_LABELS[key] : PREVIEW_PRESET_LABELS.fullOutfit;
}
