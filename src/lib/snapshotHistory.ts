/**
 * A short history of timestamped values, for replaying something a little later (the dance
 * studio's backup dancers trail the lead by a fraction of a second). Pure.
 *
 * `record(now, value)` notes what was true from `now` on; `at(time)` answers what was true at
 * `time`. Only changes are stored (recording the same value again is free), and entries older
 * than `keepSec` are dropped, except the one still in force at the edge of the window.
 */
export type SnapshotHistory<T> = {
  /** Note the value in force from `now` (seconds, never going backwards) onwards. */
  record(now: number, value: T): void;
  /** The value in force at `time`; before the first record, the first one. Undefined when empty. */
  at(time: number): T | undefined;
  clear(): void;
  /** Stored entries (for tests). */
  size(): number;
};

export function createSnapshotHistory<T>(
  keepSec: number,
  same: (a: T, b: T) => boolean = Object.is
): SnapshotHistory<T> {
  let entries: { t: number; value: T }[] = [];

  return {
    record(now, value) {
      const last = entries[entries.length - 1];
      if (last && now < last.t) entries = []; // the clock restarted: old entries mean nothing
      const tail = entries[entries.length - 1];
      if (!tail || !same(tail.value, value)) entries.push({ t: now, value });
      // Drop what is out of the window, keeping the entry that was in force at its edge.
      const cutoff = now - Math.max(0, keepSec);
      let drop = 0;
      while (drop + 1 < entries.length && entries[drop + 1]!.t <= cutoff) drop++;
      if (drop > 0) entries.splice(0, drop);
    },
    at(time) {
      if (entries.length === 0) return undefined;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.t <= time) return entries[i]!.value;
      }
      return entries[0]!.value;
    },
    clear() {
      entries = [];
    },
    size: () => entries.length,
  };
}
