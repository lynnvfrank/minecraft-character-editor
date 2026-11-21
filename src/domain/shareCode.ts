/**
 * Share codes: one saved combo packed into a short URL-safe string, carried in a link as
 * `?combo=<code>` (query before the hash). Pure; the UI is ui/shareComboUi.ts.
 *
 * Format: `b1.` + base64url(UTF-8(JSON)) where the JSON is `{ n: label, s: steps }` and a step is
 *   ['b', seconds|0, [[clip, weight, speed?], ...]]   blend (speed left out when 1)
 *   ['a', clip, seconds|0]                           single clip
 *   ['p', seconds]                                   pause
 * (0 seconds = "no length set"). Numbers are rounded to 2 decimals. Decoding trusts nothing: the
 * result goes through sanitizeSequence like any other outside input.
 */
import type { SavedSequence, SavedSequenceStep } from './sequences';
import { sanitizeSequence } from './sequenceImport';

export const SHARE_CODE_PREFIX = 'b1.';
/** Longest code we make or accept (characters, prefix included). Keeps links well inside URL limits. */
export const MAX_SHARE_CODE_LENGTH = 4096;
/** The query parameter a share link uses. */
export const SHARE_PARAM = 'combo';

export type ShareCodeResult = { ok: true; code: string } | { ok: false; reason: string };
export type SharedCombo = Pick<SavedSequence, 'label' | 'steps'>;
export type DecodeResult = { ok: true; combo: SharedCombo } | { ok: false; reason: string };

const round2 = (v: number) => Math.round(v * 100) / 100;

function packStep(step: SavedSequenceStep): unknown[] {
  if (step.type === 'animation') return ['a', step.name, round2(step.duration ?? 0)];
  if (step.type === 'pause') return ['p', round2(step.duration ?? 0.5)];
  return [
    'b',
    round2(step.duration ?? 0),
    step.layers.map((l) => {
      const speed = round2(l.timeScale ?? 1);
      return speed === 1 ? [l.name, round2(l.weight)] : [l.name, round2(l.weight), speed];
    }),
  ];
}

function unpackStep(raw: unknown): unknown {
  if (!Array.isArray(raw)) return null;
  const duration = (v: unknown) => (typeof v === 'number' && v > 0 ? { duration: v } : {});
  if (raw[0] === 'a') return { type: 'animation', name: raw[1], ...duration(raw[2]) };
  if (raw[0] === 'p') return { type: 'pause', ...duration(raw[1]) };
  if (raw[0] === 'b' && Array.isArray(raw[2])) {
    return {
      type: 'blend',
      layers: raw[2].map((l: unknown) =>
        Array.isArray(l) ? { name: l[0], weight: l[1], ...(l[2] !== undefined ? { timeScale: l[2] } : {}) } : null
      ),
      ...duration(raw[1]),
    };
  }
  return null;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Pack a combo into a share code. Fails (with a reason to show) if it isn't valid or is too long. */
export function encodeShareCode(combo: SharedCombo): ShareCodeResult {
  const clean = sanitizeSequence({ label: combo.label, steps: combo.steps });
  if (!clean) return { ok: false, reason: 'This combo can’t be shared.' };
  const code = SHARE_CODE_PREFIX + toBase64Url(JSON.stringify({ n: clean.label, s: clean.steps.map(packStep) }));
  if (code.length > MAX_SHARE_CODE_LENGTH) return { ok: false, reason: 'This combo is too long to share as a link.' };
  return { ok: true, code };
}

/** Unpack a share code from a link. Anything unexpected is refused; nothing in it is trusted. */
export function decodeShareCode(code: unknown): DecodeResult {
  const bad = (reason: string): DecodeResult => ({ ok: false, reason });
  if (typeof code !== 'string' || code.length === 0) return bad('That link has no combo in it.');
  if (code.length > MAX_SHARE_CODE_LENGTH) return bad('That shared combo is too big.');
  if (!code.startsWith(SHARE_CODE_PREFIX)) return bad('That link is from a version this app doesn’t know.');
  const body = code.slice(SHARE_CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return bad('That shared combo link is broken.');
  let data: unknown;
  try {
    data = JSON.parse(fromBase64Url(body));
  } catch {
    return bad('That shared combo link is broken.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return bad('That shared combo link is broken.');
  const d = data as Record<string, unknown>;
  if (typeof d.n !== 'string' || !Array.isArray(d.s)) return bad('That shared combo link is broken.');
  const clean = sanitizeSequence({ label: d.n, steps: d.s.map(unpackStep) });
  if (!clean) return bad('That shared combo link is broken.');
  return { ok: true, combo: { label: clean.label, steps: clean.steps } };
}

/** The link for a code: `<origin><path>?combo=<code>#/` (the app's home view). */
export function shareLink(code: string, origin: string, pathname: string = '/'): string {
  return `${origin}${pathname || '/'}?${SHARE_PARAM}=${encodeURIComponent(code)}#/`;
}

/**
 * The page address without the share parameter (other parameters and the hash stay), for
 * history.replaceState once the shared combo has been handled.
 */
export function urlWithoutShareParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete(SHARE_PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}
