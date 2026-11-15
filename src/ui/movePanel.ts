/**
 * Move panel (home view): walk the character around with a D-pad or the arrow/WASD keys,
 * and trigger tricks (backflip, dance, wave...) plus every other animation and sequence.
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

const TRICKS: { key: string; label: string; icon: string }[] = [
  { key: 'backflip', label: 'Flip', icon: '🤸' },
  { key: 'jump', label: 'Jump', icon: '🦘' },
  { key: 'dancing-twerk', label: 'Dance', icon: '💃' },
  { key: 'waving', label: 'Wave', icon: '👋' },
  { key: 'clapping', label: 'Clap', icon: '👏' },
  { key: 'blow-akiss', label: 'Kiss', icon: '😘' },
  { key: 'laughing', label: 'Laugh', icon: '😂' },
  { key: 'standing-thumbs-up', label: 'Yay!', icon: '👍' },
];

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

  // --- Tricks ---
  const tricksLabel = document.createElement('h3');
  tricksLabel.className = 'move-section-title';
  tricksLabel.textContent = 'Tricks';
  const tricks = document.createElement('div');
  tricks.className = 'move-tricks';

  // --- All moves drawer ---
  const more = document.createElement('details');
  more.className = 'move-more';
  const moreSummary = document.createElement('summary');
  moreSummary.textContent = 'All moves';
  const moreList = document.createElement('div');
  moreList.className = 'move-chip-list';
  const combosTitle = document.createElement('h3');
  combosTitle.className = 'move-section-title';
  combosTitle.textContent = 'Combos';
  const combosList = document.createElement('div');
  combosList.className = 'move-chip-list';
  more.append(moreSummary, moreList, combosTitle, combosList);

  body.append(pad, padHint, tricksLabel, tricks, more);
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

  /** Fill tricks and the All moves drawer once animations and sequences are known. */
  function setMoves(animations: AnimationEntry[], sequences: Sequence[]) {
    const available = new Set(animations.map((a) => a.key));
    tricks.innerHTML = '';
    for (const t of TRICKS) {
      if (!available.has(t.key)) continue;
      const b = button('move-trick', `<span class="move-trick-icon" aria-hidden="true">${t.icon}</span><span class="move-trick-label">${t.label}</span>`, t.label);
      b.addEventListener('click', () => play(t.key, b));
      tricks.appendChild(b);
    }

    // Movement building blocks (turns, walk phases) aren't fun on their own; leave them out.
    const hidden = /^(walking|start-walking|stop-walking|start-walking-movement|stop-walking-movement|left-turn|right-turn|walking-backwards)$/;
    moreList.innerHTML = '';
    for (const a of animations) {
      if (hidden.test(a.key)) continue;
      const b = button('move-chip', a.label.replace(/([a-z])([A-Z])/g, '$1 $2'), a.label);
      b.addEventListener('click', () => play(a.key, b));
      moreList.appendChild(b);
    }

    combosList.innerHTML = '';
    for (const s of sequences) {
      const b = button('move-chip move-chip-combo', s.label, s.label);
      b.addEventListener('click', () => playCombo(s, b));
      combosList.appendChild(b);
    }
    combosTitle.hidden = sequences.length === 0;
  }

  return { setMoves };
}
