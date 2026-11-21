/**
 * Saved feature tags, one map per skin, kept in localStorage.
 *
 * Skins are keyed by a hash of their 64x64 pixels (skinPixelKey), so tags follow the picture
 * rather than its file name: the same skin picked from the Wardrobe, loaded from a file or
 * restored by undo finds its tags again. A skin that is repainted gets a new key; its tags are
 * carried over by the panel (see featureTagsPanel.ts).
 */
import { decodeFeatureMap, encodeFeatureMap, type FeatureMap } from '../styler/featureMap';

const STORAGE_KEY = 'blockygotchi.featureTags.v1';
const MAX_SKINS = 500;

type StoredTags = Record<string, { m: string; t: number }>;

/** Stable key for a 64x64 skin (FNV-1a over its RGBA bytes). Same hash as Make it me's hair fixes. */
export function skinPixelKey(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function readStore(): StoredTags {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as StoredTags;
  } catch {
    return {};
  }
}

function writeStore(store: StoredTags): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set<(key: string) => void>();

export function onFeatureTagsSaved(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The saved tags for a skin, or null if it has none (or they don't decode). */
export function loadFeatureTags(key: string): FeatureMap | null {
  return decodeFeatureMap(readStore()[key]?.m);
}

export function hasFeatureTags(key: string): boolean {
  return key in readStore();
}

/** Save (or with null, forget) a skin's tags. Oldest skins drop off past MAX_SKINS. */
export function saveFeatureTags(key: string, map: FeatureMap | null): boolean {
  const store = readStore();
  delete store[key];
  if (map) store[key] = { m: encodeFeatureMap(map), t: Date.now() };
  const keys = Object.keys(store).sort((a, b) => store[a]!.t - store[b]!.t);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SKINS))) delete store[k];
  const ok = writeStore(store);
  listeners.forEach((fn) => fn(key));
  return ok;
}

export function countTaggedSkins(): number {
  return Object.keys(readStore()).length;
}

/** All saved tags as a JSON file body (for sharing tag work or shipping it with the wardrobe). */
export function exportFeatureTags(): string {
  const store = readStore();
  const skins: Record<string, string> = {};
  for (const [k, v] of Object.entries(store)) skins[k] = v.m;
  return JSON.stringify({ kind: 'blockygotchi.featureTags', version: 1, skins }, null, 1);
}

/** Merge a file from exportFeatureTags; returns how many skins were added or updated, or null if invalid. */
export function importFeatureTags(text: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const p = parsed as { kind?: unknown; skins?: unknown };
  if (!p || p.kind !== 'blockygotchi.featureTags' || !p.skins || typeof p.skins !== 'object') return null;
  const store = readStore();
  let n = 0;
  for (const [k, v] of Object.entries(p.skins as Record<string, unknown>)) {
    if (!/^[0-9a-z]{1,13}$/.test(k) || !decodeFeatureMap(v)) continue;
    store[k] = { m: v as string, t: Date.now() };
    n++;
  }
  if (!writeStore(store)) return null;
  for (const k of Object.keys(p.skins as object)) listeners.forEach((fn) => fn(k));
  return n;
}
