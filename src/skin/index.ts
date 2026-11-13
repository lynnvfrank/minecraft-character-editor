/**
 * Skin module: layout (bounds, layer keys), coordinates, preprocessing, mesh→part mapping.
 * Single source of truth for 64×64 skin layout and related utilities.
 */

export {
  SKIN_SIZE,
  RESOLUTION_MULTIPLIER,
  WORK_SIZE,
  workingToSkin,
  skinToWorking,
  snapWorkingToSkinCellCenter,
  uvToWorkingCoords,
  type SkinCoord,
  type WorkingCoord,
} from './coordinates';

export {
  LAYER_KEYS,
  TEXTURE_LAYER_KEYS,
  SKIN_LAYER_BOUNDS,
  LAYERS_WITH_PARTS,
  isLayerWithParts,
  LAYER_TO_PART_DISPLAY_NAMES,
  SKIN_DEAD_ZONES,
  SKIN_PART_BOUNDS,
  PART_TO_LAYER,
  LAYER_TO_UV_PARTS,
  UV_PART_TO_LAYER,
  LAYER_DISPLAY_LABELS,
  WARDROBE_COMPOSITE_KEYS,
  WARDROBE_PART_KEYS,
  WARDROBE_COMPOSITE_BOUNDS,
  WARDROBE_COMPOSITE_CAMERA_PRESET,
  isLayerKey,
  isInDeadZone,
  partToLayer,
  getLayerBoundsByKey,
  getPartBounds,
  type Bounds,
  type LayerKey,
  type UVPartKey,
  type WardrobeCompositeKey,
  type WardrobePartKey,
} from './layout';

export {
  preprocessSkinTexture,
  SKIN_PREPROCESS_CONFIG,
  type SkinPreprocessConfig,
} from './preprocess';

export {
  ARM_MODEL_PATHS,
  ARM_MODEL_SETTINGS,
  detectArmModel,
  detectArmModelFromRGBA,
  resolveArmModel,
  armModelFromPath,
  readArmModelSetting,
  writeArmModelSetting,
  type ArmModel,
  type ArmModelSetting,
} from './armModel';

export {
  getMinecraftPartFromMeshName,
  registerMeshPartMapping,
  type MappingRule,
} from './meshPartMapping';

