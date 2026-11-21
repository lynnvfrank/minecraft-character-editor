/**
 * Feature tags panel (2D and 3D editor, right column): mark which pixels of this skin are skin, hair,
 * eyes & face and outfit.
 *
 * Skins don't say what their pixels are, and artists draw hair, eyes and clothes in endless
 * ways, so detection alone can't separate them. Each skin gets a feature map
 * (styler/featureMap.ts): it starts as an automatic guess and is corrected here by painting
 * tags on the model or the 2D grid. Make it me uses the tags in place of its detection, and
 * mixing hair / eyes / skin / outfit across skins (composeFeatures) builds on them.
 *
 * While a brush is picked, the skin canvas shows a tinted copy of the skin (one color per
 * tag); the real pixels are put back the moment the brush is put down, the mode changes,
 * undo is pressed or anything outside the panel and the model is clicked.
 */
import { SKIN_SIZE, RESOLUTION_MULTIPLIER, WORK_SIZE } from '../skin';
import { creatorCanvasSlice, creatorModeSlice, creatorToolsSlice } from '../state/creatorSlices';
import {
  FEATURE_CODE,
  FEATURE_MAP_SIZE,
  UNTAGGED,
  autoTagFeatures,
  countLabels,
  isOverlayTexel,
  isUsedTexel,
  type FeatureLabel,
  type FeatureMap,
} from '../styler/featureMap';
import { createEl } from './dom';
import { creatorScope } from './lifecycle';
import {
  getFeatureTagBrush,
  onFeatureTagBrushChanged,
  registerFeatureTagHandlers,
  setFeatureTagBrush,
  type FeatureTagBrush,
} from './featureTagBrush';
import {
  countTaggedSkins,
  exportFeatureTags,
  importFeatureTags,
  loadFeatureTags,
  saveFeatureTags,
  skinPixelKey,
} from './featureTagsStore';
import { isTagSessionActive, onTagSessionChanged, startTagSession } from './tagSession';

export type FeatureTagsPanelContext = {
  getSkinCanvas: () => HTMLCanvasElement;
  onCanvasChange: () => void;
};

/** Overlay tint per tag (index = stored code); untagged painted pixels are greyed. */
const TAG_TINT: readonly (readonly [number, number, number])[] = [
  [128, 128, 128],
  [255, 150, 60], // skin
  [255, 43, 214], // hair (the Make it me hair pink)
  [30, 200, 255], // eyes & face
  [60, 220, 90], // outfit
];
const TINT_MIX = 0.55;

const BRUSHES: { key: FeatureTagBrush; label: string; hint: string }[] = [
  { key: 'hair', label: 'Hair', hint: 'Hair wherever it falls: head, back, torso, arms or legs' },
  { key: 'eyes', label: 'Eyes', hint: 'Eyes, brows, lashes, mouth and other face details' },
  { key: 'skin', label: 'Skin', hint: 'Bare skin: shown in the wearer\'s skin tone when looks are mixed' },
  { key: 'outfit', label: 'Outfit', hint: 'The costume: clothes, shoes, hats, flowers, bows and anything else worn' },
  { key: 'erase', label: 'Untag', hint: 'Clear the tag from pixels' },
];

/** Repaints changing fewer pixels than this keep the skin's tags (the hash changes, the art barely does). */
const CARRY_TAGS_MAX_CHANGED = 400;
/** "Fill" brush: neighbours this close in color get the same tag. */
const FILL_COLOR_DISTANCE = 34;

function downsample(work: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const src = (y * RESOLUTION_MULTIPLIER * WORK_SIZE + x * RESOLUTION_MULTIPLIER) * 4;
      out.set(work.subarray(src, src + 4), (y * SKIN_SIZE + x) * 4);
    }
  }
  return out;
}

function sameData(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function tint(work: Uint8ClampedArray, map: FeatureMap): Uint8ClampedArray {
  const out = new Uint8ClampedArray(work);
  for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
    const code = map[k]!;
    if (code === UNTAGGED && (!isUsedTexel(k) || isOverlayTexel(k))) continue;
    const color = TAG_TINT[code]!;
    const sx = k % SKIN_SIZE;
    const sy = (k / SKIN_SIZE) | 0;
    for (let dy = 0; dy < RESOLUTION_MULTIPLIER; dy++) {
      for (let dx = 0; dx < RESOLUTION_MULTIPLIER; dx++) {
        const o = ((sy * RESOLUTION_MULTIPLIER + dy) * WORK_SIZE + sx * RESOLUTION_MULTIPLIER + dx) * 4;
        if (out[o + 3] === 0) continue;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(out[o + c]! * (1 - TINT_MIX) + color[c]! * TINT_MIX);
      }
    }
  }
  return out;
}

export function buildFeatureTagsPanel(ctx: FeatureTagsPanelContext): void {
  // Top of the right-hand column (above Color): the left column holds the 3D preview in 2D mode.
  const host = document.getElementById('creator-right-panels-group');
  if (!host) return;
  document.getElementById('creator-feature-tags-panel')?.remove();

  /** Current skin (64x64 RGBA), its key, and its tags. */
  let pixels: Uint8ClampedArray | null = null;
  let key: string | null = null;
  let map: FeatureMap | null = null;
  let saved = false;
  /** While a brush is picked: the real canvas, and the tinted copy we put on it. */
  let overlay: { real: Uint8ClampedArray; shown: Uint8ClampedArray } | null = null;
  let strokeDirty = false;
  let strokeStarted = false;
  let fillMode = false;
  let syncTimer = 0;
  let overlayFrame = 0;

  const status = createEl('p', { className: 'creator-feature-tags-status', role: 'status' });
  const brushButtons = new Map<FeatureTagBrush, HTMLButtonElement>();
  const brushRow = createEl('div', { className: 'creator-feature-tags-brushes', role: 'group', 'aria-label': 'Tag brushes' });
  for (const b of BRUSHES) {
    const code = b.key === 'erase' ? 0 : FEATURE_CODE[b.key];
    const swatch = createEl('span', { className: 'creator-feature-tags-swatch', 'aria-hidden': 'true' });
    swatch.style.background = b.key === 'erase' ? 'transparent' : `rgb(${TAG_TINT[code]!.join(',')})`;
    const btn = createEl('button', {
      type: 'button',
      className: 'creator-tools-panel-btn creator-feature-tags-brush',
      'data-brush': b.key,
      'aria-pressed': 'false',
      title: b.hint,
    }, swatch, createEl('span', { className: 'creator-feature-tags-name' }, b.label));
    btn.addEventListener('click', () => setFeatureTagBrush(getFeatureTagBrush() === b.key ? null : b.key));
    brushButtons.set(b.key, btn);
    brushRow.appendChild(btn);
  }

  const pixelBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-feature-tags-mode', 'aria-pressed': 'true', title: 'Tag one pixel at a time' }, 'Pixel');
  const fillBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-feature-tags-mode', 'aria-pressed': 'false', title: 'Tag the clicked pixel and its neighbours of a similar color' }, 'Fill similar');
  const setFill = (on: boolean) => {
    fillMode = on;
    pixelBtn.setAttribute('aria-pressed', String(!on));
    fillBtn.setAttribute('aria-pressed', String(on));
    pixelBtn.classList.toggle('active', !on);
    fillBtn.classList.toggle('active', on);
  };
  pixelBtn.addEventListener('click', () => { setFill(false); syncUi(); });
  fillBtn.addEventListener('click', () => { setFill(true); syncUi(); });
  setFill(false);

  const doneBtn = createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-feature-tags-done', title: 'Put the brush down and show the skin (Esc)' }, 'Done');
  doneBtn.addEventListener('click', () => setFeatureTagBrush(null));

  const resetBtn = createEl('button', { type: 'button', className: 'creator-feature-tags-link', title: 'Forget the hand-made tags and guess again' }, 'Re-guess');
  resetBtn.addEventListener('click', () => {
    if (!key || !pixels) return;
    saveFeatureTags(key, null);
    map = autoTagFeatures({ width: 64, height: 64, data: pixels });
    saved = false;
    refreshOverlay();
    syncUi();
  });

  const libraryBtn = createEl('button', { type: 'button', className: 'creator-feature-tags-link', title: 'Step through the library skins as they are and tag them (your character is set aside)' }, 'Tag library skins');
  libraryBtn.addEventListener('click', () => void startTagSession(null, getFeatureTagBrush() ?? 'hair'));
  const exportBtn = createEl('button', { type: 'button', className: 'creator-feature-tags-link', title: 'Download the tags of every skin you have tagged' }, 'Export');
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([exportFeatureTags()], { type: 'application/json' });
    const a = createEl('a', { href: URL.createObjectURL(blob), download: 'blockygotchi-feature-tags.json' });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const importInput = createEl('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
  const importBtn = createEl('button', { type: 'button', className: 'creator-feature-tags-link', title: 'Add tags from an exported file' }, 'Import');
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    const n = importFeatureTags(await file.text());
    if (n == null) {
      setStatus("That file isn't a feature tags export.");
      return;
    }
    key = null; // reload this skin's tags
    syncSkin();
    setStatus(`Imported tags for ${n} skin${n === 1 ? '' : 's'}.`);
  });

  const panel = createEl('div', { id: 'creator-feature-tags-panel', className: 'creator-feature-tags-panel', role: 'region', 'aria-label': 'Feature tags' },
    createEl('div', { className: 'creator-feature-tags-header' },
      createEl('span', { className: 'creator-layers-panel-title creator-panel-title' }, 'Feature tags'),
      doneBtn,
    ),
    brushRow,
    createEl('div', { className: 'creator-feature-tags-modes', role: 'group', 'aria-label': 'Brush shape' }, pixelBtn, fillBtn),
    status,
    createEl('div', { className: 'creator-feature-tags-actions' }, libraryBtn, resetBtn, exportBtn, importBtn, importInput),
  );
  host.insertBefore(panel, host.firstChild);

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function readCanvas(): Uint8ClampedArray | null {
    const c2d = ctx.getSkinCanvas().getContext('2d', { willReadFrequently: true });
    return c2d ? new Uint8ClampedArray(c2d.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data) : null;
  }

  function writeCanvas(data: Uint8ClampedArray): void {
    const c2d = ctx.getSkinCanvas().getContext('2d', { willReadFrequently: true });
    if (!c2d) return;
    const img = c2d.createImageData(WORK_SIZE, WORK_SIZE);
    img.data.set(data);
    c2d.putImageData(img, 0, 0);
    ctx.onCanvasChange();
  }

  /** Pick up the skin on the canvas: find its saved tags, carry tags over a small repaint, or guess. */
  function syncSkin(): void {
    if (overlay) return;
    const work = readCanvas();
    if (!work) return;
    const next = downsample(work);
    const nextKey = skinPixelKey(next);
    if (nextKey === key) return;
    const stored = loadFeatureTags(nextKey);
    if (stored) {
      map = stored;
      saved = true;
    } else if (saved && map && pixels && changedPixels(pixels, next) <= CARRY_TAGS_MAX_CHANGED) {
      // Same skin, lightly repainted: keep the hand-made tags under the new picture.
      map = new Uint8Array(map);
      saveFeatureTags(nextKey, map);
    } else {
      map = autoTagFeatures({ width: 64, height: 64, data: next });
      saved = false;
    }
    pixels = next;
    key = nextKey;
    syncUi();
  }

  function changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let n = 0;
    for (let k = 0; k < FEATURE_MAP_SIZE; k++) {
      const i = k * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
    }
    return n;
  }

  function syncUi(): void {
    const brush = getFeatureTagBrush();
    for (const [k, btn] of brushButtons) {
      btn.classList.toggle('active', brush === k);
      btn.setAttribute('aria-pressed', String(brush === k));
    }
    const counts = map ? countLabels(map) : null;
    for (const b of BRUSHES) {
      const n = counts && b.key !== 'erase' ? counts[b.key as FeatureLabel] : null;
      brushButtons.get(b.key)?.setAttribute('title', n == null ? b.hint : `${b.hint} (${n} pixels)`);
    }
    panel.classList.toggle('is-tagging', brush != null);
    doneBtn.hidden = brush == null;
    resetBtn.disabled = !saved;
    libraryBtn.hidden = isTagSessionActive();
    const tagged = countTaggedSkins();
    if (brush) {
      setStatus(fillMode
        ? 'Click a pixel to tag it and its similar neighbours. Right-drag to turn the model.'
        : 'Paint tags on the model or the grid. Right-drag to turn the model.');
    } else {
      setStatus(`${saved ? 'Hand-tagged skin.' : 'Guessed tags: pick a brush to check and fix them.'} ${tagged} skin${tagged === 1 ? '' : 's'} tagged so far.`);
    }
  }

  function showOverlay(): void {
    if (!map) return;
    if (!overlay) {
      const real = readCanvas();
      if (!real) return;
      overlay = { real, shown: real };
    }
    overlay.shown = tint(overlay.real, map);
    writeCanvas(overlay.shown);
  }

  function refreshOverlay(): void {
    if (!overlay || overlayFrame) return;
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0;
      if (overlay) showOverlay();
    });
  }

  /** Put the real skin back, unless something else has changed the canvas since (then keep that). */
  function hideOverlay(): void {
    if (overlayFrame) cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
    if (!overlay) return;
    const { real, shown } = overlay;
    overlay = null;
    const now = readCanvas();
    if (now && sameData(now, shown)) writeCanvas(real);
  }

  function fillSimilar(start: number, code: number): void {
    if (!pixels || !map) return;
    const base = start * 4;
    const layer = isOverlayTexel(start);
    const seen = new Uint8Array(FEATURE_MAP_SIZE);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      map[k] = code;
      const x = k % 64;
      const y = (k / 64) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= 64 || ny >= 64) continue;
        const n = ny * 64 + nx;
        if (seen[n] || !isUsedTexel(n) || isOverlayTexel(n) !== layer) continue;
        seen[n] = 1;
        const i = n * 4;
        if ((pixels[i + 3]! > 0) !== (pixels[base + 3]! > 0)) continue;
        const dr = pixels[i]! - pixels[base]!;
        const dg = pixels[i + 1]! - pixels[base + 1]!;
        const db = pixels[i + 2]! - pixels[base + 2]!;
        if (Math.sqrt(dr * dr + dg * dg + db * db) > FILL_COLOR_DISTANCE) continue;
        stack.push(n);
      }
    }
  }

  registerFeatureTagHandlers({
    paint: (sx, sy) => {
      const brush = getFeatureTagBrush();
      if (!brush || !map || sx < 0 || sy < 0 || sx >= 64 || sy >= 64) return;
      const k = sy * 64 + sx;
      const code = brush === 'erase' ? UNTAGGED : FEATURE_CODE[brush];
      if (fillMode) {
        if (strokeStarted) return; // one fill per click
        fillSimilar(k, code);
      } else if (map[k] === code) {
        strokeStarted = true;
        return;
      } else {
        map[k] = code;
      }
      strokeStarted = true;
      strokeDirty = true;
      refreshOverlay();
    },
    end: () => {
      strokeStarted = false;
      if (!strokeDirty || !key || !map) return;
      strokeDirty = false;
      saved = true;
      saveFeatureTags(key, map);
      syncUi();
    },
  });

  creatorScope.track(onFeatureTagBrushChanged(() => {
    if (getFeatureTagBrush()) {
      syncSkin();
      showOverlay();
    } else {
      hideOverlay();
    }
    syncUi();
  }));

  // Anything that would read or change the real skin puts the brush down first.
  creatorScope.track(creatorModeSlice.subscribe(() => {
    const mode = document.body.dataset.editMode;
    if (mode !== '2d' && mode !== '3d') setFeatureTagBrush(null);
    else window.setTimeout(syncSkin, 0);
  }));
  creatorScope.track(creatorToolsSlice.subscribe(() => setFeatureTagBrush(null)));
  creatorScope.track(onTagSessionChanged(() => syncUi()));
  creatorScope.track(creatorCanvasSlice.subscribe(() => {
    if (overlay) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(syncSkin, 200);
  }));
  const onKeyDown = (e: KeyboardEvent) => {
    if (!getFeatureTagBrush()) return;
    if (e.key === 'Escape') setFeatureTagBrush(null);
    else if ((e.ctrlKey || e.metaKey) && /^[zys]$/i.test(e.key)) setFeatureTagBrush(null); // undo / redo / save
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!getFeatureTagBrush()) return;
    const target = e.target as Element | null;
    if (!target || panel.contains(target)) return;
    if (target.closest('#creator-blocky-grid') || target.tagName === 'CANVAS') return;
    setFeatureTagBrush(null);
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  creatorScope.track(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.clearTimeout(syncTimer);
    setFeatureTagBrush(null);
    registerFeatureTagHandlers(null);
    panel.remove();
  });

  syncSkin();
  syncUi();
}
