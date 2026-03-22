/**
 * Skin gallery: load from path, outfits panel, save/download, keyboard nav.
 * Handles loadSkinFromPath, setupCreatorSkinGallery, renderOutfitsPanel,
 * saveCurrentSkinToOutfits, downloadCurrentSkin, bindOutfitsKeyboardNav.
 */

import type { SkinEntry } from '../domain';
import type { CreatorState } from '../state';
import type { WardrobeApi } from './wardrobe';
import { extractColorsFromSkin } from './swatches';
import { CREATOR_EVENTS } from '../events/appEvents';

export type SkinGalleryDeps = {
  getSkinCanvas: () => HTMLCanvasElement;
  state: CreatorState;
  setCreatorCanvasPopulated: (v: boolean) => void;
  setCreatorCurrentSkinPath: (path: string | null) => void;
  wardrobeApi: WardrobeApi;
  publish: (event: string, detail?: unknown) => void;
  applyColorToUI: (hex: string, addToSwatchList?: boolean, markAsUserSelected?: boolean) => void;
  updateAllUndoRedoButtons: () => void;
  renderToDisplay: () => void;
  exportTo64x64DataURL: () => string;
  getCapture3DThumbnail: () => ((size: number) => Promise<string | null>) | null;
  loadSkinToCanvas: (
    path: string,
    canvas: HTMLCanvasElement,
    capture: (c: HTMLCanvasElement) => Uint8ClampedArray
  ) => Promise<{ beforeData: Uint8ClampedArray; afterData: Uint8ClampedArray } | null>;
  captureCanvasForUndo: (canvas: HTMLCanvasElement) => Uint8ClampedArray;
  pushUndoLoad: (beforeData: Uint8ClampedArray, afterData: Uint8ClampedArray) => void;
  swatchMax: number;
  getWardrobeBaseSkinPath: () => string | null;
};

let manifestOutfitSkins: SkinEntry[] = [];
const savedOutfitSkins: SkinEntry[] = [];

export type SkinGalleryApi = {
  loadSkinFromPath: (path: string) => Promise<void>;
  setupCreatorSkinGallery: (skins: SkinEntry[]) => void;
  renderOutfitsPanel: () => void;
  saveCurrentSkinToOutfits: () => Promise<void>;
  downloadCurrentSkin: () => void;
  bindOutfitsKeyboardNav: (container: HTMLElement) => void;
};

export function createSkinGalleryApi(deps: SkinGalleryDeps): SkinGalleryApi {
  const {
    getSkinCanvas,
    state,
    setCreatorCanvasPopulated,
    setCreatorCurrentSkinPath,
    wardrobeApi,
    publish,
    applyColorToUI,
    updateAllUndoRedoButtons,
    renderToDisplay,
    exportTo64x64DataURL,
    getCapture3DThumbnail,
    loadSkinToCanvas,
    captureCanvasForUndo,
    pushUndoLoad,
    swatchMax,
    getWardrobeBaseSkinPath,
  } = deps;

  async function loadSkinFromPath(path: string): Promise<void> {
    const canvas = getSkinCanvas();
    const result = await loadSkinToCanvas(path, canvas, captureCanvasForUndo);
    if (!result) return;
    setCreatorCurrentSkinPath(path);
    setCreatorCanvasPopulated(true);
    const { beforeData, afterData } = result;
    state.redoStack = [];
    pushUndoLoad(beforeData, afterData);
    state.skinSwatchColors = extractColorsFromSkin(canvas, swatchMax);
    if (!state.userHasSelectedColor && state.skinSwatchColors.length > 0) {
      applyColorToUI(state.skinSwatchColors[0]!, false, false);
    }
    publish(CREATOR_EVENTS.SKIN_LOAD_CHANGE, { path });
    publish(CREATOR_EVENTS.CANVAS_CHANGE);
    renderToDisplay();
    updateAllUndoRedoButtons();

    if (state.editMode === 'wardrobe' && !wardrobeApi.hasWardrobeLibrarySelection()) {
      wardrobeApi.captureWardrobeBaseFromCurrentCanvas(path);
    }
    wardrobeApi.syncWardrobeLibraryActiveStates();
  }

  function renderOutfitsPanel(): void {
    const container = document.getElementById('creator-skin-selector');
    if (!container) return;
    const allSkins = [...manifestOutfitSkins, ...savedOutfitSkins];
    container.innerHTML = '';
    allSkins.forEach((skin, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skin-preview creator-skin-preview creator-wardrobe-library-item';
      btn.dataset.path = skin.path;
      btn.dataset.index = String(index);
      btn.setAttribute('aria-label', `Load skin: ${skin.label}`);
      const img = document.createElement('img');
      img.src = skin.preview ?? skin.path;
      img.alt = skin.label;
      img.loading = 'lazy';
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        if (state.editMode === 'wardrobe') {
          void wardrobeApi.selectWardrobeOutfit(skin.path);
          return;
        }
        void loadSkinFromPath(skin.path);
      });
      container.appendChild(btn);
    });
    wardrobeApi.syncWardrobeLibraryActiveStates();
    bindOutfitsKeyboardNav(container);
  }

  function bindOutfitsKeyboardNav(container: HTMLElement): void {
    if (container.dataset.outfitsNavBound === '1') return;
    container.dataset.outfitsNavBound = '1';

    container.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.classList.contains('creator-skin-preview')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.creator-skin-preview')
      );
      if (buttons.length === 0) return;

      const currentIndex = buttons.indexOf(target as HTMLButtonElement);
      if (currentIndex === -1) return;

      const cols = 4;
      let nextIndex = currentIndex;

      if (e.key === 'ArrowRight') {
        if (currentIndex < buttons.length - 1) {
          nextIndex = currentIndex + 1;
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentIndex > 0) {
          nextIndex = currentIndex - 1;
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'ArrowDown') {
        const candidate = currentIndex + cols;
        if (candidate < buttons.length) {
          nextIndex = candidate;
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'ArrowUp') {
        const candidate = currentIndex - cols;
        if (candidate >= 0) {
          nextIndex = candidate;
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === ' ') {
        const wardrobePanel = document.getElementById('creator-wardrobe-parts-panel');
        if (wardrobePanel) {
          const activeBtn = wardrobePanel.querySelector<HTMLButtonElement>(
            '.creator-wardrobe-parts-btn.active'
          );
          (activeBtn ?? wardrobePanel.querySelector<HTMLButtonElement>('.creator-wardrobe-parts-btn'))
            ?.focus();
          e.preventDefault();
          e.stopPropagation();
        }
      }

      if (nextIndex !== currentIndex) {
        const nextBtn = buttons[nextIndex];
        if (nextBtn) {
          nextBtn.focus();
          nextBtn.click();
        }
      }
    });
  }

  function setupCreatorSkinGallery(skins: SkinEntry[]): void {
    manifestOutfitSkins = skins;
    renderOutfitsPanel();
  }

  async function saveCurrentSkinToOutfits(): Promise<void> {
    const dataUrl = exportTo64x64DataURL();
    if (!dataUrl) return;
    const n = savedOutfitSkins.length + 1;
    const capture = getCapture3DThumbnail();
    const preview = capture ? await capture(128) : null;
    savedOutfitSkins.push({
      path: dataUrl,
      label: `Saved ${n}`,
      preview: preview ?? dataUrl,
    });
    requestAnimationFrame(() => renderOutfitsPanel());
  }

  function downloadCurrentSkin(): void {
    const dataUrl = exportTo64x64DataURL();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `skin-${Date.now()}.png`;
    a.click();
  }

  return {
    loadSkinFromPath,
    setupCreatorSkinGallery,
    renderOutfitsPanel,
    saveCurrentSkinToOutfits,
    downloadCurrentSkin,
    bindOutfitsKeyboardNav,
  };
}
