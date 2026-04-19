/**
 * Layer visibility, lock, and solo modes for Creator 3D layers panel.
 * Handles setLayer3DVisible, setLayerPartVisible, setLayer3DLocked,
 * solo visibility/lock modes, drag-to-toggle, and save/restore for non-edit mode.
 */

import { creatorLayerSlice } from '../state/creatorSlices';
import { LAYER_KEYS, isLayerKey, isLayerWithParts } from '../skin';
import type { CreatorState } from '../state';
import type { PartSide } from './api';
import type { WardrobeLayerKey } from './wardrobeLayers';
import { getMemberLayerKeysForWardrobeLayer } from './wardrobeLayers';

const DRAG_THRESHOLD_PX = 4;

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

function getLayerUnderPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest('.creator-layers-panel-row');
  return row instanceof HTMLElement ? row.dataset.layer ?? null : null;
}

function getPartButtonUnderPoint(
  clientX: number,
  clientY: number
): { layer: string; side: PartSide } | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const btn = el.closest('.creator-layer-part-btn');
  if (!(btn instanceof HTMLElement)) return null;
  const layer = btn.dataset.layer;
  const side = btn.dataset.side;
  if (!layer || (side !== 'L' && side !== 'R')) return null;
  if (!isLayerKey(layer) || !isLayerWithParts(layer)) return null;
  return { layer, side };
}

export function createLayerVisibilityApi(state: CreatorState): LayerVisibilityApi {
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

  function syncVisibilityCheckboxes(panel: HTMLElement): void {
    panel
      .querySelectorAll<HTMLInputElement>('.creator-layer-3d-visible')
      .forEach((cb) => {
        const layer = cb.dataset.layer;
        if (layer && state.layer3DVisible[layer] !== undefined)
          cb.checked = state.layer3DVisible[layer];
      });
  }

  function syncLockCheckboxes(panel: HTMLElement): void {
    panel
      .querySelectorAll<HTMLInputElement>('.creator-layer-3d-lock')
      .forEach((cb) => {
        const layer = cb.dataset.layer;
        if (layer && state.layer3DLocked[layer] !== undefined)
          cb.checked = state.layer3DLocked[layer];
      });
  }

  function setupPartDragToToggle(panel: HTMLElement, sync: (panel: HTMLElement) => void): void {
    panel.querySelectorAll<HTMLButtonElement>('.creator-layer-part-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        if (!(e instanceof MouseEvent) || e.button !== 0) return;
        if (e.altKey) return;
        const layer = btn.dataset.layer;
        const side = btn.dataset.side;
        if (!layer || (side !== 'L' && side !== 'R')) return;
        if (!isLayerKey(layer) || !isLayerWithParts(layer)) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const dragValue = !getPartVisible(layer, side as PartSide);
        let hasDragged = false;
        let clickSuppressor: ((clickEv: Event) => void) | null = null;
        const removeClickSuppressor = () => {
          if (clickSuppressor) {
            btn.removeEventListener('click', clickSuppressor, true);
            clickSuppressor = null;
          }
        };
        const tearDown = () => {
          document.removeEventListener('mousemove', handleMove);
          document.removeEventListener('mouseup', handleUp, true);
          removeClickSuppressor();
        };
        const handleMove = (moveEv: MouseEvent) => {
          if (!hasDragged) {
            const dx = moveEv.clientX - startX;
            const dy = moveEv.clientY - startY;
            if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
            hasDragged = true;
            moveEv.preventDefault();
            applyPartDragTarget({ layer, side: side as PartSide }, dragValue);
            sync(panel);
            clickSuppressor = (clickEv: Event) => {
              removeClickSuppressor();
              clickEv.preventDefault();
              clickEv.stopPropagation();
            };
            btn.addEventListener('click', clickSuppressor, true);
          }
          const partTarget = getPartButtonUnderPoint(moveEv.clientX, moveEv.clientY);
          if (partTarget != null) {
            applyPartDragTarget(partTarget, dragValue);
            sync(panel);
          }
          const targetLayer = getLayerUnderPoint(moveEv.clientX, moveEv.clientY);
          if (targetLayer != null && isLayerKey(targetLayer)) {
            setLayer3DVisible(targetLayer, dragValue);
            sync(panel);
          }
        };
        const handleUp = () => {
          tearDown();
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp, true);
      });
    });
  }

  function setupDragToToggle(
    panel: HTMLElement,
    labelSelector: string,
    inputSelector: string,
    getValue: (layer: string) => boolean,
    setValue: (layer: string, value: boolean) => void,
    sync: (panel: HTMLElement) => void,
    canStartDrag: (e: Event) => boolean = () => true,
    applyPartsWhileDragging = false
  ): void {
    panel.querySelectorAll(labelSelector).forEach((label) => {
      const input = label.querySelector<HTMLInputElement>(inputSelector);
      const layer = input?.dataset.layer;
      if (!layer) return;
      label.addEventListener('mousedown', (e) => {
        if (!(e instanceof MouseEvent) || e.button !== 0 || !canStartDrag(e))
          return;
        // Do not preventDefault on mousedown: it breaks the first label→checkbox
        // activation so users often need a second click. Suppress only after a drag commits.
        const startX = e.clientX;
        const startY = e.clientY;
        const dragValue = !getValue(layer);
        let hasDragged = false;
        let clickSuppressor: ((clickEv: Event) => void) | null = null;
        const removeClickSuppressor = () => {
          if (clickSuppressor) {
            label.removeEventListener('click', clickSuppressor, true);
            clickSuppressor = null;
          }
        };
        const tearDown = () => {
          document.removeEventListener('mousemove', handleMove);
          document.removeEventListener('mouseup', handleUp, true);
          removeClickSuppressor();
        };
        const handleMove = (moveEv: MouseEvent) => {
          if (!hasDragged) {
            const dx = moveEv.clientX - startX;
            const dy = moveEv.clientY - startY;
            if (
              dx * dx + dy * dy <
              DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
            )
              return;
            hasDragged = true;
            moveEv.preventDefault();
            setValue(layer, dragValue);
            sync(panel);
            clickSuppressor = (clickEv: Event) => {
              removeClickSuppressor();
              const t = clickEv.target;
              if (
                t instanceof HTMLElement &&
                t.closest('.creator-layer-part-btn')
              ) {
                return;
              }
              clickEv.preventDefault();
              clickEv.stopPropagation();
            };
            label.addEventListener('click', clickSuppressor, true);
          }
          const targetLayer = getLayerUnderPoint(moveEv.clientX, moveEv.clientY);
          if (targetLayer != null && isLayerKey(targetLayer)) {
            setValue(targetLayer, dragValue);
            sync(panel);
          }
          if (applyPartsWhileDragging) {
            const partTarget = getPartButtonUnderPoint(moveEv.clientX, moveEv.clientY);
            if (partTarget != null) {
              applyPartDragTarget(partTarget, dragValue);
              sync(panel);
            }
          }
        };
        const handleUp = () => {
          tearDown();
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp, true);
      });
    });
  }

  function clearSoloIndicator(panel: HTMLElement): void {
    const indicator = panel.querySelector('.creator-layers-panel-solo-indicator');
    indicator?.remove();
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
    syncVisibilityCheckboxes,
    syncLockCheckboxes,
    setupDragToToggle,
    setupPartDragToToggle,
    onVisibilitySoloClick,
    onLockSoloClick,
    clearSoloIndicator,
    exitVisibilitySoloRestore,
    clearVisibilitySoloFlags,
    clearLayerSoloModes,
    saveLayerStateAndNormalizeForNonEditMode,
    restoreLayerStateForEditMode,
    applyFocusedSoloForWardrobeLayer,
  };
}
