/**
 * The lower-right mode switcher: Design (creator), Studio and Home. Each mode shows the other two
 * (CSS hides the button for the current route), so every mode can reach every other one.
 *
 *   Home   → Design: the camera glides into the creator (enterCreator)   → Studio: #/studio
 *   Design → Home:   the creator's exit animation (exitCreator)          → Studio: exitCreator('#/studio')
 *   Studio → Design: straight to the creator hash (openCreator)          → Home:   #/
 */
import { createIcon, type IconName } from '../creator/icons';
import { getRouteButtonState } from './routeButtonState';

export type RouteTransitions = {
  getRoute: () => string;
  enterCreator: () => Promise<void>;
  exitCreator: (targetHash?: string) => Promise<void>;
  /** Open the creator from a route without the home-view camera move (the studio). */
  openCreator: () => void;
};

const DESIGN_BTN_ID = 'enter-creator-btn';
const HOME_BTN_ID = 'enter-viewer-btn';
const STUDIO_BTN_ID = 'enter-studio-btn';
const HOME_HASH = '#/';
const STUDIO_HASH = '#/studio';

function getButton(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function setLabel(btn: HTMLButtonElement, label: string): void {
  const textEl = btn.querySelector('.mode-btn-text');
  if (textEl) textEl.textContent = label;
}

function decorate(btn: HTMLButtonElement, icon: IconName, label: string, onClick: () => void): void {
  const span = document.createElement('span');
  span.className = 'mode-btn-text';
  span.textContent = label;
  btn.textContent = '';
  btn.appendChild(createIcon(icon, { width: 20, height: 20 }));
  btn.appendChild(span);
  btn.addEventListener('click', onClick);
}

export function createRouteButtons(getTransitionInFlight: () => boolean) {
  function update(): void {
    const state = getRouteButtonState(getTransitionInFlight());
    const design = getButton(DESIGN_BTN_ID);
    const home = getButton(HOME_BTN_ID);
    const studio = getButton(STUDIO_BTN_ID);
    if (design) {
      design.disabled = state.disabled;
      setLabel(design, state.designLabel);
    }
    if (home) {
      home.disabled = state.disabled;
      setLabel(home, state.homeLabel);
    }
    if (studio) studio.disabled = state.disabled;
  }

  function setup(t: RouteTransitions): void {
    const design = getButton(DESIGN_BTN_ID);
    if (design) {
      decorate(design, 'modeCreator', 'Design', () => {
        if (t.getRoute() === 'studio') t.openCreator();
        else void t.enterCreator();
      });
    }
    const studio = getButton(STUDIO_BTN_ID);
    if (studio) {
      decorate(studio, 'modeStudio', 'Studio', () => {
        if (t.getRoute() === 'creator') void t.exitCreator(STUDIO_HASH);
        else location.hash = STUDIO_HASH;
      });
    }
    const home = getButton(HOME_BTN_ID);
    if (home) {
      decorate(home, 'modeHome', 'Home', () => {
        if (t.getRoute() === 'creator') void t.exitCreator();
        else location.hash = HOME_HASH;
      });
    }
    update();
  }

  return { setup, update };
}
