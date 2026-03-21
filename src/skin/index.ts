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
  uvToWorkingCoords,
  type SkinCoord,
  type WorkingCoord,
} from './coordinates';

export {
  LAYER_KEYS,
  TEXTURE_LAYER_KEYS,
  SKIN_LAYER_BOUNDS,
  LAYER_TO_PART_DISPLAY_NAMES,
  SKIN_DEAD_ZONES,
  SKIN_PART_BOUNDS,
  PART_TO_LAYER,
  LAYER_TO_UV_PARTS,
  LAYER_DISPLAY_LABELS,
  isLayerKey,
  isInDeadZone,
  partToLayer,
  getLayerBoundsByKey,
  type Bounds,
  type LayerKey,
  type UVPartKey,
} from './layout';

export {
  preprocessSkinTexture,
  SKIN_PREPROCESS_CONFIG,
  type SkinPreprocessConfig,
} from './preprocess';

export {
  getMinecraftPartFromMeshName,
  registerMeshPartMapping,
  type MappingRule,
} from './meshPartMapping';

