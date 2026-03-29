import type { WardrobeLayerKey } from './wardrobeLayers';
import { WARDROBE_LIBRARY_SELECTOR_CLOSEST } from './wardrobeDom';
import { creatorWardrobeHoverPreviewSlice } from '../state/creatorSlices';

let wardrobeHoverPreviewLayer: WardrobeLayerKey | null = null;
type WardrobeHoverPreviewSource = 'layerPanel' | 'selectorPanel' | null;
let wardrobeHoverPreviewSource: WardrobeHoverPreviewSource = null;

export function getWardrobeHoverPreviewLayer(): WardrobeLayerKey | null {
  return wardrobeHoverPreviewLayer;
}

export function getWardrobeHoverPreviewSource(): WardrobeHoverPreviewSource {
  return wardrobeHoverPreviewSource;
}

/** Clears hover without notifying (caller will notify, e.g. wardrobe selection change). */
export function clearWardrobeHoverPreviewSilently(): void {
  wardrobeHoverPreviewLayer = null;
  wardrobeHoverPreviewSource = null;
}

function notifyWardrobeHoverPreview(): void {
  creatorWardrobeHoverPreviewSlice.notify({
    layer: wardrobeHoverPreviewLayer,
    source: wardrobeHoverPreviewSource,
  });
}

function setWardrobeHoverPreview(
  layer: WardrobeLayerKey | null,
  source: WardrobeHoverPreviewSource
): void {
  if (wardrobeHoverPreviewLayer === layer && wardrobeHoverPreviewSource === source) return;
  wardrobeHoverPreviewLayer = layer;
  wardrobeHoverPreviewSource = source;
  notifyWardrobeHoverPreview();
}

export function setWardrobeLayerPanelHoverPreviewLayer(layer: WardrobeLayerKey | null): void {
  setWardrobeHoverPreview(layer, layer == null ? null : 'layerPanel');
}

export function setWardrobeSelectorPanelHoverPreviewLayer(layer: WardrobeLayerKey | null): void {
  setWardrobeHoverPreview(layer, layer == null ? null : 'selectorPanel');
}

export function subscribeWardrobeHoverPreview(
  cb: (detail: { layer: WardrobeLayerKey | null; source: WardrobeHoverPreviewSource }) => void
): () => void {
  return creatorWardrobeHoverPreviewSlice.subscribe(cb);
}

/**
 * Fast pointer motion can skip `pointerleave` on the wardrobe tree; sync hover from pointer
 * position so the camera returns to the selected layer when the pointer is not over the tree
 * (or when handing off to library selectors).
 */
if (typeof document !== 'undefined') {
  let layerPanelPointerRaf = 0;
  let latestPointerX = 0;
  let latestPointerY = 0;
  document.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (document.body.dataset.editMode !== 'wardrobe') return;
      if (getWardrobeHoverPreviewSource() !== 'layerPanel') return;
      latestPointerX = e.clientX;
      latestPointerY = e.clientY;
      if (layerPanelPointerRaf) return;
      layerPanelPointerRaf = requestAnimationFrame(() => {
        layerPanelPointerRaf = 0;
        if (document.body.dataset.editMode !== 'wardrobe') return;
        if (getWardrobeHoverPreviewSource() !== 'layerPanel') return;
        const panel = document.getElementById('creator-wardrobe-parts-panel');
        if (!panel) return;
        const el = document.elementFromPoint(latestPointerX, latestPointerY);
        if (el && panel.contains(el)) return;
        if (el instanceof Element && el.closest(WARDROBE_LIBRARY_SELECTOR_CLOSEST)) {
          return;
        }
        setWardrobeLayerPanelHoverPreviewLayer(null);
      });
    },
    { capture: true }
  );
}
