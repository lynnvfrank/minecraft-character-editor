/**
 * Home-view "Hold" panel: pick something for the selected character to carry in its right hand.
 * It sits in the Move panels' column (same look, same show-while-selected rule) and stores the
 * choice for the character's skin, so that resident keeps it from then on. The 3D side is
 * controllers/heldItemsController.ts.
 */
import { HELD_ITEMS } from '../domain/heldItems';

export type HoldPanelDeps = {
  /** Holder key of the selected character, or null if its look can't be remembered (an unsaved design). */
  getSelectedKey: () => string | null;
  store: {
    get: (key: string | null | undefined) => string | null;
    set: (key: string, itemId: string | null) => void;
    subscribe: (listener: () => void) => () => void;
  };
};

const COLLAPSED_KEY = 'holdPanel.collapsed';

function readCollapsed(): boolean {
  try {
    // Starts folded so the column stays short; remembered once the user opens it.
    return localStorage.getItem(COLLAPSED_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export function createHoldPanel(deps: HoldPanelDeps) {
  const root = document.createElement('aside');
  root.id = 'hold-panel';
  root.className = 'move-panel hold-panel';
  root.setAttribute('aria-label', 'Something to hold');
  root.classList.toggle('collapsed', readCollapsed());

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'move-panel-toggle';
  toggle.innerHTML =
    '<span class="move-panel-title">Hold</span><span class="move-panel-chevron" aria-hidden="true">▾</span>';
  toggle.title = 'Show or hide Hold';
  toggle.setAttribute('aria-expanded', String(!root.classList.contains('collapsed')));
  toggle.addEventListener('click', (e) => {
    if (e.detail > 0) toggle.blur();
    const collapsed = !root.classList.contains('collapsed');
    root.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    writeCollapsed(collapsed);
    if (!collapsed) refresh();
  });

  const body = document.createElement('div');
  body.className = 'move-panel-body';
  const grid = document.createElement('div');
  grid.className = 'move-grid';
  const hint = document.createElement('p');
  hint.className = 'move-hint';
  hint.textContent = 'Save this look as an outfit to give it something to hold';
  body.append(grid, hint);
  root.append(toggle, body);

  const options = [{ id: null as string | null, emoji: '✋', label: 'Nothing' }, ...HELD_ITEMS];
  const buttons = options.map((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'move-tile hold-tile';
    b.title = opt.label;
    b.setAttribute('aria-label', opt.label);
    const icon = document.createElement('span');
    icon.className = 'move-tile-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = opt.emoji;
    const label = document.createElement('span');
    label.className = 'move-tile-label';
    label.textContent = opt.label;
    b.append(icon, label);
    b.addEventListener('click', (e) => {
      if (e.detail > 0) b.blur();
      const key = deps.getSelectedKey();
      if (key == null) return;
      deps.store.set(key, opt.id);
      b.classList.remove('pressed');
      void b.offsetWidth;
      b.classList.add('pressed');
      window.setTimeout(() => b.classList.remove('pressed'), 450);
    });
    grid.appendChild(b);
    return { b, id: opt.id };
  });

  /** Mark what the selected character holds; call when the selection changes. */
  function refresh(): void {
    const key = deps.getSelectedKey();
    const current = deps.store.get(key);
    hint.hidden = key != null;
    for (const { b, id } of buttons) {
      const on = key != null && id === current;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = key == null;
    }
  }

  // Third in the Move panels' column (created by ui/movePanel.ts), else on its own.
  (document.querySelector('.move-panels') ?? document.body).appendChild(root);
  deps.store.subscribe(refresh);
  refresh();

  return { refresh };
}
