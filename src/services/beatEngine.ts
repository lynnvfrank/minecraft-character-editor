/**
 * Studio beat: the Web Audio side. Every sound is synthesized here (oscillators, a noise buffer,
 * gain envelopes); there are no audio files. Timing rules are pure and live in lib/beatClock.ts,
 * the grooves in lib/beatGrooves.ts.
 *
 * Scheduling: a 25 ms timer looks 100 ms ahead on the audio clock and hands every step in that
 * window to the audio thread with an exact start time, so the rhythm doesn't depend on how
 * punctual the timer is. The timer walks the grid by step index (`collectSteps`), so steps are
 * never skipped or doubled; if it stalls for longer than the window it jumps ahead on the grid
 * instead of machine-gunning the steps it missed.
 *
 * The AudioContext is created by `start()` only, which must be called from a click. It is
 * suspended again shortly after `stop()` (unless a recording is still using its audio track).
 */
import {
  collectSteps,
  createTransport,
  firstStepAtOrAfter,
  gridTime,
  retime,
  stepSeconds,
  type ClockAnchor,
  type Transport,
} from '../lib/beatClock';
import { grooveEventsAt, type Groove, type GrooveEvent } from '../lib/beatGrooves';

const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.1;
/** Gap between pressing play and the first beat. */
const START_DELAY_SEC = 0.08;
/** A step this far in the past is skipped rather than played late. */
const LATE_SEC = 0.05;
const FADE_SEC = 0.03;

export type BeatEngineOptions = { groove: Groove; bpm: number; gain: number };

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Can this browser play the beat at all? */
export const canPlayBeat = (): boolean => audioContextCtor() !== null;

export function createBeatEngine(initial: BeatEngineOptions) {
  let groove = initial.groove;
  let bpm = initial.bpm;
  let gain = initial.gain;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let streamOut: MediaStreamAudioDestinationNode | null = null;
  let noise: AudioBuffer | null = null;
  let transport: Transport | null = null;
  let nextStep = 0;
  let timer: number | null = null;
  let suspendTimer: number | null = null;
  /** Sources that have been scheduled and haven't ended (stopped at once when the beat stops). */
  const live = new Set<AudioScheduledSourceNode>();
  /** Audio tracks handed to recordings; the context stays awake while one is live. */
  let lent: MediaStreamTrack[] = [];

  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    const c = new Ctor();
    const m = c.createGain();
    m.gain.value = gain;
    // A gentle limiter so stacked voices never clip.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    m.connect(limiter);
    limiter.connect(c.destination);
    try {
      // A second copy of the master output, for "record with sound".
      streamOut = c.createMediaStreamDestination();
      limiter.connect(streamOut);
    } catch {
      streamOut = null;
    }
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buf;
    ctx = c;
    master = m;
    return c;
  }

  function track(src: AudioScheduledSourceNode, start: number, stop: number): void {
    live.add(src);
    src.onended = () => {
      live.delete(src);
      src.disconnect();
    };
    src.start(start);
    src.stop(stop);
  }

  /** Noise through a filter with a decaying envelope (snare, clap, hat). */
  function noiseHit(
    c: AudioContext,
    out: AudioNode,
    t: number,
    filter: { type: BiquadFilterType; freq: number; q?: number },
    level: number,
    decay: number,
    bursts = 1
  ): void {
    if (!noise) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    if (filter.q != null) f.Q.value = filter.q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let at = t;
    // A clap is a few quick bursts before the tail.
    for (let i = 0; i < bursts; i++) {
      g.gain.setValueAtTime(level, at);
      if (i < bursts - 1) {
        g.gain.exponentialRampToValueAtTime(level * 0.25, at + 0.009);
        at += 0.011;
      }
    }
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    track(src, t, at + decay + 0.02);
  }

  function tone(
    c: AudioContext,
    out: AudioNode,
    t: number,
    wave: OscillatorType,
    freq: number,
    level: number,
    length: number,
    cutoff: number
  ): void {
    const osc = c.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(level * 0.6, t + length * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(lp);
    lp.connect(g);
    g.connect(out);
    track(osc, t, t + length + 0.02);
  }

  function play(c: AudioContext, out: AudioNode, e: GrooveEvent, t: number, stepSec: number): void {
    switch (e.voice) {
      case 'kick': {
        // A sine that drops in pitch.
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const g = c.createGain();
        g.gain.setValueAtTime(0.9 * e.velocity, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        osc.connect(g);
        g.connect(out);
        track(osc, t, t + 0.28);
        break;
      }
      case 'snare':
        noiseHit(c, out, t, { type: 'bandpass', freq: 1900, q: 0.7 }, 0.5 * e.velocity, 0.16);
        tone(c, out, t, 'triangle', 190, 0.25 * e.velocity, 0.09, 2000);
        break;
      case 'clap':
        noiseHit(c, out, t, { type: 'bandpass', freq: 1300, q: 1.1 }, 0.55 * e.velocity, 0.14, 3);
        break;
      case 'hat':
        noiseHit(c, out, t, { type: 'highpass', freq: 7000 }, 0.16 * e.velocity, e.velocity >= 1 ? 0.11 : 0.04);
        break;
      case 'bass':
        tone(c, out, t, e.wave, e.freq, e.wave === 'sine' || e.wave === 'triangle' ? 0.42 : 0.2, Math.max(0.08, e.steps * stepSec), 700);
        break;
      case 'lead':
        tone(c, out, t, e.wave, e.freq, e.wave === 'triangle' ? 0.2 : 0.08, Math.max(0.07, e.steps * stepSec * 0.9), 3200);
        break;
    }
  }

  function tick(): void {
    if (!ctx || !master || !transport || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (gridTime(transport, nextStep) < now - LATE_SEC) {
      nextStep = Math.max(nextStep, firstStepAtOrAfter(transport, now));
    }
    const { steps, next } = collectSteps(transport, nextStep, now + LOOKAHEAD_SEC);
    nextStep = next;
    const stepSec = stepSeconds(transport.bpm);
    for (const s of steps) {
      const t = Math.max(s.time, now);
      for (const e of grooveEventsAt(groove, s.step)) play(ctx, master, e, t, stepSec);
    }
  }

  function clearSuspend(): void {
    if (suspendTimer !== null) window.clearTimeout(suspendTimer);
    suspendTimer = null;
  }

  /** Suspend once nothing needs the context: not playing, and no recording holding its audio track. */
  function suspendWhenIdle(delayMs: number): void {
    clearSuspend();
    suspendTimer = window.setTimeout(() => {
      suspendTimer = null;
      if (!ctx || transport) return;
      for (const src of live) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }
      live.clear();
      lent = lent.filter((t) => t.readyState === 'live');
      if (lent.length > 0) return suspendWhenIdle(500);
      if (ctx.state === 'running') void ctx.suspend().catch(() => {});
    }, delayMs);
  }

  return {
    /** Start the beat from the top of a bar. Call from a click: this is what unlocks audio. */
    start(): boolean {
      const c = ensureContext();
      if (!c || !master) return false;
      clearSuspend();
      if (c.state !== 'running') void c.resume().catch(() => {});
      const now = c.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(gain, now);
      transport = createTransport(now + START_DELAY_SEC, bpm, groove.swing);
      nextStep = 0;
      if (timer === null) timer = window.setInterval(tick, TICK_MS);
      tick();
      return true;
    },
    stop(): void {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (!transport) return;
      transport = null;
      if (ctx && master) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + FADE_SEC);
      }
      suspendWhenIdle(FADE_SEC * 1000 + 30);
    },
    isPlaying: (): boolean => transport !== null,
    setBpm(next: number): void {
      if (next === bpm) return;
      bpm = next;
      if (transport) transport = retime(transport, nextStep, bpm);
    },
    setGroove(next: Groove): void {
      if (next === groove) return;
      groove = next;
      if (transport) transport = retime(transport, nextStep, bpm, groove.swing);
    },
    /** Master gain, 0–1 (0 = muted). */
    setGain(next: number): void {
      gain = next;
      if (ctx && master && transport) master.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
    },
    /** The running grid, or null when stopped. */
    getTransport: (): Transport | null => transport,
    /**
     * Audio-clock time of the sound leaving the speakers at a `performance.now()` moment. Null
     * when stopped. Uses the browser's own output timestamp where it has one; otherwise the
     * context time less its reported output latency.
     */
    getClockAnchor(): ClockAnchor | null {
      if (!ctx || !transport) return null;
      try {
        const ts = ctx.getOutputTimestamp?.();
        if (ts && ts.contextTime && ts.performanceTime && ts.contextTime > 0 && ts.performanceTime > 0) {
          return { contextTime: ts.contextTime, performanceTime: ts.performanceTime };
        }
      } catch {
        /* fall through */
      }
      const latency = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : (ctx.baseLatency ?? 0);
      return { contextTime: ctx.currentTime - (latency || 0), performanceTime: performance.now() };
    },
    /**
     * A copy of the master output as an audio track for a recording, or null when the beat isn't
     * playing. The caller owns the track and stops it when done.
     */
    lendAudioTrack(): MediaStreamTrack | null {
      const source = transport && streamOut ? streamOut.stream.getAudioTracks()[0] : undefined;
      if (!source) return null;
      const copy = source.clone();
      lent.push(copy);
      return copy;
    },
  };
}

export type BeatEngine = ReturnType<typeof createBeatEngine>;
