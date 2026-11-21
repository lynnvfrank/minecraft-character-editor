/**
 * Creator.Style ("Make it me") panel.
 *
 * Captures the current skin as a base when the mode is entered, then live-restyles it
 * with the user's saved look (hair / skin tone / outfit / accessory tints + their face),
 * using the Daily Dress styler port in `src/styler`. Edits preview directly on the skin
 * canvas; one 'load' undo entry is pushed when the look is applied or the mode is left.
 */

import { SKIN_SIZE, RESOLUTION_MULTIPLIER, WORK_SIZE } from '../skin';
import { creatorCanvasSlice, creatorModeSlice } from '../state/creatorSlices';
import { styleSkin, makeFaceTemplate, type FaceTemplate, type StyleSkinOptions } from '../styler';
import { createEl } from './dom';
import { creatorScope } from './lifecycle';
import { EDIT_MODE_STYLE } from './api';
import { loadFeatureTags } from './featureTagsStore';
import { pixelsWithLabel } from '../styler/featureMap';
import { onHairBrushModeChanged, registerHairBrushHandlers, setHairBrushMode, getHairBrushMode, type HairBrushMode } from './hairFixBrush';

const STORAGE_KEY = 'blockygotchi.makeItMe.v1';
const PREVIEW_DEBOUNCE_MS = 60;

type ColorSetting = { on: boolean; color: string };
export type MyLook = {
  hair: ColorSetting;
  skin: ColorSetting;
  outfit: ColorSetting;
  accessory: ColorSetting;
  bodyHair: boolean;
  tolerance: number;
  face: { on: boolean; reference: string | null };
  eyesOverBangs: boolean;
  /** Re-apply this look to every outfit picked in the Wardrobe. */
  locked: boolean;
};

const DEFAULT_LOOK: MyLook = {
  hair: { on: true, color: '#8b4a2b' },
  skin: { on: false, color: '#e0ac8a' },
  outfit: { on: false, color: '#4a6fd1' },
  accessory: { on: false, color: '#e05a9a' },
  bodyHair: true,
  tolerance: 42,
  face: { on: false, reference: null },
  eyesOverBangs: true,
  locked: false,
};

export type StylePanelContext = {
  getSkinCanvas: () => HTMLCanvasElement;
  onCanvasChange: () => void;
  pushUndoLoad: (beforeData: Uint8ClampedArray, afterData: Uint8ClampedArray) => void;
  updateUndoRedoButtons: () => void;
};

function loadLook(): MyLook {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_LOOK);
    const parsed = JSON.parse(raw) as Partial<MyLook>;
    return {
      ...structuredClone(DEFAULT_LOOK),
      ...parsed,
      face: { ...DEFAULT_LOOK.face, ...(parsed.face ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_LOOK);
  }
}

function saveLook(look: MyLook): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // storage unavailable: look still works for this visit
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sample the 128x128 working canvas down to a 64x64 skin (top-left texel of each block). */
function downsample(work: Uint8ClampedArray): ImageData {
  const out = new ImageData(SKIN_SIZE, SKIN_SIZE);
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const src = ((y * RESOLUTION_MULTIPLIER) * WORK_SIZE + x * RESOLUTION_MULTIPLIER) * 4;
      const dst = (y * SKIN_SIZE + x) * 4;
      out.data.set(work.subarray(src, src + 4), dst);
    }
  }
  return out;
}

/**
 * Write a styled 64x64 result back over the working-resolution base. Only skin texels the
 * styler actually changed are overwritten, so untouched hi-res detail survives.
 */
function upsampleChanged(base: Uint8ClampedArray, before: ImageData, after: ImageData): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base);
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const i = (y * SKIN_SIZE + x) * 4;
      const a = before.data;
      const b = after.data;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
      for (let dy = 0; dy < RESOLUTION_MULTIPLIER; dy++) {
        for (let dx = 0; dx < RESOLUTION_MULTIPLIER; dx++) {
          const o = ((y * RESOLUTION_MULTIPLIER + dy) * WORK_SIZE + x * RESOLUTION_MULTIPLIER + dx) * 4;
          out[o] = b[i]!;
          out[o + 1] = b[i + 1]!;
          out[o + 2] = b[i + 2]!;
          out[o + 3] = b[i + 3]!;
        }
      }
    }
  }
  return out;
}

function imageDataToDataUrl(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

async function dataUrlToImageData(url: string): Promise<ImageData | null> {
  // Note: img.decode() can hang indefinitely for data URLs in some Chromium embeds; use load events.
  const img = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    if (img.complete && img.naturalWidth > 0) resolve(true);
  });
  if (!loaded) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Draw the front face (inner head + hat overlay) of a 64x64 skin into a small canvas. */
function drawFaceThumb(canvas: HTMLCanvasElement, url: string | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height);
  };
  img.src = url;
}

const FIXES_KEY = 'blockygotchi.hairFixes.v1';
const FIXES_MAX_SKINS = 200;
type StoredFixes = Record<string, { a: number[]; r: number[] }>;
type HairFixes = { add: Set<number>; remove: Set<number> };

/** Stable key for a 64x64 skin (FNV-1a over its pixels), so fixes follow the skin, not its file name. */
function skinKey(img: ImageData): string {
  let h = 0x811c9dc5;
  const d = img.data;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function readFixesStore(): StoredFixes {
  try {
    return JSON.parse(localStorage.getItem(FIXES_KEY) ?? '{}') as StoredFixes;
  } catch {
    return {};
  }
}

function loadFixes(key: string): HairFixes {
  const entry = readFixesStore()[key];
  return { add: new Set(entry?.a ?? []), remove: new Set(entry?.r ?? []) };
}

function saveFixes(key: string, fixes: HairFixes): void {
  try {
    const store = readFixesStore();
    delete store[key];
    if (fixes.add.size || fixes.remove.size) store[key] = { a: [...fixes.add], r: [...fixes.remove] };
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - FIXES_MAX_SKINS))) delete store[k];
    localStorage.setItem(FIXES_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable: fixes still apply for this visit
  }
}

const HAIR_TINT: [number, number, number] = [255, 43, 214];
const HAIR_TINT_MIX = 0.55;

/** Working-res copy of `styled` with the 64x64 `mask` pixels tinted so detected hair stands out. */
function tintMask(styled: Uint8ClampedArray, mask: Set<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(styled);
  for (const k of mask) {
    const sx = k % SKIN_SIZE;
    const sy = Math.floor(k / SKIN_SIZE);
    for (let dy = 0; dy < RESOLUTION_MULTIPLIER; dy++) {
      for (let dx = 0; dx < RESOLUTION_MULTIPLIER; dx++) {
        const o = ((sy * RESOLUTION_MULTIPLIER + dy) * WORK_SIZE + sx * RESOLUTION_MULTIPLIER + dx) * 4;
        if (out[o + 3] === 0) continue;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(out[o + c]! * (1 - HAIR_TINT_MIX) + HAIR_TINT[c]! * HAIR_TINT_MIX);
      }
    }
  }
  return out;
}

let undoRedoPending = false;

export type ColorTargetKey = 'hair' | 'skin' | 'outfit' | 'accessory';
let activeTarget: ColorTargetKey = 'hair';

/** Outfit/accessory tints are hidden for now; while hidden they are never applied. */
const SHOW_TINTS = false;

/** Me tab sections; the open one sets the camera focus and what the right-side panels edit. */
export type StyleSection = 'hair' | 'skin' | 'face';
let openSection: StyleSection | null = 'hair';
const focusListeners = new Set<(section: StyleSection | null) => void>();

export function getStyleFocus(): StyleSection | null {
  return document.body.dataset.editMode === EDIT_MODE_STYLE ? openSection : null;
}
/** Notified when a Me tab section opens/closes (and when the Me tab is entered). */
export function onStyleFocusChanged(fn: (section: StyleSection | null) => void): () => void {
  focusListeners.add(fn);
  return () => focusListeners.delete(fn);
}
function emitStyleFocus(): void {
  document.body.dataset.styleFocus = openSection ?? 'none';
  focusListeners.forEach((fn) => fn(openSection));
}
/** Styles a working-res skin with the locked look; null when the look isn't locked. */
let lockedStyler: ((work: ImageData) => ImageData | null) | null = null;
const lockListeners = new Set<() => void>();

/**
 * Wardrobe final pass: the composed outfit restyled with "my look" (hair, skin tone, face),
 * or null when the look isn't locked. Hair is found by the styler's detection, so it works
 * on any wardrobe part without the parts having to be tagged.
 */
export function styleWithLockedLook(work: ImageData): ImageData | null {
  return lockedStyler?.(work) ?? null;
}
/** Notified when the lock is toggled or the locked look changes. */
export function onLockedLookChanged(fn: () => void): () => void {
  lockListeners.add(fn);
  return () => lockListeners.delete(fn);
}
function emitLockedLook(): void {
  lockListeners.forEach((fn) => fn());
}

let setTargetColor: ((hex: string) => void) | null = null;
let getTargetColor: (() => string) | null = null;
let targetListener: ((hex: string) => void) | null = null;

/**
 * Color bridge for the shared right-side picker/swatches: while in the Me tab they edit the
 * selected look target (hair, skin tone, ...) instead of the paint color.
 */
export function isStyleColorTargetActive(): boolean {
  return document.body.dataset.editMode === EDIT_MODE_STYLE && setTargetColor != null;
}
export function getStyleTargetColor(): string | null {
  return getTargetColor?.() ?? null;
}
export function setStyleTargetColor(hex: string): void {
  setTargetColor?.(hex);
}
/** Notified with the target's color whenever a different target is selected. */
export function onStyleTargetChanged(fn: (hex: string) => void): void {
  targetListener = fn;
}

/** Called by the creator right before an undo/redo rewrites the skin canvas. */
export function noteStyleUndoRedo(): void {
  undoRedoPending = document.body.dataset.editMode === EDIT_MODE_STYLE;
}

export function buildStylePanel(ctx: StylePanelContext): void {
  const host = document.getElementById('creator-upper-left-panels');
  if (!host) return;
  document.getElementById('creator-style-panel')?.remove();

  const look = loadLook();
  let baseWork: Uint8ClampedArray | null = null;
  let base64: ImageData | null = null;
  let previewDirty = false;
  /** Last pixels this panel wrote; anything else on the canvas means the skin changed underneath us. */
  let lastWritten: Uint8ClampedArray | null = null;
  let faceTemplate: FaceTemplate | null = null;
  let faceTemplateFor: string | null = null;
  let debounce: number | undefined;
  let renderToken = 0;
  /** Clean styled result (working res) and its hair mask; the canvas may show it tinted. */
  let lastStyled: Uint8ClampedArray | null = null;
  let lastHairMask: Set<number> = new Set();
  let fixesKey: string | null = null;
  let fixes: HairFixes = { add: new Set(), remove: new Set() };
  let showHair = false;
  const overlayOn = () => showHair || getHairBrushMode() != null;

  const status = createEl('div', { className: 'creator-style-status', role: 'status' });

  const rowEls = new Map<ColorTargetKey, { row: HTMLElement; chip: HTMLElement; check: HTMLInputElement }>();
  const cards = new Map<StyleSection, HTMLElement>();

  const selectTarget = (key: ColorTargetKey): void => {
    activeTarget = key;
    targetListener?.(look[key].color);
  };

  const syncCards = (): void => {
    for (const [k, card] of cards) {
      const open = k === openSection;
      card.classList.toggle('open', open);
      card.querySelector('.creator-style-card-header')?.setAttribute('aria-expanded', String(open));
    }
  };

  /** Open one section (accordion). Hair/skin also point the right-side picker at that color. */
  const openCard = (key: StyleSection | null): void => {
    openSection = key;
    if (key !== 'hair') setHairBrushMode(null);
    if (key === 'hair' || key === 'skin') selectTarget(key);
    syncCards();
    emitStyleFocus();
  };

  /**
   * A collapsible section panel. The header shows the on/off switch (and color chip for
   * colors); clicking the header opens the section and closes the others.
   */
  const sectionCard = (
    key: StyleSection,
    title: string,
    hint: string,
    toggle: HTMLInputElement,
    chip: HTMLElement | null,
    ...body: (Node | string)[]
  ): HTMLElement => {
    const header = createEl('div', {
      className: 'creator-style-card-header',
      role: 'button',
      tabindex: '0',
      'aria-expanded': 'false',
      title: hint,
    },
      toggle,
      createEl('span', { className: 'creator-layers-panel-title creator-panel-title creator-style-card-title' }, title),
      ...(chip ? [chip] : []),
      createEl('span', { className: 'creator-style-card-caret', 'aria-hidden': 'true' }, '▸'),
    );
    const card = createEl('section', { className: 'creator-style-card', 'data-section': key, 'aria-label': title },
      header,
      createEl('div', { className: 'creator-style-card-body' }, ...body),
    );
    toggle.addEventListener('click', (e) => e.stopPropagation());
    const onHeader = () => openCard(openSection === key ? null : key);
    header.addEventListener('click', onHeader);
    header.addEventListener('keydown', (e) => {
      if (e.target !== header) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onHeader();
      }
    });
    cards.set(key, card);
    return card;
  };

  /** On/off switch + color chip for a color section header (hair, skin tone). */
  const colorToggle = (key: 'hair' | 'skin', label: string) => {
    const check = createEl('input', { type: 'checkbox', id: `creator-style-${key}-on`, 'aria-label': `Use ${label}` });
    check.checked = look[key].on;
    const chip = createEl('span', { className: 'creator-style-chip', id: `creator-style-${key}-chip`, 'aria-hidden': 'true' });
    chip.style.backgroundColor = look[key].color;
    check.addEventListener('change', () => {
      look[key].on = check.checked;
      chip.classList.toggle('creator-style-chip-off', !check.checked);
      if (check.checked && openSection !== key) openCard(key);
      onLookChanged();
    });
    chip.classList.toggle('creator-style-chip-off', !look[key].on);
    rowEls.set(key, { row: chip, chip, check });
    return { check, chip };
  };

  /** Picker on the right changed the active target's color: turn it on and restyle. */
  setTargetColor = (hex: string): void => {
    const els = rowEls.get(activeTarget);
    look[activeTarget].color = hex;
    if (!look[activeTarget].on) {
      look[activeTarget].on = true;
      if (els) els.check.checked = true;
    }
    if (els) {
      els.chip.style.backgroundColor = hex;
      els.chip.classList.remove('creator-style-chip-off');
    }
    onLookChanged();
  };
  getTargetColor = () => look[activeTarget].color;

  const bodyHair = createEl('input', { type: 'checkbox', id: 'creator-style-body-hair' });
  bodyHair.checked = look.bodyHair;
  bodyHair.addEventListener('change', () => { look.bodyHair = bodyHair.checked; onLookChanged(); });

  const tolerance = createEl('input', { type: 'range', min: '16', max: '80', step: '1', id: 'creator-style-tolerance', title: 'Raise it if hair is missed. Lower it if other parts change.' });
  tolerance.value = String(look.tolerance);
  const toleranceValue = createEl('span', { className: 'creator-style-value' }, String(look.tolerance));
  tolerance.addEventListener('input', () => {
    look.tolerance = Number(tolerance.value);
    toleranceValue.textContent = tolerance.value;
    onLookChanged();
  });

  const faceOn = createEl('input', { type: 'checkbox', id: 'creator-style-face-on' });
  faceOn.checked = look.face.on;
  const faceThumb = createEl('canvas', { className: 'creator-style-face-thumb', width: '48', height: '48', 'aria-label': 'Your saved face' });
  const faceUse = createEl('button', { type: 'button', className: 'creator-tools-panel-btn', title: "Save this base skin's face and eyes as yours" }, 'Use this face');
  const eyesOverBangs = createEl('input', { type: 'checkbox', id: 'creator-style-eyes-over-bangs' });
  eyesOverBangs.checked = look.eyesOverBangs;
  const syncFaceUi = () => {
    faceOn.disabled = !look.face.reference;
    if (!look.face.reference) faceOn.checked = false;
    eyesOverBangs.disabled = !faceOn.checked;
    drawFaceThumb(faceThumb, look.face.reference);
  };
  faceOn.addEventListener('change', () => { look.face.on = faceOn.checked; syncFaceUi(); onLookChanged(); });
  eyesOverBangs.addEventListener('change', () => { look.eyesOverBangs = eyesOverBangs.checked; onLookChanged(); });
  faceUse.addEventListener('click', () => {
    if (previewDirty) {
      setStatus('Click Original first, then use the face from the unstyled skin.');
      return;
    }
    syncBaseWithCanvas();
    if (!base64) return;
    // Front face lives at (8..15, 8..15); refuse a blank one (e.g. skin still loading).
    let faceOpaque = 0;
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) if (base64.data[(y * SKIN_SIZE + x) * 4 + 3]! > 0) faceOpaque++;
    if (faceOpaque < 32) {
      setStatus('This skin has no face to copy yet. Wait for it to load, or pick another skin.');
      return;
    }
    look.face.reference = imageDataToDataUrl(base64);
    look.face.on = true;
    faceOn.checked = true;
    faceTemplate = null;
    faceTemplateFor = null;
    syncFaceUi();
    onLookChanged();
  });

  const applyBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-style-primary', title: 'Keep this look on the skin (undoable)' }, 'Apply');
  const resetBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn', title: 'Show the base skin again' }, 'Original');
  applyBtn.addEventListener('click', () => commitPreview(true));
  resetBtn.addEventListener('click', () => {
    if (!baseWork) return;
    writeCanvas(baseWork);
    lastStyled = null;
    previewDirty = false;
    setStatus('Showing the original. Change a setting to restyle.');
  });

  const showHairBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-style-fix-btn', 'aria-pressed': 'false', title: 'Highlight the pixels counted as hair (pink)' }, 'Show');
  const addBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-style-fix-btn', 'aria-pressed': 'false', title: 'Paint on the model to mark missed pixels as hair' }, '+ Add');
  const removeBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-style-fix-btn', 'aria-pressed': 'false', title: 'Paint on the model to unmark pixels that are not hair' }, '− Remove');
  const clearFixesBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-style-fix-btn', title: 'Forget the hair fixes for this skin' }, 'Clear');
  const fixCount = createEl('span', { className: 'creator-style-fix-count' });
  const fixHint = createEl('p', { className: 'creator-style-hint creator-style-fix-hint' }, 'Paint on the model. Right-drag to turn it.');
  const fixHairBlock = createEl('div', { className: 'creator-style-fix', role: 'group', 'aria-label': 'Fix hair' },
    createEl('div', { className: 'creator-style-row' },
      createEl('span', { className: 'creator-style-row-label' }, 'Fix hair'),
      fixCount,
    ),
    createEl('div', { className: 'creator-style-fix-buttons' }, showHairBtn, addBtn, removeBtn, clearFixesBtn),
    fixHint,
  );

  const syncFixUi = () => {
    const brush = getHairBrushMode();
    showHairBtn.setAttribute('aria-pressed', String(overlayOn()));
    showHairBtn.classList.toggle('active', overlayOn());
    addBtn.setAttribute('aria-pressed', String(brush === 'add'));
    addBtn.classList.toggle('active', brush === 'add');
    removeBtn.setAttribute('aria-pressed', String(brush === 'remove'));
    removeBtn.classList.toggle('active', brush === 'remove');
    const n = fixes.add.size + fixes.remove.size;
    fixCount.textContent = n ? `${n} fixed` : '';
    clearFixesBtn.disabled = n === 0;
    fixHint.hidden = brush == null;
  };
  const toggleBrush = (m: HairBrushMode) => setHairBrushMode(getHairBrushMode() === m ? null : m);
  showHairBtn.addEventListener('click', () => {
    showHair = !overlayOn();
    if (!showHair) setHairBrushMode(null);
    syncFixUi();
    showResult();
  });
  addBtn.addEventListener('click', () => toggleBrush('add'));
  removeBtn.addEventListener('click', () => toggleBrush('remove'));
  clearFixesBtn.addEventListener('click', () => {
    fixes = { add: new Set(), remove: new Set() };
    if (fixesKey) saveFixes(fixesKey, fixes);
    syncFixUi();
    onLookChanged();
  });
  creatorScope.track(onHairBrushModeChanged(() => {
    syncFixUi();
    showResult();
  }));
  registerHairBrushHandlers({
    paint: (x, y) => {
      const mode = getHairBrushMode();
      if (!mode || x < 0 || y < 0 || x >= SKIN_SIZE || y >= SKIN_SIZE) return;
      const k = y * SKIN_SIZE + x;
      const into = mode === 'add' ? fixes.add : fixes.remove;
      const from = mode === 'add' ? fixes.remove : fixes.add;
      if (into.has(k)) return;
      // Skip pixels that are already what the brush says (and weren't overridden the other way).
      const hadOpposite = from.delete(k);
      if (!hadOpposite && lastHairMask.has(k) === (mode === 'add')) return;
      into.add(k);
      syncFixUi();
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void renderPreview(), 16);
    },
    end: () => {
      if (fixesKey) saveFixes(fixesKey, fixes);
    },
  });
  creatorScope.track(() => {
    registerHairBrushHandlers(null);
    setHairBrushMode(null);
  });

  const hairToggle = colorToggle('hair', 'my hair');
  const skinToggle = colorToggle('skin', 'my skin tone');
  faceOn.setAttribute('aria-label', 'Use my face');

  const lockLook = createEl('input', { type: 'checkbox', id: 'creator-style-lock' });
  lockLook.checked = look.locked;
  const syncLockUi = () => {
    document.body.dataset.lookLocked = String(look.locked);
  };
  lockLook.addEventListener('change', () => {
    look.locked = lockLook.checked;
    syncLockUi();
    setStatus(look.locked
      ? 'Locked. Outfits you pick in the Wardrobe get your hair, skin tone and face.'
      : 'Unlocked. The Wardrobe shows outfits as they are.');
    if (look.locked) void ensureFaceTemplate().then(emitLockedLook);
    else emitLockedLook();
    saveLook(look);
  });

  const intro = createEl('section', { className: 'creator-style-card creator-style-intro-card', 'aria-label': 'Make it me' },
    createEl('div', { className: 'creator-layers-panel-title creator-panel-title' }, 'Make it me'),
    createEl('p', { className: 'creator-style-intro' },
      'Restyle any skin to your look. Open a part below to change it; its color is on the right. Your settings are remembered.'),
    createEl('label', { for: lockLook.id, className: 'creator-style-row creator-style-lock', title: 'Keep my hair, skin tone and face on every outfit I pick in the Wardrobe' },
      lockLook, ' Lock my look for the Wardrobe'),
    createEl('div', { className: 'creator-style-actions' }, resetBtn, applyBtn),
    status,
  );

  const hairCard = sectionCard('hair', 'My hair', 'Recolor detected hair, keeping its shading', hairToggle.check, hairToggle.chip,
    createEl('div', { className: 'creator-style-row creator-style-sub' },
      createEl('label', { for: bodyHair.id }, bodyHair, ' Include shoulders & back'),
    ),
    createEl('div', { className: 'creator-style-detection' },
      createEl('div', { className: 'creator-style-row', title: 'Raise it if hair is missed. Lower it if other parts change.' },
        createEl('label', { for: tolerance.id, className: 'creator-style-row-label' }, 'Hair detection'),
        toleranceValue,
      ),
      tolerance,
      createEl('div', { className: 'creator-style-scale-ends', 'aria-hidden': 'true' },
        createEl('span', {}, 'Stricter'),
        createEl('span', {}, 'Looser'),
      ),
      fixHairBlock,
    ),
  );

  const skinCard = sectionCard('skin', 'My skin tone', 'Shift exposed skin to this tone', skinToggle.check, skinToggle.chip,
    createEl('p', { className: 'creator-style-hint' }, 'Pick your skin tone on the right. Shading on the skin is kept.'),
  );

  const faceCard = sectionCard('face', 'My face', 'Put your eyes on every skin you style', faceOn, null,
    createEl('div', { className: 'creator-style-face' },
      faceThumb,
      createEl('div', { className: 'creator-style-face-controls' },
        createEl('label', { for: eyesOverBangs.id }, eyesOverBangs, ' Eyes over bangs'),
        faceUse,
      ),
    ),
  );

  const panel = createEl('div', { id: 'creator-style-panel', className: 'creator-style-panel', role: 'region', 'aria-label': 'Make it me' },
    intro, hairCard, skinCard, faceCard,
  );
  host.appendChild(panel);
  syncFaceUi();
  syncFixUi();
  if (activeTarget !== 'hair' && activeTarget !== 'skin') activeTarget = 'hair';
  syncCards();
  if (openSection === 'hair' || openSection === 'skin') selectTarget(openSection);

  // Keep/Save sits absolutely at the bottom of the left column; stop above it and scroll inside.
  const fitHeight = (): void => {
    const lower = document.getElementById('creator-lower-left-panels');
    if (!lower || panel.classList.contains('creator-mode-panel-hidden')) return;
    const limit = lower.getBoundingClientRect().top - 8 - panel.getBoundingClientRect().top;
    panel.style.maxHeight = limit > 120 ? `${Math.floor(limit)}px` : '';
  };
  const lowerEl = document.getElementById('creator-lower-left-panels');
  const fitObserver = new ResizeObserver(() => fitHeight());
  fitObserver.observe(document.body);
  if (lowerEl) fitObserver.observe(lowerEl);
  creatorScope.track(() => fitObserver.disconnect());
  creatorScope.track(creatorModeSlice.subscribe(() => {
    requestAnimationFrame(fitHeight);
    window.setTimeout(fitHeight, 800); // after the slide-in animation settles
  }));
  window.setTimeout(fitHeight, 800);
  requestAnimationFrame(fitHeight);
  creatorScope.track(() => {
    window.clearTimeout(debounce);
    setTargetColor = null;
    getTargetColor = null;
    panel.remove();
  });

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function writeCanvas(data: Uint8ClampedArray): void {
    const canvas = ctx.getSkinCanvas();
    const c2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!c2d) return;
    const img = c2d.createImageData(WORK_SIZE, WORK_SIZE);
    img.data.set(data);
    c2d.putImageData(img, 0, 0);
    lastWritten = new Uint8ClampedArray(data);
    ctx.onCanvasChange();
  }

  function captureBase(from?: Uint8ClampedArray): void {
    if (from) {
      baseWork = new Uint8ClampedArray(from);
    } else {
      const c2d = ctx.getSkinCanvas().getContext('2d', { willReadFrequently: true });
      if (!c2d) return;
      baseWork = new Uint8ClampedArray(c2d.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data);
    }
    base64 = downsample(baseWork);
    lastWritten = baseWork;
    lastStyled = null;
    previewDirty = false;
    const key = skinKey(base64);
    if (key !== fixesKey) {
      fixesKey = key;
      fixes = loadFixes(key);
      syncFixUi();
    }
  }

  /** Put the latest styled result on the canvas, tinted where hair was found if the overlay is on. */
  function showResult(): void {
    if (!lastStyled) return;
    writeCanvas(overlayOn() ? tintMask(lastStyled, lastHairMask) : lastStyled);
  }

  function sameData(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Re-capture the base if the skin was loaded, undone or painted since we last touched it. */
  function syncBaseWithCanvas(): void {
    const c2d = ctx.getSkinCanvas().getContext('2d', { willReadFrequently: true });
    if (!c2d) return;
    const current = c2d.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;
    if (!lastWritten || !sameData(current, lastWritten)) captureBase();
  }

  async function ensureFaceTemplate(): Promise<FaceTemplate | null> {
    const ref = look.face.on ? look.face.reference : null;
    if (!ref) return null;
    if (faceTemplate && faceTemplateFor === ref) return faceTemplate;
    const img = await dataUrlToImageData(ref);
    if (!img) return null;
    faceTemplate = makeFaceTemplate(img, look.tolerance);
    faceTemplateFor = ref;
    return faceTemplate;
  }

  async function renderPreview(): Promise<void> {
    syncBaseWithCanvas();
    if (!baseWork || !base64) return;
    const token = ++renderToken;
    const template = await ensureFaceTemplate();
    if (token !== renderToken) return;
    const options = lookOptions(template, fixes, fixesKey);
    try {
      const started = performance.now();
      const result = styleSkin(base64, options);
      lastStyled = upsampleChanged(baseWork, base64, result.image as ImageData);
      lastHairMask = result.hairMask;
      showResult();
      previewDirty = true;
      const ms = Math.round(performance.now() - started);
      setStatus(`Preview (${result.hairMask.size} hair pixels found, ${ms} ms). Apply to keep it.`);
    } catch (err) {
      console.error('[make-it-me] styling failed', err);
      setStatus("Couldn't style this skin. Try another base skin.");
    }
  }

  function lookOptions(template: FaceTemplate | null, hairFixes: HairFixes | null, tagKey: string | null): StyleSkinOptions {
    const tagMap = tagKey ? loadFeatureTags(tagKey) : null;
    return {
      // Hand-made feature tags (2D/3D editor) replace hair/skin/outfit detection for this skin.
      tags: tagMap
        ? { hair: pixelsWithLabel(tagMap, 'hair'), skin: pixelsWithLabel(tagMap, 'skin'), outfit: pixelsWithLabel(tagMap, 'outfit') }
        : null,
      targetHairColor: look.hair.on ? hexToRgb(look.hair.color) : null,
      tolerance: look.tolerance,
      faceTemplate: template,
      targetSkinColor: look.skin.on ? hexToRgb(look.skin.color) : null,
      includeBodyHair: look.bodyHair,
      eyesOverBangs: look.eyesOverBangs,
      targetOutfitColor: SHOW_TINTS && look.outfit.on ? hexToRgb(look.outfit.color) : null,
      targetAccessoryColor: SHOW_TINTS && look.accessory.on ? hexToRgb(look.accessory.color) : null,
      hairAdd: hairFixes?.add,
      hairRemove: hairFixes?.remove,
    };
  }

  function onLookChanged(): void {
    if (look.locked) void ensureFaceTemplate().then(emitLockedLook);
    saveLook(look);
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void renderPreview(), PREVIEW_DEBOUNCE_MS);
  }

  /** Turn the current preview into a single undo step; optionally make it the new base. */
  function commitPreview(rebase: boolean): void {
    if (!baseWork || !previewDirty || !lastStyled) return;
    const after = lastStyled;
    if (overlayOn() || !rebase) writeCanvas(after); // never leave the pink overlay baked in
    ctx.pushUndoLoad(baseWork, after);
    ctx.updateUndoRedoButtons();
    previewDirty = false;
    if (rebase) {
      // Fixes are per skin; carry them over to the applied result so tweaking continues.
      const carried = fixes;
      captureBase(after);
      fixes = carried;
      if (fixesKey) saveFixes(fixesKey, fixes);
      syncFixUi();
      setStatus('Applied. You can keep tweaking, or undo with Ctrl+Z.');
      if (overlayOn()) void renderPreview();
    }
  }

  function enter(): void {
    targetListener?.(look[activeTarget].color);
    emitStyleFocus();
    captureBase();
    setStatus('Base skin captured. Adjust your look to preview.');
    void renderPreview();
  }

  creatorScope.track(creatorModeSlice.subscribe((detail) => {
    if (detail.mode === EDIT_MODE_STYLE && detail.previousMode !== EDIT_MODE_STYLE) enter();
    else if (detail.previousMode === EDIT_MODE_STYLE && detail.mode !== EDIT_MODE_STYLE) {
      setHairBrushMode(null);
      showHair = false;
      commitPreview(false);
    }
  }));

  // A skin loaded (or undo/redo) while in this mode: restyle the new skin.
  creatorScope.track(creatorCanvasSlice.subscribe(() => {
    if (document.body.dataset.editMode !== EDIT_MODE_STYLE) return;
    const c2d = ctx.getSkinCanvas().getContext('2d', { willReadFrequently: true });
    if (!c2d || !lastWritten) return;
    if (sameData(c2d.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data, lastWritten)) return;
    // A newly loaded skin gets styled. Undo/redo is respected as-is (adopted as the new
    // base), otherwise the undo would be immediately re-styled away.
    if (!undoRedoPending) {
      onLookChanged();
      return;
    }
    undoRedoPending = false;
    window.clearTimeout(debounce);
    captureBase();
    setStatus('Showing the skin as it is now. Change a setting to restyle it.');
  }));

  lockedStyler = (work) => {
    if (!look.locked) return null;
    const ref = look.face.on ? look.face.reference : null;
    const template = ref && faceTemplateFor === ref ? faceTemplate : null;
    const small = downsample(work.data);
    try {
      const smallKey = skinKey(small);
      const result = styleSkin(small, lookOptions(template, loadFixes(smallKey), smallKey));
      const out = new ImageData(WORK_SIZE, WORK_SIZE);
      out.data.set(upsampleChanged(work.data, small, result.image as ImageData));
      return out;
    } catch (err) {
      console.error('[make-it-me] locked look failed', err);
      return null;
    }
  };
  creatorScope.track(() => { lockedStyler = null; });
  syncLockUi();
  // The face template loads async; restyle the wardrobe once it's ready.
  if (look.locked && look.face.on) void ensureFaceTemplate().then(emitLockedLook);

  if (document.body.dataset.editMode === EDIT_MODE_STYLE) enter();
}
