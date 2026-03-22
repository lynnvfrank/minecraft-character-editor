/**
 * Layer visibility, lock, and solo modes for Creator 3D layers panel.
 * Handles setLayer3DVisible, setLayerPartVisible, setLayer3DLocked,
 * solo visibility/lock modes, drag-to-toggle, and save/restore for non-edit mode.
 */

import { publish, CREATOR_EVENTS } from '../events/appEvents';
import { LAYER_KEYS, isLayerKey, isLayerWithParts } from '../skin';
import type { CreatorState } from '../state';
import type { PartSide } from './api';

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
    canStartDrag?: (e: Event) => boolean
  ) => void;
  onVisibilitySoloClick: (layer: string) => void;
  onLockSoloClick: (layer: string) => void;
  clearSoloIndicator: (panel: HTMLElement) => void;
  clearLayerSoloModes: () => void;
  saveLayerStateAndNormalizeForNonEditMode: () => void;
  restoreLayerStateForEditMode: () => void;
};

function getLayerUnderPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest('.creator-layers-panel-row');
  return row instanceof HTMLElement ? row.dataset.layer ?? null : null;
}

export function createLayerVisibilityApi(
  state: CreatorState,
  publishEvent: typeof publish
): LayerVisibilityApi {
  let savedLayerStateBeforeNonEditMode: SavedLayerState | null = null;

  function setLayer3DVisibleAll(visible: Record<string, boolean>): void {
    let changed = false;
    for (const k of LAYER_KEYS) {
      if (visible[k] !== undefined && state.layer3DVisible[k] !== visible[k]) {
        state.layer3DVisible[k] = visible[k];
        changed = true;
      }
    }
    if (changed) {
      publishEvent(CREATOR_EVENTS.LAYER3D_CHANGE, {
        property: 'visibility',
        all: true,
        visibleMap: { ...state.layer3DVisible },
      });
    }
  }

  function setLayer3DLockedAll(locked: Record<string, boolean>): void {
    for (const k of LAYER_KEYS) {
      if (locked[k] !== undefined) state.layer3DLocked[k] = locked[k];
    }
    publishEvent(CREATOR_EVENTS.LAYER3D_CHANGE);
  }

  function setLayer3DVisible(layer: string, visible: boolean): void {
    if (isLayerKey(layer)) {
      const previous = state.layer3DVisible[layer];
      state.layer3DVisible[layer] = visible;
      if (previous !== visible) {
        publishEvent(CREATOR_EVENTS.LAYER3D_CHANGE, {
          layer,
          property: 'visibility',
          visible,
        });
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
      publishEvent(CREATOR_EVENTS.LAYER3D_CHANGE, {
        layer,
        property: 'partVisibility',
        side,
        visible,
      });
    }
  }

  function setLayer3DLocked(layer: string, locked: boolean): void {
    if (isLayerKey(layer)) {
      state.layer3DLocked[layer] = locked;
      publishEvent(CREATOR_EVENTS.LAYER3D_CHANGE);
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

  function setupDragToToggle(
    panel: HTMLElement,
    labelSelector: string,
    inputSelector: string,
    getValue: (layer: string) => boolean,
    setValue: (layer: string, value: boolean) => void,
    sync: (panel: HTMLElement) => void,
    canStartDrag: (e: Event) => boolean = () => true
  ): void {
    panel.querySelectorAll(labelSelector).forEach((label) => {
      const input = label.querySelector<HTMLInputElement>(inputSelector);
      const layer = input?.dataset.layer;
      if (!layer) return;
      label.addEventListener('mousedown', (e) => {
        if (!(e instanceof MouseEvent) || e.button !== 0 || !canStartDrag(e))
          return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const dragValue = !getValue(layer);
        let hasDragged = false;
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
            setValue(layer, dragValue);
            sync(panel);
          }
          const targetLayer = getLayerUnderPoint(moveEv.clientX, moveEv.clientY);
          if (targetLayer != null && isLayerKey(targetLayer)) {
            setValue(targetLayer, dragValue);
            sync(panel);
          }
        };
        const handleClick = (clickEv: Event) => {
          label.removeEventListener('click', handleClick, true);
          if (hasDragged) {
            clickEv.preventDefault();
            clickEv.stopPropagation();
          }
        };
        const handleUp = () => {
          document.removeEventListener('mousemove', handleMove);
          document.removeEventListener('mouseup', handleUp, true);
        };
        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp, true);
        label.addEventListener('click', handleClick, true);
      });
    });
  }

  function clearSoloIndicator(panel: HTMLElement): void {
    const indicator = panel.querySelector('.creator-layers-panel-solo-indicator');
    indicator?.remove();
  }

  function onVisibilitySoloClick(layer: string): void {
    if (state.layer3DSoloMode) {
      if (state.layer3DSoloCurrentLayer === layer) {
        if (state.layer3DSoloBeforeState)
          setLayer3DVisibleAll(state.layer3DSoloBeforeState);
        state.layer3DSoloMode = false;
        state.layer3DSoloBeforeState = null;
        state.layer3DSoloCurrentLayer = null;
      } else {
        state.layer3DSoloCurrentLayer = layer;
        const soloState = Object.fromEntries(
          LAYER_KEYS.map((k) => [k, k === layer])
        );
        setLayer3DVisibleAll(soloState);
      }
    } else {
      state.layer3DSoloBeforeState = { ...state.layer3DVisible };
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
    publishEvent(CREATOR_EVENTS.LAYER3D_CHANGE);
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

  return {
    setLayer3DVisible,
    setLayerPartVisible,
    setLayer3DLocked,
    getPartVisible,
    syncVisibilityCheckboxes,
    syncLockCheckboxes,
    setupDragToToggle,
    onVisibilitySoloClick,
    onLockSoloClick,
    clearSoloIndicator,
    clearLayerSoloModes,
    saveLayerStateAndNormalizeForNonEditMode,
    restoreLayerStateForEditMode,
  };
}
