/**
 * The backup file's built-in sections (see domain/saveFile.ts): combos, village residents, time of
 * day, studio dancers and studio backdrop. Each one reads from and writes to its live store, so a
 * restore updates the app without a reload. Values from a file are checked with the same rules the
 * stores use for localStorage.
 */
import type { AnySaveSection, SaveSection } from '../domain/saveFile';
import type { SavedSequence } from '../domain/sequences';
import { MAX_IMPORTED_SEQUENCES, sanitizeSequence } from '../domain/sequenceImport';
import { normalizeRoster, parseResidents } from '../domain/residents';
import { normalizeGroupDance, type GroupDanceSettings } from '../domain/groupDance';
import { parseBackdropSettings, type BackdropSettings } from '../lib/studioBackdrop';
import type { SavedSequencesStore } from './savedSequences';
import type { ResidentsStore } from './residentsStore';
import { parseTimeOfDaySettings, type TimeOfDaySettings, type TimeOfDayStore } from './timeOfDay';
import type { GroupDanceStore } from './groupDanceStore';
import type { StudioBackdropStore } from './studioBackdrop';

const MAX_RESIDENTS_IN_FILE = 100;
const MAX_SKIN_PATH_LENGTH = 200;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Combos from a file: every well-formed one, cleaned; null if the value isn't a list at all. */
export function parseCombosSection(raw: unknown): SavedSequence[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SavedSequence[] = [];
  for (const item of raw.slice(0, MAX_IMPORTED_SEQUENCES)) {
    const seq = sanitizeSequence(item);
    if (seq) out.push(seq);
  }
  return out.length > 0 ? out : null;
}

/** A roster from a file: site-relative skin paths only (never another site's address). */
export function parseResidentsSection(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const roster = parseResidents(JSON.stringify(raw.slice(0, MAX_RESIDENTS_IN_FILE)));
  if (!roster) return null;
  return roster.filter(
    (p) =>
      p.length <= MAX_SKIN_PATH_LENGTH &&
      // A bundled skin path, or one of the user's own outfits (restored by the 'outfits' section).
      (/^\/(?![/\\])[^\\\u0000-\u001f]*$/.test(p) || /^outfit:[a-z0-9][a-z0-9-]{0,39}$/.test(p))
  );
}

export type CoreSaveStores = {
  savedSequences: Pick<SavedSequencesStore, 'list' | 'importMany'>;
  residents: Pick<ResidentsStore, 'get' | 'set'>;
  timeOfDay: Pick<TimeOfDayStore, 'get' | 'setTime' | 'setAuto'>;
  groupDance: Pick<GroupDanceStore, 'get' | 'set'>;
  backdrop: Pick<StudioBackdropStore, 'get' | 'setBackdrop' | 'setCustomColor' | 'setFloor'>;
  /** Skins that exist right now and the village's size limit, to fit a restored roster to this app. */
  getAvailableSkins?: () => readonly string[];
  residentsCap?: number;
};

/** The built-in sections, in the order the restore summary lists them. */
export function createCoreSaveSections(stores: CoreSaveStores): AnySaveSection[] {
  const combos: SaveSection<SavedSequence[]> = {
    key: 'combos',
    label: 'Combos',
    read: () => (stores.savedSequences.list().length > 0 ? [...stores.savedSequences.list()] : undefined),
    parse: parseCombosSection,
    // Merge: the user's combos stay; ones they already have are skipped.
    write: (list) => void stores.savedSequences.importMany(list),
    describe: (list) => `${plural(list.length, 'combo', 'combos')} (added to yours)`,
  };
  const residents: SaveSection<string[]> = {
    key: 'residents',
    label: 'Village residents',
    read: () => {
      const roster = stores.residents.get();
      return roster ? [...roster] : undefined;
    },
    parse: parseResidentsSection,
    write: (roster) => {
      const available = stores.getAvailableSkins?.() ?? [];
      // With no skin list (it failed to load) keep the roster as is; the store prunes it on the next load.
      stores.residents.set(
        available.length > 0 ? normalizeRoster(roster, available, stores.residentsCap ?? roster.length) : roster
      );
    },
    describe: (roster) => `Village residents: ${roster.length} (replaces yours)`,
  };
  const timeOfDay: SaveSection<TimeOfDaySettings> = {
    key: 'timeOfDay',
    label: 'Time of day',
    read: () => ({ ...stores.timeOfDay.get() }),
    parse: (raw) => (isObject(raw) ? parseTimeOfDaySettings(JSON.stringify(raw)) : null),
    write: (v) => {
      stores.timeOfDay.setAuto(v.auto);
      stores.timeOfDay.setTime(v.time);
    },
  };
  const groupDance: SaveSection<GroupDanceSettings> = {
    key: 'groupDance',
    label: 'Studio dancers',
    read: () => ({ ...stores.groupDance.get() }),
    parse: (raw) => (isObject(raw) ? normalizeGroupDance(raw) : null),
    write: (v) => stores.groupDance.set(v),
  };
  const backdrop: SaveSection<BackdropSettings> = {
    key: 'backdrop',
    label: 'Studio backdrop',
    read: () => ({ ...stores.backdrop.get() }),
    parse: (raw) => (isObject(raw) ? parseBackdropSettings(JSON.stringify(raw)) : null),
    write: (v) => {
      // setCustomColor also selects the custom backdrop, so pick the real one after it.
      stores.backdrop.setCustomColor(v.customColor);
      stores.backdrop.setBackdrop(v.id);
      stores.backdrop.setFloor(v.floor);
    },
  };
  return [combos, residents, timeOfDay, groupDance, backdrop];
}
