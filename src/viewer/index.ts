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
  type SceneContext
} from './scene';

export {
  applySkinToModel,
  applyCreatorLayerVisibility,
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
