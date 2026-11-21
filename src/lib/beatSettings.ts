/**
 * Studio beat settings (pure): what is remembered between visits and its validation.
 * state/studioBeatStore.ts persists them; whether the beat is *playing* is never saved (the beat
 * only ever starts from a click).
 */
import { clampBpm, DEFAULT_BPM } from './beatClock';
import { DEFAULT_GROOVE_ID, grooveById, isGrooveId } from './beatGrooves';

export type BeatSettings = {
  groove: string;
  bpm: number;
  /** Master volume, 0–1. */
  volume: number;
  muted: boolean;
  /** Routine step lengths are entered in beats. */
  snap: boolean;
  /** On-beat bounce of the dancer, 0 (off) to 1. */
  bounce: number;
};

export const DEFAULT_BEAT_SETTINGS: BeatSettings = {
  groove: DEFAULT_GROOVE_ID,
  bpm: DEFAULT_BPM,
  volume: 0.7,
  muted: false,
  snap: false,
  bounce: 0,
};

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : fallback;

/** Coerce anything into valid settings; junk fields fall back to `base`. */
export function normalizeBeatSettings(value: unknown, base: BeatSettings = DEFAULT_BEAT_SETTINGS): BeatSettings {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    groove: isGrooveId(v.groove) ? v.groove : base.groove,
    bpm: clampBpm(v.bpm, base.bpm),
    volume: unit(v.volume, base.volume),
    muted: typeof v.muted === 'boolean' ? v.muted : base.muted,
    snap: typeof v.snap === 'boolean' ? v.snap : base.snap,
    bounce: unit(v.bounce, base.bounce),
  };
}

/** Settings from untrusted JSON (localStorage); the defaults when nothing usable is stored. */
export function parseBeatSettings(json: string | null): BeatSettings {
  if (!json) return { ...DEFAULT_BEAT_SETTINGS };
  try {
    return normalizeBeatSettings(JSON.parse(json));
  } catch {
    return { ...DEFAULT_BEAT_SETTINGS };
  }
}

/** For the backup file: null unless the value is an object (then every field is validated). */
export function parseBeatSettingsValue(raw: unknown): BeatSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return normalizeBeatSettings(raw);
}

export function sameBeatSettings(a: BeatSettings, b: BeatSettings): boolean {
  return (
    a.groove === b.groove &&
    a.bpm === b.bpm &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.snap === b.snap &&
    a.bounce === b.bounce
  );
}

/** "Bouncy · 110 BPM" (for the collapsed section and the restore summary). */
export function describeBeatSettings(s: BeatSettings): string {
  return `${grooveById(s.groove).label} · ${s.bpm} BPM`;
}

/** Gain for the master volume: squared so the slider feels even, silent when muted. */
export function masterGain(s: Pick<BeatSettings, 'volume' | 'muted'>): number {
  return s.muted ? 0 : s.volume * s.volume;
}
