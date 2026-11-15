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
  { id: 'creator-arm-model-panel', modes: ['wardrobe', '2d', '3d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-upper-right-panels-root', modes: ['wardrobe'], enterFrom: 'right', exitTo: 'right' },
  { id: 'creator-canvas-overlays-panel', modes: ['2d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-layers-panel', modes: ['2d', '3d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-tools-panel', modes: ['2d', '3d'], enterFrom: 'bottom', exitTo: 'bottom' },
  { id: 'creator-undo-redo-panel', modes: ['2d', '3d'], enterFrom: 'bottom', exitTo: 'bottom' },
  { id: 'creator-right-panels-group', modes: ['2d', '3d'], enterFrom: 'right', exitTo: 'right' },
  { id: 'creator-3d-preview-slot', modes: ['2d'], enterFrom: 'left', exitTo: 'left' },
  { id: 'creator-top-center-panels', modes: ['wardrobe', '3d'], enterFrom: 'top', exitTo: 'top' },
];

/** Must match mode panel exit duration in `_animations.scss` (`$creator-mode-panel-enter-duration`). */
export const MODE_TRANSITION_MS = 360;

/** Panels that change size when shown, so the 3D view needs a resize afterwards. */
const RESIZE_ON_SHOW_IDS = new Set(['creator-3d-preview-slot', 'creator-right-panels-group', 'creator-upper-right-panels-root']);

export type ModePanelPlan = {
  /** Visible before and not after: animate out, then hide. */
  hide: ModePanelConfig[];
  /** Hidden before and visible after: show (animated in after the hides finish). */
  show: ModePanelConfig[];
  /** Visible in both modes: stays shown. */
  keep: ModePanelConfig[];
  /** Hidden in both modes. */
  stayHidden: ModePanelConfig[];
  /** Wait this long before showing, so outgoing panels finish animating first. */
  enterDelayMs: number;
  /** A newly shown panel changes the 3D view's size. */
  needsResize: boolean;
};

/**
 * Which panels hide, show or stay when switching `from` → `to`. With `from` null (first render)
 * every panel is placed immediately: visible ones go in `keep`, nothing animates.
 */
export function planModePanelTransition(
  configs: readonly ModePanelConfig[],
  from: EditMode | null,
  to: EditMode
): ModePanelPlan {
  const plan: ModePanelPlan = { hide: [], show: [], keep: [], stayHidden: [], enterDelayMs: 0, needsResize: false };
  for (const cfg of configs) {
    const inTo = cfg.modes.includes(to);
    const inFrom = from == null || from === to ? inTo : cfg.modes.includes(from);
    if (inFrom && inTo) plan.keep.push(cfg);
    else if (inFrom) plan.hide.push(cfg);
    else if (inTo) plan.show.push(cfg);
    else plan.stayHidden.push(cfg);
  }
  plan.enterDelayMs = plan.hide.length > 0 ? MODE_TRANSITION_MS : 0;
  const shown = from == null || from === to ? plan.keep : plan.show;
  plan.needsResize = shown.some((cfg) => RESIZE_ON_SHOW_IDS.has(cfg.id));
  return plan;
}

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
    const plan = planModePanelTransition(MODE_PANEL_CONFIGS, null, mode);
    for (const cfg of MODE_PANEL_CONFIGS) {
      const el = document.getElementById(cfg.id) as HTMLElement | null;
      if (!el) continue;
      clearModeAnimClasses(el);
      setModePanelHidden(el, !cfg.modes.includes(mode));
    }
    if (plan.needsResize) {
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

    const plan = planModePanelTransition(MODE_PANEL_CONFIGS, modePanelsCurrentMode, targetMode);
    const token = ++modeTransitionToken;
    const withEl = (cfgs: ModePanelConfig[]) =>
      cfgs.flatMap((cfg) => {
        const el = document.getElementById(cfg.id) as HTMLElement | null;
        return el ? [{ el, cfg }] : [];
      });

    for (const { el } of withEl(plan.keep)) {
      clearModeAnimClasses(el);
      setModePanelHidden(el, false);
    }
    for (const { el } of withEl(plan.stayHidden)) {
      clearModeAnimClasses(el);
      setModePanelHidden(el, true);
    }
    const hideNow = withEl(plan.hide);
    const showLater = withEl(plan.show);
    hideNow.forEach(({ el, cfg }) => animateModePanelOut(el, cfg.exitTo));

    window.setTimeout(() => {
      if (token !== modeTransitionToken) return;
      hideNow.forEach(({ el }) => {
        clearModeAnimClasses(el);
        setModePanelHidden(el, true);
      });
      showLater.forEach(({ el, cfg }) => animateModePanelIn(el, cfg.enterFrom));
      if (plan.needsResize) {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      }
      modePanelsCurrentMode = targetMode;
    }, hideNow.length > 0 ? plan.enterDelayMs : 0);
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
