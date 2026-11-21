/**
 * Camera bookmarks ("spots"): named camera poses the user saves in the home view's photo mode and
 * in the dance studio, then glides back to. Pure (no DOM, no Three), tested in
 * cameraBookmarks.test.ts. The store is state/cameraBookmarks.ts.
 */
import { easeInOut, lerpOrbit, orbitFromOffset, orbitPosition, type Point3 } from './turntable';

/** Where a camera is, what it looks at and its lens (vertical field of view, degrees). */
export type CameraPose = { position: Point3; target: Point3; fov: number };
export type CameraBookmark = CameraPose & { id: string; name: string };

/** Each place keeps its own list: a studio shot makes no sense in the village. */
export type BookmarkPlace = 'home' | 'studio';
export const BOOKMARK_PLACES: readonly BookmarkPlace[] = ['home', 'studio'];
export type CameraBookmarks = Record<BookmarkPlace, CameraBookmark[]>;

export const MAX_BOOKMARKS_PER_PLACE = 8;
export const MAX_BOOKMARK_NAME_LENGTH = 20;
/** Sanity limits for a saved pose (world units / degrees). */
export const MAX_POSE_COORDINATE = 500;
export const MIN_POSE_DISTANCE = 0.2;
export const MAX_POSE_DISTANCE = 200;
export const MIN_POSE_FOV = 10;
export const MAX_POSE_FOV = 120;
export const DEFAULT_POSE_FOV = 45;
/** Seconds a glide to a bookmark takes. */
export const BOOKMARK_GLIDE_SEC = 0.9;

export function emptyBookmarks(): CameraBookmarks {
  return { home: [], studio: [] };
}

function parsePoint(raw: unknown): Point3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const out = { x: p.x, y: p.y, z: p.z };
  for (const v of Object.values(out)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_POSE_COORDINATE) return null;
  }
  return out as Point3;
}

/** A usable pose from untrusted data, or null: finite numbers, a sane distance, the lens clamped. */
export function parsePose(raw: unknown): CameraPose | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const position = parsePoint(d.position);
  const target = parsePoint(d.target);
  if (!position || !target) return null;
  const distance = Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
  if (distance < MIN_POSE_DISTANCE || distance > MAX_POSE_DISTANCE) return null;
  const fov =
    typeof d.fov === 'number' && Number.isFinite(d.fov)
      ? Math.min(MAX_POSE_FOV, Math.max(MIN_POSE_FOV, d.fov))
      : DEFAULT_POSE_FOV;
  return { position, target, fov };
}

/** Trimmed, single-spaced and cut to length; '' when nothing is left. */
export function cleanBookmarkName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_BOOKMARK_NAME_LENGTH).trim();
}

/** "Spot N" with the smallest N no bookmark in the list is using. */
export function defaultBookmarkName(list: readonly { name: string }[]): string {
  const taken = new Set(list.map((b) => b.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `Spot ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function nextId(list: readonly { id: string }[]): string {
  const taken = new Set(list.map((b) => b.id));
  for (let n = 1; ; n++) {
    if (!taken.has(`spot-${n}`)) return `spot-${n}`;
  }
}

function parseList(raw: unknown): CameraBookmark[] {
  if (!Array.isArray(raw)) return [];
  const out: CameraBookmark[] = [];
  for (const item of raw) {
    if (out.length >= MAX_BOOKMARKS_PER_PLACE) break;
    const pose = parsePose(item);
    if (!pose) continue;
    const d = item as Record<string, unknown>;
    const rawId = d.id;
    const id =
      typeof rawId === 'string' && /^[\w-]{1,24}$/.test(rawId) && !out.some((b) => b.id === rawId) ? rawId : nextId(out);
    out.push({ id, name: cleanBookmarkName(d.name) || defaultBookmarkName(out), ...pose });
  }
  return out;
}

/**
 * Bookmarks from an untrusted value (parsed storage JSON or a backup file's section). Bad entries
 * are dropped, lists are capped. Null when the value is not a bookmarks object at all.
 */
export function parseCameraBookmarks(raw: unknown): CameraBookmarks | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  return { home: parseList(d.home), studio: parseList(d.studio) };
}

/** Same, from a JSON string; anything malformed is an empty set. */
export function parseCameraBookmarksJson(json: string | null): CameraBookmarks {
  if (!json) return emptyBookmarks();
  try {
    return parseCameraBookmarks(JSON.parse(json)) ?? emptyBookmarks();
  } catch {
    return emptyBookmarks();
  }
}

export function canAddBookmark(list: readonly CameraBookmark[]): boolean {
  return list.length < MAX_BOOKMARKS_PER_PLACE;
}

/** The list with a new bookmark at the end (same list when it is full or the pose is unusable). */
export function addBookmark(list: readonly CameraBookmark[], pose: CameraPose, name?: string): readonly CameraBookmark[] {
  const clean = parsePose(pose);
  if (!clean || !canAddBookmark(list)) return list;
  return [...list, { id: nextId(list), name: cleanBookmarkName(name) || defaultBookmarkName(list), ...clean }];
}

/** The list with one bookmark renamed (same list for an unknown id, an empty name or the same name). */
export function renameBookmark(list: readonly CameraBookmark[], id: string, name: string): readonly CameraBookmark[] {
  const clean = cleanBookmarkName(name);
  const found = list.find((b) => b.id === id);
  if (!clean || !found || found.name === clean) return list;
  return list.map((b) => (b.id === id ? { ...b, name: clean } : b));
}

export function removeBookmark(list: readonly CameraBookmark[], id: string): readonly CameraBookmark[] {
  return list.some((b) => b.id === id) ? list.filter((b) => b.id !== id) : list;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The pose a fraction `t` (0 to 1) of the way from `a` to `b`: the look-at point slides in a
 * straight line while the camera swings around it the short way (an orbit lerp, like the studio's
 * framing moves), so a move between two sides of a character goes around it, not through it.
 */
export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const k = Math.min(1, Math.max(0, t));
  const target = {
    x: mix(a.target.x, b.target.x, k),
    y: mix(a.target.y, b.target.y, k),
    z: mix(a.target.z, b.target.z, k),
  };
  const from = orbitFromOffset(a.position.x - a.target.x, a.position.y - a.target.y, a.position.z - a.target.z);
  const to = orbitFromOffset(b.position.x - b.target.x, b.position.y - b.target.y, b.position.z - b.target.z);
  const orbit = lerpOrbit(from, to, k);
  return {
    target,
    position: orbitPosition(target, orbit.angle, orbit.radius, orbit.height),
    fov: mix(a.fov, b.fov, k),
  };
}

/** The pose `elapsed` seconds into an eased glide from `a` to `b`, and whether it has arrived. */
export function glidePose(
  a: CameraPose,
  b: CameraPose,
  elapsed: number,
  duration: number = BOOKMARK_GLIDE_SEC
): { pose: CameraPose; done: boolean } {
  const done = !(duration > 0) || elapsed >= duration;
  return { pose: done ? lerpPose(a, b, 1) : lerpPose(a, b, easeInOut(elapsed / duration)), done };
}

/** "1 camera spot" / "3 camera spots" for the backup summary. */
export function describeBookmarks(all: CameraBookmarks): string {
  const n = all.home.length + all.studio.length;
  return `${n} camera spot${n === 1 ? '' : 's'}`;
}
