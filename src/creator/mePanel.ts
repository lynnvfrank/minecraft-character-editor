/**
 * Me tab (first stage of Design): pick your hair, eyes and skin, each a style and a color.
 *
 * Left: rows for Hair, Eyes and Skin (like the Wardrobe's layer rows), each with its style and a
 * color chip. Right: the selected feature's style catalog, every skin in the library with just
 * that feature cut out of it (by its tags); hover to preview, click to pick. The shared color
 * picker on the right colors the selected feature. Choices live in me.ts and are worn under every
 * outfit picked in the Wardrobe.
 */
import type { SkinEntry } from '../domain';
import { createEl } from './dom';
import { creatorScope } from './lifecycle';
import { MODE_PANEL_CONFIGS } from './modePanels';
import {
  cutoutSize,
  drawCutout,
  ensureSource,
  getMeChoice,
  loadMeStyles,
  ME_FEATURES,
  onMeChanged,
  onMeTagsChanged,
  previewMeStyle,
  setMeColor,
  setMeStyle,
  type MeFeature,
} from './me';
import { FEATURE_CODE } from '../styler/featureMap';

const META: Record<MeFeature, { label: string; catalog: string; hint: string }> = {
  hair: { label: 'Hair', catalog: 'Hair styles', hint: 'Hair style from any skin, and its color' },
  eyes: { label: 'Eyes', catalog: 'Eye styles', hint: 'Eyes, brows and face details from any skin, and the eye color' },
  skin: { label: 'Skin', catalog: 'Skin styles', hint: 'Skin with its shading from any skin, and its tone' },
};

let selected: MeFeature | null = 'hair';
const focusListeners = new Set<(f: MeFeature | null) => void>();
let targetListener: ((hex: string) => void) | null = null;

/** The Me row that's open (camera framing follows it), only while the Me tab shows. */
export function getMeFocus(): MeFeature | null {
  return document.body.dataset.editMode === 'style' ? selected : null;
}
export function onMeFocusChanged(fn: (f: MeFeature | null) => void): () => void {
  focusListeners.add(fn);
  return () => focusListeners.delete(fn);
}

/** Color bridge: in the Me tab the shared picker/swatches color the selected feature. */
export function isMeColorTargetActive(): boolean {
  return document.body.dataset.editMode === 'style' && selected != null;
}
export function getMeTargetColor(): string | null {
  return selected ? getMeChoice(selected).color : null;
}
export function setMeTargetColor(hex: string): void {
  if (selected) setMeColor(selected, hex);
}
/** Notified with the selected feature's color when another feature is selected. */
export function onMeTargetChanged(fn: (hex: string) => void): void {
  targetListener = fn;
}

export type MePanelContext = {
  getSkins: () => readonly SkinEntry[];
  /** Open a skin in the editor with the tag brush for a feature, to fix how it's cut out. */
  openForTagging: (path: string, feature: MeFeature) => void;
};

export function buildMePanel(ctx: MePanelContext): void {
  const host = document.getElementById('creator-upper-left-panels');
  const rightHost = document.getElementById('creator-right-panels-group');
  if (!host || !rightHost) return;
  document.getElementById('creator-me-panel')?.remove();
  document.getElementById('creator-me-catalog')?.remove();

  const labelFor = (path: string | null): string => {
    if (!path) return "Outfit's own";
    const skin = ctx.getSkins().find((s) => s.path === path);
    if (skin) return skin.label;
    if (path.startsWith('data:')) return 'A saved skin';
    const file = path.split('/').pop()?.replace(/\.png$/i, '') ?? '';
    return file.replace(/[_-]+/g, ' ').trim() || 'Another skin';
  };

  // ---- Left: feature rows.
  const rows = new Map<MeFeature, { btn: HTMLButtonElement; thumb: HTMLCanvasElement; name: HTMLElement; chip: HTMLButtonElement; reset: HTMLButtonElement }>();
  const list = createEl('div', { className: 'creator-me-rows', role: 'group', 'aria-label': 'My features' });
  for (const f of ME_FEATURES) {
    const { w, h } = cutoutSize(f);
    const thumb = createEl('canvas', { className: 'creator-me-thumb', width: String(w * 3), height: String(h * 3), 'aria-hidden': 'true' });
    const name = createEl('span', { className: 'creator-me-style-name' });
    const btn = createEl('button', { type: 'button', className: 'creator-wardrobe-parts-btn creator-me-row-btn', 'data-feature': f, title: META[f].hint },
      thumb,
      createEl('span', { className: 'creator-me-row-text' },
        createEl('span', { className: 'creator-wardrobe-layer-label' }, META[f].label),
        name,
      ),
    );
    const chip = createEl('button', { type: 'button', className: 'creator-me-chip', title: `${META[f].label} color: pick it on the right`, 'aria-label': `${META[f].label} color` });
    const reset = createEl('button', { type: 'button', className: 'creator-me-reset', title: `Use the style's own ${META[f].label.toLowerCase()} color`, 'aria-label': `Reset ${META[f].label.toLowerCase()} color` }, '×');
    btn.addEventListener('click', () => select(f));
    chip.addEventListener('click', () => select(f));
    reset.addEventListener('click', () => setMeColor(f, null));
    rows.set(f, { btn, thumb, name, chip, reset });
    list.appendChild(createEl('div', { className: 'creator-me-row', 'data-feature': f }, btn, chip, reset));
  }
  const tagBtn = createEl('button', { type: 'button', className: 'creator-me-link', title: "Open this style's skin in 3D with the tag brush, to fix what counts as hair, eyes or skin" }, 'Tag this skin');
  tagBtn.addEventListener('click', () => {
    const path = selected ? getMeChoice(selected).style : null;
    if (path && selected) ctx.openForTagging(path, selected);
  });
  const panel = createEl('div', { id: 'creator-me-panel', className: 'creator-me-panel', role: 'region', 'aria-label': 'Me' },
    createEl('div', { className: 'creator-layers-panel-title creator-panel-title' }, 'Me'),
    createEl('p', { className: 'creator-me-intro' }, 'Pick your hair, eyes and skin, then dress up in the Wardrobe. They stay on through every outfit.'),
    list,
    createEl('div', { className: 'creator-me-actions' }, tagBtn),
  );
  const modePanel = document.getElementById('creator-mode-panel');
  if (modePanel?.parentElement === host) host.insertBefore(panel, modePanel.nextSibling);
  else host.insertBefore(panel, host.firstChild);

  // ---- Right: the selected feature's catalog, above the color picker.
  const header = createEl('div', { className: 'creator-panel-title creator-me-catalog-title' });
  const grid = createEl('div', { className: 'creator-me-grid', role: 'listbox' });
  const catalog = createEl('div', { id: 'creator-me-catalog', className: 'creator-me-catalog', role: 'region' }, header, grid);
  rightHost.insertBefore(catalog, rightHost.firstChild);
  grid.addEventListener('mouseleave', () => {
    if (selected) previewMeStyle(selected, undefined);
  });

  for (const el of [panel, catalog]) {
    const mode = document.body.dataset.editMode;
    if (mode && !MODE_PANEL_CONFIGS.find((c) => c.id === el.id)?.modes.includes(mode as never)) {
      el.classList.add('creator-mode-panel-hidden');
    }
  }

  // Draw catalog cut-outs only as they scroll into view (each needs its skin loaded and tagged).
  const drawObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      drawObserver.unobserve(e.target);
      void drawTile(e.target as HTMLElement);
    }
  }, { root: grid, rootMargin: '120px' });

  async function drawTile(tile: HTMLElement): Promise<void> {
    const path = tile.dataset.path;
    const f = tile.dataset.feature as MeFeature | undefined;
    if (!path || !f) return;
    const src = await ensureSource(path);
    const canvas = tile.querySelector('canvas');
    if (!src || !canvas) {
      tile.hidden = true;
      return;
    }
    // A skin with none of this feature (e.g. no hair) has no style to offer.
    const code = FEATURE_CODE[f];
    let n = 0;
    for (let k = 0; k < src.map.length && n < 3; k++) if (src.map[k] === code) n++;
    if (n < 3) {
      tile.hidden = true;
      return;
    }
    drawCutout(canvas, src, f);
  }

  function tile(f: MeFeature, path: string | null): HTMLElement {
    const label = labelFor(path);
    const btn = createEl('button', {
      type: 'button',
      className: 'creator-me-tile' + (path ? '' : ' creator-me-tile-own'),
      role: 'option',
      title: label,
      'aria-label': `${META[f].label}: ${label}`,
      'data-path': path ?? '',
      'data-feature': f,
    });
    if (path) {
      const { w, h } = cutoutSize(f);
      btn.appendChild(createEl('canvas', { width: String(w * 5), height: String(h * 5), 'aria-hidden': 'true' }));
      drawObserver.observe(btn);
    } else {
      btn.appendChild(createEl('span', {}, "Outfit's own"));
    }
    btn.addEventListener('mouseenter', () => previewMeStyle(f, path));
    btn.addEventListener('focus', () => previewMeStyle(f, path));
    btn.addEventListener('click', () => setMeStyle(f, path));
    return btn;
  }

  function fillCatalog(): void {
    drawObserver.disconnect();
    if (!selected) {
      grid.replaceChildren();
      return;
    }
    const f = selected;
    header.textContent = META[f].catalog;
    grid.dataset.feature = f;
    grid.setAttribute('aria-label', META[f].catalog);
    grid.replaceChildren(tile(f, null), ...ctx.getSkins().map((s) => tile(f, s.path)));
    syncActive();
  }

  function syncActive(): void {
    if (!selected) return;
    const current = getMeChoice(selected).style;
    grid.querySelectorAll<HTMLElement>('.creator-me-tile').forEach((el) => {
      const on = (el.dataset.path || null) === current;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', String(on));
    });
  }

  function select(f: MeFeature): void {
    if (selected === f) return;
    if (selected) previewMeStyle(selected, undefined);
    selected = f;
    fillCatalog();
    syncRows();
    focusListeners.forEach((fn) => fn(getMeFocus()));
    const color = getMeChoice(f).color;
    if (color) targetListener?.(color);
  }

  function syncRows(): void {
    for (const f of ME_FEATURES) {
      const r = rows.get(f)!;
      const { style, color } = getMeChoice(f);
      r.btn.classList.toggle('active', selected === f);
      r.name.textContent = labelFor(style);
      r.chip.classList.toggle('is-original', !color);
      r.chip.style.background = color ?? '';
      r.reset.hidden = !color;
      const ctx2d = r.thumb.getContext('2d');
      ctx2d?.clearRect(0, 0, r.thumb.width, r.thumb.height);
      if (style) void ensureSource(style).then((src) => { if (src && getMeChoice(f).style === style) drawCutout(r.thumb, src, f); });
    }
    tagBtn.disabled = !(selected && getMeChoice(selected).style);
    syncActive();
  }

  // Fit the catalog into the space above the color picker; it scrolls inside.
  const fit = () => {
    if (catalog.classList.contains('creator-mode-panel-hidden')) return;
    const below = rightHost.getBoundingClientRect().bottom - catalog.getBoundingClientRect().bottom;
    const space = window.innerHeight - 12 - below - (window.innerHeight - rightHost.getBoundingClientRect().bottom);
    catalog.style.maxHeight = `${Math.max(140, Math.floor(space - 12))}px`;
  };
  const ro = new ResizeObserver(() => fit());
  ro.observe(document.body);
  ro.observe(rightHost);
  requestAnimationFrame(fit);

  creatorScope.track(onMeChanged(syncRows));
  creatorScope.track(onMeTagsChanged(() => fillCatalog()));
  creatorScope.track(() => {
    drawObserver.disconnect();
    ro.disconnect();
    if (selected) previewMeStyle(selected, undefined);
    targetListener = null;
    panel.remove();
    catalog.remove();
  });

  fillCatalog();
  syncRows();
  loadMeStyles();
  // The skin list loads after the panels: fill the catalog once it's there.
  let tries = 0;
  const waitForSkins = window.setInterval(() => {
    if (ctx.getSkins().length || ++tries > 40) {
      window.clearInterval(waitForSkins);
      fillCatalog();
      syncRows();
    }
  }, 250);
  creatorScope.track(() => window.clearInterval(waitForSkins));
}
