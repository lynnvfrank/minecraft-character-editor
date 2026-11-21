/**
 * Dance studio beat (`#/studio`): owns the beat engine (services/beatEngine.ts), keeps it in step
 * with the saved settings (state/studioBeatStore.ts), and makes the dancer move with it.
 *
 * - Never autoplays: `play()` is only called from the Play button. The beat stops (and the audio
 *   context is suspended) when you leave the studio or the tab is hidden.
 * - Beat position is read from the audio clock as heard (`getClockAnchor`), so the beat dots,
 *   the bounce and the bar line a routine waits for all line up with the sound, not the timer.
 * - Bounce: a small on-beat bob of the lead's container. The y it had before is remembered and put
 *   back exactly when the bounce is off, the beat stops, or you leave the studio. Backup dancers
 *   copy the lead's position, so they bob too.
 */
import type * as THREE from 'three';
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { audioTimeAtPerf, beatInfoAt, bounceOffset, nextBarLine, perfTimeOfAudio, type BeatInfo } from '../lib/beatClock';
import { grooveById } from '../lib/beatGrooves';
import { masterGain } from '../lib/beatSettings';
import { canPlayBeat, createBeatEngine } from '../services/beatEngine';
import type { StudioBeatStore } from '../state/studioBeatStore';

export type StudioBeatControllerDeps = {
  store: StudioBeatStore;
  getLead: () => { container: THREE.Object3D } | undefined;
};

/** A routine waits at least this long for its bar line (so the first frame isn't already late). */
const MIN_BAR_LEAD_SEC = 0.06;

export function createStudioBeatController(deps: StudioBeatControllerDeps) {
  const { store } = deps;
  const settings = () => store.get();
  const engine = createBeatEngine({
    groove: grooveById(settings().groove),
    bpm: settings().bpm,
    gain: masterGain(settings()),
  });
  const slice = createSubscribable();

  store.subscribe(() => {
    const s = settings();
    engine.setGroove(grooveById(s.groove));
    engine.setBpm(s.bpm);
    engine.setGain(masterGain(s));
  });

  /** The bob currently applied: the container, the y it had without it, and the y we set. */
  let bob: { container: THREE.Object3D; baseY: number; setY: number } | null = null;

  function restoreBob(): void {
    if (!bob) return;
    // Only put it back if nobody else moved the dancer meanwhile.
    if (bob.container.position.y === bob.setY) bob.container.position.y = bob.baseY;
    bob = null;
  }

  function stop(): void {
    if (!engine.isPlaying()) return;
    engine.stop();
    restoreBob();
    slice.notify();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
    });
  }

  /** Audio-clock time being heard now, or null when the beat is off. */
  function heardNow(): { audio: number; anchor: NonNullable<ReturnType<typeof engine.getClockAnchor>> } | null {
    const anchor = engine.getClockAnchor();
    if (!anchor) return null;
    return { audio: audioTimeAtPerf(anchor, performance.now()), anchor };
  }

  function beatNow(): BeatInfo | null {
    const tr = engine.getTransport();
    const now = heardNow();
    return tr && now ? beatInfoAt(tr, now.audio) : null;
  }

  return {
    canPlay: canPlayBeat,
    /** Start the beat. Call from a click (that is what lets the browser play sound). */
    play(): boolean {
      const ok = engine.start();
      slice.notify();
      return ok;
    },
    stop,
    isPlaying: () => engine.isPlaying(),
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
    /** Where in the bar the music is (as heard), or null when it's off. */
    beatNow,
    /** `performance.now()` time of the next bar line as heard, or null when the beat is off. */
    nextBarStartMs(): number | null {
      const tr = engine.getTransport();
      const now = heardNow();
      if (!tr || !now) return null;
      return perfTimeOfAudio(now.anchor, nextBarLine(tr, now.audio, MIN_BAR_LEAD_SEC).time);
    },
    /** A copy of the beat's sound for a recording (null when the beat isn't playing). */
    lendAudioTrack: () => engine.lendAudioTrack(),
    /** Every frame, after the studio has applied its mix. */
    update(route: string): void {
      if (route !== 'studio') {
        stop();
        restoreBob();
        return;
      }
      const amount = settings().bounce;
      const info = amount > 0 ? beatNow() : null;
      const lead = deps.getLead()?.container;
      if (!info || !lead) {
        restoreBob();
        return;
      }
      if (bob && bob.container !== lead) restoreBob();
      if (!bob) bob = { container: lead, baseY: lead.position.y, setY: lead.position.y };
      else if (lead.position.y !== bob.setY) bob.baseY = lead.position.y; // moved by something else
      lead.position.y = bob.baseY + bounceOffset(amount, info.phase);
      bob.setY = lead.position.y;
    },
  };
}

export type StudioBeatController = ReturnType<typeof createStudioBeatController>;
