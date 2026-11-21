/**
 * The dance studio's backdrop choice (which backdrop, the custom color, floor on/off), persisted to
 * localStorage. Subscribers are notified after every change. The catalogue is lib/studioBackdrop.ts;
 * controllers/studioStageController.ts applies the choice to the scene on the studio route.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { normalizeHex } from '../lib/color';
import { CUSTOM_BACKDROP_ID, isBackdropId, parseBackdropSettings, type BackdropSettings } from '../lib/studioBackdrop';

export const STUDIO_BACKDROP_KEY = 'studio.backdrop';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function createStudioBackdropStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(STUDIO_BACKDROP_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let settings = parseBackdropSettings(read());
  const slice = createSubscribable();

  function commit(next: BackdropSettings): void {
    settings = next;
    try {
      storage?.setItem(STUDIO_BACKDROP_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked: keep the in-memory value for this visit */
    }
    slice.notify();
  }

  return {
    get: (): Readonly<BackdropSettings> => settings,
    /** Pick a backdrop by id (unknown ids are ignored). */
    setBackdrop(id: string): void {
      if (!isBackdropId(id) || id === settings.id) return;
      commit({ ...settings, id });
    },
    /** Set the custom color and switch to it (invalid colors are ignored). */
    setCustomColor(hex: string): void {
      const color = normalizeHex(hex);
      if (!color || (color === settings.customColor && settings.id === CUSTOM_BACKDROP_ID)) return;
      commit({ ...settings, id: CUSTOM_BACKDROP_ID, customColor: color });
    },
    setFloor(floor: boolean): void {
      if (floor === settings.floor) return;
      commit({ ...settings, floor });
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type StudioBackdropStore = ReturnType<typeof createStudioBackdropStore>;
