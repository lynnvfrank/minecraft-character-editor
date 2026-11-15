/**
 * Skin texture composition: layer masking, preview-part compositing and the
 * reusable CanvasTextures that feed them to the 3D model.
 *
 * Extracted from main.ts. Each compositor owns its scratch canvases/textures so
 * callers don't keep module-level `let` state for them.
 */
import * as THREE from 'three';
import {
  SKIN_LAYER_BOUNDS,
  LAYER_KEYS,
  TEXTURE_LAYER_KEYS,
  isLayerWithParts,
  getPartBounds,
  type LayerKey,
} from '../skin';
import type { PreviewRoutePartKey } from '../controllers/previewRoute';

export type LayerVisibleState = Record<string, boolean>;
export type LayerPartVisibleState = Record<string, { L?: boolean; R?: boolean }>;

export function buildLayerVisibleState(visibleLayers: readonly LayerKey[]): LayerVisibleState {
  const visibleSet = new Set<string>(visibleLayers);
  return Object.fromEntries(LAYER_KEYS.map((layer) => [layer, visibleSet.has(layer)]));
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

/** Load an image once per path; later calls share the same promise. */
export function loadCachedImage(path: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(path);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load preview image: ${path}`));
    img.src = path;
  });
  imageCache.set(path, pending);
  return pending;
}

function getImageSourceSize(source: HTMLCanvasElement | HTMLImageElement): number {
  if (source instanceof HTMLCanvasElement) return source.width;
  return source.naturalWidth || source.width || 64;
}

export function createPixelSkinTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = true;
  return tex;
}

/**
 * Zero the alpha of every hidden layer region in a square RGBA buffer of side `size`
 * (64-pixel skin scaled up by size/64). For layers with L/R parts, bounds[0] is R and bounds[1] is L.
 * Pure: no DOM, unit-tested in skinCompositor.test.ts.
 */
export function maskHiddenLayerRegions(
  data: Uint8ClampedArray,
  size: number,
  layerVisible: LayerVisibleState,
  layerPartVisible: LayerPartVisibleState
): void {
  const scale = size / 64;
  for (const layerKey of TEXTURE_LAYER_KEYS) {
    const bounds = SKIN_LAYER_BOUNDS[layerKey];
    if (!bounds) continue;
    const layerHidden = layerVisible[layerKey] === false;
    const parts = layerPartVisible[layerKey];
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i]!;
      const partHidden = isLayerWithParts(layerKey) ? (i === 0 ? parts?.R === false : parts?.L === false) : false;
      if (!layerHidden && !partHidden) continue;
      const x0 = Math.floor(b.x * scale);
      const y0 = Math.floor(b.y * scale);
      const x1 = Math.min(Math.ceil((b.x + b.w) * scale), size);
      const y1 = Math.min(Math.ceil((b.y + b.h) * scale), size);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          data[(py * size + px) * 4 + 3] = 0;
        }
      }
    }
  }
}

/** Holds one scratch canvas + texture pair, recreating the canvas when the size changes. */
export function createSkinCompositor() {
  let maskCanvas: HTMLCanvasElement | null = null;
  let maskTexture: THREE.CanvasTexture | null = null;
  let previewCanvas: HTMLCanvasElement | null = null;
  let previewTexture: THREE.CanvasTexture | null = null;

  /** Copy `source` at `workSize` and zero alpha over hidden layer / part regions. */
  function buildLayerMaskedCanvas(
    source: HTMLCanvasElement | HTMLImageElement,
    layerVisible: LayerVisibleState,
    layerPartVisible: LayerPartVisibleState,
    workSize: number
  ): HTMLCanvasElement | null {
    const sourceSize = getImageSourceSize(source);
    if (!sourceSize) return null;
    if (!maskCanvas || maskCanvas.width !== workSize || maskCanvas.height !== workSize) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.width = workSize;
      maskCanvas.height = workSize;
    }
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, workSize, workSize);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, sourceSize, sourceSize, 0, 0, workSize, workSize);
    const imageData = ctx.getImageData(0, 0, workSize, workSize);

    maskHiddenLayerRegions(imageData.data, workSize, layerVisible, layerPartVisible);
    ctx.putImageData(imageData, 0, 0);
    return maskCanvas;
  }

  /** Masked copy of the skin as a texture; returns `fallback` if masking fails. */
  function buildVisibilityTexture(
    skinCanvas: HTMLCanvasElement,
    layerVisible: LayerVisibleState,
    layerPartVisible: LayerPartVisibleState,
    workSize: number,
    fallback: THREE.Texture
  ): THREE.Texture {
    const masked = buildLayerMaskedCanvas(skinCanvas, layerVisible, layerPartVisible, workSize);
    if (!masked) return fallback;
    if (!maskTexture) maskTexture = createPixelSkinTexture(masked);
    maskTexture.source.data = masked;
    maskTexture.needsUpdate = true;
    return maskTexture;
  }

  /** Draw `baseImage`, then paste only `part`'s regions of `skinImage` over it (whole skin when part is null). */
  function composePreviewSkinCanvas(
    baseImage: HTMLImageElement | null,
    skinImage: HTMLImageElement,
    part: PreviewRoutePartKey | null
  ): HTMLCanvasElement {
    if (!previewCanvas) {
      previewCanvas = document.createElement('canvas');
      previewCanvas.width = 64;
      previewCanvas.height = 64;
    }
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return previewCanvas;

    ctx.clearRect(0, 0, 64, 64);
    ctx.imageSmoothingEnabled = false;
    const skinSize = skinImage.naturalWidth || skinImage.width || 64;

    if (!part) {
      ctx.drawImage(skinImage, 0, 0, skinSize, skinSize, 0, 0, 64, 64);
      return previewCanvas;
    }

    if (baseImage) {
      const baseSize = baseImage.naturalWidth || baseImage.width || 64;
      ctx.drawImage(baseImage, 0, 0, baseSize, baseSize, 0, 0, 64, 64);
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 64;
    sourceCanvas.height = 64;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) return previewCanvas;
    sourceCtx.imageSmoothingEnabled = false;
    sourceCtx.drawImage(skinImage, 0, 0, skinSize, skinSize, 0, 0, 64, 64);

    for (const rect of getPartBounds(part)) {
      ctx.putImageData(sourceCtx.getImageData(rect.x, rect.y, rect.w, rect.h), rect.x, rect.y);
    }
    return previewCanvas;
  }

  /** Reusable texture for the preview route, pointed at `canvas`. */
  function getPreviewTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    if (!previewTexture) previewTexture = createPixelSkinTexture(canvas);
    previewTexture.source.data = canvas;
    previewTexture.needsUpdate = true;
    return previewTexture;
  }

  return { buildLayerMaskedCanvas, buildVisibilityTexture, composePreviewSkinCanvas, getPreviewTexture };
}

export type SkinCompositor = ReturnType<typeof createSkinCompositor>;
