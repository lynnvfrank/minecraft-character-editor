/**
 * The village layout the player painted in Build mode (controllers/villageEditorController.ts),
 * persisted to localStorage. Always holds a valid map: anything missing, damaged or against the
 * rules (domain/villageEdit.ts) falls back to the built-in VILLAGE_MAP. Subscribers are notified
 * after every change; the block world rebuilds itself from `get()`.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { VILLAGE_MAP } from '../domain/blockWorld';
import { parseVillageMap, sameVillageMap } from '../domain/villageEdit';
import type { SaveSection } from '../domain/saveFile';

export const VILLAGE_KEY = 'world.village';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

/** A stored value (JSON text) as a valid map, or null. */
export function parseStoredVillage(text: string | null): string[] | null {
  if (!text) return null;
  try {
    return parseVillageMap(JSON.parse(text));
  } catch {
    return null;
  }
}

export function createVillageStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(VILLAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let map: readonly string[] = parseStoredVillage(read()) ?? VILLAGE_MAP;
  const slice = createSubscribable();

  function persist(): void {
    try {
      if (sameVillageMap(map, VILLAGE_MAP) && storage?.removeItem) storage.removeItem(VILLAGE_KEY);
      else storage?.setItem(VILLAGE_KEY, JSON.stringify(map));
    } catch {
      /* storage full or blocked: keep the in-memory village for this visit */
    }
  }

  return {
    /** The current layout (the built-in one until the player paints). */
    get: (): readonly string[] => map,
    /** Replace the layout. Returns false (and changes nothing) if `next` breaks a rule. */
    set(next: readonly string[]): boolean {
      const clean = parseVillageMap(next);
      if (!clean) return false;
      if (sameVillageMap(clean, map)) return true;
      map = sameVillageMap(clean, VILLAGE_MAP) ? VILLAGE_MAP : clean;
      persist();
      slice.notify();
      return true;
    },
    /** Back to the built-in village. */
    reset(): void {
      if (map === VILLAGE_MAP) return;
      map = VILLAGE_MAP;
      persist();
      slice.notify();
    },
    /** Has the player changed anything from the built-in village? */
    isCustom: (): boolean => map !== VILLAGE_MAP,
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type VillageStore = ReturnType<typeof createVillageStore>;

/** The 'village' section of the backup file (controllers/saveAndShare.ts saveRegistry). */
export function createVillageSaveSection(store: VillageStore): SaveSection<string[]> {
  return {
    key: 'village',
    label: 'Village layout',
    // Always saved, so restoring a backup made before any building puts the original village back.
    read: () => [...store.get()],
    parse: (raw) => parseVillageMap(raw),
    write: (map) => void store.set(map),
    describe: (map) => (sameVillageMap(map, VILLAGE_MAP) ? 'Village layout (the original)' : 'Village layout (replaces yours)'),
  };
}
