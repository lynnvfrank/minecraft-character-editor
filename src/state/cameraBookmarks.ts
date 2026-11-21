/**
 * Saved camera spots for the home view's photo mode and the dance studio, persisted to
 * localStorage. Subscribers are notified after every change. The rules (validation, caps, naming)
 * are lib/cameraBookmarks.ts.
 */
import { createSubscribable, type Unsubscribe } from '../lib/subscribable';
import {
  addBookmark,
  describeBookmarks,
  emptyBookmarks,
  parseCameraBookmarks,
  parseCameraBookmarksJson,
  removeBookmark,
  renameBookmark,
  type BookmarkPlace,
  type CameraBookmark,
  type CameraBookmarks,
  type CameraPose,
} from '../lib/cameraBookmarks';

export const CAMERA_BOOKMARKS_KEY = 'camera.bookmarks';

/** Minimal Storage shape so tests can pass a Map-backed fake (Node has no localStorage). */
export type KeyValueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function createCameraBookmarksStore(storage: KeyValueStorage | null) {
  const read = (): string | null => {
    try {
      return storage?.getItem(CAMERA_BOOKMARKS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let all: CameraBookmarks = parseCameraBookmarksJson(read());
  const slice = createSubscribable();

  function commit(next: CameraBookmarks): void {
    all = next;
    try {
      storage?.setItem(CAMERA_BOOKMARKS_KEY, JSON.stringify(all));
    } catch {
      /* storage full or blocked: keep the in-memory value for this visit */
    }
    slice.notify();
  }

  /** Swap one place's list; false when nothing changed. */
  function setList(place: BookmarkPlace, next: readonly CameraBookmark[]): boolean {
    if (next === all[place]) return false;
    commit({ ...all, [place]: [...next] });
    return true;
  }

  return {
    get: (): Readonly<CameraBookmarks> => all,
    list: (place: BookmarkPlace): readonly CameraBookmark[] => all[place],
    find: (place: BookmarkPlace, id: string): CameraBookmark | undefined => all[place].find((b) => b.id === id),
    /** Save a pose as "Spot N". Null when the place is full or the pose is unusable. */
    add(place: BookmarkPlace, pose: CameraPose): CameraBookmark | null {
      return setList(place, addBookmark(all[place], pose)) ? all[place][all[place].length - 1]! : null;
    },
    rename: (place: BookmarkPlace, id: string, name: string): boolean =>
      setList(place, renameBookmark(all[place], id, name)),
    remove: (place: BookmarkPlace, id: string): boolean => setList(place, removeBookmark(all[place], id)),
    /** Replace everything (restoring a backup). The value is checked again on the way in. */
    replaceAll(value: unknown): void {
      commit(parseCameraBookmarks(value) ?? emptyBookmarks());
    },
    subscribe: (listener: () => void): Unsubscribe => slice.subscribe(listener),
  };
}

export type CameraBookmarksStore = ReturnType<typeof createCameraBookmarksStore>;

/**
 * The store's section in the backup file. Shaped for `saveRegistry.register`
 * (domain/saveFile.ts's SaveSection, described here by shape so state stays below domain's users).
 */
export function cameraBookmarksSaveSection(store: CameraBookmarksStore) {
  return {
    key: 'cameraBookmarks',
    label: 'Camera spots',
    read: (): CameraBookmarks | undefined => {
      const all = store.get();
      return all.home.length + all.studio.length > 0 ? { home: [...all.home], studio: [...all.studio] } : undefined;
    },
    parse: (raw: unknown): CameraBookmarks | null => {
      const parsed = parseCameraBookmarks(raw);
      return parsed && parsed.home.length + parsed.studio.length > 0 ? parsed : null;
    },
    write: (value: CameraBookmarks): void => store.replaceAll(value),
    describe: (value: CameraBookmarks): string => describeBookmarks(value),
  };
}
