/**
 * Skin texture application to 3D model.
 * UV mapping, mesh part resolution, texture preset configuration.
 */

import * as THREE from 'three';
import { getMinecraftPartFromMeshName, UV_PART_TO_LAYER } from '../skin';
import { logger } from '../lib';

export type TexturePreset = 'clamped' | 'clamped-flip' | 'repeat' | 'repeat-flip';
export type AlphaMode = 'none' | 'alphaTest' | 'transparent' | 'cutout';

/** Overlay scale workaround: scale the 2nd_Layer mesh (jacket, sleeves, pants) slightly outward so it renders above the base. */
export const OVERLAY_SCALE = {
  enabled: true,
  factor: 1.03,
};

/**
 * Minecraft 64x64 skin layout UVs (from minecraft-skin-layout-specification.md).
 * Normalized 0-1: U = x/64, V = 1 - y/64 (OpenGL convention, top-left image origin).
 * Face order: front, back, top, bottom, right, left — 4 verts each (bl, br, tr, tl).
 * Runningboy uses FBX UVs; this table is for models with separate meshes per part.
 */
export const MINECRAFT_SKIN_UVS: Record<string, number[]> = {
  head: [
    0.125, 0.75, 0.25, 0.75, 0.25, 0.875, 0.125, 0.875,
    0.375, 0.75, 0.5, 0.75, 0.5, 0.875, 0.375, 0.875,
    0.125, 0.875, 0.25, 0.875, 0.25, 1, 0.125, 1,
    0.25, 0.875, 0.375, 0.875, 0.375, 1, 0.25, 1,
    0, 0.75, 0.125, 0.75, 0.125, 0.875, 0, 0.875,
    0.25, 0.75, 0.375, 0.75, 0.375, 0.875, 0.25, 0.875,
  ],
  hat: [
    0.625, 0.75, 0.75, 0.75, 0.75, 0.875, 0.625, 0.875,
    0.875, 0.75, 1, 0.75, 1, 0.875, 0.875, 0.875,
    0.625, 0.875, 0.75, 0.875, 0.75, 1, 0.625, 1,
    0.75, 0.875, 0.875, 0.875, 0.875, 1, 0.75, 1,
    0.5, 0.75, 0.625, 0.75, 0.625, 0.875, 0.5, 0.875,
    0.75, 0.75, 0.875, 0.75, 0.875, 0.875, 0.75, 0.875,
  ],
  body: [
    0.3125, 0.5, 0.4375, 0.5, 0.4375, 0.6875, 0.3125, 0.6875,
    0.5, 0.5, 0.625, 0.5, 0.625, 0.6875, 0.5, 0.6875,
    0.3125, 0.6875, 0.4375, 0.6875, 0.4375, 0.75, 0.3125, 0.75,
    0.4375, 0.6875, 0.5625, 0.6875, 0.5625, 0.75, 0.4375, 0.75,
    0.25, 0.5, 0.3125, 0.5, 0.3125, 0.6875, 0.25, 0.6875,
    0.4375, 0.5, 0.5, 0.5, 0.5, 0.6875, 0.4375, 0.6875,
  ],
  jacket: [
    0.3125, 0.25, 0.4375, 0.25, 0.4375, 0.4375, 0.3125, 0.4375,
    0.5, 0.25, 0.625, 0.25, 0.625, 0.4375, 0.5, 0.4375,
    0.3125, 0.4375, 0.4375, 0.4375, 0.4375, 0.5, 0.3125, 0.5,
    0.4375, 0.4375, 0.5625, 0.4375, 0.5625, 0.5, 0.4375, 0.5,
    0.25, 0.25, 0.3125, 0.25, 0.3125, 0.4375, 0.25, 0.4375,
    0.4375, 0.25, 0.5, 0.25, 0.5, 0.4375, 0.4375, 0.4375,
  ],
  armR: [
    0.6875, 0.5, 0.75, 0.5, 0.75, 0.6875, 0.6875, 0.6875,
    0.8125, 0.5, 0.875, 0.5, 0.875, 0.6875, 0.8125, 0.6875,
    0.6875, 0.6875, 0.75, 0.6875, 0.75, 0.75, 0.6875, 0.75,
    0.75, 0.6875, 0.8125, 0.6875, 0.8125, 0.75, 0.75, 0.75,
    0.625, 0.5, 0.6875, 0.5, 0.6875, 0.6875, 0.625, 0.6875,
    0.75, 0.5, 0.8125, 0.5, 0.8125, 0.6875, 0.75, 0.6875,
  ],
  armL: [
    0.5625, 0, 0.625, 0, 0.625, 0.1875, 0.5625, 0.1875,
    0.6875, 0, 0.75, 0, 0.75, 0.1875, 0.6875, 0.1875,
    0.5625, 0.1875, 0.625, 0.1875, 0.625, 0.25, 0.5625, 0.25,
    0.625, 0.1875, 0.6875, 0.1875, 0.6875, 0.25, 0.625, 0.25,
    0.5, 0, 0.5625, 0, 0.5625, 0.1875, 0.5, 0.1875,
    0.625, 0, 0.6875, 0, 0.6875, 0.1875, 0.625, 0.1875,
  ],
  legR: [
    0.0625, 0.5, 0.125, 0.5, 0.125, 0.6875, 0.0625, 0.6875,
    0.1875, 0.5, 0.25, 0.5, 0.25, 0.6875, 0.1875, 0.6875,
    0.0625, 0.6875, 0.125, 0.6875, 0.125, 0.75, 0.0625, 0.75,
    0.125, 0.6875, 0.1875, 0.6875, 0.1875, 0.75, 0.125, 0.75,
    0, 0.5, 0.0625, 0.5, 0.0625, 0.6875, 0, 0.6875,
    0.125, 0.5, 0.1875, 0.5, 0.1875, 0.6875, 0.125, 0.6875,
  ],
  legL: [
    0.3125, 0, 0.375, 0, 0.375, 0.1875, 0.3125, 0.1875,
    0.4375, 0, 0.5, 0, 0.5, 0.1875, 0.4375, 0.1875,
    0.3125, 0.1875, 0.375, 0.1875, 0.375, 0.25, 0.3125, 0.25,
    0.375, 0.1875, 0.4375, 0.1875, 0.4375, 0.25, 0.375, 0.25,
    0.25, 0, 0.3125, 0, 0.3125, 0.1875, 0.25, 0.1875,
    0.375, 0, 0.4375, 0, 0.4375, 0.1875, 0.375, 0.1875,
  ],
  sleeveR: [
    0.6875, 0.3125, 0.75, 0.3125, 0.75, 0.5, 0.6875, 0.5,
    0.8125, 0.3125, 0.875, 0.3125, 0.875, 0.5, 0.8125, 0.5,
    0.6875, 0.5, 0.75, 0.5, 0.75, 0.5625, 0.6875, 0.5625,
    0.75, 0.5, 0.8125, 0.5, 0.8125, 0.5625, 0.75, 0.5625,
    0.625, 0.3125, 0.6875, 0.3125, 0.6875, 0.5, 0.625, 0.5,
    0.75, 0.3125, 0.8125, 0.3125, 0.8125, 0.5, 0.75, 0.5,
  ],
  sleeveL: [
    0.8125, 0, 0.875, 0, 0.875, 0.1875, 0.8125, 0.1875,
    0.9375, 0, 1, 0, 1, 0.1875, 0.9375, 0.1875,
    0.8125, 0.1875, 0.875, 0.1875, 0.875, 0.25, 0.8125, 0.25,
    0.875, 0.1875, 0.9375, 0.1875, 0.9375, 0.25, 0.875, 0.25,
    0.75, 0, 0.8125, 0, 0.8125, 0.1875, 0.75, 0.1875,
    0.875, 0, 0.9375, 0, 0.9375, 0.1875, 0.875, 0.1875,
  ],
  pantsR: [
    0.0625, 0.3125, 0.125, 0.3125, 0.125, 0.5, 0.0625, 0.5,
    0.1875, 0.3125, 0.25, 0.3125, 0.25, 0.5, 0.1875, 0.5,
    0.0625, 0.5, 0.125, 0.5, 0.125, 0.5625, 0.0625, 0.5625,
    0.125, 0.5, 0.1875, 0.5, 0.1875, 0.5625, 0.125, 0.5625,
    0, 0.3125, 0.0625, 0.3125, 0.0625, 0.5, 0, 0.5,
    0.125, 0.3125, 0.1875, 0.3125, 0.1875, 0.5, 0.125, 0.5,
  ],
  pantsL: [
    0.0625, 0, 0.125, 0, 0.125, 0.1875, 0.0625, 0.1875,
    0.1875, 0, 0.25, 0, 0.25, 0.1875, 0.1875, 0.1875,
    0.0625, 0.1875, 0.125, 0.1875, 0.125, 0.25, 0.0625, 0.25,
    0.125, 0.1875, 0.1875, 0.1875, 0.1875, 0.25, 0.125, 0.25,
    0, 0, 0.0625, 0, 0.0625, 0.1875, 0, 0.1875,
    0.125, 0, 0.1875, 0, 0.1875, 0.1875, 0.125, 0.1875,
  ],
};

export function configureTexture(texture: THREE.Texture, preset: TexturePreset): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  switch (preset) {
    case 'clamped':
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = false;
      break;
    case 'clamped-flip':
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = true;
      break;
    case 'repeat':
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false;
      break;
    case 'repeat-flip':
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = true;
      break;
  }
}

export function applyCreatorLayerVisibility(
  model: THREE.Group,
  _layerVisible: Record<string, boolean>
): void {
  // Visibility is handled by texture-region transparency; all meshes stay visible
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      (obj as THREE.Mesh).visible = true;
    }
  });
}

/**
 * Set mesh visibility per layer for per-part capture. Hides meshes for layers not in layerVisible.
 * Use only during capture; caller must restore visibility after.
 */
export function applyCreatorLayerVisibilityForCapture(
  model: THREE.Group,
  layerVisible: Record<string, boolean>,
  modelPath?: string
): void {
  model.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const part = getMinecraftPartFromMeshName(mesh.name || '', modelPath);
    const layer = part ? UV_PART_TO_LAYER[part] : null;
    mesh.visible = layer != null ? (layerVisible[layer] !== false) : true;
  });
}

export function applySkinToModel(
  model: THREE.Group,
  texture: THREE.Texture,
  preset: TexturePreset = 'clamped',
  alphaMode: AlphaMode = 'none',
  skinPath?: string,
  modelPath?: string
): void {
  configureTexture(texture, preset);

  const OVERLAY_PARTS = new Set(['hat', 'jacket', 'sleeveR', 'sleeveL', 'pantsR', 'pantsL']);

  let appliedCount = 0;
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const meshName = mesh.name || '';
      const part = getMinecraftPartFromMeshName(meshName, modelPath);
      const is2ndLayer = meshName.toLowerCase().includes('2nd') && meshName.toLowerCase().includes('layer');

      mesh.renderOrder = (part && OVERLAY_PARTS.has(part)) || is2ndLayer ? 1 : 0;

      if (is2ndLayer && OVERLAY_SCALE.enabled) {
        mesh.scale.setScalar(OVERLAY_SCALE.factor);
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (!m) return;
        const mat = m as THREE.MeshPhongMaterial;
        mat.map = texture;

        switch (alphaMode) {
          case 'alphaTest':
            mat.alphaTest = 0.5;
            mat.transparent = false;
            break;
          case 'transparent':
            mat.transparent = true;
            mat.alphaTest = 0.1;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            break;
          case 'cutout':
            mat.alphaTest = 0.01;
            mat.transparent = false;
            mat.side = THREE.DoubleSide;
            break;
        }

        mat.needsUpdate = true;
        appliedCount++;
      });
    }
  });
  logger.info('messaging', 'Skin change', { path: skinPath, appliedCount, alphaMode });
}
