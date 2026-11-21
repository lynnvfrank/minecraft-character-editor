/**
 * The one save file ("backup"): everything the user made, in a single versioned JSON document.
 *
 *   { "app": "blockygotchi", "version": 1, "savedAt": "<ISO time>", "data": { "<section key>": ... } }
 *
 * Each kind of data is a *section* that knows how to read itself from the live app, check a value
 * from an untrusted file, and write it back. A feature joins the backup by registering a section:
 *
 *   saveRegistry.register({ key: 'weather', label: 'Weather', read: () => store.get(), parse: parseWeather, write: (v) => store.set(v) });
 *
 * Sections a file has but this build doesn't know are ignored (a newer backup still loads), and so
 * are sections whose content doesn't pass `parse`. Pure: no DOM, no storage. The core sections are
 * in state/saveSections.ts; the UI is ui/backupSection.ts.
 */

export const SAVE_FILE_APP = 'blockygotchi';
export const SAVE_FILE_VERSION = 1;
/** Largest file we read, in characters. Real backups are a few kilobytes. */
// Room for 24 outfits (up to 600,000 characters of skin images) plus everything else.
export const MAX_SAVE_FILE_LENGTH = 2_000_000;

export type SaveSection<T> = {
  /** Property name under `data` in the file. Never reuse a key for a different shape. */
  key: string;
  /** Short name for the restore summary ("Time of day"). */
  label: string;
  /** Current value, or undefined when there is nothing worth saving. Must be JSON-safe. */
  read: () => T | undefined;
  /** Check a value from a file. Return a clean value, or null to skip the section. Must not throw on junk. */
  parse: (raw: unknown) => T | null;
  /** Put a parsed value into the live app (the store notifies its subscribers). */
  write: (value: T) => void;
  /** One line for the restore summary, e.g. "3 combos (added to yours)". Defaults to the label. */
  describe?: (value: T) => string;
};

/** A section of unknown value type, as the registry holds it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySaveSection = SaveSection<any>;

export type SaveFile = { app: string; version: number; savedAt: string; data: Record<string, unknown> };

export type ParsedSaveEntry = { key: string; label: string; summary: string; apply: () => void };

export type ParsedSaveFile =
  | {
      ok: true;
      /** When the backup was made (ISO string), or null if the file doesn't say. */
      savedAt: string | null;
      /** What will be restored, in registration order. */
      entries: ParsedSaveEntry[];
      /** Labels of sections that were in the file but not usable. */
      skipped: string[];
      /** Keys in the file this build doesn't know (from a newer version, say). */
      unknown: string[];
    }
  | { ok: false; reason: string };

/** Wrap section values in the versioned envelope. `undefined` values are left out. */
export function buildSaveFile(parts: Record<string, unknown>, savedAt: Date = new Date()): SaveFile {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parts)) if (value !== undefined) data[key] = value;
  return { app: SAVE_FILE_APP, version: SAVE_FILE_VERSION, savedAt: savedAt.toISOString(), data };
}

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * Read an untrusted backup file. Returns what can be restored (nothing is applied yet: call each
 * entry's `apply`, or `applySaveFile`), or a friendly reason the file can't be used.
 */
export function parseSaveFile(json: unknown, sections: readonly AnySaveSection[]): ParsedSaveFile {
  const bad = (reason: string): ParsedSaveFile => ({ ok: false, reason });
  if (typeof json !== 'string' || json.trim() === '') return bad('That file is empty.');
  if (json.length > MAX_SAVE_FILE_LENGTH) return bad('That file is too big to be a Blockygotchi backup.');
  let file: unknown;
  try {
    file = JSON.parse(json);
  } catch {
    return bad('That file isn’t a Blockygotchi backup.');
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) return bad('That file isn’t a Blockygotchi backup.');
  const f = file as Record<string, unknown>;
  if (f.app !== SAVE_FILE_APP) return bad('That file isn’t a Blockygotchi backup.');
  if (typeof f.version !== 'number' || !Number.isInteger(f.version) || f.version < 1) {
    return bad('That backup file is damaged.');
  }
  if (f.version > SAVE_FILE_VERSION) return bad('That backup was made by a newer version of Blockygotchi.');
  const data = f.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return bad('That backup file is damaged.');

  const known = new Set(sections.map((s) => s.key));
  const entries: ParsedSaveEntry[] = [];
  const skipped: string[] = [];
  for (const section of sections) {
    if (!own(data, section.key)) continue;
    let value: unknown = null;
    try {
      value = section.parse((data as Record<string, unknown>)[section.key]);
    } catch {
      value = null;
    }
    if (value === null || value === undefined) {
      skipped.push(section.label);
      continue;
    }
    entries.push({
      key: section.key,
      label: section.label,
      summary: section.describe?.(value) ?? section.label,
      apply: () => section.write(value),
    });
  }
  if (entries.length === 0) return bad('There’s nothing in that backup this version can restore.');
  const savedAt = typeof f.savedAt === 'string' && !Number.isNaN(Date.parse(f.savedAt)) ? new Date(f.savedAt).toISOString() : null;
  return { ok: true, savedAt, entries, skipped, unknown: Object.keys(data).filter((k) => !known.has(k)) };
}

/** Apply everything a parsed file holds. One failing section doesn't stop the rest; returns the labels that failed. */
export function applySaveFile(parsed: Extract<ParsedSaveFile, { ok: true }>): string[] {
  const failed: string[] = [];
  for (const entry of parsed.entries) {
    try {
      entry.apply();
    } catch {
      failed.push(entry.label);
    }
  }
  return failed;
}

/** The set of sections that make up a backup. Register once at startup; order is the summary order. */
export function createSaveRegistry() {
  const sections: AnySaveSection[] = [];
  return {
    /** Add a section (a second section with the same key replaces the first). */
    register<T>(section: SaveSection<T>): void {
      const at = sections.findIndex((s) => s.key === section.key);
      if (at >= 0) sections[at] = section;
      else sections.push(section);
    },
    sections: (): readonly AnySaveSection[] => sections,
    /** The backup as JSON text, read from the live app now. */
    build(savedAt: Date = new Date()): string {
      const parts: Record<string, unknown> = {};
      for (const s of sections) {
        try {
          parts[s.key] = s.read();
        } catch {
          /* a broken section must not block the rest of the backup */
        }
      }
      return JSON.stringify(buildSaveFile(parts, savedAt), null, 2);
    },
    parse: (json: unknown): ParsedSaveFile => parseSaveFile(json, sections),
  };
}

export type SaveRegistry = ReturnType<typeof createSaveRegistry>;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `blockygotchi-backup-YYYYMMDD-HHMMSS.json` in the user's local time. */
export function backupFileName(date: Date): string {
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${SAVE_FILE_APP}-backup-${day}-${time}.json`;
}
