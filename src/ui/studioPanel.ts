/**
 * Dance studio panel (`#/studio`). Sections read top-down in the order you work: Clips (every clip
 * with play/stop, a weight slider and a speed slider; takes the height that is left and scrolls),
 * the A↔B crossfade, the Routine, and the saved combos. The Routine section collects mixes as
 * steps (add, reorder, set lengths, preview) and saves them as one sequence in the saved-sequence
 * store, which the Move panel lists under "My combos". With no steps, Save stores the current
 * mix as a one-step combo. Routine rules live in `animation/studioRoutine.ts`.
 *
 * Every section is a collapsible one from collapsibleSection.ts; the stage sections (Dancers,
 * Backdrop, Camera moves, Camera) come from their own modules and mount themselves below these.
 *
 * Created once at startup (like the Move panel) and shown only on the studio route via CSS, so
 * its listeners don't stack up on re-entry.
 */
import type { StudioCrossfade, StudioLayer, StudioMix } from '../animation/studioMix';
import type { BlendStep, SavedSequence, SavedSequenceStep } from '../domain/sequences';
import { describeBlend } from '../animation/studioMix';
import {
  addPause,
  addStep,
  blendStepToMix,
  clampStepDuration,
  DEFAULT_STEP_SEC,
  describeRoutineLength,
  formatSeconds,
  hasBlend,
  MAX_STEP_SEC,
  MIN_STEP_SEC,
  moveStep,
  removeStep,
  selectionAfterMove,
  selectionAfterRemove,
  setStepDuration,
  toSavedSteps,
  updateStep,
  type RoutineStep,
} from '../animation/studioRoutine';
import { MOVEMENT_CLIPS, moveEmoji, moveLabel } from './moveInfo';
import { createCollapsibleSection, mountStudioSection } from './collapsibleSection';

type AnimationEntry = { key: string; label: string };

/** What the panel needs from the studio controller (described by shape: ui can't import controllers). */
export type StudioPanelApi = {
  getSnapshot: () => {
    mix: StudioMix;
    applied: Map<string, { weight: number; timeScale: number }>;
    sweeping: boolean;
    sweepPeriodSec: number;
    routineIndex: number | null;
  };
  subscribe: (listener: () => void) => () => void;
  setLayer: (key: string, patch: Partial<StudioLayer>) => void;
  setCrossfade: (patch: Partial<StudioCrossfade>) => void;
  setNormalize: (on: boolean) => void;
  setSweeping: (on: boolean, periodSec?: number) => void;
  reset: () => void;
  toBlendStep: (durationSec: number) => BlendStep | null;
  setMix: (mix: StudioMix) => void;
  playRoutine: (steps: readonly RoutineStep[]) => boolean;
  stopRoutine: () => void;
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

  const labels = new Map<string, string>();
  const labelFor = (key: string) => labels.get(key) ?? moveLabel(key);

  // --- A↔B crossfade ---
  const xfSection = createCollapsibleSection({
    id: 'crossfade',
    title: 'Crossfade A ↔ B',
    className: 'studio-crossfade',
    summary: () => {
      const { a, b, t } = studio.getSnapshot().mix.crossfade;
      if (!a && !b) return 'Off';
      return `${a ? labelFor(a) : '—'} ↔ ${b ? labelFor(b) : '—'} · ${pct(t)}`;
    },
  });
  const xf = xfSection.body;
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

  // --- Mix options (shown in the Clips section, above the list) ---
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
  const optRow = el('div', 'studio-row studio-options');
  optRow.append(normLabel, resetBtn);

  // --- Routine: a list of mixes played one after another ---
  let draft: readonly RoutineStep[] = [];
  /** Step whose mix is loaded in the sliders ("Update step" writes back to it). */
  let selected: number | null = null;

  function numInput(value: number, label: string): HTMLInputElement {
    const n = el('input', 'studio-input studio-input--num');
    n.type = 'number';
    n.min = String(MIN_STEP_SEC);
    n.max = String(MAX_STEP_SEC);
    n.step = '0.25';
    n.value = String(value);
    n.title = label;
    n.setAttribute('aria-label', label);
    return n;
  }
  function iconBtn(text: string, label: string): HTMLButtonElement {
    const b = el('button', 'studio-btn studio-btn--icon', text);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }

  const routineSection = createCollapsibleSection({
    id: 'routine',
    title: 'Routine',
    className: 'studio-routine',
    summary: () => (draft.length === 0 ? 'No steps yet' : describeRoutineLength(draft)),
  });
  const routine = routineSection.body;
  const addRow = el('div', 'studio-row');
  const durInput = numInput(DEFAULT_STEP_SEC, 'Step length (seconds)');
  durInput.id = 'studio-step-duration';
  const addBtn = el('button', 'studio-btn', 'Add step');
  addBtn.type = 'button';
  addBtn.id = 'studio-add-step-btn';
  addBtn.title = 'Add the current mix as a step';
  const pauseBtn = el('button', 'studio-btn', 'Add pause');
  pauseBtn.type = 'button';
  pauseBtn.id = 'studio-add-pause-btn';
  pauseBtn.title = 'Hold the last step a little longer';
  const updateBtn = el('button', 'studio-btn', 'Update step');
  updateBtn.type = 'button';
  updateBtn.id = 'studio-update-step-btn';
  updateBtn.hidden = true;
  addRow.append(durInput, el('span', 'studio-unit', 's'), addBtn, pauseBtn, updateBtn);

  const stepList = el('ol', 'studio-steps');
  stepList.id = 'studio-step-list';

  const playRow = el('div', 'studio-row studio-routine-foot');
  const totalLabel = el('span', 'studio-routine-total');
  const clearBtn = el('button', 'studio-btn', 'Clear');
  clearBtn.type = 'button';
  const playBtn = el('button', 'studio-btn', '▶ Play routine');
  playBtn.type = 'button';
  playBtn.id = 'studio-play-routine-btn';
  playRow.append(totalLabel, clearBtn, playBtn);

  const saveRow = el('div', 'studio-row studio-save');
  const nameInput = el('input', 'studio-input');
  nameInput.type = 'text';
  nameInput.id = 'studio-save-name';
  nameInput.placeholder = 'Name (optional)';
  nameInput.maxLength = 40;
  nameInput.setAttribute('aria-label', 'Combo name');
  const saveBtn = el('button', 'studio-btn studio-btn--save', 'Save combo');
  saveBtn.type = 'button';
  saveBtn.id = 'studio-save-btn';
  saveRow.append(nameInput, saveBtn);
  const saveMsg = el('p', 'studio-hint');
  saveMsg.setAttribute('role', 'status');
  routine.append(addRow, stepList, playRow, saveRow, saveMsg);

  const stepText = (s: RoutineStep) => (s.type === 'blend' ? describeBlend(s, labelFor) : 'Pause');
  const stepLength = () => clampStepDuration(Number(durInput.value || NaN));
  const say = (text: string) => {
    saveMsg.textContent = text;
  };
  const NOTHING_PLAYING = 'Play a clip or pick A/B first.';

  /** Every change to the draft goes through here: it ends a running preview and redraws. */
  function setDraft(next: readonly RoutineStep[], nextSelected: number | null) {
    if (next !== draft) studio.stopRoutine();
    draft = next;
    selected = nextSelected != null && nextSelected < draft.length ? nextSelected : null;
    renderRoutine();
  }

  function renderRoutine() {
    stepList.replaceChildren(
      ...draft.map((s, i) => {
        const li = el('li', 'studio-step');
        li.classList.toggle('selected', i === selected);
        const pick = el('button', 'studio-step-name', `${i + 1}. ${stepText(s)}`);
        pick.type = 'button';
        pick.title = s.type === 'blend' ? 'Load this step into the sliders' : 'Pause';
        pick.setAttribute('aria-pressed', String(i === selected));
        pick.addEventListener('click', () => {
          if (s.type === 'blend') studio.setMix(blendStepToMix(s));
          else studio.stopRoutine();
          setDraft(draft, i);
          say(s.type === 'blend' ? `Step ${i + 1} is in the sliders. Tweak it, then Update step.` : '');
        });
        const dur = numInput(s.duration, `Step ${i + 1} length (seconds)`);
        dur.addEventListener('change', () => setDraft(setStepDuration(draft, i, Number(dur.value || NaN)), selected));
        const up = iconBtn('↑', `Move step ${i + 1} up`);
        up.disabled = i === 0;
        up.addEventListener('click', () =>
          setDraft(moveStep(draft, i, -1), selectionAfterMove(selected, i, -1, draft.length))
        );
        const down = iconBtn('↓', `Move step ${i + 1} down`);
        down.disabled = i === draft.length - 1;
        down.addEventListener('click', () =>
          setDraft(moveStep(draft, i, 1), selectionAfterMove(selected, i, 1, draft.length))
        );
        const del = iconBtn('✕', `Remove step ${i + 1}`);
        del.addEventListener('click', () => setDraft(removeStep(draft, i), selectionAfterRemove(selected, i)));
        li.append(pick, dur, up, down, del);
        return li;
      })
    );
    const empty = draft.length === 0;
    stepList.hidden = empty;
    playRow.hidden = empty;
    pauseBtn.disabled = empty;
    totalLabel.textContent = describeRoutineLength(draft);
    updateBtn.hidden = selected == null;
    updateBtn.textContent = selected == null ? 'Update step' : `Update step ${selected + 1}`;
    saveBtn.textContent = empty ? 'Save combo' : 'Save routine';
    saveBtn.title = empty ? 'Save the current mix as a combo' : 'Save every step as one combo';
    routineSection.refresh();
    renderPreview();
  }

  /** Runs on every studio notification (each frame while previewing), so it only flips classes. */
  function renderPreview() {
    const index = studio.getSnapshot().routineIndex;
    const playing = index != null;
    playBtn.textContent = playing ? '■ Stop' : '▶ Play routine';
    playBtn.setAttribute('aria-pressed', String(playing));
    for (let i = 0; i < stepList.children.length; i++) {
      stepList.children[i]!.classList.toggle('active', i === index);
    }
  }

  addBtn.addEventListener('click', () => {
    const step = studio.toBlendStep(stepLength());
    if (!step) return say(NOTHING_PLAYING);
    setDraft(addStep(draft, step, stepLength()), selected);
    say('');
  });
  pauseBtn.addEventListener('click', () => {
    setDraft(addPause(draft, stepLength()), selected);
    say('');
  });
  updateBtn.addEventListener('click', () => {
    if (selected == null) return;
    const step = studio.toBlendStep(DEFAULT_STEP_SEC);
    if (!step) return say(NOTHING_PLAYING);
    const n = selected + 1;
    setDraft(updateStep(draft, selected, step), selected);
    say(`Step ${n} updated.`);
  });
  durInput.addEventListener('change', () => {
    durInput.value = String(stepLength());
  });
  clearBtn.addEventListener('click', () => {
    setDraft([], null);
    say('');
  });
  playBtn.addEventListener('click', () => {
    if (studio.getSnapshot().routineIndex != null) return studio.stopRoutine();
    if (!studio.playRoutine(draft)) say('Add a step first.');
    else say('');
  });
  saveBtn.addEventListener('click', () => {
    let steps: readonly RoutineStep[] = draft;
    if (steps.length === 0) {
      // No routine yet: save the current mix as a one-step combo.
      const step = studio.toBlendStep(stepLength());
      if (!step) return say(NOTHING_PLAYING);
      steps = addStep([], step, stepLength());
    } else if (!hasBlend(steps)) {
      return say('Add a step with a clip first.');
    }
    const first = steps.find((s) => s.type === 'blend');
    const fallback =
      steps.length === 1 && first?.type === 'blend' ? describeBlend(first, labelFor) : `${steps.length}-step routine`;
    const seq = deps.savedSequences.add(nameInput.value.trim() || fallback, toSavedSteps(steps));
    nameInput.value = '';
    say(`Saved “${seq.label}”. Play it from Home → All moves → My combos.`);
  });

  // --- Saved list ---
  const saved = createCollapsibleSection({
    id: 'saved',
    title: 'My combos',
    className: 'studio-saved-section',
    summary: () => `${deps.savedSequences.list().length} saved`,
  });
  const savedSection = saved.root;
  const savedList = el('ul', 'studio-saved');
  savedList.id = 'studio-saved-list';
  saved.body.append(savedList);
  function renderSaved() {
    const items = deps.savedSequences.list();
    savedSection.hidden = items.length === 0;
    savedList.replaceChildren(
      ...items.map((sq) => {
        const li = el('li', 'studio-saved-item');
        const name = el('span', 'studio-saved-name', sq.label);
        name.title = sq.steps
          .map((s) => {
            const text = s.type === 'blend' ? describeBlend(s, labelFor) : s.type === 'animation' ? labelFor(s.name) : 'pause';
            return sq.steps.length > 1 && s.duration != null ? `${text} (${formatSeconds(s.duration)})` : text;
          })
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
  const clips = createCollapsibleSection({
    id: 'clips',
    title: 'Clips',
    className: 'studio-clips-section',
    summary: () => {
      let playing = 0;
      for (const r of studio.getSnapshot().applied.values()) if (r.weight > 0) playing++;
      return playing === 0 ? 'Nothing playing' : playing === 1 ? '1 playing' : `${playing} playing`;
    },
  });
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
  clips.body.append(clipsHead, optRow, clipList);

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

  root.append(header);
  for (const section of [clips, xfSection, routineSection, saved]) mountStudioSection(root, section.root);

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
    clips.refresh();
    xfSection.refresh();
    renderPreview();
  }
  studio.subscribe(render);
  deps.savedSequences.subscribe(renderSaved);
  deps.savedSequences.subscribe(saved.refresh);

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
    renderRoutine();
    renderSaved();
  }

  renderSaved();
  renderRoutine();
  render();
  return { setAnimations };
}
