/**
 * Who lives in the home village (the Residents panel's roster), persisted to localStorage.
 * `null` until the user chooses: the crowd then behaves as it always has. Subscribers are
 * notified after every change. Rules live in domain/residents.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import { normalizeRoster, parseResidents } from '../domain/residents';

export const RESIDENTS_KEY = 'world.residents';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

export function createResidentsStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(RESIDENTS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let roster: string[] | null = parseResidents(read());
  const slice = createSubscribable();

  function commit(next: string[]): void {
    if (roster && same(roster, next)) return;
    roster = next;
    try {
      storage?.setItem(RESIDENTS_KEY, JSON.stringify(roster));
    } catch {
      /* storage full or blocked: keep the in-memory roster for this visit */
    }
    slice.notify();
  }

  return {
    /** The chosen skins, or null if the user never chose (default crowd). */
    get: (): readonly string[] | null => roster,
    /** Replace the roster (an empty list is a choice too: nobody but the main character). */
    set(next: readonly string[]): void {
      commit([...new Set(next)]);
    },
    /**
     * Drop skins that no longer exist and trim to the cap. Call once the skin list has loaded.
     * Does nothing without a stored roster, or with an empty list (a failed load must not wipe it).
     */
    prune(available: readonly string[], cap: number): void {
      if (!roster || available.length === 0) return;
      commit(normalizeRoster(roster, available, cap));
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type ResidentsStore = ReturnType<typeof createResidentsStore>;
