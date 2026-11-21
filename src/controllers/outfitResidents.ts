/**
 * The user's outfits as village residents: translates between roster keys (`outfit:<id>`) and
 * what the scene works with (the skin's data URL and a rig path).
 *
 * - The Residents panel lists `entries()` (the key is the tile's identity).
 * - The crowd controller spawns from `resolve(key)` and names what a character wears with
 *   `keyOf(skin)`.
 *
 * `keyOf` remembers every outfit it has seen this visit, deleted ones included, so a character
 * still wearing a deleted outfit is recognised as that (now unlisted) outfit and sent home,
 * instead of being taken for an unsaved design that may stay.
 */
import type { Outfit } from '../domain/outfits';
import { outfitIdFromKey, outfitRosterKey } from '../domain/residents';
import { ARM_MODEL_PATHS } from '../skin/armModel';

export type OutfitResidentEntry = {
  /** Roster key, `outfit:<id>`. */
  path: string;
  label: string;
  /** The skin image; the panel shows its face. */
  face: string;
  group: 'outfits';
};

export type OutfitResidentsDeps = {
  list: () => readonly Outfit[];
  subscribe: (listener: () => void) => () => void;
};

export function createOutfitResidents(store: OutfitResidentsDeps) {
  const keyByImage = new Map<string, string>();
  const remember = () => {
    for (const o of store.list()) keyByImage.set(o.dataUrl, outfitRosterKey(o.id));
  };
  remember();
  store.subscribe(remember);

  const find = (key: string): Outfit | undefined => {
    const id = outfitIdFromKey(key);
    return id == null ? undefined : store.list().find((o) => o.id === id);
  };

  return {
    /** Roster keys of the outfits that exist now. */
    keys: (): string[] => store.list().map((o) => outfitRosterKey(o.id)),
    /** Tiles for the Residents panel, newest first. */
    entries: (): OutfitResidentEntry[] =>
      [...store.list()]
        .reverse()
        .map((o) => ({ path: outfitRosterKey(o.id), label: o.label, face: o.dataUrl, group: 'outfits' as const })),
    /** The roster key for a worn skin: an outfit's key for its image, any other skin unchanged. */
    keyOf(skin: string): string {
      remember();
      return keyByImage.get(skin) ?? skin;
    },
    /** Image and rig for an outfit key; null for a bundled skin or a deleted outfit. */
    resolve(key: string): { skin: string; modelPath: string } | null {
      const outfit = find(key);
      return outfit ? { skin: outfit.dataUrl, modelPath: ARM_MODEL_PATHS[outfit.armModel] } : null;
    },
    /** An outfit's name from its key or its image (for labels); undefined if it isn't an outfit. */
    labelOf(skinOrKey: string): string | undefined {
      return (find(skinOrKey) ?? store.list().find((o) => o.dataUrl === skinOrKey))?.label;
    },
  };
}

export type OutfitResidents = ReturnType<typeof createOutfitResidents>;
