/**
 * One collapsible section of the dance studio panel (`#/studio`). Every section (the ones in
 * studioPanel.ts and the Camera, Dancers, Backdrop and Camera moves modules) is built with this,
 * so they share one markup and one behaviour:
 *
 *   <section class="studio-section studio-collapsible" data-studio-section="…">
 *     <h3 class="studio-section-title">
 *       <button class="studio-section-toggle" aria-expanded aria-controls>chevron · title · summary</button>
 *     </h3>
 *     <div class="studio-section-body">…the section's controls…</div>
 *   </section>
 *
 * The whole header row is the button (so it works with the keyboard for free). Open/closed is
 * remembered per section (state/studioSections.ts). A collapsed section shows a one-line summary
 * of its state, which the section supplies through the optional `summary` hook and updates by
 * calling `refresh()` from its own render.
 */
import { studioSectionIndex, isStudioSectionId, type StudioSectionId } from '../lib/studioSections';
import { createStudioSectionsStore, type StudioSectionsStore } from '../state/studioSections';

let sharedStore: StudioSectionsStore | null = null;

/** The store all studio sections share (created on first use; works without localStorage). */
export function getStudioSectionsStore(): StudioSectionsStore {
  if (!sharedStore) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    sharedStore = createStudioSectionsStore(storage);
  }
  return sharedStore;
}

export type CollapsibleSectionOptions = {
  id: StudioSectionId;
  title: string;
  /** Extra classes for the `<section>` (e.g. `studio-dancers`). */
  className?: string;
  /** DOM id for the `<section>`. */
  domId?: string;
  /** One short line about the section's current state, shown in the header while collapsed. */
  summary?: () => string;
  store?: StudioSectionsStore;
};

export type CollapsibleSection = {
  root: HTMLElement;
  /** Put the section's controls in here. */
  body: HTMLElement;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  /** Re-read the summary (call from the section's render). Cheap; does nothing while open. */
  refresh: () => void;
};

export function createCollapsibleSection(options: CollapsibleSectionOptions): CollapsibleSection {
  const store = options.store ?? getStudioSectionsStore();
  const { id } = options;

  const root = document.createElement('section');
  root.className = `studio-section studio-collapsible${options.className ? ` ${options.className}` : ''}`;
  if (options.domId) root.id = options.domId;
  root.dataset.studioSection = id;

  const bodyId = `studio-section-body-${id}`;
  const heading = document.createElement('h3');
  heading.className = 'studio-section-title';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'studio-section-toggle';
  toggle.setAttribute('aria-controls', bodyId);
  const chevron = document.createElement('span');
  chevron.className = 'studio-section-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▸';
  const name = document.createElement('span');
  name.className = 'studio-section-name';
  name.textContent = options.title;
  const summary = document.createElement('span');
  summary.className = 'studio-section-summary';
  toggle.append(chevron, name, summary);
  heading.append(toggle);

  const body = document.createElement('div');
  body.className = 'studio-section-body';
  body.id = bodyId;
  root.append(heading, body);

  function refresh(): void {
    const text = store.isOpen(id) ? '' : (options.summary?.() ?? '');
    if (summary.textContent !== text) summary.textContent = text;
  }

  function apply(): void {
    const open = store.isOpen(id);
    root.classList.toggle('is-collapsed', !open);
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    refresh();
  }

  toggle.addEventListener('click', () => store.toggle(id));
  store.subscribe(apply);
  apply();

  return { root, body, isOpen: () => store.isOpen(id), setOpen: (open) => store.set(id, open), refresh };
}

/**
 * Put a section into the studio panel at its place in STUDIO_SECTION_ORDER, whatever order the
 * modules are created in. The panel header (and anything else that isn't a section) stays on top.
 */
export function mountStudioSection(mount: HTMLElement | null, section: HTMLElement): void {
  if (!mount) return;
  const id = section.dataset.studioSection;
  const index = isStudioSectionId(id) ? studioSectionIndex(id) : Number.POSITIVE_INFINITY;
  for (const child of Array.from(mount.children)) {
    const other = (child as HTMLElement).dataset?.studioSection;
    if (isStudioSectionId(other) && studioSectionIndex(other) > index) {
      mount.insertBefore(section, child);
      return;
    }
  }
  mount.append(section);
}
