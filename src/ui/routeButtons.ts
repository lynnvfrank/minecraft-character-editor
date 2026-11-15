/**
 * The "Design" (enter creator) and "Home" (exit creator) buttons. Extracted from main.ts.
 */
import { createIcon, type IconName } from '../creator/icons';
import { getRouteButtonState } from './routeButtonState';

export type RouteTransitions = {
  enterCreator: () => Promise<void>;
  exitCreator: () => Promise<void>;
};

const DESIGN_BTN_ID = 'enter-creator-btn';
const HOME_BTN_ID = 'enter-viewer-btn';

function getButton(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function setLabel(btn: HTMLButtonElement, label: string): void {
  const textEl = btn.querySelector('.creator-home-btn-text');
  if (textEl) textEl.textContent = label;
}

function decorate(btn: HTMLButtonElement, icon: IconName, label: string, onClick: () => void): void {
  const span = document.createElement('span');
  span.className = 'creator-home-btn-text';
  span.textContent = label;
  btn.textContent = '';
  btn.appendChild(createIcon(icon, { width: 22, height: 22 }));
  btn.appendChild(span);
  btn.addEventListener('click', onClick);
}

export function createRouteButtons(getTransitionInFlight: () => boolean) {
  function update(): void {
    const state = getRouteButtonState(getTransitionInFlight());
    const design = getButton(DESIGN_BTN_ID);
    const home = getButton(HOME_BTN_ID);
    if (design) {
      design.disabled = state.disabled;
      setLabel(design, state.designLabel);
    }
    if (home) {
      home.disabled = state.disabled;
      setLabel(home, state.homeLabel);
    }
  }

  function setup(transitions: RouteTransitions): void {
    const design = getButton(DESIGN_BTN_ID);
    if (design) decorate(design, 'modeCreator', 'Design', () => void transitions.enterCreator());
    const home = getButton(HOME_BTN_ID);
    if (home) decorate(home, 'modeHome', 'Home', () => void transitions.exitCreator());
    update();
  }

  return { setup, update };
}
