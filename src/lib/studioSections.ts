/**
 * Dance studio panel sections (pure): their top-down order, which ones start open, and the
 * validation of the saved open/closed choices. state/studioSections.ts persists the choices and
 * ui/collapsibleSection.ts draws the headers.
 *
 * The order follows the creative flow: pick and mix clips, blend two of them, string mixes into a
 * routine, keep it, then dress the stage (dancers, backdrop, camera moves) and shoot it.
 */
export const STUDIO_SECTION_ORDER = [
  'clips',
  'crossfade',
  'routine',
  'saved',
  'dancers',
  'backdrop',
  'cameraMoves',
  'capture',
] as const;
export type StudioSectionId = (typeof STUDIO_SECTION_ORDER)[number];

export type StudioSectionsOpen = Readonly<Record<StudioSectionId, boolean>>;

/** The mixer is open; the stage dressing waits behind one-line summaries. */
export const DEFAULT_STUDIO_SECTIONS_OPEN: StudioSectionsOpen = {
  clips: true,
  crossfade: true,
  routine: true,
  saved: false,
  dancers: false,
  backdrop: false,
  cameraMoves: false,
  capture: false,
};

export function isStudioSectionId(value: unknown): value is StudioSectionId {
  return typeof value === 'string' && (STUDIO_SECTION_ORDER as readonly string[]).includes(value);
}

/** Place of a section in the panel (0 = first). */
export function studioSectionIndex(id: StudioSectionId): number {
  return STUDIO_SECTION_ORDER.indexOf(id);
}

/** Coerce anything into a full open/closed record; unknown keys are dropped, junk values fall back to `base`. */
export function normalizeStudioSections(
  value: unknown,
  base: StudioSectionsOpen = DEFAULT_STUDIO_SECTIONS_OPEN
): StudioSectionsOpen {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const id of STUDIO_SECTION_ORDER) {
    if (typeof v[id] === 'boolean') out[id] = v[id] as boolean;
  }
  return out;
}

/** Choices from untrusted JSON (localStorage); the defaults when nothing usable is stored. */
export function parseStudioSections(json: string | null): StudioSectionsOpen {
  if (!json) return { ...DEFAULT_STUDIO_SECTIONS_OPEN };
  try {
    return normalizeStudioSections(JSON.parse(json));
  } catch {
    return { ...DEFAULT_STUDIO_SECTIONS_OPEN };
  }
}

/** Open or close one section. Returns the same object when nothing changes. */
export function setStudioSection(state: StudioSectionsOpen, id: StudioSectionId, open: boolean): StudioSectionsOpen {
  if (!isStudioSectionId(id) || state[id] === open) return state;
  return { ...state, [id]: open };
}

export function toggleStudioSection(state: StudioSectionsOpen, id: StudioSectionId): StudioSectionsOpen {
  if (!isStudioSectionId(id)) return state;
  return { ...state, [id]: !state[id] };
}
