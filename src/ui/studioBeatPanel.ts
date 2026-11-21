/**
 * "Beat" section of the dance studio panel (`#/studio`): music to dance to. Play/Stop, a groove
 * picker, tempo (slider + tap tempo), volume and mute, the on-beat bounce, and four dots that
 * pulse on the beat (read from the audio clock, so they match what you hear).
 *
 * Its own module (like the Camera section); it mounts itself at its place in the panel. The
 * engine lives behind `StudioBeatPanelApi` (ui can't import controllers).
 */
import { MAX_BPM, MIN_BPM, pushTap, tapTempo, type BeatInfo } from '../lib/beatClock';
import { GROOVES } from '../lib/beatGrooves';
import { describeBeatSettings, type BeatSettings } from '../lib/beatSettings';
import { createCollapsibleSection, mountStudioSection } from './collapsibleSection';

export type StudioBeatPanelApi = {
  canPlay: () => boolean;
  play: () => boolean;
  stop: () => void;
  isPlaying: () => boolean;
  subscribe: (listener: () => void) => () => void;
  beatNow: () => BeatInfo | null;
};

export type StudioBeatPanelDeps = {
  mount: HTMLElement | null;
  beat: StudioBeatPanelApi;
  settings: {
    get: () => BeatSettings;
    set: (patch: Partial<BeatSettings>) => void;
    subscribe: (listener: () => void) => () => void;
  };
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, className = 'studio-btn'): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
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

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function createStudioBeatPanel(deps: StudioBeatPanelDeps) {
  const { beat, settings } = deps;
  const section = createCollapsibleSection({
    id: 'beat',
    title: 'Beat',
    className: 'studio-beat',
    domId: 'studio-beat',
    summary: () => `${beat.isPlaying() ? '♪ ' : ''}${describeBeatSettings(settings.get())}`,
  });

  // Play + groove
  const playRow = el('div', 'studio-row');
  const playBtn = button('▶ Play', 'studio-btn studio-beat-play');
  playBtn.id = 'studio-beat-play';
  playBtn.setAttribute('aria-pressed', 'false');
  const grooveSel = el('select', 'studio-select');
  grooveSel.id = 'studio-beat-groove';
  grooveSel.setAttribute('aria-label', 'Groove');
  for (const g of GROOVES) {
    const o = new Option(g.label, g.id);
    o.title = g.blurb;
    grooveSel.append(o);
  }
  const dots = el('div', 'studio-beat-dots');
  dots.setAttribute('aria-hidden', 'true');
  const dotEls = [0, 1, 2, 3].map(() => dots.appendChild(el('span', 'studio-beat-dot')));
  playRow.append(playBtn, grooveSel, dots);

  // Tempo
  const bpmRow = el('div', 'studio-row');
  const bpmSlider = range(MIN_BPM, MAX_BPM, 1, 'Tempo (beats per minute)');
  bpmSlider.id = 'studio-beat-bpm';
  const bpmVal = el('span', 'studio-value studio-beat-bpm');
  const tapBtn = button('Tap');
  tapBtn.title = 'Tap along to set the tempo';
  bpmRow.append(el('span', 'studio-slider-label', 'Tempo'), bpmSlider, bpmVal, tapBtn);

  // Volume
  const volRow = el('div', 'studio-row');
  const volSlider = range(0, 1, 0.01, 'Volume');
  const volVal = el('span', 'studio-value');
  const muteBtn = button('🔊', 'studio-btn studio-btn--icon');
  muteBtn.setAttribute('aria-label', 'Mute');
  volRow.append(el('span', 'studio-slider-label', 'Volume'), volSlider, volVal, muteBtn);

  // Bounce
  const bounceRow = el('div', 'studio-row');
  const bounceSlider = range(0, 1, 0.05, 'Bounce on the beat');
  bounceSlider.title = 'A little hop on every beat while the music plays';
  const bounceVal = el('span', 'studio-value');
  bounceRow.append(el('span', 'studio-slider-label', 'Bounce'), bounceSlider, bounceVal);

  const hint = el('p', 'studio-hint');
  hint.setAttribute('aria-live', 'polite');
  section.body.append(playRow, bpmRow, volRow, bounceRow, hint);
  mountStudioSection(deps.mount, section.root);

  if (!beat.canPlay()) {
    playBtn.disabled = true;
    hint.textContent = "This browser can't play the beat.";
  }

  playBtn.addEventListener('click', () => {
    if (beat.isPlaying()) beat.stop();
    else if (!beat.play()) hint.textContent = "Couldn't start the beat.";
  });
  grooveSel.addEventListener('change', () => settings.set({ groove: grooveSel.value }));
  bpmSlider.addEventListener('input', () => settings.set({ bpm: Number(bpmSlider.value) }));
  let taps: number[] = [];
  tapBtn.addEventListener('click', () => {
    taps = pushTap(taps, performance.now());
    const bpm = tapTempo(taps);
    if (bpm != null) settings.set({ bpm });
  });
  volSlider.addEventListener('input', () => settings.set({ volume: Number(volSlider.value), muted: false }));
  muteBtn.addEventListener('click', () => settings.set({ muted: !settings.get().muted }));
  bounceSlider.addEventListener('input', () => settings.set({ bounce: Number(bounceSlider.value) }));

  const setIfIdle = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
    if (document.activeElement === input && input instanceof HTMLInputElement) return;
    if (input.value !== value) input.value = value;
  };

  function render(): void {
    const s = settings.get();
    const playing = beat.isPlaying();
    playBtn.textContent = playing ? '■ Stop' : '▶ Play';
    playBtn.setAttribute('aria-pressed', String(playing));
    section.root.classList.toggle('playing', playing);
    setIfIdle(grooveSel, s.groove);
    setIfIdle(bpmSlider, String(s.bpm));
    bpmVal.textContent = `${s.bpm}`;
    bpmVal.title = `${s.bpm} beats per minute`;
    setIfIdle(volSlider, String(s.volume));
    volVal.textContent = s.muted ? 'Off' : pct(s.volume);
    muteBtn.textContent = s.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', s.muted ? 'Unmute' : 'Mute');
    muteBtn.setAttribute('aria-pressed', String(s.muted));
    setIfIdle(bounceSlider, String(s.bounce));
    bounceVal.textContent = s.bounce > 0 ? pct(s.bounce) : 'Off';
    section.refresh();
    if (playing) startDots();
  }

  // Beat dots: animated only while the beat plays.
  let raf: number | null = null;
  function drawDots(): void {
    const info = beat.isPlaying() ? beat.beatNow() : null;
    dotEls.forEach((d, i) => {
      const on = info != null && info.beat === i;
      d.classList.toggle('on', on);
      d.style.setProperty('--pulse', on ? String(1 - info!.phase) : '0');
    });
    raf = info || beat.isPlaying() ? requestAnimationFrame(drawDots) : null;
  }
  function startDots(): void {
    if (raf === null) raf = requestAnimationFrame(drawDots);
  }

  beat.subscribe(render);
  settings.subscribe(render);
  render();
}
