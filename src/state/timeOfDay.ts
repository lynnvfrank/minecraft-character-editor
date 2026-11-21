/**
 * The home view's time of day (hours in [0, 24)) and whether it cycles by itself, persisted to
 * localStorage. Subscribers are notified after every change. The sky that goes with a time is
 * lib/dayNight.ts; controllers/dayNightController.ts applies it to the scene.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { DEFAULT_TIME_OF_DAY, wrapHours } from '../lib/dayNight';

export const TIME_OF_DAY_KEY = 'world.timeOfDay';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type TimeOfDaySettings = { time: number; auto: boolean };

export const DEFAULT_TIME_OF_DAY_SETTINGS: TimeOfDaySettings = { time: DEFAULT_TIME_OF_DAY, auto: false };

/** Read settings from untrusted JSON; anything malformed falls back to the default (midday, no auto). */
export function parseTimeOfDaySettings(json: string | null): TimeOfDaySettings {
  if (!json) return { ...DEFAULT_TIME_OF_DAY_SETTINGS };
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return { ...DEFAULT_TIME_OF_DAY_SETTINGS };
    const d = data as Record<string, unknown>;
    const time = typeof d.time === 'number' && Number.isFinite(d.time) ? wrapHours(d.time) : DEFAULT_TIME_OF_DAY;
    return { time, auto: d.auto === true };
  } catch {
    return { ...DEFAULT_TIME_OF_DAY_SETTINGS };
  }
}

export function createTimeOfDayStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(TIME_OF_DAY_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let settings = parseTimeOfDaySettings(read());
  const slice = createSubscribable();

  function persist(): void {
    try {
      storage?.setItem(TIME_OF_DAY_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked: keep the in-memory value for this visit */
    }
  }

  return {
    get: (): Readonly<TimeOfDaySettings> => settings,
    /**
     * Set the time (wrapped to a day). Pass `save: false` for the auto-cycle's per-frame ticks and
     * call persist() now and then instead, so a running clock doesn't write storage 60 times a second.
     */
    setTime(time: number, save = true): void {
      const next = wrapHours(time);
      if (next !== settings.time) {
        settings = { ...settings, time: next };
        slice.notify();
      }
      if (save) persist();
    },
    setAuto(auto: boolean): void {
      if (auto === settings.auto) return;
      settings = { ...settings, auto };
      persist();
      slice.notify();
    },
    persist,
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type TimeOfDayStore = ReturnType<typeof createTimeOfDayStore>;
