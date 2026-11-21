/**
 * My outfits (skins kept in the creator), persisted to localStorage so they survive a reload.
 * Subscribers are notified after every change. Rules and limits live in domain/outfits.ts.
 *
 * Stored data is untrusted: it is validated on read and anything malformed is dropped.
 * When the browser refuses a write (quota, private mode) the list still changes for this visit
 * and the result says `persisted: false`, so the caller can tell the user.
 *
 * `exportOutfits` / `importOutfits` are the two functions a save-file registry needs.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import {
  addOutfit,
  exportOutfits,
  importOutfits,
  parseOutfits,
  removeOutfit,
  renameOutfit,
  type AddOutfitOutcome,
  type Outfit,
  type OutfitsFile,
} from '../domain/outfits';
import type { ArmModel } from '../skin/armModel';

export const OUTFITS_KEY = 'creator.outfits';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type OutfitsStoreOptions = {
  now?: () => number;
  /** A new id (lowercase letters, digits and dashes). */
  newId?: () => string;
};

export type AddOutfitResult = { outfit: Outfit | null; outcome: AddOutfitOutcome; persisted: boolean };

function defaultId(): string {
  return `o${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 6).toString(36)}`;
}

export function createOutfitsStore(storage: KeyValueStorage | null, options: OutfitsStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? defaultId;
  const slice = createSubscribable();

  let outfits: Outfit[] = (() => {
    try {
      return parseOutfits(storage?.getItem(OUTFITS_KEY) ?? null);
    } catch {
      return [];
    }
  })();

  /** Replace the list, write it and notify. Returns false when the write was refused. */
  function commit(next: Outfit[]): boolean {
    outfits = next;
    let persisted = storage != null;
    try {
      storage?.setItem(OUTFITS_KEY, JSON.stringify(exportOutfits(outfits)));
    } catch {
      persisted = false; // storage full or blocked: the list still holds for this visit
    }
    slice.notify();
    return persisted;
  }

  return {
    /** Oldest first. */
    list: (): readonly Outfit[] => outfits,
    get: (id: string): Outfit | undefined => outfits.find((o) => o.id === id),
    findByDataUrl: (dataUrl: string): Outfit | undefined => outfits.find((o) => o.dataUrl === dataUrl),
    /** Keep a skin; the same image again returns the outfit it already is ('exists'). */
    add(input: { dataUrl: string; armModel: ArmModel; label?: string }): AddOutfitResult {
      let id = newId();
      for (let i = 0; i < 5 && outfits.some((o) => o.id === id); i++) id = newId();
      const result = addOutfit(outfits, input, { id, now: now() });
      if (result.outcome !== 'added') return { outfit: result.outfit, outcome: result.outcome, persisted: true };
      return { outfit: result.outfit, outcome: 'added', persisted: commit(result.list) };
    },
    /** Returns whether there was such an outfit. */
    remove(id: string): boolean {
      if (!outfits.some((o) => o.id === id)) return false;
      commit(removeOutfit(outfits, id));
      return true;
    },
    /** Returns whether the name changed. */
    rename(id: string, label: string): boolean {
      const next = renameOutfit(outfits, id, label);
      if (next.every((o, i) => o.label === outfits[i]!.label)) return false;
      commit(next);
      return true;
    },
    /** A JSON-ready copy of every outfit, for a save file. */
    exportOutfits: (): OutfitsFile => exportOutfits(outfits),
    /** Merge outfits from untrusted save-file data; what is already here stays. */
    importOutfits(data: unknown): { added: number; persisted: boolean } {
      const result = importOutfits(outfits, data);
      if (result.added === 0) return { added: 0, persisted: true };
      return { added: result.added, persisted: commit(result.list) };
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type OutfitsStore = ReturnType<typeof createOutfitsStore>;

let shared: OutfitsStore | null = null;

/** The app's one outfits store (the creator and the home view both use it). */
export function getOutfitsStore(): OutfitsStore {
  if (!shared) {
    let storage: KeyValueStorage | null = null;
    try {
      storage = (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null;
    } catch {
      storage = null; // blocked (private mode, sandboxed iframe)
    }
    shared = createOutfitsStore(storage);
  }
  return shared;
}
