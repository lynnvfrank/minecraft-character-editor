/**
 * Library skin tagging session: open the raw skins of the library in the 2D/3D editor and mark
 * what each pixel is (skin, hair, eyes, outfit) with the feature tag brush.
 *
 * Me and the Wardrobe cut styles out of library skins by these tags, and detection alone can't
 * tell an artist's hair from a hood, so a person tags them by eye. The session sets the user's
 * own character aside (canvas, skin path, undo history), shows library skins as they really
 * are (no Me, no outfit), steps through them with previous / next / next untagged, and puts the
 * character back exactly as it was when it ends.
 */
import type { SkinEntry } from '../domain';
import { createEl } from './dom';
import { getFeatureTagBrush, onFeatureTagBrushChanged, setFeatureTagBrush, type FeatureTagBrush } from './featureTagBrush';
import { hasFeatureTags, onFeatureTagsSaved, skinPixelKey } from './featureTagsStore';
import { ensureSource } from './me';

/** Everything about the user's character that the session borrows and gives back. */
export type CharacterSnapshot = unknown;

export type TagSessionDeps = {
  getSkins: () => readonly SkinEntry[];
  /** Set the character aside / put it back (canvas, current skin, undo history). */
  saveCharacter: () => CharacterSnapshot;
  restoreCharacter: (snapshot: CharacterSnapshot) => void;
  /** Put a library skin on the canvas as it is: no undo entry, not the character's skin. */
  showRawSkin: (path: string) => Promise<boolean>;
  getEditMode: () => string;
  setEditMode: (mode: 'style' | 'wardrobe' | '2d' | '3d') => void;
};

let deps: TagSessionDeps | null = null;
let session: {
  snapshot: CharacterSnapshot;
  returnMode: 'style' | 'wardrobe' | '2d' | '3d';
  index: number;
  brush: FeatureTagBrush;
} | null = null;
let bar: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function registerTagSession(next: TagSessionDeps): void {
  deps = next;
}

export function isTagSessionActive(): boolean {
  return session != null;
}

export function onTagSessionChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  document.body.dataset.tagSession = session ? 'on' : '';
  if (!session) delete document.body.dataset.tagSession;
  listeners.forEach((fn) => fn());
}

/** Open the library skin at `path` (or the first one) for tagging, with a brush picked. */
export async function startTagSession(path: string | null, brush: FeatureTagBrush = 'hair'): Promise<void> {
  if (!deps) return;
  const skins = deps.getSkins();
  if (!skins.length) return;
  const index = Math.max(0, path ? skins.findIndex((s) => s.path === path) : 0);
  if (!session) {
    setFeatureTagBrush(null); // put any overlay away before the character is saved
    const mode = deps.getEditMode();
    session = {
      snapshot: deps.saveCharacter(),
      returnMode: mode === 'style' || mode === 'wardrobe' || mode === '2d' || mode === '3d' ? mode : 'style',
      index,
      brush,
    };
    ensureBar();
    emit();
    if (deps.getEditMode() !== '2d' && deps.getEditMode() !== '3d') deps.setEditMode('2d');
  }
  session.brush = brush;
  await showIndex(index);
}

/** Put the character back and return to the mode the session started from. */
export function endTagSession(options: { returnToMode?: boolean } = {}): void {
  if (!session || !deps) return;
  const { snapshot, returnMode } = session;
  setFeatureTagBrush(null);
  session = null;
  deps.restoreCharacter(snapshot);
  emit();
  syncBar();
  if (options.returnToMode !== false && deps.getEditMode() !== returnMode) deps.setEditMode(returnMode);
}

async function showIndex(index: number): Promise<void> {
  if (!session || !deps) return;
  const skins = deps.getSkins();
  const n = skins.length;
  session.index = ((index % n) + n) % n;
  const skin = skins[session.index]!;
  const brush = getFeatureTagBrush() ?? session.brush;
  setFeatureTagBrush(null); // the tag overlay must be off while the canvas changes
  syncBar();
  const ok = await deps.showRawSkin(skin.path);
  if (!session) return;
  if (ok) {
    session.brush = brush;
    setFeatureTagBrush(brush);
  }
  syncBar();
}

/** The next library skin with no hand-made tags, after the current one. */
async function nextUntagged(): Promise<void> {
  if (!session || !deps) return;
  const skins = deps.getSkins();
  for (let step = 1; step <= skins.length; step++) {
    const i = (session.index + step) % skins.length;
    const src = await ensureSource(skins[i]!.path);
    if (!session) return;
    if (src && !hasFeatureTags(skinPixelKey(src.pixels.data as Uint8ClampedArray))) {
      await showIndex(i);
      return;
    }
  }
  setStatus('Every library skin has tags.');
}

// ---------------------------------------------------------------------------
// The session bar (top center while a session runs).

let nameEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let originalBtn: HTMLButtonElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function ensureBar(): void {
  if (bar) return;
  const prev = createEl('button', { type: 'button', className: 'creator-tag-session-btn', title: 'Previous library skin', 'aria-label': 'Previous skin' }, '◀');
  const next = createEl('button', { type: 'button', className: 'creator-tag-session-btn', title: 'Next library skin', 'aria-label': 'Next skin' }, '▶');
  const untagged = createEl('button', { type: 'button', className: 'creator-tag-session-btn', title: 'Skip to the next skin nobody has tagged yet' }, 'Next untagged');
  originalBtn = createEl('button', { type: 'button', className: 'creator-tag-session-btn', 'aria-pressed': 'false', title: 'Show the skin without the tag colors' }, 'Original');
  const done = createEl('button', { type: 'button', className: 'creator-tag-session-btn creator-tag-session-done', title: 'Stop tagging and put your character back' }, 'Back to my character');
  nameEl = createEl('span', { className: 'creator-tag-session-name' });
  countEl = createEl('span', { className: 'creator-tag-session-count' });
  statusEl = createEl('span', { className: 'creator-tag-session-status', role: 'status' });
  bar = createEl('div', { id: 'creator-tag-session-bar', className: 'creator-tag-session-bar', role: 'toolbar', 'aria-label': 'Tagging library skins' },
    createEl('span', { className: 'creator-tag-session-label' }, 'Tagging'),
    prev, nameEl, countEl, next, untagged, originalBtn, statusEl, done,
  );
  prev.addEventListener('click', () => session && void showIndex(session.index - 1));
  next.addEventListener('click', () => session && void showIndex(session.index + 1));
  untagged.addEventListener('click', () => void nextUntagged());
  originalBtn.addEventListener('click', () => {
    if (!session) return;
    const on = getFeatureTagBrush() != null;
    setFeatureTagBrush(on ? null : session.brush);
  });
  done.addEventListener('click', () => endTagSession());
  document.body.appendChild(bar);
  onFeatureTagBrushChanged(() => {
    const b = getFeatureTagBrush();
    if (session && b) session.brush = b;
    syncBar();
  });
  onFeatureTagsSaved(() => syncBar());
  // Leaving Design (Home, Studio) with a library skin on the canvas: put the character back first.
  new MutationObserver(() => {
    if (session && document.body.dataset.route !== 'creator') endTagSession({ returnToMode: false });
  }).observe(document.body, { attributes: true, attributeFilter: ['data-route'] });
}

function syncBar(): void {
  if (!bar) return;
  bar.hidden = !session;
  if (!session || !deps) return;
  const skins = deps.getSkins();
  const skin = skins[session.index];
  if (nameEl) {
    nameEl.textContent = skin?.label ?? '';
    nameEl.title = skin?.label ?? '';
  }
  if (countEl) countEl.textContent = `${session.index + 1} of ${skins.length}`;
  const showingTags = getFeatureTagBrush() != null;
  originalBtn?.setAttribute('aria-pressed', String(!showingTags));
  originalBtn?.classList.toggle('active', !showingTags);
  setStatus('');
  if (skin) {
    void ensureSource(skin.path).then((src) => {
      if (!session || deps?.getSkins()[session.index]?.path !== skin.path) return;
      setStatus(src && hasFeatureTags(skinPixelKey(src.pixels.data as Uint8ClampedArray)) ? 'Hand-tagged' : 'Guessed tags');
    });
  }
}
