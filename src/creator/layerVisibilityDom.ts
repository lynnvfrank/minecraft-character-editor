/**
 * Layers panel DOM wiring for layer visibility: checkbox sync, solo indicator, and
 * drag-to-toggle across rows and L/R part buttons. State changes go through the model.
 */
import { isLayerKey, isLayerWithParts } from '../skin';
import type { CreatorState } from '../state';
import type { PartSide } from './api';
import type { LayerVisibilityModel } from './layerVisibility';

const DRAG_THRESHOLD_PX = 4;

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

export function createLayerVisibilityDom(state: CreatorState, model: LayerVisibilityModel) {
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
        const dragValue = !model.getPartVisible(layer, side as PartSide);
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
            model.applyPartDragTarget({ layer, side: side as PartSide }, dragValue);
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
            model.applyPartDragTarget(partTarget, dragValue);
            sync(panel);
          }
          const targetLayer = getLayerUnderPoint(moveEv.clientX, moveEv.clientY);
          if (targetLayer != null && isLayerKey(targetLayer)) {
            model.setLayer3DVisible(targetLayer, dragValue);
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
              model.applyPartDragTarget(partTarget, dragValue);
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

  return {
    syncVisibilityCheckboxes,
    syncLockCheckboxes,
    setupPartDragToToggle,
    setupDragToToggle,
    clearSoloIndicator,
  };
}
