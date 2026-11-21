/**
 * User-made sequences (saved from the dance studio), persisted to localStorage and listed in the
 * Move panel. Subscribers are notified after every change.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { isSavedSequenceStep as isStep, type SavedSequence, type SavedSequenceStep } from '../domain/sequences';
import { mergeSequences } from '../domain/sequenceImport';

export const SAVED_SEQUENCES_KEY = 'studio.savedSequences';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** Keep only well-formed sequences from untrusted JSON. */
export function parseSavedSequences(json: string | null): SavedSequence[] {
  if (!json) return [];
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (s): s is SavedSequence =>
        !!s && typeof s === 'object' &&
        typeof (s as SavedSequence).id === 'string' &&
        typeof (s as SavedSequence).label === 'string' &&
        Array.isArray((s as SavedSequence).steps) &&
        (s as SavedSequence).steps.length > 0 &&
        (s as SavedSequence).steps.every(isStep)
    );
  } catch {
    return [];
  }
}

export function createSavedSequencesStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(SAVED_SEQUENCES_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let list = parseSavedSequences(read());
  const slice = createSubscribable();
  let counter = 0;

  function persist(): void {
    try {
      storage?.setItem(SAVED_SEQUENCES_KEY, JSON.stringify(list));
    } catch {
      /* storage full or blocked: keep the in-memory list for this visit */
    }
    slice.notify();
  }

  return {
    list: (): readonly SavedSequence[] => list,
    get: (id: string): SavedSequence | undefined => list.find((s) => s.id === id),
    /** Add a sequence (newest first) and return it. */
    add(label: string, steps: SavedSequenceStep[], now: number = Date.now()): SavedSequence {
      const id = `studio-${now.toString(36)}-${(counter++).toString(36)}`;
      const seq: SavedSequence = { id, label: label.trim() || 'My combo', steps };
      list = [seq, ...list];
      persist();
      return seq;
    },
    remove(id: string): void {
      const next = list.filter((s) => s.id !== id);
      if (next.length === list.length) return;
      list = next;
      persist();
    },
    /**
     * Add sequences from a backup file or a share link, after the existing ones. Ones the user
     * already has (same name and steps) are skipped; clashing ids get a new one. Returns how many
     * were added. Callers pass sanitized input (domain/sequenceImport.ts).
     */
    importMany(incoming: readonly SavedSequence[], now: number = Date.now()): number {
      const merged = mergeSequences(list, incoming, () => `studio-${now.toString(36)}-${(counter++).toString(36)}`);
      if (merged.added === 0) return 0;
      list = merged.list;
      persist();
      return merged.added;
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type SavedSequencesStore = ReturnType<typeof createSavedSequencesStore>;
