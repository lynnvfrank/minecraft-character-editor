/**
 * Wardrobe "Pieces": keep hair, eyes or skin tone from any skin while you change outfits.
 *
 * The outfit (the Wardrobe's composed skin) supplies the costume. Each piece picked here
 * comes from another skin, cut out by that skin's feature tags (featureTagsStore.ts, painted
 * in the 2D/3D editor) or, for untagged skins, by the automatic guess. The mix is done by
 * composeFeatures (styler/featureMap.ts) as the Wardrobe's final pass, so pieces stay on
 * through every outfit and part you pick, and hovering previews like the rest of the Wardrobe.
 */
import { SKIN_SIZE, RESOLUTION_MULTIPLIER, WORK_SIZE } from '../skin';
import type { SkinEntry } from '../domain';
import { autoTagFeatures, composeFeatures, type FeatureMap, type TaggedSkin } from '../styler/featureMap';
import { createEl } from './dom';
import { creatorScope } from './lifecycle';
import { clearModeAnimClasses, setModePanelHidden } from './modePanels';
import { loadFeatureTags, onFeatureTagsSaved, skinPixelKey } from './featureTagsStore';

export type PieceSlot = 'hair' | 'eyes' | 'skin';
const SLOTS: { key: PieceSlot; label: string; libraryTitle: string; hint: string }[] = [
  { key: 'hair', label: 'Hair', libraryTitle: 'Hair', hint: 'Hair from any skin, wherever it falls' },
  { key: 'eyes', label: 'Eyes', libraryTitle: 'Eyes', hint: 'Eyes, brows and face details from any skin' },
  { key: 'skin', label: 'Skin', libraryTitle: 'Skin tones', hint: 'Skin tone from any skin, with its shading' },
];

type Picks = Record<PieceSlot, string | null>;
const STORAGE_KEY = 'blockygotchi.wardrobePieces.v1';

function loadPicks(): Picks {
  const empty: Picks = { hair: null, eyes: null, skin: null };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Picks> | null;
    if (!parsed || typeof parsed !== 'object') return empty;
    for (const s of SLOTS) {
      const v = parsed[s.key];
      // Saved-this-visit skins are data URLs: too big to keep, and gone next visit anyway.
      if (typeof v === 'string' && v.length < 300 && !v.startsWith('data:')) empty[s.key] = v;
    }
    return empty;
  } catch {
    return empty;
  }
}

function savePicks(picks: Picks): void {
  try {
    const keep: Partial<Picks> = {};
    for (const s of SLOTS) if (picks[s.key] && !picks[s.key]!.startsWith('data:')) keep[s.key] = picks[s.key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch {
    // storage unavailable: picks last for this visit
  }
}

const picks: Picks = loadPicks();
/** Hovered tile in the picker: previews in place of that slot's pick. */
let preview: { slot: PieceSlot; path: string | null } | null = null;
const listeners = new Set<() => void>();

/** Notified when a pick or the hover preview changes (the Wardrobe re-composes). */
export function onPiecesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  listeners.forEach((fn) => fn());
}

function effectivePick(slot: PieceSlot): string | null {
  return preview?.slot === slot ? preview.path : picks[slot];
}

export function hasPieces(): boolean {
  return SLOTS.some((s) => effectivePick(s.key) != null);
}

// ---------------------------------------------------------------------------
// Source skins: 64x64 pixels (read exactly as the editor loads them, so tag keys match) + tags.

const sources = new Map<string, TaggedSkin | null>();
const loading = new Map<string, Promise<void>>();
/** Auto-guessed maps by skin key (guessing takes a few ms; outfits re-compose on every hover). */
const guessed = new Map<string, FeatureMap>();

function tagsFor(pixels: Uint8ClampedArray): FeatureMap {
  const key = skinPixelKey(pixels);
  const stored = loadFeatureTags(key);
  if (stored) return stored;
  let map = guessed.get(key);
  if (!map) {
    map = autoTagFeatures({ width: SKIN_SIZE, height: SKIN_SIZE, data: pixels });
    if (guessed.size > 64) guessed.clear();
    guessed.set(key, map);
  }
  return map;
}

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

function loadImage(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path.startsWith('data:') || path.startsWith('/') ? path : `/${path}`;
  });
}

/** Read a skin file the way skinIO.loadSkinToCanvas does (draw at working size, sample back). */
function ensureSource(path: string): Promise<void> {
  if (sources.has(path)) return Promise.resolve();
  let pending = loading.get(path);
  if (pending) return pending;
  pending = (async () => {
    const img = await loadImage(path);
    let result: TaggedSkin | null = null;
    if (img && img.width > 0 && img.height > 0) {
      const c = document.createElement('canvas');
      c.width = WORK_SIZE;
      c.height = WORK_SIZE;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const h = img.height < img.width ? (WORK_SIZE * img.height) / img.width : WORK_SIZE;
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, WORK_SIZE, h);
        const pixels = downsample(ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data);
        result = { pixels: { width: SKIN_SIZE, height: SKIN_SIZE, data: pixels }, map: tagsFor(pixels) };
      }
    }
    sources.set(path, result);
    loading.delete(path);
  })();
  loading.set(path, pending);
  return pending;
}

/** Tags were edited in the 2D/3D editor: re-read the tags of loaded sources. */
onFeatureTagsSaved(() => {
  for (const [path, src] of sources) {
    if (src) sources.set(path, { pixels: src.pixels, map: tagsFor(src.pixels.data as Uint8ClampedArray) });
  }
  if (hasPieces()) emit();
});

// ---------------------------------------------------------------------------
// The Wardrobe's final pass.

/**
 * The composed outfit (working resolution) with the picked pieces laid in, or null when no
 * piece is picked (or none is loaded yet). Only texels the mix changed are rewritten, so the
 * outfit keeps any hi-res detail.
 */
export function applyPieces(work: ImageData): ImageData | null {
  if (!hasPieces()) return null;
  const pick = (slot: PieceSlot): TaggedSkin | null => {
    const path = effectivePick(slot);
    return path ? (sources.get(path) ?? null) : null;
  };
  const hair = pick('hair');
  const eyes = pick('eyes');
  const skin = pick('skin');
  if (!hair && !eyes && !skin) return null;
  const outfitPixels = downsample(work.data);
  const outfit: TaggedSkin = { pixels: { width: SKIN_SIZE, height: SKIN_SIZE, data: outfitPixels }, map: tagsFor(outfitPixels) };
  const mixed = composeFeatures({ outfit, hair, eyes, skin }).data;

  const out = new ImageData(new Uint8ClampedArray(work.data), WORK_SIZE, WORK_SIZE);
  for (let k = 0; k < SKIN_SIZE * SKIN_SIZE; k++) {
    const i = k * 4;
    if (mixed[i] === outfitPixels[i] && mixed[i + 1] === outfitPixels[i + 1] && mixed[i + 2] === outfitPixels[i + 2] && mixed[i + 3] === outfitPixels[i + 3]) continue;
    const sx = k % SKIN_SIZE;
    const sy = (k / SKIN_SIZE) | 0;
    for (let dy = 0; dy < RESOLUTION_MULTIPLIER; dy++) {
      for (let dx = 0; dx < RESOLUTION_MULTIPLIER; dx++) {
        const o = ((sy * RESOLUTION_MULTIPLIER + dy) * WORK_SIZE + sx * RESOLUTION_MULTIPLIER + dx) * 4;
        out.data[o] = mixed[i]!;
        out.data[o + 1] = mixed[i + 1]!;
        out.data[o + 2] = mixed[i + 2]!;
        out.data[o + 3] = mixed[i + 3]!;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wardrobe UI: Hair / Eyes / Skin buttons above the layer tree, and a right-side library panel
// (like a layer's parts library) listing every skin's face for the selected piece.

export const PIECES_LIBRARY_PANEL_ID = 'creator-wardrobe-pieces-library';

let selectedSlot: PieceSlot | null = null;

/** The right-side panel to show in place of the selected layer's library, while a piece is selected. */
export function getPiecesLibraryPanelId(): string | null {
  return selectedSlot && document.body.dataset.editMode === 'wardrobe' ? PIECES_LIBRARY_PANEL_ID : null;
}

let clearSelection: (() => void) | null = null;
/** A wardrobe layer was picked: the piece buttons let go of the selection. */
export function clearPieceSelection(): void {
  clearSelection?.();
}

export type PiecesPanelContext = {
  getSkins: () => readonly SkinEntry[];
  /** Re-show the right-side library for the current selection (wardrobe.showWardrobeLibraryPanel). */
  showLibrary: () => void;
};

/** Head front of a skin, scaled up: with the hat layer for hair, bare for eyes and skin. */
function drawThumb(canvas: HTMLCanvasElement, path: string | null, slot: PieceSlot): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!path) return;
  void loadImage(path).then((img) => {
    if (!img) return;
    const s = img.width / 64;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, canvas.width, canvas.height);
    if (slot === 'hair') ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, canvas.width, canvas.height);
  });
}

export function buildPiecesPanel(ctx: PiecesPanelContext): void {
  const partsPanel = document.getElementById('creator-wardrobe-parts-panel');
  const tree = partsPanel?.querySelector('.creator-wardrobe-parts-tree');
  const rightRoot = document.getElementById('creator-upper-right-panels-root');
  if (!partsPanel || !tree || !rightRoot) return;
  document.getElementById('creator-wardrobe-pieces')?.remove();
  document.getElementById(PIECES_LIBRARY_PANEL_ID)?.remove();

  const labelFor = (path: string | null): string => {
    if (!path) return 'from the outfit';
    const skin = ctx.getSkins().find((s) => s.path === path);
    if (skin) return skin.label;
    // The Outfits list may not be loaded yet (picks restored at startup): name it from the file.
    if (path.startsWith('data:')) return 'a saved skin';
    const file = path.split('/').pop()?.replace(/\.png$/i, '') ?? '';
    return file.replace(/[_-]+/g, ' ').trim() || 'another skin';
  };

  // Left: three buttons styled like the layer rows, above the tree.
  const buttons = new Map<PieceSlot, { btn: HTMLButtonElement; thumb: HTMLCanvasElement }>();
  const row = createEl('div', { id: 'creator-wardrobe-pieces', className: 'creator-wardrobe-pieces', role: 'group', 'aria-label': 'Pieces' });
  for (const s of SLOTS) {
    const thumb = createEl('canvas', { className: 'creator-wardrobe-pieces-thumb', width: '20', height: '20', 'aria-hidden': 'true' });
    const btn = createEl('button', { type: 'button', className: 'creator-wardrobe-parts-btn creator-wardrobe-pieces-btn', 'data-slot': s.key },
      thumb,
      createEl('span', { className: 'creator-wardrobe-layer-label' }, s.label),
    );
    btn.addEventListener('click', () => selectSlot(s.key));
    buttons.set(s.key, { btn, thumb });
    row.appendChild(btn);
  }
  partsPanel.insertBefore(row, tree);

  // Right: one library panel, filled for the selected piece.
  const header = createEl('div', { className: 'creator-wardrobe-library-header' });
  const selector = createEl('div', { className: 'creator-wardrobe-library-selector creator-wardrobe-pieces-selector', role: 'listbox' });
  const hint = createEl('p', { className: 'creator-wardrobe-pieces-hint' }, 'Tag skins in 2D or 3D to cut pieces out cleanly.');
  const library = createEl('div', { id: PIECES_LIBRARY_PANEL_ID, className: 'creator-wardrobe-library-panel creator-mode-panel-hidden', 'aria-label': 'Pieces' },
    header, selector, hint,
  );
  rightRoot.appendChild(library);
  selector.addEventListener('mouseleave', () => setPreview(null));

  function tile(slot: PieceSlot, path: string | null): HTMLElement {
    const label = path ? labelFor(path) : `${SLOTS.find((s) => s.key === slot)!.label} from the outfit`;
    const btn = createEl('button', {
      type: 'button',
      className: 'skin-preview creator-wardrobe-library-item creator-wardrobe-pieces-item' + (path ? '' : ' creator-wardrobe-library-item-none'),
      role: 'option',
      title: label,
      'aria-label': label,
      'data-path': path ?? '',
    });
    if (path) {
      const c = createEl('canvas', { width: '40', height: '40', 'aria-hidden': 'true' });
      drawThumb(c, path, slot);
      btn.appendChild(c);
    } else {
      btn.appendChild(createEl('span', { className: 'creator-wardrobe-library-item-none-label' }, "Outfit's own"));
    }
    btn.addEventListener('mouseenter', () => setPreview({ slot, path }));
    btn.addEventListener('click', () => setPick(slot, path));
    return btn;
  }

  function fillLibrary(slot: PieceSlot): void {
    const meta = SLOTS.find((s) => s.key === slot)!;
    header.textContent = meta.libraryTitle;
    header.title = meta.hint;
    selector.setAttribute('aria-label', meta.libraryTitle);
    selector.replaceChildren(tile(slot, null), ...ctx.getSkins().map((s) => tile(slot, s.path)));
    syncActive();
  }

  function selectSlot(slot: PieceSlot): void {
    if (slot === selectedSlot) return;
    selectedSlot = slot;
    setPreview(null);
    fillLibrary(slot);
    syncUi();
    ctx.showLibrary();
  }
  clearSelection = () => {
    if (!selectedSlot) return;
    selectedSlot = null;
    setPreview(null);
    syncUi();
    // The wardrobe shows the layer's own library right after; just drop this one.
    clearModeAnimClasses(library);
    setModePanelHidden(library, true);
  };

  function setPreview(next: { slot: PieceSlot; path: string | null } | null): void {
    if (next?.slot === preview?.slot && next?.path === preview?.path) return;
    preview = next;
    const path = next?.path;
    if (path && !sources.has(path)) {
      void ensureSource(path).then(() => {
        if (preview?.path === path) emit();
      });
      return;
    }
    emit();
  }

  function setPick(slot: PieceSlot, path: string | null): void {
    picks[slot] = path;
    savePicks(picks);
    if (preview?.slot === slot) preview = null;
    syncUi();
    if (path && !sources.has(path)) void ensureSource(path).then(emit);
    else emit();
  }

  function syncActive(): void {
    if (!selectedSlot) return;
    const current = picks[selectedSlot];
    selector.querySelectorAll<HTMLElement>('.creator-wardrobe-pieces-item').forEach((el) => {
      const on = (el.dataset.path || null) === current;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', String(on));
    });
  }

  function syncUi(): void {
    partsPanel!.classList.toggle('is-piece-selected', selectedSlot != null);
    for (const s of SLOTS) {
      const b = buttons.get(s.key)!;
      const path = picks[s.key];
      b.btn.classList.toggle('active', selectedSlot === s.key);
      b.btn.classList.toggle('is-picked', path != null);
      b.btn.title = `${s.hint}. Now: ${labelFor(path)}`;
      drawThumb(b.thumb, path, s.key);
    }
    syncActive();
  }

  creatorScope.track(() => {
    clearSelection = null;
    selectedSlot = null;
    preview = null;
    row.remove();
    library.remove();
  });

  syncUi();
  // Load saved picks so the first outfit already wears them.
  const pending = SLOTS.map((s) => picks[s.key]).filter((p): p is string => p != null).map(ensureSource);
  if (pending.length) void Promise.all(pending).then(emit);
}
