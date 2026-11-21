/**
 * Home-view "Residents" popover: choose which skins live in the village.
 *
 * A round button in the bottom-right corner (stacked above About and the theme toggle, so it is
 * there whether or not a character is selected; the top-left belongs to the Move panels) opens a
 * panel with one thumbnail tile per skin (pressed = lives here) and three quick actions.
 * The panel only edits the roster store; controllers/crowdController.ts applies it to the crowd.
 *
 * - Nothing stored yet: the tiles show whoever is in the world right now, and the first change
 *   saves that group as the roster.
 * - The main character (the primary, i.e. whoever is or was last selected) can't be sent away:
 *   its tile is locked and says so. Select someone else to make them the main character.
 * - At most `cap` residents; a full village refuses more with a hint.
 */
import {
  effectiveRoster,
  fillRoster,
  normalizeRoster,
  randomRoster,
  toggleResident,
} from '../domain/residents';

type SkinEntry = { path: string; label: string; preview?: string };

export type ResidentsPanelDeps = {
  getSkins: () => readonly SkinEntry[];
  store: {
    get: () => readonly string[] | null;
    set: (roster: readonly string[]) => void;
    subscribe: (listener: () => void) => () => void;
  };
  /** Skins in the world right now (primary first). */
  getPresentSkins: () => readonly string[];
  /** The primary character's skin (null before it loads). */
  getPrimarySkin: () => string | null;
  /** Most residents at once. */
  cap: number;
  random?: () => number;
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
  panel.append(header, actions, hint, grid);
  // On the body, like the About and theme buttons it is stacked with.
  document.body.append(openBtn, panel);

  const tiles = new Map<string, HTMLButtonElement>();
  let timer: number | null = null;
  let lastSignature = '';
  let hintOverride: string | null = null;

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
      hint.textContent = chosen ? 'Tap a character to move them in or out.' : 'Visitors drop by at random. Tap to pick who lives here.';
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

  /** Tiles are built on open: current residents first, then the rest in list order. */
  function buildTiles(): void {
    const { roster } = current();
    const on = new Set(roster);
    const skins = deps.getSkins();
    const ordered = [...skins.filter((s) => on.has(s.path)), ...skins.filter((s) => !on.has(s.path))];
    tiles.clear();
    grid.textContent = '';
    for (const skin of ordered) {
      const tile = el('button', 'residents-tile');
      tile.type = 'button';
      tile.dataset.label = skin.label;
      tile.setAttribute('aria-label', skin.label);
      const img = document.createElement('img');
      img.src = skin.preview ?? skin.path;
      img.alt = '';
      img.loading = 'lazy';
      tile.appendChild(img);
      tile.addEventListener('click', () => toggle(skin.path));
      tiles.set(skin.path, tile);
      grid.appendChild(tile);
    }
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

  openBtn.addEventListener('click', () => setOpen(panel.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));
  deps.store.subscribe(() => {
    if (!panel.hidden) refresh(true);
  });

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => !panel.hidden,
  };
}
