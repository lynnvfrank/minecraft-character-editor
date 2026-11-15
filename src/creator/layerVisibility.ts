/**
 * Layer visibility, lock, and solo modes for the Creator layers panel (state only, no DOM;
 * tested in layerVisibility.test.ts). DOM wiring (checkbox sync, drag-to-toggle) lives in
 * layerVisibilityDom.ts.
 */

import { creatorLayerSlice } from '../state/creatorSlices';
import { LAYER_KEYS, isLayerKey, isLayerWithParts } from '../skin';
import type { CreatorState } from '../state';
import type { PartSide } from './api';
import type { WardrobeLayerKey } from './wardrobeLayers';
import { getMemberLayerKeysForWardrobeLayer } from './wardrobeLayers';
import { createLayerVisibilityDom } from './layerVisibilityDom';

export type SavedLayerState = {
  visible: Record<string, boolean>;
  partVisible: Record<string, { L?: boolean; R?: boolean }>;
  locked: Record<string, boolean>;
};

export type LayerVisibilityApi = {
  setLayer3DVisible: (layer: string, visible: boolean) => void;
  setLayerPartVisible: (layer: string, side: PartSide, visible: boolean) => void;
  setLayer3DLocked: (layer: string, locked: boolean) => void;
  getPartVisible: (layer: string, side: PartSide) => boolean;
  syncVisibilityCheckboxes: (panel: HTMLElement) => void;
  syncLockCheckboxes: (panel: HTMLElement) => void;
  setupDragToToggle: (
    panel: HTMLElement,
    labelSelector: string,
    inputSelector: string,
    getValue: (layer: string) => boolean,
    setValue: (layer: string, value: boolean) => void,
    sync: (panel: HTMLElement) => void,
    canStartDrag?: (e: Event) => boolean,
    /** When true (visibility row drag only), paint the same on/off across L/R limb part buttons. */
    applyPartsWhileDragging?: boolean
  ) => void;
  setupPartDragToToggle: (panel: HTMLElement, sync: (panel: HTMLElement) => void) => void;
  onVisibilitySoloClick: (layer: string) => void;
  onLockSoloClick: (layer: string) => void;
  clearSoloIndicator: (panel: HTMLElement) => void;
  /** End Alt visibility solo and restore pre-solo visibility + L/R part state (no-op if not in solo). */
  exitVisibilitySoloRestore: () => void;
  /** Drop Alt visibility solo bookkeeping without changing layer visibility (keeps current on/off mask). */
  clearVisibilitySoloFlags: () => void;
  clearLayerSoloModes: () => void;
  saveLayerStateAndNormalizeForNonEditMode: () => void;
  restoreLayerStateForEditMode: () => void;
  applyFocusedSoloForWardrobeLayer: (wardrobeLayer: WardrobeLayerKey) => void;
};

export function createLayerVisibilityModel(state: CreatorState) {
  let savedLayerStateBeforeNonEditMode: SavedLayerState | null = null;
  /** Snapshot of `layer3DPartVisible` before Alt visibility solo; restored when solo exits. */
  let visibilitySoloBeforePartState: Partial<
    Record<string, { L?: boolean; R?: boolean }>
  > | null = null;

  function setLayer3DVisibleAll(visible: Record<string, boolean>, notify = true): void {
    let changed = false;
    for (const k of LAYER_KEYS) {
      if (visible[k] !== undefined && state.layer3DVisible[k] !== visible[k]) {
        state.layer3DVisible[k] = visible[k];
        changed = true;
      }
    }
    if (changed && notify) {
      creatorLayerSlice.notify();
    }
  }

  function setLayer3DLockedAll(locked: Record<string, boolean>): void {
    for (const k of LAYER_KEYS) {
      if (locked[k] !== undefined) state.layer3DLocked[k] = locked[k];
    }
    creatorLayerSlice.notify();
  }

  function setLayer3DVisible(layer: string, visible: boolean): void {
    if (isLayerKey(layer)) {
      const previous = state.layer3DVisible[layer];
      state.layer3DVisible[layer] = visible;
      if (previous !== visible) {
        creatorLayerSlice.notify();
      }
    }
  }

  function setLayerPartVisible(
    layer: string,
    side: PartSide,
    visible: boolean
  ): void {
    if (!isLayerKey(layer) || !isLayerWithParts(layer)) return;
    if (!state.layer3DPartVisible[layer])
      state.layer3DPartVisible[layer] = {};
    const prev = state.layer3DPartVisible[layer]![side];
    state.layer3DPartVisible[layer]![side] = visible;
    if (prev !== visible) {
      creatorLayerSlice.notify();
    }
  }

  function setLayer3DLocked(layer: string, locked: boolean): void {
    if (isLayerKey(layer)) {
      state.layer3DLocked[layer] = locked;
      creatorLayerSlice.notify();
    }
  }

  function getPartVisible(layer: string, side: PartSide): boolean {
    if (state.layer3DVisible[layer] !== true) return false;
    const parts = state.layer3DPartVisible[layer];
    const val = side === 'R' ? parts?.R : parts?.L;
    return val !== false;
  }

  function saveVisibilitySoloPartBackup(): void {
    visibilitySoloBeforePartState = Object.fromEntries(
      Object.entries(state.layer3DPartVisible).map(([k, v]) => [k, { ...v }])
    );
  }

  function restoreVisibilitySoloPartBackup(): void {
    if (visibilitySoloBeforePartState == null) {
      state.layer3DPartVisible = {};
    } else {
      state.layer3DPartVisible = Object.fromEntries(
        Object.entries(visibilitySoloBeforePartState).map(([k, v]) => [
          k,
          { ...v },
        ])
      );
    }
    visibilitySoloBeforePartState = null;
  }

  function exitVisibilitySoloRestore(): void {
    if (!state.layer3DSoloMode) return;
    if (state.layer3DSoloBeforeState)
      setLayer3DVisibleAll(state.layer3DSoloBeforeState, false);
    restoreVisibilitySoloPartBackup();
    creatorLayerSlice.notify();
    state.layer3DSoloMode = false;
    state.layer3DSoloBeforeState = null;
    state.layer3DSoloCurrentLayer = null;
  }

  function clearVisibilitySoloFlags(): void {
    if (!state.layer3DSoloMode) return;
    state.layer3DSoloMode = false;
    state.layer3DSoloBeforeState = null;
    state.layer3DSoloCurrentLayer = null;
    visibilitySoloBeforePartState = null;
  }

  /** Part drag / eye-row drag over parts: show layer without restoring the pre-solo “all layers” snapshot. */
  function applyPartDragTarget(
    partTarget: { layer: string; side: PartSide },
    dragValue: boolean
  ): void {
    if (!isLayerKey(partTarget.layer) || !isLayerWithParts(partTarget.layer)) return;
    if (dragValue && state.layer3DVisible[partTarget.layer] !== true) {
      clearVisibilitySoloFlags();
      setLayer3DVisible(partTarget.layer, true);
    }
    setLayerPartVisible(partTarget.layer, partTarget.side, dragValue);
  }

  function onVisibilitySoloClick(layer: string): void {
    if (state.layer3DSoloMode) {
      if (state.layer3DSoloCurrentLayer === layer) {
        exitVisibilitySoloRestore();
      } else {
        state.layer3DSoloCurrentLayer = layer;
        state.layer3DPartVisible = {};
        const soloState = Object.fromEntries(
          LAYER_KEYS.map((k) => [k, k === layer])
        );
        setLayer3DVisibleAll(soloState);
      }
    } else {
      state.layer3DSoloBeforeState = { ...state.layer3DVisible };
      saveVisibilitySoloPartBackup();
      state.layer3DPartVisible = {};
      state.layer3DSoloCurrentLayer = layer;
      const soloState = Object.fromEntries(
        LAYER_KEYS.map((k) => [k, k === layer])
      );
      setLayer3DVisibleAll(soloState);
      state.layer3DSoloMode = true;
    }
  }

  function onLockSoloClick(layer: string): void {
    if (state.layer3DSoloLockMode) {
      if (state.layer3DSoloLockCurrentLayer === layer) {
        if (state.layer3DSoloLockBeforeState)
          setLayer3DLockedAll(state.layer3DSoloLockBeforeState);
        state.layer3DSoloLockMode = false;
        state.layer3DSoloLockBeforeState = null;
        state.layer3DSoloLockCurrentLayer = null;
      } else {
        state.layer3DSoloLockCurrentLayer = layer;
        const soloState = Object.fromEntries(
          LAYER_KEYS.map((k) => [k, k !== layer])
        );
        setLayer3DLockedAll(soloState);
      }
    } else {
      state.layer3DSoloLockBeforeState = { ...state.layer3DLocked };
      state.layer3DSoloLockCurrentLayer = layer;
      const soloState = Object.fromEntries(
        LAYER_KEYS.map((k) => [k, k !== layer])
      );
      setLayer3DLockedAll(soloState);
      state.layer3DSoloLockMode = true;
    }
  }

  function clearLayerSoloModes(): void {
    state.layer3DSoloMode = false;
    state.layer3DSoloBeforeState = null;
    state.layer3DSoloCurrentLayer = null;
    visibilitySoloBeforePartState = null;
    state.layer3DSoloLockMode = false;
    state.layer3DSoloLockBeforeState = null;
    state.layer3DSoloLockCurrentLayer = null;
  }

  function saveLayerStateAndNormalizeForNonEditMode(): void {
    if (!savedLayerStateBeforeNonEditMode) {
      savedLayerStateBeforeNonEditMode = {
        visible: { ...state.layer3DVisible },
        partVisible: Object.fromEntries(
          Object.entries(state.layer3DPartVisible).map(([k, v]) => [k, { ...v }])
        ),
        locked: { ...state.layer3DLocked },
      };
    }
    clearLayerSoloModes();
    setLayer3DVisibleAll(
      Object.fromEntries(LAYER_KEYS.map((k) => [k, true]))
    );
    state.layer3DPartVisible = {};
    creatorLayerSlice.notify();
    setLayer3DLockedAll(
      Object.fromEntries(LAYER_KEYS.map((k) => [k, false]))
    );
  }

  function restoreLayerStateForEditMode(): void {
    if (!savedLayerStateBeforeNonEditMode) return;
    clearLayerSoloModes();
    setLayer3DVisibleAll(savedLayerStateBeforeNonEditMode.visible);
    state.layer3DPartVisible = Object.fromEntries(
      Object.entries(savedLayerStateBeforeNonEditMode.partVisible).map(
        ([k, v]) => [k, { ...v }]
      )
    );
    setLayer3DLockedAll(savedLayerStateBeforeNonEditMode.locked);
    savedLayerStateBeforeNonEditMode = null;
  }

  function applyFocusedSoloForWardrobeLayer(wardrobeLayer: WardrobeLayerKey): void {
    if (wardrobeLayer === 'fullOutfit' || wardrobeLayer === 'all') {
      clearLayerSoloModes();
      setLayer3DVisibleAll(Object.fromEntries(LAYER_KEYS.map((k) => [k, true])));
      state.layer3DPartVisible = {};
      setLayer3DLockedAll(Object.fromEntries(LAYER_KEYS.map((k) => [k, false])));
      creatorLayerSlice.notify();
      return;
    }
    const members = getMemberLayerKeysForWardrobeLayer(wardrobeLayer);
    if (members.length === 0) return;
    clearLayerSoloModes();
    const memberSet = new Set<string>(members);
    setLayer3DVisibleAll(
      Object.fromEntries(LAYER_KEYS.map((k) => [k, memberSet.has(k)]))
    );
    const nextPart = { ...state.layer3DPartVisible };
    for (const k of LAYER_KEYS) {
      if (isLayerWithParts(k) && memberSet.has(k)) {
        delete nextPart[k];
      }
    }
    state.layer3DPartVisible = nextPart;
    creatorLayerSlice.notify();
  }

  return {
    setLayer3DVisible,
    setLayerPartVisible,
    setLayer3DLocked,
    getPartVisible,
    applyPartDragTarget,
    onVisibilitySoloClick,
    onLockSoloClick,
    exitVisibilitySoloRestore,
    clearVisibilitySoloFlags,
    clearLayerSoloModes,
    saveLayerStateAndNormalizeForNonEditMode,
    restoreLayerStateForEditMode,
    applyFocusedSoloForWardrobeLayer,
  };
}

export type LayerVisibilityModel = ReturnType<typeof createLayerVisibilityModel>;

/** Model + layers-panel DOM wiring, as used by creator.ts. */
export function createLayerVisibilityApi(state: CreatorState): LayerVisibilityApi {
  const model = createLayerVisibilityModel(state);
  return { ...model, ...createLayerVisibilityDom(state, model) };
}
