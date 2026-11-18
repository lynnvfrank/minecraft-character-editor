/**
 * User-made sequences (saved from the dance studio), persisted to localStorage and listed in the
 * Move panel. Subscribers are notified after every change.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import type { SavedSequence, SavedSequenceStep } from '../domain/sequences';

export const SAVED_SEQUENCES_KEY = 'studio.savedSequences';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function isStep(v: unknown): v is SavedSequenceStep {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (s.type === 'animation') return typeof s.name === 'string';
  if (s.type === 'pause') return true;
  if (s.type === 'blend') {
    return (
      Array.isArray(s.layers) &&
      s.layers.length > 0 &&
      s.layers.every(
        (l) =>
          l && typeof l === 'object' &&
          typeof (l as Record<string, unknown>).name === 'string' &&
          typeof (l as Record<string, unknown>).weight === 'number'
      )
    );
  }
  return false;
}

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
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type SavedSequencesStore = ReturnType<typeof createSavedSequencesStore>;
