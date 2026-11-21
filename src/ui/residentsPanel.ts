/**
 * Home-view "Residents" popover: choose which skins live in the village.
 *
 * A round button in the bottom-right corner (stacked above About and the theme toggle, so it is
 * there whether or not a character is selected; the top-left belongs to the Move panels) opens a
 * panel with one thumbnail tile per skin (pressed = lives here) and four quick actions.
 * The panel only edits the roster store; controllers/crowdController.ts applies it to the crowd.
 *
 * - Nothing stored yet: the tiles show whoever is in the world right now, and the first change
 *   saves that group as the roster.
 * - The main character (the primary, i.e. whoever is or was last selected) can't be sent away:
 *   its tile is locked and says so. Select someone else to make them the main character.
 * - At most `cap` residents; a full village refuses more with a hint.
 * - "Random visitors" forgets the roster, so the default come-and-go crowd returns; the hint
 *   line says which of the two modes is on.
 * - "My outfits" (skins kept in the creator) get their own group above the bundled characters,
 *   with the same tap-to-toggle tiles. A tile shows the skin's face, cut out of the skin image
 *   with CSS. The small x on a tile deletes the outfit for good (second tap confirms); whoever
 *   wore it in the village goes with it.
 * - Escape closes the open panel. The listener runs in the capture phase and stops the event, so
 *   the same keypress doesn't also deselect the character (selectionController listens for
 *   Escape on the document too). The About overlay, when open, sits on top and gets Escape first.
 */
import {
  effectiveRoster,
  fillRoster,
  normalizeRoster,
  randomRoster,
  toggleResident,
} from '../domain/residents';

import { isOutfitDataUrl } from '../domain/outfits';

type SkinEntry = {
  /** What the roster stores: a skin path, or `outfit:<id>` for one of the user's outfits. */
  path: string;
  label: string;
  preview?: string;
  /** A 64×64 skin image (data URL) whose face is the thumbnail; used when there is no preview. */
  face?: string;
  /** 'outfits' puts the tile in the "My outfits" group. */
  group?: string;
};

export type ResidentsPanelDeps = {
  getSkins: () => readonly SkinEntry[];
  store: {
    get: () => readonly string[] | null;
    set: (roster: readonly string[]) => void;
    /** Forget the roster: random visitors again. */
    clear: () => void;
    subscribe: (listener: () => void) => () => void;
  };
  /** Skins in the world right now (primary first). */
  getPresentSkins: () => readonly string[];
  /** The primary character's skin (null before it loads). */
  getPrimarySkin: () => string | null;
  /** Most residents at once. */
  cap: number;
  random?: () => number;
  /** Delete one of the user's outfits for good (tiles in the 'outfits' group get a small x). */
  onRemoveOutfit?: (path: string) => void;
  /** Called when the skin list changes (an outfit was kept or deleted) so open tiles can be rebuilt. */
  subscribeSkins?: (listener: () => void) => () => void;
};

/** While open, re-check who is around (visitors come and go, selection changes the main character). */
const REFRESH_MS = 500;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function createResidentsPanel(deps: ResidentsPanelDeps) {
  const random = deps.random ?? Math.random;

  const openBtn = el('button', 'residents-btn', '👥');
  openBtn.type = 'button';
  openBtn.id = 'residents-btn';
  openBtn.title = 'Residents';
  openBtn.setAttribute('aria-label', 'Choose who lives in the village');
  openBtn.setAttribute('aria-expanded', 'false');

  const panel = el('aside', 'residents-panel');
  panel.id = 'residents-panel';
  panel.setAttribute('aria-label', 'Residents');
  panel.hidden = true;

  const header = el('div', 'residents-header');
  const title = el('span', 'residents-title', 'Residents');
  const count = el('span', 'residents-count');
  const closeBtn = el('button', 'residents-close', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close residents');
  header.append(title, count, closeBtn);

  const actions = el('div', 'residents-actions');
  const action = (label: string, tip: string, run: () => void) => {
    const b = el('button', 'residents-action', label);
    b.type = 'button';
    b.title = tip;
    b.addEventListener('click', run);
    actions.appendChild(b);
  };

  const hint = el('div', 'residents-hint');
  hint.setAttribute('role', 'status');
  const grid = el('div', 'residents-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Characters');
  const outfitsTitle = el('div', 'residents-group-title', 'My outfits');
  const outfitsGrid = el('div', 'residents-grid residents-grid--outfits');
  outfitsGrid.setAttribute('role', 'group');
  outfitsGrid.setAttribute('aria-label', 'My outfits');
  const charactersTitle = el('div', 'residents-group-title', 'Characters');
  panel.append(header, actions, hint, outfitsTitle, outfitsGrid, charactersTitle, grid);
  // On the body, like the About and theme buttons it is stacked with.
  document.body.append(openBtn, panel);

  const tiles = new Map<string, HTMLButtonElement>();
  let timer: number | null = null;
  let lastSignature = '';
  let hintOverride: string | null = null;
  /** Outfit whose x was tapped once; a second tap deletes it. */
  let removeArmed: string | null = null;

  const available = () => deps.getSkins().map((s) => s.path);

  function current(): { roster: string[]; main: string | null; chosen: boolean } {
    const main = deps.getPrimarySkin();
    const stored = deps.store.get();
    return {
      roster: effectiveRoster(stored, deps.getPresentSkins(), available(), deps.cap, main),
      main,
      chosen: stored !== null,
    };
  }

  function say(text: string): void {
    hintOverride = text;
    hint.textContent = text;
  }

  function refresh(force = false): void {
    const { roster, main, chosen } = current();
    const signature = `${chosen}|${main}|${roster.join('|')}`;
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    const on = new Set(roster);
    for (const [path, tile] of tiles) {
      const isOn = on.has(path);
      const isMain = isOn && path === main;
      tile.classList.toggle('is-on', isOn);
      tile.classList.toggle('is-main', isMain);
      tile.setAttribute('aria-pressed', String(isOn));
      const label = tile.dataset.label ?? '';
      tile.title = isMain ? `${label} (main character)` : label;
    }
    count.textContent = `${roster.length} of ${deps.cap}`;
    if (hintOverride == null) {
      hint.textContent = chosen
        ? 'Only your picks live here. Tap to move someone in or out.'
        : 'Visitors drop by at random. Tap to pick who lives here.';
    }
  }

  function commit(roster: readonly string[], message: string | null = null): void {
    hintOverride = message;
    deps.store.set(roster);
    refresh(true);
  }

  function toggle(path: string): void {
    const { roster, main } = current();
    const result = toggleResident(roster, path, { available: available(), cap: deps.cap, locked: main });
    switch (result.outcome) {
      case 'added':
      case 'removed':
        commit(result.roster);
        break;
      case 'locked':
        say('Your main character stays. Select someone else first.');
        break;
      case 'full':
        say(`The village is full (${deps.cap}). Send someone home first.`);
        break;
      default:
        break;
    }
  }

  function buildTile(skin: SkinEntry): HTMLButtonElement {
    const tile = el('button', 'residents-tile');
    tile.type = 'button';
    tile.dataset.label = skin.label;
    tile.setAttribute('aria-label', skin.label);
    if (!skin.preview && skin.face) {
      // The face (and hat layer over it) cut out of the skin image. Only a checked PNG data URL
      // goes into the style: the image comes from storage.
      const face = el('span', 'residents-face');
      if (isOutfitDataUrl(skin.face)) face.style.backgroundImage = `url("${skin.face}"), url("${skin.face}")`;
      tile.appendChild(face);
    } else {
      const img = document.createElement('img');
      img.src = skin.preview ?? skin.path;
      img.alt = '';
      img.loading = 'lazy';
      tile.appendChild(img);
    }
    tile.addEventListener('click', () => toggle(skin.path));
    tiles.set(skin.path, tile);
    return tile;
  }

  /** An outfit tile with its delete button (two taps: the first asks, the second deletes). */
  function buildOutfitTile(skin: SkinEntry): HTMLElement {
    const wrap = el('div', 'residents-outfit');
    wrap.appendChild(buildTile(skin));
    const onRemove = deps.onRemoveOutfit;
    if (!onRemove) return wrap;
    const remove = el('button', 'residents-outfit-remove', '✕');
    remove.type = 'button';
    remove.title = 'Delete this outfit';
    remove.setAttribute('aria-label', `Delete outfit ${skin.label}`);
    remove.addEventListener('click', () => {
      if (removeArmed !== skin.path) {
        removeArmed = skin.path;
        for (const other of outfitsGrid.querySelectorAll('.residents-outfit-remove.is-armed')) other.classList.remove('is-armed');
        remove.classList.add('is-armed');
        say('Delete this outfit for good? Tap the x again.');
        return;
      }
      removeArmed = null;
      hintOverride = 'Outfit deleted.';
      onRemove(skin.path);
      rebuild();
    });
    wrap.appendChild(remove);
    return wrap;
  }

  /** Tiles are built on open: current residents first, then the rest in list order. */
  function buildTiles(): void {
    const { roster } = current();
    const on = new Set(roster);
    const skins = deps.getSkins();
    const ordered = [...skins.filter((s) => on.has(s.path)), ...skins.filter((s) => !on.has(s.path))];
    tiles.clear();
    removeArmed = null;
    grid.textContent = '';
    outfitsGrid.textContent = '';
    for (const skin of ordered) {
      if (skin.group === 'outfits') outfitsGrid.appendChild(buildOutfitTile(skin));
      else grid.appendChild(buildTile(skin));
    }
    const hasOutfits = outfitsGrid.childElementCount > 0;
    outfitsTitle.hidden = outfitsGrid.hidden = charactersTitle.hidden = !hasOutfits;
  }

  function rebuild(): void {
    if (panel.hidden) return;
    buildTiles();
    refresh(true);
  }

  function setOpen(open: boolean): void {
    if (open === !panel.hidden) return;
    panel.hidden = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    openBtn.classList.toggle('is-open', open);
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (!open) return;
    hintOverride = null;
    buildTiles();
    refresh(true);
    timer = window.setInterval(() => {
      // Left the home view with the panel open: close it rather than reappear later.
      if (document.body.dataset.route !== 'viewer') setOpen(false);
      else refresh();
    }, REFRESH_MS);
  }

  action('Everyone', `Fill the village (up to ${deps.cap})`, () => {
    const { roster } = current();
    commit(fillRoster(roster, available(), deps.cap), null);
  });
  action('Nobody', 'Just your main character', () => {
    commit(normalizeRoster([], available(), deps.cap, current().main), 'Just your main character for now.');
  });
  action('Surprise me', 'A random group', () => {
    commit(randomRoster(available(), deps.cap, random, current().main), null);
  });

  action('Random visitors', 'Forget your picks: anyone may drop by', () => {
    hintOverride = current().chosen ? 'Random visitors are back. Anyone may drop by.' : null;
    deps.store.clear();
    refresh(true);
  });

  openBtn.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || panel.hidden) return;
      if (document.querySelector('.about-overlay:not([hidden])')) return;
      setOpen(false);
      e.stopPropagation();
      openBtn.focus();
    },
    true
  );
  closeBtn.addEventListener('click', () => setOpen(false));
  deps.store.subscribe(() => {
    if (!panel.hidden) refresh(true);
  });
  deps.subscribeSkins?.(rebuild);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => !panel.hidden,
  };
}
