/**
 * Studio beat timing (pure; no Web Audio, no DOM), tested in beatClock.test.ts.
 *
 * The beat is a grid of 16th-note steps: 4 steps to a beat, 4 beats (16 steps) to a bar. A
 * `Transport` pins one step to a moment on the audio clock; every other step's time follows from
 * the tempo. The scheduler (services/beatEngine.ts) walks the grid by step *index*, so a step can
 * never be dropped or played twice however its timer wakes up, and a tempo change just re-pins
 * the grid at the next step that hasn't been scheduled yet.
 *
 * Also here: tap tempo, beats <-> seconds for "Snap to beat", the bar line a routine waits for,
 * the audio-clock <-> performance-clock mapping, and the "Bounce" curve.
 */

export const MIN_BPM = 70;
export const MAX_BPM = 160;
export const DEFAULT_BPM = 110;
export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

/** Whole BPM in range; junk (NaN, text) becomes `fallback`. */
export function clampBpm(value: unknown, fallback: number = DEFAULT_BPM): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
}

export const beatSeconds = (bpm: number): number => 60 / bpm;
export const stepSeconds = (bpm: number): number => 60 / bpm / STEPS_PER_BEAT;

export type Transport = {
  /** Step index pinned to `anchorTime`. */
  anchorStep: number;
  /** Audio-clock time (seconds) of `anchorStep`, without swing. */
  anchorTime: number;
  bpm: number;
  /** 0 = straight, 1 = full triplet swing (every off 16th lands a third of a step late). */
  swing: number;
};

export function createTransport(startTime: number, bpm: number, swing = 0): Transport {
  return { anchorStep: 0, anchorTime: startTime, bpm, swing: Math.min(1, Math.max(0, swing)) };
}

/** Time of a step on the straight grid. */
export function gridTime(tr: Transport, step: number): number {
  return tr.anchorTime + (step - tr.anchorStep) * stepSeconds(tr.bpm);
}

/** How late a step plays because of swing (only the odd 16ths move; always less than a step). */
export function swingDelay(step: number, bpm: number, swing: number): number {
  if (step % 2 === 0 || !(swing > 0)) return 0;
  return (Math.min(1, swing) * stepSeconds(bpm)) / 3;
}

/** Time a step actually sounds (grid + swing). */
export function stepTime(tr: Transport, step: number): number {
  return gridTime(tr, step) + swingDelay(step, tr.bpm, tr.swing);
}

/** Fractional step index on the straight grid at `time` (4.5 = halfway through step 4). */
export function positionAt(tr: Transport, time: number): number {
  return tr.anchorStep + (time - tr.anchorTime) / stepSeconds(tr.bpm);
}

export type ScheduledStep = { step: number; time: number };

/**
 * The steps from `fromStep` on that sound before `untilTime`, and the step to continue from next
 * time. Call it with the returned `next` and a later `untilTime` and every step comes out exactly
 * once, in order. `maxSteps` bounds one call (a timer that slept for a long time).
 */
export function collectSteps(
  tr: Transport,
  fromStep: number,
  untilTime: number,
  maxSteps = 64
): { steps: ScheduledStep[]; next: number } {
  const steps: ScheduledStep[] = [];
  let next = fromStep;
  while (steps.length < maxSteps) {
    const time = stepTime(tr, next);
    if (!(time < untilTime)) break;
    steps.push({ step: next, time });
    next++;
  }
  return { steps, next };
}

/** First step whose grid time is at or after `time` (to skip ahead after the timer stalled). */
export function firstStepAtOrAfter(tr: Transport, time: number): number {
  // The epsilon keeps a step that is exactly "now" from being skipped by float noise.
  return Math.ceil(positionAt(tr, time) - 1e-9);
}

/**
 * Change tempo and/or swing mid-play. The grid is re-pinned at `nextStep` (the first step not yet
 * scheduled), so what was already scheduled stays put and the next step follows it at the old
 * spacing; only the steps after it use the new tempo.
 */
export function retime(tr: Transport, nextStep: number, bpm: number, swing: number = tr.swing): Transport {
  return { anchorStep: nextStep, anchorTime: gridTime(tr, nextStep), bpm, swing: Math.min(1, Math.max(0, swing)) };
}

export type BeatInfo = {
  /** Beat of the bar, 0–3. */
  beat: number;
  /** How far through that beat, 0 (on the beat) up to 1. */
  phase: number;
  bar: number;
};

/** Where in the bar `time` falls; null before the first beat. */
export function beatInfoAt(tr: Transport, time: number): BeatInfo | null {
  const pos = positionAt(tr, time);
  if (!Number.isFinite(pos) || pos < 0) return null;
  const beats = pos / STEPS_PER_BEAT;
  const whole = Math.floor(beats);
  return { beat: whole % BEATS_PER_BAR, phase: beats - whole, bar: Math.floor(whole / BEATS_PER_BAR) };
}

/** The first bar line at or after `time + minLeadSec`: its step index and when it sounds. */
export function nextBarLine(tr: Transport, time: number, minLeadSec = 0): ScheduledStep {
  const pos = Math.max(0, positionAt(tr, time + Math.max(0, minLeadSec)));
  const step = Math.max(0, Math.ceil(pos / STEPS_PER_BAR - 1e-9) * STEPS_PER_BAR); // max: no -0
  return { step, time: gridTime(tr, step) }; // bar lines are even steps: swing never moves them
}

/**
 * A matched pair of readings: the audio-clock time (seconds) of the sound leaving the speakers at
 * a `performance.now()` moment (milliseconds). `AudioContext.getOutputTimestamp()` gives one.
 */
export type ClockAnchor = { contextTime: number; performanceTime: number };

/** Audio-clock time being heard at `perfMs`. Both clocks tick in real time, so one pair is enough. */
export function audioTimeAtPerf(anchor: ClockAnchor, perfMs: number): number {
  return anchor.contextTime + (perfMs - anchor.performanceTime) / 1000;
}

/** The `performance.now()` moment at which audio-clock time `audioTime` is heard. */
export function perfTimeOfAudio(anchor: ClockAnchor, audioTime: number): number {
  return anchor.performanceTime + (audioTime - anchor.contextTime) * 1000;
}

// --- Tap tempo ---------------------------------------------------------------------------------

/** A pause this long between taps starts a new count. */
export const TAP_RESET_MS = 2000;
/** Taps kept for the average. */
export const MAX_TAPS = 6;

/** Add a tap (a timestamp in ms). A long pause forgets the earlier taps; only the latest few are kept. */
export function pushTap(taps: readonly number[], nowMs: number): number[] {
  const last = taps[taps.length - 1];
  if (last === undefined || nowMs - last > TAP_RESET_MS || nowMs <= last) return [nowMs];
  return [...taps, nowMs].slice(-MAX_TAPS);
}

/** Tempo from the average gap between taps, clamped to the BPM range; null until there are two taps. */
export function tapTempo(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  const span = taps[taps.length - 1]! - taps[0]!;
  if (!(span > 0)) return null;
  return clampBpm(60000 / (span / (taps.length - 1)));
}

// --- Snap to beat ------------------------------------------------------------------------------

/** Step lengths offered when a routine snaps to the beat. */
export const BEAT_LENGTHS = [0.5, 1, 2, 4, 8] as const;
export const DEFAULT_BEAT_LENGTH = 4;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function beatsToSeconds(beats: number, bpm: number): number {
  return round3(beats * beatSeconds(bpm));
}

export function secondsToBeats(sec: number, bpm: number): number {
  return sec / beatSeconds(bpm);
}

/** The beat lengths that fit the allowed step length at this tempo (½ beat is too short above 120 BPM). */
export function beatLengthsFor(bpm: number, minSec = 0.25, maxSec = 20): number[] {
  const ok = BEAT_LENGTHS.filter((b) => {
    const sec = b * beatSeconds(bpm);
    return sec >= minSec - 1e-9 && sec <= maxSec + 1e-9;
  });
  return ok.length > 0 ? ok : [DEFAULT_BEAT_LENGTH];
}

/** The offered beat length closest to a length in seconds (closest by ratio: 3 beats is nearer 4 than 2). */
export function nearestBeatLength(sec: number, bpm: number, minSec = 0.25, maxSec = 20): number {
  const options = beatLengthsFor(bpm, minSec, maxSec);
  if (!Number.isFinite(sec) || sec <= 0) return options.includes(DEFAULT_BEAT_LENGTH) ? DEFAULT_BEAT_LENGTH : options[0]!;
  const beats = secondsToBeats(sec, bpm);
  let best = options[0]!;
  for (const b of options) {
    if (Math.abs(Math.log(b / beats)) < Math.abs(Math.log(best / beats)) - 1e-9) best = b;
  }
  return best;
}

/** A length in seconds moved onto the beat grid at this tempo. */
export function snapSeconds(sec: number, bpm: number, minSec = 0.25, maxSec = 20): number {
  return beatsToSeconds(nearestBeatLength(sec, bpm, minSec, maxSec), bpm);
}

/**
 * A snapped length carried from one tempo to another: it keeps its number of beats (so 4 beats
 * stays 4 beats), unless that no longer fits at the new tempo, in which case the nearest that does.
 */
export function rescaleSnapped(sec: number, fromBpm: number, toBpm: number, minSec = 0.25, maxSec = 20): number {
  const beats = nearestBeatLength(sec, fromBpm, 0, Number.POSITIVE_INFINITY);
  return snapSeconds(beats * beatSeconds(toBpm), toBpm, minSec, maxSec);
}

/** "½ beat", "1 beat", "4 beats". */
export function formatBeats(beats: number): string {
  if (beats === 0.5) return '½ beat';
  return `${beats} beat${beats === 1 ? '' : 's'}`;
}

// --- Bounce ------------------------------------------------------------------------------------

/** How high the dancer lifts at 100% bounce, in world units (the character is about 2 tall). */
export const MAX_BOUNCE_HEIGHT = 0.07;

/** 0 on the beat (feet down), 1 halfway to the next one; smooth in between. */
export function bouncePulse(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  const p = phase - Math.floor(phase);
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
}

/** Lift for a bounce amount (0–1) at a beat phase. Exactly 0 when the amount is 0. */
export function bounceOffset(amount: number, phase: number): number {
  if (!(amount > 0)) return 0;
  return Math.min(1, amount) * MAX_BOUNCE_HEIGHT * bouncePulse(phase);
}
