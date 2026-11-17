/**
 * Dance studio panel (`#/studio`): an A↔B crossfade at the top, then every clip with
 * play/stop, a weight slider and a speed slider. "Save as sequence" snapshots the mix into the
 * saved-sequence store, which the Move panel lists under "My combos".
 *
 * Created once at startup (like the Move panel) and shown only on the studio route via CSS, so
 * its listeners don't stack up on re-entry.
 */
import type { StudioCrossfade, StudioLayer, StudioMix } from '../animation/studioMix';
import type { BlendStep, SavedSequence, SavedSequenceStep } from '../domain/sequences';
import { describeBlend } from '../animation/studioMix';
import { MOVEMENT_CLIPS, moveEmoji, moveLabel } from './moveInfo';

type AnimationEntry = { key: string; label: string };

/** What the panel needs from the studio controller (described by shape: ui can't import controllers). */
export type StudioPanelApi = {
  getSnapshot: () => {
    mix: StudioMix;
    applied: Map<string, { weight: number; timeScale: number }>;
    sweeping: boolean;
    sweepPeriodSec: number;
  };
  subscribe: (listener: () => void) => () => void;
  setLayer: (key: string, patch: Partial<StudioLayer>) => void;
  setCrossfade: (patch: Partial<StudioCrossfade>) => void;
  setNormalize: (on: boolean) => void;
  setSweeping: (on: boolean, periodSec?: number) => void;
  reset: () => void;
  toBlendStep: (durationSec: number) => BlendStep | null;
};

export type StudioPanelDeps = {
  studio: StudioPanelApi;
  savedSequences: {
    list: () => readonly SavedSequence[];
    add: (label: string, steps: SavedSequenceStep[]) => SavedSequence;
    remove: (id: string) => void;
    subscribe: (listener: () => void) => () => void;
  };
  /** Leave the studio (back to the home view). */
  onExit: () => void;
};

const pct = (w: number) => `${Math.round(w * 100)}%`;
const speed = (s: number) => `${s.toFixed(2).replace(/0$/, '')}×`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function range(min: number, max: number, step: number, label: string): HTMLInputElement {
  const r = el('input', 'studio-range');
  r.type = 'range';
  r.min = String(min);
  r.max = String(max);
  r.step = String(step);
  r.setAttribute('aria-label', label);
  return r;
}

/** Don't overwrite a control the user is dragging or typing in. */
function setIfIdle(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (document.activeElement === input && input instanceof HTMLInputElement && input.type !== 'checkbox') return;
  if (input.value !== value) input.value = value;
}

export function createStudioPanel(deps: StudioPanelDeps) {
  const { studio } = deps;
  const root = el('aside', 'studio-panel');
  root.id = 'studio-panel';
  root.setAttribute('aria-label', 'Dance studio');
  (document.getElementById('app-lower-left-panels')?.parentElement ?? document.body).appendChild(root);

  // --- Header ---
  const header = el('div', 'studio-header');
  const title = el('h2', 'studio-title', 'Dance studio');
  const exitBtn = el('button', 'studio-btn', 'Home');
  exitBtn.type = 'button';
  exitBtn.id = 'studio-exit-btn';
  exitBtn.addEventListener('click', () => deps.onExit());
  header.append(title, exitBtn);

  // --- A↔B crossfade ---
  const xf = el('section', 'studio-section studio-crossfade');
  xf.append(el('h3', 'studio-section-title', 'Crossfade A ↔ B'));
  const pickRow = el('div', 'studio-xf-picks');
  const selA = el('select', 'studio-select');
  selA.id = 'studio-xf-a';
  selA.setAttribute('aria-label', 'Clip A');
  const selB = el('select', 'studio-select');
  selB.id = 'studio-xf-b';
  selB.setAttribute('aria-label', 'Clip B');
  pickRow.append(el('span', 'studio-xf-tag', 'A'), selA, el('span', 'studio-xf-tag', 'B'), selB);
  const xfRow = el('div', 'studio-xf-row');
  const xfA = el('span', 'studio-value', '100%');
  const xfSlider = range(0, 1, 0.001, 'Crossfade from A to B');
  xfSlider.id = 'studio-xf-t';
  xfSlider.classList.add('studio-range--wide');
  const xfB = el('span', 'studio-value', '0%');
  xfRow.append(xfA, xfSlider, xfB);
  const xfOpts = el('div', 'studio-xf-opts');
  const curveSel = el('select', 'studio-select studio-select--small');
  curveSel.setAttribute('aria-label', 'Crossfade curve');
  curveSel.append(new Option('Equal power', 'equal-power'), new Option('Linear', 'linear'));
  const sweepBtn = el('button', 'studio-btn', 'Auto ⇄');
  sweepBtn.type = 'button';
  sweepBtn.title = 'Sweep back and forth between A and B';
  sweepBtn.setAttribute('aria-pressed', 'false');
  const swapBtn = el('button', 'studio-btn', 'Swap');
  swapBtn.type = 'button';
  swapBtn.title = 'Swap A and B';
  xfOpts.append(curveSel, sweepBtn, swapBtn);
  xf.append(pickRow, xfRow, xfOpts);

  selA.addEventListener('change', () => studio.setCrossfade({ a: selA.value || null }));
  selB.addEventListener('change', () => studio.setCrossfade({ b: selB.value || null }));
  xfSlider.addEventListener('input', () => studio.setCrossfade({ t: Number(xfSlider.value) }));
  curveSel.addEventListener('change', () =>
    studio.setCrossfade({ curve: curveSel.value === 'linear' ? 'linear' : 'equal-power' })
  );
  sweepBtn.addEventListener('click', () => studio.setSweeping(!studio.getSnapshot().sweeping));
  swapBtn.addEventListener('click', () => {
    const { a, b, t } = studio.getSnapshot().mix.crossfade;
    studio.setCrossfade({ a: b, b: a, t: 1 - t });
  });

  // --- Mix options + save ---
  const opts = el('section', 'studio-section studio-options');
  const normLabel = el('label', 'studio-check');
  const normBox = el('input');
  normBox.type = 'checkbox';
  normBox.id = 'studio-normalize';
  normLabel.append(normBox, document.createTextNode(' Normalize weights'));
  normLabel.title = 'Scale weights to add up to 100%. Off: anything under 100% blends toward the rest pose.';
  normBox.addEventListener('change', () => studio.setNormalize(normBox.checked));
  const resetBtn = el('button', 'studio-btn', 'Stop all');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => studio.reset());
  const optRow = el('div', 'studio-row');
  optRow.append(normLabel, resetBtn);

  const saveRow = el('div', 'studio-row studio-save');
  const nameInput = el('input', 'studio-input');
  nameInput.type = 'text';
  nameInput.id = 'studio-save-name';
  nameInput.placeholder = 'Name (optional)';
  nameInput.maxLength = 40;
  nameInput.setAttribute('aria-label', 'Sequence name');
  const durInput = el('input', 'studio-input studio-input--num');
  durInput.type = 'number';
  durInput.id = 'studio-save-duration';
  durInput.min = '0.5';
  durInput.max = '60';
  durInput.step = '0.5';
  durInput.value = '4';
  durInput.title = 'How long the combo plays (seconds)';
  durInput.setAttribute('aria-label', 'Duration in seconds');
  const saveBtn = el('button', 'studio-btn studio-btn--primary', 'Save as sequence');
  saveBtn.type = 'button';
  saveBtn.id = 'studio-save-btn';
  const saveMsg = el('p', 'studio-hint');
  saveMsg.setAttribute('role', 'status');
  saveRow.append(nameInput, durInput, el('span', 'studio-unit', 's'));
  opts.append(optRow, saveRow, saveBtn, saveMsg);

  const labels = new Map<string, string>();
  const labelFor = (key: string) => labels.get(key) ?? moveLabel(key);
  saveBtn.addEventListener('click', () => {
    const step = studio.toBlendStep(Number(durInput.value) || 4);
    if (!step) {
      saveMsg.textContent = 'Play a clip or pick A/B first.';
      return;
    }
    const seq = deps.savedSequences.add(nameInput.value.trim() || describeBlend(step, labelFor), [step]);
    nameInput.value = '';
    saveMsg.textContent = `Saved “${seq.label}”. Play it from Home → All moves → My combos.`;
  });

  // --- Saved list ---
  const savedSection = el('section', 'studio-section');
  const savedTitle = el('h3', 'studio-section-title', 'Saved sequences');
  const savedList = el('ul', 'studio-saved');
  savedList.id = 'studio-saved-list';
  savedSection.append(savedTitle, savedList);
  function renderSaved() {
    const items = deps.savedSequences.list();
    savedSection.hidden = items.length === 0;
    savedList.replaceChildren(
      ...items.map((sq) => {
        const li = el('li', 'studio-saved-item');
        const name = el('span', 'studio-saved-name', sq.label);
        name.title = sq.steps
          .map((s) => (s.type === 'blend' ? describeBlend(s, labelFor) : s.type === 'animation' ? labelFor(s.name) : 'pause'))
          .join(' → ');
        const del = el('button', 'studio-btn studio-btn--icon', '✕');
        del.type = 'button';
        del.title = `Delete “${sq.label}”`;
        del.setAttribute('aria-label', `Delete ${sq.label}`);
        del.addEventListener('click', () => deps.savedSequences.remove(sq.id));
        li.append(name, del);
        return li;
      })
    );
  }

  // --- Clip list ---
  const clipsSection = el('section', 'studio-section studio-clips-section');
  const clipsHead = el('div', 'studio-row');
  const filter = el('input', 'studio-input');
  filter.type = 'search';
  filter.placeholder = 'Filter clips';
  filter.setAttribute('aria-label', 'Filter clips');
  const showAll = el('label', 'studio-check');
  const showAllBox = el('input');
  showAllBox.type = 'checkbox';
  showAll.append(showAllBox, document.createTextNode(' Walk/turn'));
  showAll.title = 'Also list walk and turn building blocks';
  clipsHead.append(filter, showAll);
  const clipList = el('ul', 'studio-clips');
  clipList.id = 'studio-clip-list';
  clipsSection.append(el('h3', 'studio-section-title', 'Clips'), clipsHead, clipList);

  type Row = {
    key: string;
    li: HTMLLIElement;
    play: HTMLButtonElement;
    weight: HTMLInputElement;
    weightVal: HTMLSpanElement;
    ts: HTMLInputElement;
    tsVal: HTMLSpanElement;
    meter: HTMLSpanElement;
  };
  const rows = new Map<string, Row>();

  function buildRow(a: AnimationEntry): Row {
    const li = el('li', 'studio-clip');
    li.dataset.clip = a.key;
    const top = el('div', 'studio-clip-top');
    const play = el('button', 'studio-btn studio-btn--icon studio-play');
    play.type = 'button';
    play.setAttribute('aria-label', `Play ${labelFor(a.key)}`);
    const name = el('span', 'studio-clip-name', `${moveEmoji(a.key)} ${labelFor(a.key)}`);
    name.title = a.key;
    const meter = el('span', 'studio-meter');
    meter.title = 'Weight being applied';
    top.append(play, name, meter);

    const wRow = el('div', 'studio-clip-slider');
    const weight = range(0, 1, 0.01, `${labelFor(a.key)} weight`);
    const weightVal = el('span', 'studio-value');
    wRow.append(el('span', 'studio-slider-label', 'Weight'), weight, weightVal);
    const tRow = el('div', 'studio-clip-slider');
    const ts = range(0, 2, 0.05, `${labelFor(a.key)} speed`);
    const tsVal = el('span', 'studio-value');
    tRow.append(el('span', 'studio-slider-label', 'Speed'), ts, tsVal);
    li.append(top, wRow, tRow);

    play.addEventListener('click', () => {
      const layer = studio.getSnapshot().mix.layers[a.key];
      studio.setLayer(a.key, { playing: !layer?.playing });
    });
    weight.addEventListener('input', () => studio.setLayer(a.key, { weight: Number(weight.value) }));
    ts.addEventListener('input', () => studio.setLayer(a.key, { timeScale: Number(ts.value) }));
    // Double-click a speed slider to reset it to 1×.
    ts.addEventListener('dblclick', () => studio.setLayer(a.key, { timeScale: 1 }));
    return { key: a.key, li, play, weight, weightVal, ts, tsVal, meter };
  }

  function applyFilter() {
    const q = filter.value.trim().toLowerCase();
    for (const r of rows.values()) {
      const movement = MOVEMENT_CLIPS.test(r.key);
      const match = !q || r.key.includes(q) || labelFor(r.key).toLowerCase().includes(q);
      r.li.hidden = !match || (movement && !showAllBox.checked);
    }
  }
  filter.addEventListener('input', applyFilter);
  showAllBox.addEventListener('change', applyFilter);

  root.append(header, xf, opts, savedSection, clipsSection);

  // --- Sync from state ---
  function render() {
    const { mix, applied, sweeping } = studio.getSnapshot();
    const { a, b, t, curve } = mix.crossfade;
    setIfIdle(selA, a ?? '');
    setIfIdle(selB, b ?? '');
    setIfIdle(xfSlider, String(t));
    xfA.textContent = a ? pct(1 - t) : '—';
    xfB.textContent = b ? pct(t) : '—';
    setIfIdle(curveSel, curve);
    sweepBtn.setAttribute('aria-pressed', String(sweeping));
    sweepBtn.classList.toggle('active', sweeping);
    sweepBtn.disabled = !a || !b || a === b;
    normBox.checked = mix.normalize;

    for (const r of rows.values()) {
      const layer = mix.layers[r.key];
      const playing = !!layer?.playing;
      r.play.textContent = playing ? '■' : '▶';
      r.play.setAttribute('aria-pressed', String(playing));
      r.play.setAttribute('aria-label', `${playing ? 'Stop' : 'Play'} ${labelFor(r.key)}`);
      r.li.classList.toggle('playing', playing);
      setIfIdle(r.weight, String(layer?.weight ?? 1));
      r.weightVal.textContent = pct(layer?.weight ?? 1);
      setIfIdle(r.ts, String(layer?.timeScale ?? 1));
      r.tsVal.textContent = speed(layer?.timeScale ?? 1);
      const w = applied.get(r.key)?.weight ?? 0;
      r.meter.textContent = w > 0 ? pct(w) : '';
      r.meter.style.setProperty('--w', String(Math.min(1, w)));
      r.li.classList.toggle('audible', w > 0);
      r.li.classList.toggle('in-crossfade', r.key === a || r.key === b);
    }
  }
  studio.subscribe(render);
  deps.savedSequences.subscribe(renderSaved);

  /** Build the clip rows and A/B options once the animation list is known. */
  function setAnimations(animations: AnimationEntry[]) {
    for (const a of animations) labels.set(a.key, moveLabel(a.key, a.label));
    const sorted = [...animations].sort((x, y) => labelFor(x.key).localeCompare(labelFor(y.key)));
    rows.clear();
    clipList.replaceChildren(
      ...sorted.map((a) => {
        const r = buildRow(a);
        rows.set(a.key, r);
        return r.li;
      })
    );
    for (const sel of [selA, selB]) {
      sel.replaceChildren(new Option('— none —', ''), ...sorted.map((a) => new Option(labelFor(a.key), a.key)));
    }
    applyFilter();
    render();
    renderSaved();
  }

  renderSaved();
  render();
  return { setAnimations };
}
