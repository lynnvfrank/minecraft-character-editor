/**
 * Dance studio "Beat" settings (groove, tempo, volume, snap to beat, bounce), persisted to
 * localStorage. Subscribers are notified after every change. Rules live in lib/beatSettings.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import type { SaveSection } from '../domain/saveFile';
import {
  describeBeatSettings,
  normalizeBeatSettings,
  parseBeatSettings,
  parseBeatSettingsValue,
  sameBeatSettings,
  type BeatSettings,
} from '../lib/beatSettings';

export const STUDIO_BEAT_KEY = 'studio.beat';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function createStudioBeatStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(STUDIO_BEAT_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let settings = parseBeatSettings(read());
  const slice = createSubscribable();

  return {
    get: (): BeatSettings => settings,
    /** Change some settings; invalid values are ignored (the old value stays). */
    set(patch: Partial<BeatSettings>): void {
      const next = normalizeBeatSettings({ ...settings, ...patch }, settings);
      if (sameBeatSettings(next, settings)) return;
      settings = next;
      try {
        storage?.setItem(STUDIO_BEAT_KEY, JSON.stringify(settings));
      } catch {
        /* storage full or blocked: keep the in-memory settings for this visit */
      }
      slice.notify();
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type StudioBeatStore = ReturnType<typeof createStudioBeatStore>;

/** The 'studioBeat' section of the backup file. */
export function createBeatSaveSection(store: Pick<StudioBeatStore, 'get' | 'set'>): SaveSection<BeatSettings> {
  return {
    key: 'studioBeat',
    label: 'Studio beat',
    read: () => ({ ...store.get() }),
    parse: parseBeatSettingsValue,
    write: (v) => store.set(v),
    describe: (v) => `Studio beat: ${describeBeatSettings(v)}`,
  };
}
