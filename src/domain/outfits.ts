/**
 * My outfits: skins the user made in the creator and kept.
 *
 * An outfit is a 64×64 skin PNG (as a data URL) with a label, the arm model it was made for, when
 * it was kept and a stable id. Residents name an outfit by `outfit:<id>` (see domain/residents.ts).
 *
 * Pure rules only (no DOM, no storage): strict validation of untrusted data, and add / remove /
 * rename / export / import on plain lists. state/outfitsStore.ts persists the list.
 */
import type { ArmModel } from '../skin/armModel';

export const OUTFIT_URL_PREFIX = 'data:image/png;base64,';
/** Most outfits kept at once. */
export const MAX_OUTFITS = 24;
/** Longest data URL accepted (a 64×64 RGBA PNG is a few KB; this is roughly 30 KB of image). */
export const MAX_OUTFIT_URL_LENGTH = 40_000;
/** All data URLs together (keeps the list far below the localStorage quota). */
export const MAX_OUTFITS_TOTAL_LENGTH = 600_000;
export const MAX_OUTFIT_LABEL_LENGTH = 32;
const SKIN_SIZE = 64;

export type Outfit = {
  id: string;
  label: string;
  /** `data:image/png;base64,...` of a 64×64 skin. */
  dataUrl: string;
  armModel: ArmModel;
  /** Milliseconds since the epoch. */
  createdAt: number;
};

/** The shape exportOutfits writes and importOutfits / parseOutfits read. */
export type OutfitsFile = { version: 1; outfits: Outfit[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Width and height from a PNG's header, read from the start of its base64 text. null if it isn't a PNG. */
function pngSize(base64: string): { width: number; height: number } | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 32)); // 24 bytes: signature, IHDR length + name, width, height
  } catch {
    return null;
  }
  if (head.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => head.charCodeAt(i) === b)) return null;
  if (head.slice(12, 16) !== 'IHDR') return null;
  const u32 = (at: number) =>
    ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/** A base64 PNG data URL of a 64×64 image, within the size cap, and nothing else. */
export function isOutfitDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_OUTFIT_URL_LENGTH || !value.startsWith(OUTFIT_URL_PREFIX)) return false;
  const base64 = value.slice(OUTFIT_URL_PREFIX.length);
  if (base64.length < 32 || base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) return false;
  const size = pngSize(base64);
  return size != null && size.width === SKIN_SIZE && size.height === SKIN_SIZE;
}

export function isOutfitId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Control characters, zero-width characters and text-direction overrides: never part of a label. */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Plain one-line text of at most MAX_OUTFIT_LABEL_LENGTH characters; `fallback` when nothing is left. */
export function cleanOutfitLabel(value: unknown, fallback = 'My outfit'): string {
  if (typeof value !== 'string') return fallback;
  const text = Array.from(value, (ch) => (isInvisible(ch.codePointAt(0)!) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_OUTFIT_LABEL_LENGTH)
    .trim();
  return text || fallback;
}

/** One outfit from untrusted data, or null if any required part is wrong. */
export function validateOutfit(value: unknown): Outfit | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isOutfitId(v.id) || !isOutfitDataUrl(v.dataUrl)) return null;
  const createdAt = typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) && v.createdAt >= 0 ? v.createdAt : 0;
  return {
    id: v.id,
    label: cleanOutfitLabel(v.label),
    dataUrl: v.dataUrl,
    armModel: v.armModel === 'slim' ? 'slim' : 'classic',
    createdAt,
  };
}

const totalLength = (list: readonly Outfit[]) => list.reduce((sum, o) => sum + o.dataUrl.length, 0);

/** Whether one more outfit of this size fits under the count and size caps. */
function hasRoom(list: readonly Outfit[], dataUrl: string): boolean {
  return list.length < MAX_OUTFITS && totalLength(list) + dataUrl.length <= MAX_OUTFITS_TOTAL_LENGTH;
}

/**
 * The valid outfits in `value` (an exported file or a bare array), in order: no repeated ids or
 * images, and no more than the caps allow. Anything else is dropped.
 */
export function normalizeOutfits(value: unknown): Outfit[] {
  const raw =
    Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as { outfits?: unknown }).outfits)
        ? (value as { outfits: unknown[] }).outfits
        : [];
  const out: Outfit[] = [];
  const ids = new Set<string>();
  const images = new Set<string>();
  for (const item of raw) {
    const outfit = validateOutfit(item);
    if (!outfit || ids.has(outfit.id) || images.has(outfit.dataUrl)) continue;
    if (!hasRoom(out, outfit.dataUrl)) continue;
    ids.add(outfit.id);
    images.add(outfit.dataUrl);
    out.push(outfit);
  }
  return out;
}

/** Outfits from untrusted JSON (localStorage); an empty list when nothing usable is stored. */
export function parseOutfits(json: string | null): Outfit[] {
  if (!json) return [];
  try {
    return normalizeOutfits(JSON.parse(json));
  } catch {
    return [];
  }
}

export type AddOutfitOutcome = 'added' | 'exists' | 'full' | 'invalid';

/** "My outfit N" with the lowest N no other outfit uses. */
function nextLabel(list: readonly Outfit[]): string {
  const used = new Set(list.map((o) => o.label));
  for (let n = list.length + 1; ; n++) {
    const label = `My outfit ${n}`;
    if (!used.has(label)) return label;
  }
}

/**
 * Keep a skin. The same image twice is one outfit ('exists', the first one is returned).
 * Refused when the image isn't a 64×64 PNG data URL ('invalid') or there is no room ('full').
 * `meta.id` must be new; `meta.now` is the creation time.
 */
export function addOutfit(
  list: readonly Outfit[],
  input: { dataUrl: string; armModel: ArmModel; label?: string },
  meta: { id: string; now: number }
): { list: Outfit[]; outfit: Outfit | null; outcome: AddOutfitOutcome } {
  const current = [...list];
  if (!isOutfitDataUrl(input.dataUrl) || !isOutfitId(meta.id)) return { list: current, outfit: null, outcome: 'invalid' };
  const same = current.find((o) => o.dataUrl === input.dataUrl);
  if (same) return { list: current, outfit: same, outcome: 'exists' };
  if (current.some((o) => o.id === meta.id)) return { list: current, outfit: null, outcome: 'invalid' };
  if (!hasRoom(current, input.dataUrl)) return { list: current, outfit: null, outcome: 'full' };
  const outfit: Outfit = {
    id: meta.id,
    label: cleanOutfitLabel(input.label, nextLabel(current)),
    dataUrl: input.dataUrl,
    armModel: input.armModel === 'slim' ? 'slim' : 'classic',
    createdAt: meta.now,
  };
  return { list: [...current, outfit], outfit, outcome: 'added' };
}

/** Without outfit `id` (the same list contents if there is no such outfit). */
export function removeOutfit(list: readonly Outfit[], id: string): Outfit[] {
  return list.filter((o) => o.id !== id);
}

/** With outfit `id` renamed; an empty or junk label leaves the name as it was. */
export function renameOutfit(list: readonly Outfit[], id: string, label: string): Outfit[] {
  return list.map((o) => (o.id === id ? { ...o, label: cleanOutfitLabel(label, o.label) } : o));
}

/** A plain, JSON-ready copy of the list (for a save file). */
export function exportOutfits(list: readonly Outfit[]): OutfitsFile {
  return { version: 1, outfits: list.map((o) => ({ ...o })) };
}

/**
 * Merge outfits from untrusted data (an exported file) into `list`. What is already there stays;
 * new ones are appended while there is room. Outfits whose id or image is already present are skipped.
 */
export function importOutfits(list: readonly Outfit[], data: unknown): { list: Outfit[]; added: number } {
  const merged = normalizeOutfits([...list, ...normalizeOutfits(data)]);
  return { list: merged, added: Math.max(0, merged.length - list.length) };
}

/** Short message for the user after trying to keep an outfit. `persisted` false = storage refused it. */
export function outfitSaveMessage(outcome: AddOutfitOutcome, persisted = true): string {
  switch (outcome) {
    case 'added':
      return persisted
        ? 'Kept in My outfits.'
        : "Kept for this visit only. Your browser couldn't save it (storage may be full).";
    case 'exists':
      return 'Already in My outfits.';
    case 'full':
      return `My outfits is full (${MAX_OUTFITS}). Remove one from Residents to make room.`;
    default:
      return "That skin couldn't be kept. Try again after a change.";
  }
}
