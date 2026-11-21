/**
 * Which dance studio panel sections are open, persisted to localStorage. Subscribers are notified
 * after every change. Rules (order, defaults, validation) live in lib/studioSections.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import {
  parseStudioSections,
  setStudioSection,
  type StudioSectionId,
  type StudioSectionsOpen,
} from '../lib/studioSections';

export const STUDIO_SECTIONS_KEY = 'studio.sections';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function createStudioSectionsStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(STUDIO_SECTIONS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let state = parseStudioSections(read());
  const slice = createSubscribable();

  function set(id: StudioSectionId, open: boolean): void {
    const next = setStudioSection(state, id, open);
    if (next === state) return;
    state = next;
    try {
      storage?.setItem(STUDIO_SECTIONS_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: keep the in-memory choice for this visit */
    }
    slice.notify();
  }

  return {
    get: (): StudioSectionsOpen => state,
    isOpen: (id: StudioSectionId): boolean => state[id],
    set,
    toggle: (id: StudioSectionId): void => set(id, !state[id]),
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type StudioSectionsStore = ReturnType<typeof createStudioSectionsStore>;
