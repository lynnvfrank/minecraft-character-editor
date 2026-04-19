/**
 * Wardrobe logic: composite outfit from base skin + library parts.
 * Handles wardrobeSelections, wardrobeLibraries, resolveWardrobeComposite,
 * captureWardrobeBaseFromCurrentCanvas, applyWardrobePartSelection, selectWardrobeOutfit,
 * loadWardrobeImage, clearPartBoundsToTransparent,
 * ensureWardrobeLibrariesLoaded, renderWardrobeLibraries, syncWardrobeLibraryActiveStates,
 * showWardrobeLibraryPanel, hideAllWardrobeLibraryPanels.
 */

import {
  WORK_SIZE,
  RESOLUTION_MULTIPLIER,
  getPartBounds,
  WARDROBE_COMPOSITE_KEYS,
  isLayerKey,
} from '../skin';
import { cloneImageData } from './canvasCoords';
import { CREATOR_WARDROBE_LIBRARY_PANEL_TRANSITION_MS } from '../config/creatorWardrobeMotion';
import { clearModeAnimClasses, setModePanelHidden } from './modePanels';
import type { SkinEntry } from '../domain';
import {
  areWardrobeLayersSameDualLibraryPair,
  isWardrobeDualLibrarySplitLayer,
  type WardrobeLayerKey,
  type WardrobePartKey,
  WARDROBE_PART_KEYS,
} from './wardrobeLayers';
import {
  buildWardrobeLibraryPanels,
  ensureWardrobeLibraryHoverPreviewBound,
  getWardrobeLibraryPanelIdsForLayer,
  renderWardrobeLibraryPanel,
  WARDROBE_PART_PANEL_CONFIGS,
} from './wardrobeLibraryPanels';
import { creatorWardrobeFocusSlice } from '../state/creatorSlices';
import {
  clearWardrobeHoverPreviewSilently,
  subscribeWardrobeHoverPreview,
} from './wardrobeHoverPreview';

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
  getCreatorCanvasPopulated: () => boolean;
  getCreatorCurrentSkinPath: () => string | null;
  getEditMode: () => 'wardrobe' | '2d' | '3d';
  updateAllUndoRedoButtons: () => void;
  renderToDisplay: () => void;
  animateModePanelIn: (el: HTMLElement, dir: 'left' | 'right' | 'top' | 'bottom') => void;
  animateModePanelOut: (el: HTMLElement, dir: 'left' | 'right' | 'top' | 'bottom') => void;
  getFocusedCreationEnabled: () => boolean;
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
  flushDeferredWardrobeLibraryPanelsAfterCamera: () => void;
};

export function createWardrobeApi(deps: WardrobeDeps): WardrobeApi {
  const {
    getSkinCanvas,
    captureCanvasImageData,
    applyProgrammaticCanvasImage,
    onLoadSkin,
    getCreatorCanvasPopulated,
    getCreatorCurrentSkinPath,
    getEditMode,
    updateAllUndoRedoButtons,
    renderToDisplay,
    animateModePanelIn,
    animateModePanelOut,
    getFocusedCreationEnabled,
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
  let wardrobePreviewSelections: WardrobeSelectionState | null = null;
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
  let wardrobePanelTransitionToken = 0;
  let outfitsHoverPreviewBound = false;
  let prevWardrobeHoverLayer: WardrobeLayerKey | null = null;
  let prevWardrobeHoverSource: 'layerPanel' | 'selectorPanel' | null = null;
  /** When true, `showWardrobeLibraryPanel` for the selection is deferred until camera restore finishes (focused mode). */
  let deferLibraryPanelRevealUntilCamera = false;

  function clearWardrobePanelAnim(el: HTMLElement): void {
    clearModeAnimClasses(el);
  }

  function hideAllWardrobeLibraryPanels(): void {
    const root = document.getElementById('creator-upper-right-panels-root');
    const currentIds = getVisibleWardrobeLibraryPanelIds();

    if (currentIds.length === 0) {
      root?.classList.remove('creator-upper-right-panels-root--wardrobe-dual-libraries');
      root?.classList.remove('creator-upper-right-panels-root--wardrobe-single-library');
      return;
    }

    // Moving across non-selected tree rows fires hide repeatedly; restarting exit anim each time wiggles the panels.
    const outRightClass = 'creator-mode-anim-out-right';
    const allAlreadyExiting = currentIds.every((id) => {
      const el = document.getElementById(id) as HTMLElement | null;
      return el != null && el.classList.contains(outRightClass);
    });
    if (allAlreadyExiting) {
      return;
    }

    const token = ++wardrobePanelTransitionToken;

    for (const id of currentIds) {
      const el = document.getElementById(id) as HTMLElement | null;
      if (el) animateModePanelOut(el, 'right');
    }

    const delayMs = currentIds.length > 0 ? CREATOR_WARDROBE_LIBRARY_PANEL_TRANSITION_MS : 0;
    window.setTimeout(() => {
      if (token !== wardrobePanelTransitionToken) return;
      document.querySelectorAll<HTMLElement>('.creator-wardrobe-library-panel').forEach((panel) => {
        clearWardrobePanelAnim(panel);
        setModePanelHidden(panel, true);
      });
      root?.classList.remove('creator-upper-right-panels-root--wardrobe-dual-libraries');
      root?.classList.remove('creator-upper-right-panels-root--wardrobe-single-library');
    }, delayMs);
  }

  function getVisibleWardrobeLibraryPanelIds(): string[] {
    const panels = document.querySelectorAll<HTMLElement>('.creator-wardrobe-library-panel');
    return Array.from(panels)
      .filter((el) => !el.classList.contains('creator-mode-panel-hidden'))
      .map((el) => el.id)
      .filter(Boolean);
  }

  function panelSetsEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    return b.every((id) => sa.has(id));
  }

  function showWardrobeLibraryPanel(layer: WardrobeLayerKey | null): void {
    const root = document.getElementById('creator-upper-right-panels-root');
    const targetIds = getWardrobeLibraryPanelIdsForLayer(layer);
    const currentIds = getVisibleWardrobeLibraryPanelIds();

    if (targetIds.length === 0) {
      hideAllWardrobeLibraryPanels();
      return;
    }

    // Invalidate any in-flight hide-all or cross-fade (e.g. fast hover away then back to selection).
    const token = ++wardrobePanelTransitionToken;
    const isDualLibraries = layer != null && isWardrobeDualLibrarySplitLayer(layer);
    root?.classList.toggle('creator-upper-right-panels-root--wardrobe-dual-libraries', isDualLibraries);
    root?.classList.toggle(
      'creator-upper-right-panels-root--wardrobe-single-library',
      !isDualLibraries && targetIds.length > 0,
    );

    if (panelSetsEqual(currentIds, targetIds)) {
      for (const id of targetIds) {
        const el = document.getElementById(id) as HTMLElement | null;
        if (el) {
          clearWardrobePanelAnim(el);
          setModePanelHidden(el, false);
        }
      }
      return;
    }

    const targetSet = new Set(targetIds);
    const toHide = currentIds.filter((id) => !targetSet.has(id));

    const outRightClass = 'creator-mode-anim-out-right';
    for (const id of toHide) {
      const el = document.getElementById(id) as HTMLElement | null;
      if (!el) continue;
      if (el.classList.contains(outRightClass)) continue;
      animateModePanelOut(el, 'right');
    }

    const delayMs = toHide.length > 0 ? CREATOR_WARDROBE_LIBRARY_PANEL_TRANSITION_MS : 0;
    window.setTimeout(() => {
      if (token !== wardrobePanelTransitionToken) return;
      for (const id of toHide) {
        const el = document.getElementById(id) as HTMLElement | null;
        if (el) {
          clearModeAnimClasses(el);
          setModePanelHidden(el, true);
        }
      }
      for (const id of targetIds) {
        const el = document.getElementById(id) as HTMLElement | null;
        if (!el) continue;
        clearWardrobePanelAnim(el);
        animateModePanelIn(el, 'right');
      }
    }, delayMs);
  }

  function setWardrobeSelectedLayer(layer: WardrobeLayerKey): void {
    clearWardrobeHoverPreviewSilently();
    deferLibraryPanelRevealUntilCamera = false;
    wardrobePreviewSelections = null;
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
    wardrobePreviewSelections = null;
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
  }

  function hasWardrobeLibrarySelection(): boolean {
    return WARDROBE_PART_KEYS.some(
      (part) => wardrobeSelections[part] != null && wardrobeSelections[part] !== WARDROBE_ORIGINAL
    );
  }

  function getEffectiveSelections(): WardrobeSelectionState {
    return wardrobePreviewSelections ?? wardrobeSelections;
  }

  function bindOutfitsHoverPreview(): void {
    if (outfitsHoverPreviewBound) return;
    const container = document.getElementById('creator-skin-selector');
    if (!container) return;
    outfitsHoverPreviewBound = true;
    container.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement | null;
      const item = target?.closest('.creator-skin-preview') as HTMLElement | null;
      if (!item) return;
      if (getEditMode() !== 'wardrobe') return;
      const path = item.dataset.path;
      if (!path) return;
      wardrobePreviewSelections = { ...wardrobeSelections, all: path };
      void resolveWardrobeComposite(wardrobePreviewSelections);
      syncWardrobeLibraryActiveStates();
    });
    container.addEventListener('mouseleave', () => {
      if (getEditMode() !== 'wardrobe') return;
      if (!wardrobePreviewSelections) return;
      wardrobePreviewSelections = null;
      void resolveWardrobeComposite(wardrobeSelections);
      syncWardrobeLibraryActiveStates();
    });
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

  /**
   * Default order paints upper atomics before `torso` / `center`, so composite images would
   * overwrite atomic previews. Committed state clears overlapping composites when atomics win.
   * For hover preview we keep composites + atomics — draw `center` before jacket/body/sleeves/arms
   * and `torso` before body/arms so library hovers only replace matching UVs.
   */
  function getWardrobeResolvePartOrder(): readonly WardrobePartKey[] {
    const keys = [...WARDROBE_PART_KEYS];
    const torsoIdx = keys.indexOf('torso');
    if (torsoIdx !== -1) keys.splice(torsoIdx, 1);
    const centerIdx = keys.indexOf('center');
    if (centerIdx !== -1) keys.splice(centerIdx, 1);
    const jacketIdx = keys.indexOf('jacket');
    if (jacketIdx !== -1) keys.splice(jacketIdx, 0, 'center');
    const bodyIdx = keys.indexOf('body');
    if (bodyIdx !== -1) keys.splice(bodyIdx, 0, 'torso');
    return keys;
  }

  async function resolveWardrobeComposite(
    selections: WardrobeSelectionState = getEffectiveSelections()
  ): Promise<void> {
    if (!wardrobeBaseSkinData) {
      return;
    }
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

    for (const part of getWardrobeResolvePartOrder()) {
      const selected = selections[part];
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
    // Persist base only for committed resolves — not for `wardrobePreviewSelections` hover passes.
    // Otherwise ORIGINAL/skipped layers keep pixels from the last hover after mouseleave.
    const isHoverPreviewPass =
      wardrobePreviewSelections != null && selections === wardrobePreviewSelections;
    if (!isHoverPreviewPass) {
      wardrobeBaseSkinData = cloneImageData(composed);
    }
    applyProgrammaticCanvasImage(composed);
    renderToDisplay();
    updateAllUndoRedoButtons();
  }

  /**
   * Composites are painted after atomics in resolve order; a stale composite path would
   * overwrite valid atomics (e.g. top after user picks a head library item).
   * Composite rows (`torso`, `center`, `jacketGroup`) exclude each other when picking another composite;
   * atomic chest/arms/jacket/sleeves selections clear `torso` and `jacketGroup` but keep `center` so the
   * composite still supplies regions the atomics do not paint.
   * Atomic body/arms/jacket/sleeves commits keep `center` as well — {@link getWardrobeResolvePartOrder}
   * paints `center` before atomics so e.g. chest can switch to an atomic body while arms stay from Upper Body.
   * Hover previews also keep `torso` / `jacketGroup` until commit where applicable.
   */
  function applyMutuallyExclusiveCompositeClears(
    selections: WardrobeSelectionState,
    partBeingSet: WardrobePartKey,
    options?: { hoverPreview?: boolean }
  ): void {
    const hoverPreview = options?.hoverPreview === true;
    selections.all = null;

    if (
      partBeingSet === 'torso' ||
      partBeingSet === 'center' ||
      partBeingSet === 'jacketGroup'
    ) {
      if (partBeingSet !== 'torso') selections.torso = null;
      if (partBeingSet !== 'center') {
        // Hovering the Jacket composite strip (`jacketGroup`) must not drop a committed Upper
        // Body (`center`) until the user commits — same idea as atomic hover preserving composites.
        if (!(hoverPreview && partBeingSet === 'jacketGroup')) {
          selections.center = null;
        }
      }
      if (partBeingSet !== 'jacketGroup') selections.jacketGroup = null;
    }

    if (!isLayerKey(partBeingSet)) return;

    if (partBeingSet === 'head' || partBeingSet === 'hat') {
      selections.top = null;
    }
    if (
      partBeingSet === 'body' ||
      partBeingSet === 'arms' ||
      partBeingSet === 'jacket' ||
      partBeingSet === 'sleeves'
    ) {
      const preserveUpperCompositesOnAtomicHover =
        hoverPreview &&
        (partBeingSet === 'body' ||
          partBeingSet === 'arms' ||
          partBeingSet === 'jacket' ||
          partBeingSet === 'sleeves');
      if (!preserveUpperCompositesOnAtomicHover) {
        selections.jacketGroup = null;
        selections.torso = null;
        // Do not clear selections.center — it underlays these atomics in resolve order.
      }
    }
    if (partBeingSet === 'legs' || partBeingSet === 'pants') {
      selections.bottom = null;
    }
  }

  async function applyWardrobePartSelection(part: WardrobePartKey, path: string | null): Promise<void> {
    if (!wardrobeBaseSkinData) {
      captureWardrobeBaseFromCurrentCanvas(getCreatorCurrentSkinPath());
    }
    wardrobePreviewSelections = null;
    applyMutuallyExclusiveCompositeClears(wardrobeSelections, part);
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

  function renderWardrobeLibraries(): void {
    ensureWardrobeLibraryHoverPreviewBound();
    bindOutfitsHoverPreview();
    const effectiveSelections = getEffectiveSelections();

    WARDROBE_PART_PANEL_CONFIGS.forEach((config) => {
      const isOverlay = (WARDROBE_OVERLAY_KEYS as readonly string[]).includes(config.key);
      renderWardrobeLibraryPanel({
        partKey: config.key,
        selectorId: config.selectorId,
        items: wardrobeLibraries[config.key],
        activeValue: effectiveSelections[config.key],
        includeNone: isOverlay,
        noneLabel: config.noneLabel,
        onSelect: (value) => {
          void applyWardrobePartSelection(config.key, value);
        },
        onHoverStart: (value) => {
          if (getEditMode() !== 'wardrobe') return;
          const preview: WardrobeSelectionState = { ...wardrobeSelections };
          applyMutuallyExclusiveCompositeClears(preview, config.key, { hoverPreview: true });
          preview[config.key] = value;
          wardrobePreviewSelections = preview;
          void resolveWardrobeComposite(wardrobePreviewSelections);
          syncWardrobeLibraryActiveStates();
        },
        onHoverEnd: () => {
          if (!wardrobePreviewSelections) return;
          wardrobePreviewSelections = null;
          void resolveWardrobeComposite(wardrobeSelections);
          syncWardrobeLibraryActiveStates();
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
      const activeValue = getEffectiveSelections()[config.key];
      selector.querySelectorAll<HTMLElement>('.creator-wardrobe-library-item').forEach((el) => {
        const isNone = el.dataset.none === '1';
        const isActive = isNone
          ? activeValue === null
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

  function flushDeferredWardrobeLibraryPanelsAfterCamera(): void {
    if (!deferLibraryPanelRevealUntilCamera) return;
    deferLibraryPanelRevealUntilCamera = false;
    if (getEditMode() === 'wardrobe') {
      showWardrobeLibraryPanel(wardrobeSelectedLayer);
    }
  }

  subscribeWardrobeHoverPreview(({ source, layer }) => {
    if (getEditMode() !== 'wardrobe') {
      deferLibraryPanelRevealUntilCamera = false;
      prevWardrobeHoverLayer = layer;
      prevWardrobeHoverSource = source;
      return;
    }

    const hadOffSelectionLayerTreeHover =
      prevWardrobeHoverSource === 'layerPanel' &&
      prevWardrobeHoverLayer != null &&
      prevWardrobeHoverLayer !== wardrobeSelectedLayer &&
      !areWardrobeLayersSameDualLibraryPair(prevWardrobeHoverLayer, wardrobeSelectedLayer);

    if (source === 'layerPanel') {
      if (
        layer != null &&
        (layer === wardrobeSelectedLayer ||
          areWardrobeLayersSameDualLibraryPair(layer, wardrobeSelectedLayer))
      ) {
        deferLibraryPanelRevealUntilCamera = false;
        showWardrobeLibraryPanel(wardrobeSelectedLayer);
      } else {
        hideAllWardrobeLibraryPanels();
      }
      prevWardrobeHoverLayer = layer;
      prevWardrobeHoverSource = source;
      return;
    }

    if (layer == null && source == null && hadOffSelectionLayerTreeHover && getFocusedCreationEnabled()) {
      deferLibraryPanelRevealUntilCamera = true;
      prevWardrobeHoverLayer = layer;
      prevWardrobeHoverSource = source;
      return;
    }

    deferLibraryPanelRevealUntilCamera = false;
    showWardrobeLibraryPanel(wardrobeSelectedLayer);
    prevWardrobeHoverLayer = layer;
    prevWardrobeHoverSource = source;
  });

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
    flushDeferredWardrobeLibraryPanelsAfterCamera,
  };
}
