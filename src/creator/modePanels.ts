/**
 * Mode panel visibility and transitions.
 * Shows/hides creator panels based on edit mode (wardrobe, 2d, 3d).
 */

import { creatorModeSlice } from '../state/creatorSlices';
import type { EditMode } from './api';

export type PanelDirection = 'left' | 'right' | 'top' | 'bottom';
export type ModePanelConfig = {
  id: string;
  modes: readonly EditMode[];
  enterFrom: PanelDirection;
  exitTo: PanelDirection;
};

export const MODE_PANEL_HIDDEN_CLASS = 'creator-mode-panel-hidden';
export const MODE_PANEL_CONFIGS: readonly ModePanelConfig[] = [
  { id: 'creator-save-download-panel', modes: ['wardrobe', '2d', '3d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-wardrobe-parts-panel', modes: ['wardrobe'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-upper-right-panels-root', modes: ['wardrobe'], enterFrom: 'right', exitTo: 'right' },
  { id: 'creator-canvas-overlays-panel', modes: ['2d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-layers-panel', modes: ['2d', '3d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-tools-panel', modes: ['2d', '3d'], enterFrom: 'bottom', exitTo: 'bottom' },
  { id: 'creator-undo-redo-panel', modes: ['2d', '3d'], enterFrom: 'bottom', exitTo: 'bottom' },
  { id: 'creator-right-panels-group', modes: ['2d', '3d'], enterFrom: 'right', exitTo: 'right' },
  { id: 'creator-3d-preview-slot', modes: ['2d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-top-center-panels', modes: ['wardrobe', '3d'], enterFrom: 'top', exitTo: 'top' },
];

export const MODE_TRANSITION_MS = 450;

function getAnimClass(prefix: 'in' | 'out', dir: PanelDirection): string {
  return `creator-mode-anim-${prefix}-${dir}`;
}

export function clearModeAnimClasses(el: HTMLElement): void {
  el.classList.remove(
    'creator-mode-anim-in-left',
    'creator-mode-anim-in-right',
    'creator-mode-anim-in-top',
    'creator-mode-anim-in-bottom',
    'creator-mode-anim-out-left',
    'creator-mode-anim-out-right',
    'creator-mode-anim-out-top',
    'creator-mode-anim-out-bottom'
  );
}

export function setModePanelHidden(el: HTMLElement, hidden: boolean): void {
  el.classList.toggle(MODE_PANEL_HIDDEN_CLASS, hidden);
}

function animateModePanelIn(el: HTMLElement, dir: PanelDirection): void {
  clearModeAnimClasses(el);
  setModePanelHidden(el, false);
  void el.offsetWidth;
  el.classList.add(getAnimClass('in', dir));
}

function animateModePanelOut(el: HTMLElement, dir: PanelDirection): void {
  clearModeAnimClasses(el);
  setModePanelHidden(el, false);
  void el.offsetWidth;
  el.classList.add(getAnimClass('out', dir));
}

function mountPreviewSlotForMode(): void {
  const previewSlot = document.getElementById('creator-3d-preview-slot');
  const lowerLeftPanels = document.getElementById('creator-lower-left-panels');
  if (!previewSlot) return;

  if (lowerLeftPanels) {
    if (previewSlot.parentElement !== lowerLeftPanels || previewSlot !== lowerLeftPanels.firstElementChild) {
      lowerLeftPanels.insertBefore(previewSlot, lowerLeftPanels.firstChild);
    }
  } else {
    const rightGroup = document.getElementById('creator-right-panels-group');
    if (rightGroup && previewSlot.parentElement !== rightGroup) rightGroup.appendChild(previewSlot);
  }
}

export type ModePanelTransitions = {
  transitionModePanels: (targetMode: EditMode) => void;
  applyModePanelsImmediate: (mode: EditMode) => void;
  bindModePanelTransitions: (getEditMode: () => EditMode) => void;
  animateModePanelIn: (el: HTMLElement, dir: PanelDirection) => void;
  animateModePanelOut: (el: HTMLElement, dir: PanelDirection) => void;
  mountPreviewSlotForMode: () => void;
};

export function createModePanelTransitions(): ModePanelTransitions {
  let modePanelsCurrentMode: EditMode | null = null;
  let modePanelsBound = false;
  let modeTransitionToken = 0;

  function applyModePanelsImmediate(mode: EditMode): void {
    modeTransitionToken += 1;
    mountPreviewSlotForMode();
    let needsResizeAfterShow = false;
    for (const cfg of MODE_PANEL_CONFIGS) {
      const el = document.getElementById(cfg.id) as HTMLElement | null;
      if (!el) continue;
      clearModeAnimClasses(el);
      const isVisibleInMode = cfg.modes.includes(mode);
      setModePanelHidden(el, !isVisibleInMode);
      if (isVisibleInMode && (cfg.id === 'creator-3d-preview-slot' || cfg.id === 'creator-right-panels-group' || cfg.id === 'creator-upper-right-panels-root')) {
        needsResizeAfterShow = true;
      }
    }
    if (needsResizeAfterShow) {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    modePanelsCurrentMode = mode;
  }

  function transitionModePanels(targetMode: EditMode): void {
    mountPreviewSlotForMode();
    if (modePanelsCurrentMode == null) {
      applyModePanelsImmediate(targetMode);
      return;
    }
    if (modePanelsCurrentMode === targetMode) {
      applyModePanelsImmediate(targetMode);
      return;
    }

    const fromMode = modePanelsCurrentMode;
    const token = ++modeTransitionToken;
    const hideNow: Array<{ el: HTMLElement; cfg: ModePanelConfig }> = [];
    const showLater: Array<{ el: HTMLElement; cfg: ModePanelConfig }> = [];

    for (const cfg of MODE_PANEL_CONFIGS) {
      const el = document.getElementById(cfg.id) as HTMLElement | null;
      if (!el) continue;
      const inFrom = cfg.modes.includes(fromMode);
      const inTarget = cfg.modes.includes(targetMode);
      if (inFrom && !inTarget) hideNow.push({ el, cfg });
      else if (!inFrom && inTarget) showLater.push({ el, cfg });
      else if (inFrom && inTarget) {
        clearModeAnimClasses(el);
        setModePanelHidden(el, false);
      } else {
        clearModeAnimClasses(el);
        setModePanelHidden(el, true);
      }
    }

    hideNow.forEach(({ el, cfg }) => animateModePanelOut(el, cfg.exitTo));

    const enterDelayMs = hideNow.length > 0 ? MODE_TRANSITION_MS : 0;
    window.setTimeout(() => {
      if (token !== modeTransitionToken) return;
      hideNow.forEach(({ el }) => {
        clearModeAnimClasses(el);
        setModePanelHidden(el, true);
      });
      showLater.forEach(({ el, cfg }) => {
        animateModePanelIn(el, cfg.enterFrom);
      });
      if (showLater.some(({ cfg }) => cfg.id === 'creator-3d-preview-slot' || cfg.id === 'creator-right-panels-group' || cfg.id === 'creator-upper-right-panels-root')) {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      }
      modePanelsCurrentMode = targetMode;
    }, enterDelayMs);
  }

  function bindModePanelTransitions(getEditMode: () => EditMode): void {
    if (modePanelsBound) return;
    modePanelsBound = true;
    creatorModeSlice.subscribe((detail) => {
      const nextMode = (detail.mode ?? getEditMode()) as EditMode;
      transitionModePanels(nextMode);
    });
  }

  return {
    transitionModePanels,
    applyModePanelsImmediate,
    bindModePanelTransitions,
    animateModePanelIn,
    animateModePanelOut,
    mountPreviewSlotForMode,
  };
}
