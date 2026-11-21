/**
 * World residents: which skins live in the home village (the "roster").
 *
 * A roster is a list of skin paths, at most `cap` long, and always describes the whole world,
 * the primary (selected / main) character included. `null` means the user never chose: the crowd
 * then runs as it always has (random visitors from every skin).
 *
 * A roster entry is a bundled skin's path or, for one of the user's own outfits
 * (domain/outfits.ts), the key `outfit:<id>`. The crowd controller turns that key into the
 * outfit's image and arm model when the character appears.
 *
 * Pure rules only; state/residentsStore.ts persists the roster and
 * controllers/crowdController.ts applies it to the live crowd.
 */

export const OUTFIT_KEY_PREFIX = 'outfit:';

/** Roster entry for the outfit with this id. */
export function outfitRosterKey(id: string): string {
  return `${OUTFIT_KEY_PREFIX}${id}`;
}

export function isOutfitKey(skin: string | null | undefined): skin is string {
  return typeof skin === 'string' && skin.startsWith(OUTFIT_KEY_PREFIX) && skin.length > OUTFIT_KEY_PREFIX.length;
}

/** The outfit id a roster entry names, or null for a bundled skin. */
export function outfitIdFromKey(skin: string | null | undefined): string | null {
  return isOutfitKey(skin) ? skin.slice(OUTFIT_KEY_PREFIX.length) : null;
}

/** Keep only a well-formed roster from untrusted JSON. null = nothing (usable) stored. */
export function parseResidents(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return null;
    return unique(data.filter((v): v is string => typeof v === 'string' && v.length > 0));
  } catch {
    return null;
  }
}

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/**
 * Drop skins that don't exist (any more) and duplicates, then trim to `cap`.
 * `keep` (the primary's skin) goes first so trimming never drops it; it is ignored if it isn't
 * an available skin (e.g. a design that was never saved to the skin list).
 */
export function normalizeRoster(
  roster: readonly string[],
  available: readonly string[],
  cap: number,
  keep: string | null = null
): string[] {
  const known = new Set(available);
  const base = keep != null && known.has(keep) ? [keep, ...roster] : roster;
  return unique(base.filter((s) => known.has(s))).slice(0, Math.max(0, cap));
}

/**
 * The roster the Residents panel shows and edits: the stored one, or (nothing stored yet) whoever
 * is in the world right now, so the first toggle starts from what the user sees.
 */
export function effectiveRoster(
  stored: readonly string[] | null,
  present: readonly string[],
  available: readonly string[],
  cap: number,
  keep: string | null = null
): string[] {
  return normalizeRoster(stored ?? present, available, cap, keep);
}

export type ToggleOutcome = 'added' | 'removed' | 'full' | 'locked' | 'unknown';

/**
 * Flip one skin. Refused (roster returned unchanged) when the skin doesn't exist ('unknown'),
 * is the primary's ('locked': the main character can't be sent away) or the village is at its
 * cap ('full').
 */
export function toggleResident(
  roster: readonly string[],
  skin: string,
  opts: { available: readonly string[]; cap: number; locked?: string | null }
): { roster: string[]; outcome: ToggleOutcome } {
  const current = [...roster];
  if (!opts.available.includes(skin)) return { roster: current, outcome: 'unknown' };
  if (current.includes(skin)) {
    if (skin === opts.locked) return { roster: current, outcome: 'locked' };
    return { roster: current.filter((s) => s !== skin), outcome: 'removed' };
  }
  if (current.length >= opts.cap) return { roster: current, outcome: 'full' };
  return { roster: [...current, skin], outcome: 'added' };
}

export type AddResidentOutcome = 'added' | 'already' | 'full' | 'unknown';

/**
 * Move one skin in (the creator's "Send to village"). Starts from the stored roster or, with
 * nothing stored, from whoever is in the world right now, like the Residents panel does.
 * Refused (outcome says why, `roster` is that starting roster) when the skin doesn't exist or
 * the village is at its cap; 'already' when it lives there.
 */
export function addResident(
  stored: readonly string[] | null,
  present: readonly string[],
  available: readonly string[],
  cap: number,
  skin: string
): { roster: string[]; outcome: AddResidentOutcome } {
  const roster = normalizeRoster(stored ?? present, available, cap);
  if (!available.includes(skin)) return { roster, outcome: 'unknown' };
  if (roster.includes(skin)) return { roster, outcome: 'already' };
  if (roster.length >= cap) return { roster, outcome: 'full' };
  return { roster: [...roster, skin], outcome: 'added' };
}

/** "Everyone": keep who is there and fill the free places in list order, up to the cap. */
export function fillRoster(roster: readonly string[], available: readonly string[], cap: number): string[] {
  return normalizeRoster([...roster, ...available], available, cap);
}

/**
 * "Surprise me": a random group of 2..cap skins (fewer if there aren't that many). `keep` (the
 * primary's skin) is always part of it. `random` returns [0, 1) like Math.random.
 */
export function randomRoster(
  available: readonly string[],
  cap: number,
  random: () => number,
  keep: string | null = null
): string[] {
  const max = Math.min(Math.max(0, cap), available.length);
  if (max === 0) return [];
  const min = Math.min(2, max);
  const size = min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const pool = [...available];
  // Fisher-Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const pick = keep != null && available.includes(keep) ? [keep, ...pool.filter((s) => s !== keep)] : pool;
  return pick.slice(0, size);
}

/** Skins the crowd should wear: the roster minus the primary's (that one is already in the world). */
export function crowdSkinsFor(roster: readonly string[], primarySkin: string | null): string[] {
  return unique(roster.filter((s) => s !== primarySkin));
}

/**
 * A skin that isn't in the skin list: a design the user edited and never saved (e.g. a former
 * main character back in the crowd). The roster can't name it, so it is never sent home for
 * "not being on the list" and doesn't take a resident's place.
 * An outfit key is never custom: the roster can name it, so an outfit that was deleted (its key
 * is no longer available) is sent home like any other skin that left the roster.
 */
export function isCustomSkin(skin: string | null, available: readonly string[]): skin is string {
  return skin != null && !isOutfitKey(skin) && !available.includes(skin);
}

/**
 * Current crowd vs the skins it should wear. One character per wanted skin stays (the first
 * found); everyone else goes; wanted skins nobody wears are added. Characters whose skin isn't
 * in `available` (custom designs, see isCustomSkin) always stay; without `available` every skin
 * is taken to be a listed one.
 */
export function diffResidents(
  current: readonly { id: string; skin: string | null }[],
  desired: readonly string[],
  available?: readonly string[]
): { toAdd: string[]; toRemove: string[] } {
  const wanted = new Set(desired);
  const seen = new Set<string>();
  const toRemove: string[] = [];
  for (const c of current) {
    if (available && isCustomSkin(c.skin, available)) continue;
    if (c.skin != null && wanted.has(c.skin) && !seen.has(c.skin)) seen.add(c.skin);
    else toRemove.push(c.id);
  }
  return { toAdd: unique(desired).filter((s) => !seen.has(s)), toRemove };
}
