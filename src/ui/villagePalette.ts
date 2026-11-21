/**
 * Home-view Build mode chrome: a round 🔨 button in the bottom-right stack (above Residents) and,
 * while building, a small palette panel: one swatch per tile, Undo, Reset village and Done, plus
 * a hint line that also shows why a stroke was refused. DOM only; the painting itself is
 * controllers/villageEditorController.ts.
 */

type Tile = { id: string; label: string; swatch: string };

export type VillagePaletteDeps = {
  tiles: readonly Tile[];
  initialTile: string;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onUndo: () => void;
  onReset: () => void;
  onDone: () => void;
};

export const VILLAGE_PALETTE_HINT =
  'Left-drag to paint. Right-drag turns the view, scroll zooms, WASD moves. On touch: one finger paints, two turn. Houses stay put.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function createVillagePalette(deps: VillagePaletteDeps) {
  const openBtn = el('button', 'village-build-btn', '🔨');
  openBtn.type = 'button';
  openBtn.title = 'Build: paint the village';
  openBtn.setAttribute('aria-label', 'Build: paint the village');
  openBtn.setAttribute('aria-pressed', 'false');
  openBtn.addEventListener('click', (e) => {
    deps.onToggle();
    if (e.detail > 0) openBtn.blur();
  });

  const panel = el('aside', 'village-palette');
  panel.setAttribute('aria-label', 'Build');
  panel.hidden = true;

  const header = el('div', 'village-palette-header');
  header.append(el('span', 'village-palette-title', 'Build'));

  const grid = el('div', 'village-palette-tiles');
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Tile to paint');
  const tileButtons = new Map<string, HTMLButtonElement>();
  for (const tile of deps.tiles) {
    const b = el('button', 'village-tile');
    b.type = 'button';
    b.dataset.tile = tile.id;
    b.title = tile.label;
    b.setAttribute('role', 'radio');
    const sw = el('span', 'village-tile-swatch');
    sw.style.background = tile.swatch;
    if (tile.id === 'eraser') sw.textContent = '⌫';
    b.append(sw, el('span', 'village-tile-label', tile.label));
    b.addEventListener('click', (e) => {
      deps.onSelect(tile.id);
      if (e.detail > 0) b.blur();
    });
    tileButtons.set(tile.id, b);
    grid.appendChild(b);
  }

  const actions = el('div', 'village-palette-actions');
  const action = (label: string, tip: string, run: () => void) => {
    const b = el('button', 'village-action', label);
    b.type = 'button';
    b.title = tip;
    b.addEventListener('click', (e) => {
      run();
      if (e.detail > 0) b.blur();
    });
    actions.appendChild(b);
    return b;
  };
  const undoBtn = action('Undo', 'Undo the last stroke (Ctrl+Z)', deps.onUndo);
  action('Reset village', 'Put the village back the way it was', deps.onReset);
  const doneBtn = action('Done', 'Stop building (Esc)', deps.onDone);
  doneBtn.classList.add('is-primary');

  const hint = el('p', 'village-palette-hint', VILLAGE_PALETTE_HINT);
  hint.setAttribute('role', 'status');

  panel.append(header, grid, actions, hint);
  const layer = document.getElementById('app-lower-left-panels')?.parentElement ?? document.body;
  layer.append(openBtn, panel);

  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function setSelected(id: string): void {
    for (const [tid, b] of tileButtons) {
      const on = tid === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  setSelected(deps.initialTile);

  return {
    setOpen(open: boolean): void {
      panel.hidden = !open;
      openBtn.classList.toggle('is-open', open);
      openBtn.setAttribute('aria-pressed', String(open));
      if (!open) this.setMessage(null);
    },
    setSelected,
    setCanUndo(can: boolean): void {
      undoBtn.disabled = !can;
    },
    /** Show a refusal (or other note) for a few seconds in place of the hint; null restores the hint. */
    setMessage(text: string | null): void {
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = null;
      hint.textContent = text ?? VILLAGE_PALETTE_HINT;
      hint.classList.toggle('is-refusal', !!text);
      if (text) hintTimer = setTimeout(() => this.setMessage(null), 3500);
    },
  };
}

export type VillagePalette = ReturnType<typeof createVillagePalette>;
