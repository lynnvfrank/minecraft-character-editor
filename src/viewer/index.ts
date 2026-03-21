/**
 * Viewer module: scene setup, skin application, orbit/pointer controls.
 */

export {
  initScene,
  addLights,
  addGround,
  applyShadowToModel,
  logModelUVInfo,
  logMeshNames,
  createDebugTexture,
  setupCreatorCameraLight,
  setCreatorCameraLightEnabled,
  isCreatorCameraLightEnabled,
  CREATOR_CAMERA_LIGHT_ENABLED,
  type SceneContext
} from './scene';

export {
  applySkinToModel,
  applyCreatorLayerVisibility,
  applyCreatorLayerVisibilityForCapture,
  configureTexture,
  OVERLAY_SCALE,
  MINECRAFT_SKIN_UVS,
  type TexturePreset,
  type AlphaMode
} from './skinApplication';

export {
  setupCreator3DPaint,
  updateOrbitControlsForEditMode,
  updateCreator3DCanvasCursor,
  recreateOrbitControls,
  resetCameraFor2DPreview,
  type Creator3DPaintDeps
} from './controls';

export {
  WARDROBE_PART_PREVIEW_PRESETS,
  PREVIEW_PRESET_KEYS,
  getPreviewPreset,
  getPreviewPresetLabel,
  isPreviewPresetKey,
  type PreviewPreset,
  type PreviewPresetKey,
  type PreviewVector,
  type PreviewViewport,
} from './previewPresets';
