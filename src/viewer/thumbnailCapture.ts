/**
 * 3D thumbnail capture for the creator gallery and wardrobe parts. Renders the scene from a
 * preview preset with a separate camera, so the main 3D view is never moved. Extracted from main.ts.
 */
import * as THREE from 'three';
import type { AlphaMode, TexturePreset } from './skinApplication';

/** The parts of a character that capture needs (CapturableCharacter in controllers/ satisfies it). */
type CapturableCharacter = {
  model: THREE.Group;
  texturePreset: TexturePreset;
  alphaMode: AlphaMode;
  currentSkin: string;
  modelPath: string;
};
import { getPreviewPreset, type PreviewPreset, type PreviewPresetKey } from './previewPresets';
import type { SceneContext } from './scene';
import { applySkinToModel, applyCreatorLayerVisibility, applyCreatorLayerVisibilityForCapture } from './skinApplication';
import { buildLayerVisibleState, createPixelSkinTexture, type SkinCompositor } from './skinCompositor';
import { renderTargetPixelsToImageData } from './captureHelpers';
import { placeAroundCharacter, type CharacterAnchor } from '../domain/preview';
import { BLOCK_WORLD_NAME } from './blockWorldMesh';

export type ThumbnailCaptureDeps = {
  getSceneContext: () => SceneContext | null;
  getPrimaryCharacter: () => CapturableCharacter | undefined;
  /** Where the character stands and faces; presets are placed around it. Default: origin, facing +Z. */
  getCharacterAnchor?: () => CharacterAnchor;
  getSkinCanvas: () => HTMLCanvasElement;
  getWorkSize: () => number;
  compositor: SkinCompositor;
  /** Ask the creator preview to re-upload its texture (before and after a capture). */
  markPreviewDirty: () => void;
};

const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const ORIGIN_ANCHOR: CharacterAnchor = { x: 0, y: 0, z: 0, yaw: 0 };

/**
 * Thumbnails show the character on the plain ground, as they always have: hide the home view's
 * block village (if any) and show the ground disc for the duration of `render`.
 */
function withPlainStage<T>(scene: THREE.Scene, render: () => T): T {
  const world = scene.getObjectByName(BLOCK_WORLD_NAME);
  const ground = scene.getObjectByName('ground');
  const worldWas = world?.visible;
  const groundWas = ground?.visible;
  if (world) world.visible = false;
  if (ground) ground.visible = true;
  try {
    return render();
  } finally {
    if (world && worldWas !== undefined) world.visible = worldWas;
    if (ground && groundWas !== undefined) ground.visible = groundWas;
  }
}

/** Render `ctx.scene` from `preset` into a size×size PNG data URL, then restore the main viewport. */
function renderPresetToDataUrl(
  ctx: SceneContext,
  preset: PreviewPreset,
  size: number,
  anchor: CharacterAnchor = ORIGIN_ANCHOR
): string | null {
  const camera = new THREE.PerspectiveCamera(preset.fov ?? 35, 1, 0.1, 100);
  const eye = placeAroundCharacter(preset.cameraPosition, anchor);
  const look = placeAroundCharacter(preset.cameraTarget, anchor);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(look.x, look.y, look.z);
  camera.updateProjectionMatrix();

  const target = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const { renderer } = ctx;
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, size, size);
  renderer.setScissor(0, 0, size, size);
  renderer.setScissorTest(true);
  withPlainStage(ctx.scene, () => renderer.render(ctx.scene, camera));
  renderer.setScissorTest(false);
  renderer.setRenderTarget(null);

  const w = ctx.container.clientWidth;
  const h = ctx.container.clientHeight;
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.setScissorTest(false);

  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  target.dispose();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const canvasCtx = canvas.getContext('2d');
  if (!canvasCtx) return null;
  const imgData = canvasCtx.createImageData(size, size);
  imgData.data.set(renderTargetPixelsToImageData(pixels, size));
  canvasCtx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function createThumbnailCapture(deps: ThumbnailCaptureDeps) {
  function ready(): { ctx: SceneContext; char: CapturableCharacter } | null {
    const ctx = deps.getSceneContext();
    const char = deps.getPrimaryCharacter();
    if (!char || !ctx?.renderer || !ctx.scene || !ctx.container) return null;
    return { ctx, char };
  }

  /** Whole character with the current creator skin, fullOutfit preset. */
  async function captureFull(size = 128): Promise<string | null> {
    const r = ready();
    if (!r) return null;
    deps.markPreviewDirty();
    await nextAnimationFrame();
    await nextAnimationFrame();
    return renderPresetToDataUrl(r.ctx, getPreviewPreset('fullOutfit'), size, deps.getCharacterAnchor?.());
  }

  /** One wardrobe part: that part's camera preset, with only its layers visible. */
  async function capturePart(part: PreviewPresetKey, size = 128): Promise<string | null> {
    const r = ready();
    if (!r) return null;
    const { ctx, char } = r;
    const preset = getPreviewPreset(part);
    const layerVisible = buildLayerVisibleState(preset.visibleLayers);
    const masked = deps.compositor.buildLayerMaskedCanvas(deps.getSkinCanvas(), layerVisible, {}, deps.getWorkSize());
    if (!masked) return null;

    deps.markPreviewDirty();
    await nextAnimationFrame();
    await nextAnimationFrame();

    const texture = createPixelSkinTexture(masked);
    applySkinToModel(char.model, texture, char.texturePreset, char.alphaMode, char.currentSkin);
    applyCreatorLayerVisibilityForCapture(char.model, layerVisible, char.modelPath);
    const url = renderPresetToDataUrl(ctx, preset, size, deps.getCharacterAnchor?.());
    texture.dispose();
    applyCreatorLayerVisibility(char.model, {});
    deps.markPreviewDirty();
    return url;
  }

  return { captureFull, capturePart };
}
