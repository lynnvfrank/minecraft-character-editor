/**
 * "Backdrop" and "Camera moves" sections of the dance studio panel (`#/studio`): pick what is
 * behind the dancer, hide the floor, spin the camera around the stage or jump to a framing.
 *
 * A separate module from studioPanel.ts (like studioCapturePanel.ts): it builds its own collapsible
 * sections and mounts them at their places in the panel. Created once at startup.
 */
import {
  CUSTOM_BACKDROP_ID,
  STUDIO_BACKDROPS,
  backdropSwatchCss,
  findBackdrop,
  type BackdropSettings,
} from '../lib/studioBackdrop';
import {
  CAMERA_FRAMINGS,
  CAMERA_FRAMING_ORDER,
  TURNTABLE_SPEEDS,
  TURNTABLE_SPEED_ORDER,
  type CameraFramingId,
  type TurntableSpeedId,
} from '../lib/turntable';
import { createCollapsibleSection, mountStudioSection } from './collapsibleSection';

export type StudioStagePanelDeps = {
  /** The studio panel root (`#studio-panel`). */
  mount: HTMLElement | null;
  /** The saved backdrop choice (state/studioBackdrop.ts). */
  backdrop: {
    get: () => Readonly<BackdropSettings>;
    setBackdrop: (id: string) => void;
    setCustomColor: (hex: string) => void;
    setFloor: (floor: boolean) => void;
    subscribe: (listener: () => void) => () => void;
  };
  /** Camera moves (described by shape: ui can't import controllers). */
  camera: {
    getSnapshot: () => { turntable: boolean; speed: TurntableSpeedId };
    subscribe: (listener: () => void) => () => void;
    setTurntable: (on: boolean) => void;
    setTurntableSpeed: (speed: TurntableSpeedId) => void;
    frame: (id: CameraFramingId) => boolean;
  };
  /** Saved camera spots (ui/cameraBookmarkChips.ts), shown under the framings. */
  cameraSpots?: HTMLElement;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className: string, text?: string): HTMLButtonElement {
  const btn = el('button', className, text);
  btn.type = 'button';
  return btn;
}

function buildBackdropSection(store: StudioStagePanelDeps['backdrop']): HTMLElement {
  const section = createCollapsibleSection({
    id: 'backdrop',
    title: 'Backdrop',
    className: 'studio-backdrop',
    domId: 'studio-backdrop',
    summary: () => {
      const s = store.get();
      const name = s.id === CUSTOM_BACKDROP_ID ? 'Your color' : (findBackdrop(s.id)?.label ?? 'Default');
      return s.floor ? name : `${name} · No floor`;
    },
  });
  const root = section.root;

  const grid = el('div', 'studio-swatches');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Backdrop');
  const swatches = new Map<string, HTMLElement>();
  for (const def of STUDIO_BACKDROPS) {
    const btn = button(`studio-swatch studio-swatch--${def.kind}`);
    btn.dataset.backdrop = def.id;
    btn.title = def.label;
    btn.setAttribute('aria-label', def.label);
    const css = backdropSwatchCss(def);
    if (css) btn.style.background = css;
    btn.addEventListener('click', () => store.setBackdrop(def.id));
    swatches.set(def.id, btn);
    grid.append(btn);
  }

  // Custom color: the swatch is a label around a native color input (click opens the picker).
  const custom = el('label', 'studio-swatch studio-swatch--custom');
  custom.title = 'Pick your own color';
  const customInput = el('input', 'studio-swatch-input');
  customInput.type = 'color';
  customInput.id = 'studio-backdrop-custom';
  customInput.setAttribute('aria-label', 'Your own backdrop color');
  custom.append(customInput);
  customInput.addEventListener('input', () => store.setCustomColor(customInput.value));
  // Picking the color it already shows fires no input event: a click still selects the swatch.
  customInput.addEventListener('click', () => store.setBackdrop(CUSTOM_BACKDROP_ID));
  swatches.set(CUSTOM_BACKDROP_ID, custom);
  grid.append(custom);

  const row = el('div', 'studio-row');
  const floorLabel = el('label', 'studio-check');
  const floorBox = el('input', '');
  floorBox.type = 'checkbox';
  floorBox.id = 'studio-backdrop-floor';
  floorLabel.append(floorBox, document.createTextNode('Floor'));
  floorLabel.title = 'Turn off for a seamless backdrop';
  floorBox.addEventListener('change', () => store.setFloor(floorBox.checked));
  row.append(floorLabel);

  section.body.append(grid, row);

  function render(): void {
    const s = store.get();
    for (const [id, node] of swatches) {
      const on = id === s.id;
      node.classList.toggle('active', on);
      if (node instanceof HTMLButtonElement) node.setAttribute('aria-pressed', String(on));
    }
    custom.style.background = s.customColor;
    if (customInput.value !== s.customColor) customInput.value = s.customColor;
    floorBox.checked = s.floor;
    section.refresh();
  }
  store.subscribe(render);
  render();
  return root;
}

function buildCameraSection(camera: StudioStagePanelDeps['camera'], spots?: HTMLElement): HTMLElement {
  const section = createCollapsibleSection({
    id: 'cameraMoves',
    title: 'Camera moves',
    className: 'studio-camera-moves',
    domId: 'studio-camera-moves',
    summary: () => {
      const s = camera.getSnapshot();
      return s.turntable ? `Turntable on · ${TURNTABLE_SPEEDS[s.speed].label}` : 'Turntable off';
    },
  });
  const root = section.root;

  const spinRow = el('div', 'studio-row');
  const spinBtn = button('studio-btn studio-turntable-btn', '⟳ Turntable');
  spinBtn.id = 'studio-turntable-btn';
  spinBtn.title = 'Slowly circle the camera around the stage';
  spinBtn.addEventListener('click', () => camera.setTurntable(!camera.getSnapshot().turntable));
  const speeds = el('div', 'studio-seg');
  speeds.setAttribute('role', 'group');
  speeds.setAttribute('aria-label', 'Turntable speed');
  const speedBtns = new Map<TurntableSpeedId, HTMLButtonElement>();
  for (const id of TURNTABLE_SPEED_ORDER) {
    const btn = button('studio-btn studio-seg-btn', TURNTABLE_SPEEDS[id].label);
    btn.title = `One turn in ${TURNTABLE_SPEEDS[id].secondsPerTurn} seconds`;
    btn.addEventListener('click', () => camera.setTurntableSpeed(id));
    speedBtns.set(id, btn);
    speeds.append(btn);
  }
  spinRow.append(spinBtn, speeds);

  const frameRow = el('div', 'studio-row');
  for (const id of CAMERA_FRAMING_ORDER) {
    const framing = CAMERA_FRAMINGS[id];
    const btn = button('studio-btn studio-framing-btn', framing.label);
    btn.dataset.framing = id;
    btn.title = framing.title;
    btn.addEventListener('click', () => camera.frame(id));
    frameRow.append(btn);
  }

  section.body.append(spinRow, frameRow);
  if (spots) {
    const spotsRow = el('div', 'studio-row studio-spots-row');
    spotsRow.append(spots);
    section.body.append(spotsRow);
  }

  function render(): void {
    const s = camera.getSnapshot();
    spinBtn.setAttribute('aria-pressed', String(s.turntable));
    for (const [id, btn] of speedBtns) btn.setAttribute('aria-pressed', String(id === s.speed));
    section.refresh();
  }
  camera.subscribe(render);
  render();
  return root;
}

export function createStudioStagePanel(deps: StudioStagePanelDeps): void {
  if (!deps.mount) return;
  mountStudioSection(deps.mount, buildBackdropSection(deps.backdrop));
  mountStudioSection(deps.mount, buildCameraSection(deps.camera, deps.cameraSpots));
}
