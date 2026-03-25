/**
 * Wardrobe logic: composite outfit from base skin + library parts.
 * Handles wardrobeSelections, wardrobeLibraries, resolveWardrobeComposite,
 * captureWardrobeBaseFromCurrentCanvas, applyWardrobePartSelection, selectWardrobeOutfit,
 * loadWardrobeImage, clearPartBoundsToTransparent, captureWardrobeOriginalPreviews,
 * ensureWardrobeLibrariesLoaded, renderWardrobeLibraries, syncWardrobeLibraryActiveStates,
 * showWardrobeLibraryPanel, hideAllWardrobeLibraryPanels.
 */

import {
  SKIN_LAYER_BOUNDS,
  WORK_SIZE,
  RESOLUTION_MULTIPLIER,
  getPartBounds,
  WARDROBE_COMPOSITE_KEYS,
} from '../skin';
import { cloneImageData } from './canvasCoords';
import { clearModeAnimClasses, setModePanelHidden, MODE_TRANSITION_MS } from './modePanels';
import type { SkinEntry } from '../domain';
import type { WardrobeLayerKey, WardrobePartKey } from './wardrobePartsPanel';
import { WARDROBE_PART_KEYS } from './wardrobePartsPanel';
import {
  buildWardrobeLibraryPanels,
  renderWardrobeLibraryPanel,
  WARDROBE_PART_PANEL_CONFIGS,
  getWardrobePanelIdForLayer,
} from './wardrobeLibraryPanels';
import { creatorWardrobeFocusSlice } from '../state/creatorSlices';

/** Sentinel for "use base skin" on overlay parts. Base parts use null. */
export const WARDROBE_ORIGINAL = '__original__' as const;
const WARDROBE_OVERLAY_KEYS = ['hat', 'jacket', 'sleeves', 'pants'] as const;

type WardrobeSelectionState = Record<WardrobePartKey, string | null>;
type WardrobeLibraryState = Record<WardrobePartKey, SkinEntry[]>;

export type WardrobeDeps = {
  getSkinCanvas: () => HTMLCanvasElement;
  captureCanvasImageData: (canvas: HTMLCanvasElement) => ImageData | null;
  applyProgrammaticCanvasImage: (data: ImageData) => void;
  onLoadSkin: (path: string) => Promise<void>;
  getCapture3DThumbnail: () => ((size: number) => Promise<string | null>) | null;
  getCapture3DPartThumbnail: () => ((part: WardrobePartKey, size: number) => Promise<string | null>) | null;
  getCreatorCanvasPopulated: () => boolean;
  getCreatorCurrentSkinPath: () => string | null;
  getEditMode: () => 'wardrobe' | '2d' | '3d';
  updateAllUndoRedoButtons: () => void;
  renderToDisplay: () => void;
  animateModePanelIn: (el: HTMLElement, dir: 'left' | 'right' | 'top' | 'bottom') => void;
  animateModePanelOut: (el: HTMLElement, dir: 'left' | 'right' | 'top' | 'bottom') => void;
};

export type WardrobeApi = {
  captureWardrobeBaseFromCurrentCanvas: (path?: string | null) => void;
  applyWardrobePartSelection: (part: WardrobePartKey, path: string | null) => Promise<void>;
  selectWardrobeOutfit: (path: string) => Promise<void>;
  resolveWardrobeComposite: () => Promise<void>;
  loadWardrobeImage: (path: string) => Promise<HTMLImageElement>;
  clearPartBoundsToTransparent: (destCtx: CanvasRenderingContext2D, part: WardrobePartKey) => void;
  ensureWardrobeLibrariesLoaded: () => Promise<void>;
  renderWardrobeLibraries: () => void;
  syncWardrobeLibraryActiveStates: () => void;
  setWardrobeSelectedLayer: (layer: WardrobeLayerKey) => void;
  getWardrobeSelectedLayer: () => WardrobeLayerKey;
  resetWardrobeSelections: () => void;
  hasWardrobeLibrarySelection: () => boolean;
  showWardrobeLibraryPanel: (layer: WardrobeLayerKey | null) => void;
  hideAllWardrobeLibraryPanels: () => void;
  getWardrobeBaseSkinPath: () => string | null;
};

export function createWardrobeApi(deps: WardrobeDeps): WardrobeApi {
  const {
    getSkinCanvas,
    captureCanvasImageData,
    applyProgrammaticCanvasImage,
    onLoadSkin,
    getCapture3DThumbnail,
    getCapture3DPartThumbnail,
    getCreatorCanvasPopulated,
    getCreatorCurrentSkinPath,
    getEditMode,
    updateAllUndoRedoButtons,
    renderToDisplay,
    animateModePanelIn,
    animateModePanelOut,
  } = deps;

  let wardrobeSelectedLayer: WardrobeLayerKey = 'fullOutfit';
  let wardrobeCompositeToken = 0;
  let wardrobeBaseSkinPath: string | null = null;
  let wardrobeBaseSkinData: ImageData | null = null;
  let wardrobeLibrariesLoaded = false;
  let wardrobeLibrariesPromise: Promise<void> | null = null;
  const wardrobeImageCache = new Map<string, Promise<HTMLImageElement>>();
  const wardrobeSelections: WardrobeSelectionState = {
    hat: WARDROBE_ORIGINAL,
    head: null,
    jacket: WARDROBE_ORIGINAL,
    body: null,
    arms: null,
    sleeves: WARDROBE_ORIGINAL,
    pants: WARDROBE_ORIGINAL,
    legs: null,
    torso: null,
    jacketGroup: null,
    bottom: null,
    center: null,
    top: null,
    all: null,
  };
  const wardrobeLibraries: WardrobeLibraryState = {
    hat: [],
    head: [],
    jacket: [],
    body: [],
    arms: [],
    sleeves: [],
    pants: [],
    legs: [],
    torso: [],
    jacketGroup: [],
    bottom: [],
    center: [],
    top: [],
    all: [],
  };
  const wardrobeOriginalPreviews: Record<WardrobePartKey, string | null> = {
    hat: null,
    head: null,
    jacket: null,
    body: null,
    arms: null,
    sleeves: null,
    pants: null,
    legs: null,
    torso: null,
    jacketGroup: null,
    bottom: null,
    center: null,
    top: null,
    all: null,
  };
  let wardrobeOriginalPreviewSignature = '';
  let wardrobeOriginalCaptureToken = 0;
  let wardrobePanelTransitionToken = 0;

  function clearWardrobePanelAnim(el: HTMLElement): void {
    clearModeAnimClasses(el);
  }

  function hideAllWardrobeLibraryPanels(): void {
    const panels = document.querySelectorAll<HTMLElement>('.creator-wardrobe-library-panel');
    panels.forEach((panel) => {
      clearWardrobePanelAnim(panel);
      setModePanelHidden(panel, true);
    });
  }

  function showWardrobeLibraryPanel(layer: WardrobeLayerKey | null): void {
    const targetPanelId = layer ? getWardrobePanelIdForLayer(layer) : null;
    const targetPanel = targetPanelId ? (document.getElementById(targetPanelId) as HTMLElement | null) : null;
    const currentPanel = document.querySelector<HTMLElement>(
      '.creator-wardrobe-library-panel:not(.creator-mode-panel-hidden)'
    );

    if (!targetPanel) {
      hideAllWardrobeLibraryPanels();
      return;
    }

    if (!currentPanel || currentPanel === targetPanel) {
      clearWardrobePanelAnim(targetPanel);
      setModePanelHidden(targetPanel, false);
      return;
    }

    const token = ++wardrobePanelTransitionToken;
    animateModePanelOut(currentPanel, 'right');

    window.setTimeout(() => {
      if (token !== wardrobePanelTransitionToken) return;
      clearModeAnimClasses(currentPanel);
      setModePanelHidden(currentPanel, true);
      animateModePanelIn(targetPanel, 'right');
    }, MODE_TRANSITION_MS);
  }

  function setWardrobeSelectedLayer(layer: WardrobeLayerKey): void {
    wardrobeSelectedLayer = layer;
    creatorWardrobeFocusSlice.notify();
    const isBasePart = layer === 'head' || layer === 'body' || layer === 'arms' || layer === 'legs';
    if (isBasePart && wardrobeSelections[layer] !== null) {
      wardrobeSelections[layer] = null;
      syncWardrobeLibraryActiveStates();
      void resolveWardrobeComposite();
    }
    showWardrobeLibraryPanel(getEditMode() === 'wardrobe' ? layer : null);
  }

  function resetWardrobeSelections(): void {
    wardrobeCompositeToken += 1;
    for (const part of WARDROBE_PART_KEYS) {
      wardrobeSelections[part] = WARDROBE_OVERLAY_KEYS.includes(part as (typeof WARDROBE_OVERLAY_KEYS)[number])
        ? WARDROBE_ORIGINAL
        : null;
    }
  }

  function captureWardrobeBaseFromCurrentCanvas(path: string | null = getCreatorCurrentSkinPath()): void {
    if (!getCreatorCanvasPopulated()) return;
    const snapshot = captureCanvasImageData(getSkinCanvas());
    if (!snapshot) return;
    wardrobeBaseSkinData = snapshot;
    wardrobeBaseSkinPath = path;
    wardrobeOriginalPreviewSignature = '';
    if (getEditMode() === 'wardrobe') {
      ensureWardrobeOriginalPreviewsScheduled();
    }
  }

  function hasWardrobeLibrarySelection(): boolean {
    return WARDROBE_PART_KEYS.some(
      (part) => wardrobeSelections[part] != null && wardrobeSelections[part] !== WARDROBE_ORIGINAL
    );
  }

  function loadWardrobeImage(path: string): Promise<HTMLImageElement> {
    const cached = wardrobeImageCache.get(path);
    if (cached) return cached;
    const pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load wardrobe part: ${path}`));
      img.src = path;
    });
    wardrobeImageCache.set(path, pending);
    return pending;
  }

  function clearPartBoundsToTransparent(destCtx: CanvasRenderingContext2D, part: WardrobePartKey): void {
    const bounds = getPartBounds(part);
    const scale = RESOLUTION_MULTIPLIER;
    bounds.forEach((rect) => {
      const x = rect.x * scale;
      const y = rect.y * scale;
      const w = rect.w * scale;
      const h = rect.h * scale;
      const imgData = destCtx.getImageData(x, y, w, h);
      imgData.data.fill(0, 0, imgData.data.length);
      destCtx.putImageData(imgData, x, y);
    });
  }

  async function resolveWardrobeComposite(): Promise<void> {
    if (!wardrobeBaseSkinData) return;
    const token = ++wardrobeCompositeToken;
    const result = cloneImageData(wardrobeBaseSkinData);
    const destCanvas = document.createElement('canvas');
    destCanvas.width = WORK_SIZE;
    destCanvas.height = WORK_SIZE;
    const destCtx = destCanvas.getContext('2d', { willReadFrequently: true });
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = WORK_SIZE;
    srcCanvas.height = WORK_SIZE;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    if (!destCtx || !srcCtx) return;
    destCtx.putImageData(result, 0, 0);
    srcCtx.imageSmoothingEnabled = false;

    for (const part of WARDROBE_PART_KEYS) {
      const selected = wardrobeSelections[part];
      const isOverlay =
        (WARDROBE_OVERLAY_KEYS as readonly string[]).includes(part) &&
        !WARDROBE_COMPOSITE_KEYS.includes(part as (typeof WARDROBE_COMPOSITE_KEYS)[number]);

      if (selected === null) {
        if (isOverlay) {
          clearPartBoundsToTransparent(destCtx, part);
        }
        continue;
      }
      if (selected === WARDROBE_ORIGINAL) {
        continue;
      }

      let img: HTMLImageElement;
      try {
        img = await loadWardrobeImage(selected);
      } catch {
        continue;
      }
      if (token !== wardrobeCompositeToken) return;

      srcCtx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
      srcCtx.drawImage(img, 0, 0, WORK_SIZE, WORK_SIZE);
      const bounds = getPartBounds(part);
      bounds.forEach((rect) => {
        const x = rect.x * RESOLUTION_MULTIPLIER;
        const y = rect.y * RESOLUTION_MULTIPLIER;
        const w = rect.w * RESOLUTION_MULTIPLIER;
        const h = rect.h * RESOLUTION_MULTIPLIER;
        const partData = srcCtx.getImageData(x, y, w, h);
        destCtx.putImageData(partData, x, y);
      });
    }

    if (token !== wardrobeCompositeToken) return;
    const composed = destCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
    applyProgrammaticCanvasImage(composed);
    renderToDisplay();
    updateAllUndoRedoButtons();
  }

  async function applyWardrobePartSelection(part: WardrobePartKey, path: string | null): Promise<void> {
    if (!wardrobeBaseSkinData) {
      captureWardrobeBaseFromCurrentCanvas(getCreatorCurrentSkinPath());
    }
    wardrobeSelections[part] = path;
    syncWardrobeLibraryActiveStates();
    await resolveWardrobeComposite();
  }

  async function selectWardrobeOutfit(path: string): Promise<void> {
    resetWardrobeSelections();
    await onLoadSkin(path);
    captureWardrobeBaseFromCurrentCanvas(path);
    void resolveWardrobeComposite();
    renderWardrobeLibraries();
  }

  function getWardrobeOriginalPreviewSignature(): string {
    return (wardrobeBaseSkinPath ?? 'default') + '_' + (wardrobeBaseSkinData ? '1' : '0');
  }

  const WARDROBE_ORIGINAL_CAPTURE_MAX_RETRIES = 20;

  async function captureWardrobeOriginalPreviews(retryCount = 0): Promise<void> {
    if (!wardrobeBaseSkinData) return;
    const token = ++wardrobeOriginalCaptureToken;
    await resolveWardrobeComposite();
    if (token !== wardrobeOriginalCaptureToken) return;

    const capturePart = getCapture3DPartThumbnail();
    if (!capturePart) {
      if (retryCount < WARDROBE_ORIGINAL_CAPTURE_MAX_RETRIES) {
        window.setTimeout(() => void captureWardrobeOriginalPreviews(retryCount + 1), 150);
      }
      return;
    }

    const partKeys: WardrobePartKey[] = [
      'hat',
      'head',
      'jacket',
      'body',
      'arms',
      'sleeves',
      'pants',
      'legs',
      ...WARDROBE_COMPOSITE_KEYS,
    ];
    let successCount = 0;
    for (const part of partKeys) {
      if (token !== wardrobeOriginalCaptureToken) return;
      try {
        const dataUrl = await capturePart(part, 128);
        if (token !== wardrobeOriginalCaptureToken) return;
        if (dataUrl) {
          wardrobeOriginalPreviews[part] = dataUrl;
          successCount++;
        }
      } catch {
        // ignore per-part failures
      }
    }
    if (token !== wardrobeOriginalCaptureToken) return;

    if (successCount > 0) {
      wardrobeOriginalPreviewSignature = getWardrobeOriginalPreviewSignature();
      renderWardrobeLibraries();
    } else if (retryCount < WARDROBE_ORIGINAL_CAPTURE_MAX_RETRIES) {
      window.setTimeout(() => void captureWardrobeOriginalPreviews(retryCount + 1), 150);
    }
  }

  function ensureWardrobeOriginalPreviewsScheduled(): void {
    if (!wardrobeBaseSkinData) return;
    const currentSig = getWardrobeOriginalPreviewSignature();
    if (wardrobeOriginalPreviewSignature === currentSig) return;
    void captureWardrobeOriginalPreviews();
  }

  function renderWardrobeLibraries(): void {
    ensureWardrobeOriginalPreviewsScheduled();

    WARDROBE_PART_PANEL_CONFIGS.forEach((config) => {
      const isOverlay = (WARDROBE_OVERLAY_KEYS as readonly string[]).includes(config.key);
      renderWardrobeLibraryPanel({
        selectorId: config.selectorId,
        items: wardrobeLibraries[config.key],
        activeValue: wardrobeSelections[config.key],
        includeNone: isOverlay,
        noneLabel: config.noneLabel,
        includeOriginal: true,
        originalLabel: 'Original',
        originalPreview: wardrobeOriginalPreviews[config.key],
        originalSentinel: WARDROBE_ORIGINAL,
        onSelect: (value) => {
          void applyWardrobePartSelection(config.key, value);
        },
      });
    });
    syncWardrobeLibraryActiveStates();
  }

  function syncWardrobeLibraryActiveStates(): void {
    const activeOutfitPath = wardrobeBaseSkinPath ?? getCreatorCurrentSkinPath();
    const outfitsContainer = document.getElementById('creator-skin-selector');
    if (outfitsContainer) {
      outfitsContainer.querySelectorAll<HTMLElement>('.creator-skin-preview').forEach((el) => {
        el.classList.toggle('active', el.dataset.path === activeOutfitPath);
      });
    }

    WARDROBE_PART_PANEL_CONFIGS.forEach((config) => {
      const selector = document.getElementById(config.selectorId);
      if (!selector) return;
      const activeValue = wardrobeSelections[config.key];
      const isBasePanel = !(WARDROBE_OVERLAY_KEYS as readonly string[]).includes(config.key);
      selector.querySelectorAll<HTMLElement>('.creator-wardrobe-library-item').forEach((el) => {
        const isNone = el.dataset.none === '1';
        const isOriginal = el.dataset.original === '1';
        const isActive = isNone
          ? activeValue === null
          : isOriginal
            ? activeValue === WARDROBE_ORIGINAL || (isBasePanel && activeValue === null)
            : el.dataset.path === activeValue;
        el.classList.toggle('active', isActive);
      });
    });
  }

  async function ensureWardrobeLibrariesLoaded(): Promise<void> {
    if (wardrobeLibrariesLoaded) {
      renderWardrobeLibraries();
      return;
    }
    if (wardrobeLibrariesPromise) {
      await wardrobeLibrariesPromise;
      return;
    }

    wardrobeLibrariesPromise = (async () => {
      buildWardrobeLibraryPanels();
      await Promise.all(
        WARDROBE_PART_PANEL_CONFIGS.map(async (config) => {
          try {
            const res = await fetch(`/wardrobe/parts/${config.key}/index.json`);
            const data = await res.json();
            wardrobeLibraries[config.key] = Array.isArray(data) ? data : [];
          } catch {
            wardrobeLibraries[config.key] = [];
          }
        })
      );
      wardrobeLibrariesLoaded = true;
      renderWardrobeLibraries();
    })();

    try {
      await wardrobeLibrariesPromise;
    } finally {
      wardrobeLibrariesPromise = null;
    }
  }

  return {
    captureWardrobeBaseFromCurrentCanvas,
    applyWardrobePartSelection,
    selectWardrobeOutfit,
    resolveWardrobeComposite,
    loadWardrobeImage,
    clearPartBoundsToTransparent,
    ensureWardrobeLibrariesLoaded,
    renderWardrobeLibraries,
    syncWardrobeLibraryActiveStates,
    setWardrobeSelectedLayer,
    getWardrobeSelectedLayer: () => wardrobeSelectedLayer,
    resetWardrobeSelections,
    hasWardrobeLibrarySelection,
    showWardrobeLibraryPanel,
    hideAllWardrobeLibraryPanels,
    getWardrobeBaseSkinPath: () => wardrobeBaseSkinPath,
  };
}
