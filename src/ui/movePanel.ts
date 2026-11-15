/**
 * Move panel (home view): walk the character around with a D-pad or the arrow/WASD keys,
 * replay recent moves, and pick from every animation and combo (sequence), each with an emoji.
 */
import * as THREE from 'three';
import type { SequenceStep } from '../animation';
import { APP_EVENTS, publish } from '../events/appEvents';

type Sequence = { id: string; label: string; steps: SequenceStep[] };
type AnimationEntry = { key: string; label: string };

export type MovePanelDeps = {
  getRoute: () => string;
  getCamera: () => THREE.Camera | null;
  /** World position of the character's root (null before it loads). */
  getCharacterPosition: () => THREE.Vector3 | null;
  getAnimationManager: () => {
    walkTo: (target: THREE.Vector3, speed?: number) => Promise<void>;
    playSequence: (steps: SequenceStep[]) => void;
    stop: () => void;
    setLastActivity: () => void;
  } | null;
  /** Tell the idle AI the user is in control (so it stops wandering). */
  onUserControl: () => void;
};

/** How far one D-pad press walks, in world units. */
const STEP_DISTANCE = 1.6;
const COLLAPSED_KEY = 'movePanel.collapsed';

const RECENT_KEY = 'movePanel.recent';
const RECENT_MAX = 6;

/** Emoji and a short friendly name per animation key. Unknown keys fall back to a clapperboard and the manifest label. */
const MOVE_INFO: Record<string, { emoji: string; label: string }> = {
  acknowledging: { emoji: '🙂', label: 'Say Hi' },
  'arm-stretching': { emoji: '🙆', label: 'Stretch' },
  backflip: { emoji: '🤸', label: 'Backflip' },
  bashful: { emoji: '😊', label: 'Bashful' },
  'blow-akiss': { emoji: '😘', label: 'Blow a Kiss' },
  bored: { emoji: '😑', label: 'Bored' },
  clapping: { emoji: '👏', label: 'Clap' },
  crying: { emoji: '😢', label: 'Cry' },
  'dancing-twerk': { emoji: '💃', label: 'Dance' },
  excited: { emoji: '🤩', label: 'Excited' },
  'female-walk': { emoji: '🚶', label: 'Strut' },
  'happy-idle': { emoji: '😌', label: 'Happy Idle' },
  happy: { emoji: '😄', label: 'Happy' },
  'hard-head-nod': { emoji: '🤘', label: 'Head Nod' },
  idle: { emoji: '🧍', label: 'Idle' },
  jump: { emoji: '🦘', label: 'Jump' },
  laughing: { emoji: '😂', label: 'Laugh' },
  laying: { emoji: '🛌', label: 'Lie Down' },
  'look-around': { emoji: '👀', label: 'Look Around' },
  pointing: { emoji: '👉', label: 'Point' },
  'quick-informal-bow': { emoji: '🙇', label: 'Bow' },
  shrugging: { emoji: '🤷', label: 'Shrug' },
  'sit-to-stand': { emoji: '⬆️', label: 'Stand Up' },
  'sitting-clap': { emoji: '🙌', label: 'Sitting Clap' },
  'sitting-talking': { emoji: '💬', label: 'Sitting Talk' },
  'sitting-yell': { emoji: '📣', label: 'Sitting Yell' },
  'stand-to-sit': { emoji: '🪑', label: 'Sit Down' },
  'standing-thumbs-up': { emoji: '👍', label: 'Thumbs Up' },
  surprised: { emoji: '😮', label: 'Surprised' },
  texting: { emoji: '📱', label: 'Texting' },
  thinking: { emoji: '🤔', label: 'Thinking' },
  'thoughtful-head-shake': { emoji: '🙅', label: 'Head Shake' },
  waving: { emoji: '👋', label: 'Wave' },
  yawn: { emoji: '🥱', label: 'Yawn' },
};

/** Emoji per combo (sequence id). Unknown ids fall back to sparkles. */
const COMBO_EMOJI: Record<string, string> = {
  'wave-and-happy': '👋',
  'walk-in-clap-walk-back': '👏',
  'excited-then-thinking': '🤔',
  'greet-wave': '🙋',
  'wave-thumbs-up': '👍',
  'walk-forward-bow': '🙇',
  'excited-surprised': '😲',
  'thinking-nod': '💡',
  'shy-then-wave': '😊',
  'walk-closer-wave-walk-back': '🚶',
  'greet-walk-happy': '😄',
  'excited-approach-clap': '🙌',
  'happy-walk-laugh': '😂',
};

/** Movement building blocks (turns, walk phases) are not fun on their own; leave them out. */
const HIDDEN_MOVES = /^(walking|start-walking|stop-walking|start-walking-movement|stop-walking-movement|left-turn|right-turn|walking-backwards)$/;

type Tile = { id: string; emoji: string; label: string; run: (btn: HTMLElement) => void };

const ARROW_SVG = (rotateDeg: number) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="transform:rotate(${rotateDeg}deg)"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const HOME_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>';

type Dir = 'up' | 'down' | 'left' | 'right';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable: just don't remember */
  }
}

function button(className: string, html: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.innerHTML = html;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}

export function createMovePanel(deps: MovePanelDeps) {
  const root = document.createElement('aside');
  root.id = 'move-panel';
  root.className = 'move-panel';
  root.setAttribute('aria-label', 'Move the character');
  root.classList.toggle('collapsed', readCollapsed());

  // Collapsed pill / header toggle
  const toggle = button('move-panel-toggle', '<span class="move-panel-title">Move</span><span class="move-panel-chevron" aria-hidden="true">▾</span>', 'Show or hide the Move panel');
  toggle.setAttribute('aria-expanded', String(!root.classList.contains('collapsed')));
  toggle.addEventListener('click', () => {
    const collapsed = !root.classList.contains('collapsed');
    root.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    writeCollapsed(collapsed);
  });

  const body = document.createElement('div');
  body.className = 'move-panel-body';

  // --- D-pad ---
  const pad = document.createElement('div');
  pad.className = 'move-dpad';
  const dirButtons: Record<Dir, HTMLButtonElement> = {
    up: button('move-dpad-btn move-dpad-up', ARROW_SVG(0), 'Walk away (↑ / W)'),
    left: button('move-dpad-btn move-dpad-left', ARROW_SVG(-90), 'Walk left (← / A)'),
    right: button('move-dpad-btn move-dpad-right', ARROW_SVG(90), 'Walk right (→ / D)'),
    down: button('move-dpad-btn move-dpad-down', ARROW_SVG(180), 'Walk toward you (↓ / S)'),
  };
  const homeBtn = button('move-dpad-btn move-dpad-home', HOME_SVG, 'Back to the middle');
  (Object.keys(dirButtons) as Dir[]).forEach((d) => {
    dirButtons[d].addEventListener('click', () => walk(d));
    pad.appendChild(dirButtons[d]);
  });
  homeBtn.addEventListener('click', () => walkHome());
  pad.appendChild(homeBtn);
  const padHint = document.createElement('p');
  padHint.className = 'move-hint';
  padHint.textContent = 'Arrow keys or WASD work too';

  // --- Recent: last moves played, newest first, tap to play again ---
  const recentTitle = document.createElement('h3');
  recentTitle.className = 'move-section-title';
  recentTitle.textContent = 'Recent';
  const recentGrid = document.createElement('div');
  recentGrid.className = 'move-grid';
  const recentEmpty = document.createElement('p');
  recentEmpty.className = 'move-hint move-recent-empty';
  recentEmpty.textContent = 'Moves you play show up here';

  // --- All moves / Combos drawers (alphabetical) ---
  const drawer = (title: string, open: boolean) => {
    const d = document.createElement('details');
    d.className = 'move-more';
    d.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'move-grid';
    d.append(summary, grid);
    return { d, grid };
  };
  const allMoves = drawer('All moves', true);
  const combos = drawer('Combos', false);

  body.append(pad, padHint, recentTitle, recentGrid, recentEmpty, allMoves.d, combos.d);
  root.append(toggle, body);
  // Same layer as the other floating panels (Design button etc.).
  (document.getElementById('app-lower-left-panels')?.parentElement ?? document.body).appendChild(root);

  // --- Actions ---
  function takeControl() {
    deps.onUserControl();
    const mgr = deps.getAnimationManager();
    mgr?.stop();
    mgr?.setLastActivity();
    return mgr;
  }

  function walk(dir: Dir) {
    if (deps.getRoute() !== 'viewer') return;
    const camera = deps.getCamera();
    const from = deps.getCharacterPosition();
    if (!camera || !from) return;
    // Screen-relative: "up" walks away from the camera, "right" walks screen-right.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const step =
      dir === 'up' ? forward : dir === 'down' ? forward.clone().negate() : dir === 'right' ? right : right.clone().negate();
    const target = from.clone().addScaledVector(step, STEP_DISTANCE);
    target.y = 0;
    flash(dirButtons[dir]);
    void takeControl()?.walkTo(target, 1);
  }

  function walkHome() {
    if (deps.getRoute() !== 'viewer') return;
    flash(homeBtn);
    void takeControl()?.walkTo(new THREE.Vector3(0, 0, 0), 1);
  }

  function play(key: string, btn?: HTMLElement) {
    if (deps.getRoute() !== 'viewer') return;
    if (btn) flash(btn);
    // Claim control first so the idle AI doesn't treat this as "user came back" and walk over.
    // The animation-play handler then stops any movement and plays the clip.
    deps.onUserControl();
    publish(APP_EVENTS['app:character:animation-play'], { name: key });
  }

  function playCombo(seq: Sequence, btn: HTMLElement) {
    if (deps.getRoute() !== 'viewer') return;
    flash(btn);
    takeControl()?.playSequence(seq.steps);
  }

  function flash(el: HTMLElement) {
    el.classList.remove('pressed');
    void el.offsetWidth; // restart the animation
    el.classList.add('pressed');
    window.setTimeout(() => el.classList.remove('pressed'), 450);
  }

  // Keyboard: arrows / WASD on the home view, unless typing or a dialog is open.
  const KEY_DIRS: Record<string, Dir> = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = KEY_DIRS[e.code];
    if (!dir || deps.getRoute() !== 'viewer') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('.about-overlay:not([hidden])')) return;
    e.preventDefault();
    walk(dir);
  });

  // --- Tiles and recents ---
  const tiles = new Map<string, Tile>();

  function tileButton(t: Tile): HTMLButtonElement {
    const b = button(
      'move-tile',
      `<span class="move-tile-icon" aria-hidden="true">${t.emoji}</span><span class="move-tile-label">${t.label}</span>`,
      t.label
    );
    b.dataset.move = t.id;
    b.addEventListener('click', () => {
      t.run(b);
      pushRecent(t.id);
    });
    return b;
  }

  function readRecent(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  let recent = readRecent();

  function pushRecent(id: string) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      /* storage unavailable: recents last for this visit only */
    }
    renderRecent();
  }

  function renderRecent() {
    const shown = recent.map((id) => tiles.get(id)).filter((t): t is Tile => !!t);
    recentGrid.replaceChildren(...shown.map(tileButton));
    recentEmpty.hidden = shown.length > 0;
    recentGrid.hidden = shown.length === 0;
  }

  /** Build the tiles once animations and sequences are known. */
  function setMoves(animations: AnimationEntry[], sequences: Sequence[]) {
    tiles.clear();
    const byLabel = (a: Tile, b: Tile) => a.label.localeCompare(b.label);

    const moveTiles: Tile[] = animations
      .filter((a) => !HIDDEN_MOVES.test(a.key))
      .map((a) => ({
        id: `move:${a.key}`,
        emoji: MOVE_INFO[a.key]?.emoji ?? '🎬',
        label: MOVE_INFO[a.key]?.label ?? a.label.replace(/([a-z])([A-Z])/g, '$1 $2'),
        run: (btn: HTMLElement) => play(a.key, btn),
      }))
      .sort(byLabel);

    const comboTiles: Tile[] = sequences
      .map((sq) => ({
        id: `combo:${sq.id}`,
        emoji: COMBO_EMOJI[sq.id] ?? '✨',
        label: sq.label,
        run: (btn: HTMLElement) => playCombo(sq, btn),
      }))
      .sort(byLabel);

    for (const t of [...moveTiles, ...comboTiles]) tiles.set(t.id, t);

    allMoves.grid.replaceChildren(...moveTiles.map(tileButton));
    combos.grid.replaceChildren(...comboTiles.map(tileButton));
    combos.d.hidden = comboTiles.length === 0;
    renderRecent();
  }

  return { setMoves };
}
