/**
 * Dance studio "Dancers" settings (how many backup dancers, their formation, how far they trail
 * the lead), persisted to localStorage. Subscribers are notified after every change.
 * Rules live in domain/groupDance.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { normalizeGroupDance, parseGroupDance, type GroupDanceSettings } from '../domain/groupDance';

export const GROUP_DANCE_KEY = 'studio.groupDance';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function createGroupDanceStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(GROUP_DANCE_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let settings = parseGroupDance(read());
  const slice = createSubscribable();

  return {
    get: (): GroupDanceSettings => settings,
    /** Change some settings; invalid values are ignored (the old value stays). */
    set(patch: Partial<GroupDanceSettings>): void {
      const next = normalizeGroupDance({ ...settings, ...patch }, settings);
      if (
        next.count === settings.count &&
        next.formation === settings.formation &&
        next.offsetSec === settings.offsetSec
      ) {
        return;
      }
      settings = next;
      try {
        storage?.setItem(GROUP_DANCE_KEY, JSON.stringify(settings));
      } catch {
        /* storage full or blocked: keep the in-memory settings for this visit */
      }
      slice.notify();
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type GroupDanceStore = ReturnType<typeof createGroupDanceStore>;
