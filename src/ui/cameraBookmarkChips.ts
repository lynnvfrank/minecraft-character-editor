/**
 * A row of camera bookmark chips ("spots"): click to glide there, double-click to rename, ✕ to
 * delete, and "+ Save spot" for where the camera is now. Used in the home view's photo bar and
 * the studio's "Camera moves" section; each passes its own place ('home' or 'studio').
 * The store is state/cameraBookmarks.ts; the glide is the caller's (ui can't reach the camera).
 */
import { MAX_BOOKMARKS_PER_PLACE, type BookmarkPlace, type CameraBookmark, type CameraPose } from '../lib/cameraBookmarks';
import type { CameraBookmarksStore } from '../state/cameraBookmarks';

export type BookmarkChipsDeps = {
  store: CameraBookmarksStore;
  place: BookmarkPlace;
  /** Where the camera is now. */
  getPose: () => CameraPose;
  /** Glide to a saved spot. */
  goTo: (bookmark: CameraBookmark) => void;
  className?: string;
};

function button(className: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  return b;
}

export function createBookmarkChips(deps: BookmarkChipsDeps) {
  const { store, place } = deps;
  const root = document.createElement('div');
  root.className = `cam-chips${deps.className ? ` ${deps.className}` : ''}`;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Camera spots');
  let editing: string | null = null;

  function startRename(b: CameraBookmark, chip: HTMLElement): void {
    editing = b.id;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cam-chip-input';
    input.value = b.name;
    input.maxLength = 20;
    input.setAttribute('aria-label', 'Spot name');
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      editing = null;
      if (!save || !store.rename(place, b.id, input.value)) render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Escape cancels the rename, not photo mode; WASD types
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    chip.replaceWith(input);
    input.focus();
    input.select();
  }

  function render(): void {
    if (editing) return;
    root.replaceChildren();
    for (const b of store.list(place)) {
      const wrap = document.createElement('span');
      wrap.className = 'cam-chip';
      const go = button('cam-chip-go', b.name);
      go.title = `Glide to ${b.name} (double-click to rename)`;
      go.addEventListener('click', (e) => {
        deps.goTo(b);
        if (e.detail > 0) go.blur();
      });
      go.addEventListener('dblclick', () => startRename(b, wrap));
      const del = button('cam-chip-del', '✕');
      del.title = `Forget ${b.name}`;
      del.setAttribute('aria-label', `Delete ${b.name}`);
      del.addEventListener('click', () => store.remove(place, b.id));
      wrap.append(go, del);
      root.append(wrap);
    }
    const full = store.list(place).length >= MAX_BOOKMARKS_PER_PLACE;
    const add = button('cam-chip-add', '+ Save spot');
    add.disabled = full;
    add.title = full ? `Up to ${MAX_BOOKMARKS_PER_PLACE} spots. Delete one to save another` : 'Remember this camera spot';
    add.addEventListener('click', (e) => {
      store.add(place, deps.getPose());
      if (e.detail > 0) add.blur();
    });
    root.append(add);
  }

  const unsubscribe = store.subscribe(render);
  render();
  return {
    root,
    dispose: () => {
      unsubscribe();
      root.remove();
    },
  };
}
