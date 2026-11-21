/**
 * Dance studio backdrops (pure): the catalogue of choices, validation of the saved choice and the
 * gradient math. state/studioBackdrop.ts persists the choice, viewer/studioBackdrop.ts draws it and
 * controllers/studioStageController.ts applies it on the studio route only.
 */
import { hexToRgb, normalizeHex, rgbToHex } from './color';

/** One color stop of a vertical gradient: `at` runs from 0 (top of the picture) to 1 (bottom). */
export type GradientStop = { at: number; color: string };

export type BackdropDef =
  | { id: string; label: string; kind: 'default' }
  | { id: string; label: string; kind: 'solid'; color: string }
  | { id: string; label: string; kind: 'gradient'; stops: readonly GradientStop[] }
  | { id: string; label: string; kind: 'spotlight'; color: string; light: string };

export const DEFAULT_BACKDROP_ID = 'default';
/** The "pick your own color" choice; its color is `BackdropSettings.customColor`. */
export const CUSTOM_BACKDROP_ID = 'custom';

/** In the order the swatches are shown. */
export const STUDIO_BACKDROPS: readonly BackdropDef[] = [
  { id: DEFAULT_BACKDROP_ID, label: 'Default', kind: 'default' },
  { id: 'white', label: 'White', kind: 'solid', color: '#ffffff' },
  { id: 'black', label: 'Black', kind: 'solid', color: '#000000' },
  { id: 'green', label: 'Green screen', kind: 'solid', color: '#00b140' },
  { id: 'pink', label: 'Pink', kind: 'solid', color: '#ff8fc7' },
  { id: 'sky', label: 'Sky blue', kind: 'solid', color: '#8fd3ff' },
  {
    id: 'sunset', label: 'Sunset', kind: 'gradient',
    stops: [{ at: 0, color: '#2b1b5e' }, { at: 0.45, color: '#c2457a' }, { at: 0.75, color: '#ff8a4c' }, { at: 1, color: '#ffd27a' }],
  },
  {
    id: 'ocean', label: 'Ocean', kind: 'gradient',
    stops: [{ at: 0, color: '#0b2a6f' }, { at: 0.6, color: '#1c8fc9' }, { at: 1, color: '#8ff0e0' }],
  },
  {
    id: 'candy', label: 'Candy', kind: 'gradient',
    stops: [{ at: 0, color: '#ff9ad5' }, { at: 0.5, color: '#c9a7ff' }, { at: 1, color: '#9ae6ff' }],
  },
  {
    id: 'night', label: 'Night', kind: 'gradient',
    stops: [{ at: 0, color: '#03040f' }, { at: 0.6, color: '#101a4a' }, { at: 1, color: '#3a2a6b' }],
  },
  { id: 'spotlight', label: 'Spotlight', kind: 'spotlight', color: '#07070c', light: '#fff2cf' },
];

export type BackdropSettings = {
  /** A STUDIO_BACKDROPS id, or CUSTOM_BACKDROP_ID. */
  id: string;
  /** #rrggbb, used while `id` is CUSTOM_BACKDROP_ID (kept when another backdrop is picked). */
  customColor: string;
  /** Show the ground. Off makes solid backdrops seamless. */
  floor: boolean;
};

export const DEFAULT_BACKDROP_SETTINGS: Readonly<BackdropSettings> = { id: DEFAULT_BACKDROP_ID, customColor: '#7a5cff', floor: true };

export function findBackdrop(id: string): BackdropDef | undefined {
  return STUDIO_BACKDROPS.find((b) => b.id === id);
}

export function isBackdropId(id: unknown): id is string {
  return typeof id === 'string' && (id === CUSTOM_BACKDROP_ID || findBackdrop(id) !== undefined);
}

/** Read settings from untrusted JSON; anything malformed falls back to the default, field by field. */
export function parseBackdropSettings(json: string | null): BackdropSettings {
  const fallback = { ...DEFAULT_BACKDROP_SETTINGS };
  if (!json) return fallback;
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return fallback;
    const d = data as Record<string, unknown>;
    return {
      id: isBackdropId(d.id) ? d.id : fallback.id,
      customColor: (typeof d.customColor === 'string' && normalizeHex(d.customColor)) || fallback.customColor,
      floor: d.floor !== false,
    };
  } catch {
    return fallback;
  }
}

/** What to draw for a choice: the catalogue entry, with the custom color resolved to a solid. */
export function resolveBackdrop(settings: Pick<BackdropSettings, 'id' | 'customColor'>): BackdropDef {
  if (settings.id === CUSTOM_BACKDROP_ID) {
    const color = normalizeHex(settings.customColor) ?? DEFAULT_BACKDROP_SETTINGS.customColor;
    return { id: CUSTOM_BACKDROP_ID, label: 'Custom', kind: 'solid', color };
  }
  return findBackdrop(settings.id) ?? STUDIO_BACKDROPS[0];
}

/**
 * Color of a gradient at `t` (0 = top, 1 = bottom): straight-line mix between the two stops around
 * it, per channel in the hex values' own space (what a canvas / CSS gradient does). Stops must be
 * sorted by `at`; `t` outside the stops clamps to the first / last color.
 */
export function gradientColorAt(stops: readonly GradientStop[], t: number): string {
  if (stops.length === 0) return '#000000';
  if (!(t > stops[0].at)) return normalizeHex(stops[0].color) ?? '#000000';
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (t <= b.at) {
      const span = b.at - a.at;
      const k = span > 0 ? (t - a.at) / span : 1;
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return rgbToHex(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k);
    }
  }
  return normalizeHex(stops[stops.length - 1].color) ?? '#000000';
}

/** CSS `linear-gradient(...)` (top to bottom) for a gradient's swatch button. */
export function gradientCss(stops: readonly GradientStop[]): string {
  return `linear-gradient(to bottom, ${stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`;
}

/** CSS background for a backdrop's swatch button ('' for Default: the stylesheet draws that one). */
export function backdropSwatchCss(def: BackdropDef): string {
  switch (def.kind) {
    case 'solid':
      return def.color;
    case 'gradient':
      return gradientCss(def.stops);
    case 'spotlight':
      return `radial-gradient(circle at 50% 78%, ${def.light} 0%, ${def.color} 62%)`;
    default:
      return '';
  }
}
