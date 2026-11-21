/**
 * Who holds what: holder key (bundled skin path or `outfit:<id>`) → held item id, persisted to
 * localStorage so a resident keeps their item wherever and whenever they appear. Rules live in
 * domain/heldItems.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import {
  parseStoredHeldItems,
  withHeldItem,
  type HeldItemAssignments,
} from '../domain/heldItems';
import type { KeyValueStorage } from './residentsStore';

export const HELD_ITEMS_KEY = 'world.heldItems';

export function createHeldItemsStore(storage: KeyValueStorage | null) {
  let assignments: HeldItemAssignments = (() => {
    try {
      return parseStoredHeldItems(storage?.getItem(HELD_ITEMS_KEY) ?? null);
    } catch {
      return {};
    }
  })();
  const slice = createSubscribable();

  function commit(next: HeldItemAssignments): void {
    if (next === assignments) return;
    assignments = next;
    try {
      storage?.setItem(HELD_ITEMS_KEY, JSON.stringify(assignments));
    } catch {
      /* storage full or blocked: keep it for this visit */
    }
    slice.notify();
  }

  return {
    /** The item `key` holds, or null. */
    get: (key: string | null | undefined): string | null => (key != null ? assignments[key] ?? null : null),
    /** Everything (for the backup file). */
    all: (): Readonly<HeldItemAssignments> => assignments,
    /** Give `key` an item (null: empty hands). Keys that can't be remembered are ignored. */
    set(key: string, itemId: string | null): void {
      commit(withHeldItem(assignments, key, itemId));
    },
    /** Merge assignments from a backup; restored ones win. */
    merge(more: HeldItemAssignments): void {
      let next = assignments;
      for (const [key, id] of Object.entries(more)) next = withHeldItem(next, key, id);
      commit(next);
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type HeldItemsStore = ReturnType<typeof createHeldItemsStore>;
