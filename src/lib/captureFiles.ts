/**
 * Pure helpers for the dance studio's photo and video capture (no DOM, no Three), tested in
 * captureFiles.test.ts. The DOM side lives in ui/studioCapturePanel.ts and ui/canvasRecorder.ts.
 */

/** Recording container/codec preference, best first. */
export const VIDEO_MIME_PREFERENCE: readonly string[] = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/** Recordings stop by themselves after this long. */
export const MAX_RECORDING_MS = 60_000;

/**
 * First mime type the browser can record (pass `MediaRecorder.isTypeSupported`). `null` means
 * none of ours is supported: let the recorder pick its own default.
 */
export function pickVideoMimeType(
  isSupported: (mime: string) => boolean,
  preference: readonly string[] = VIDEO_MIME_PREFERENCE
): string | null {
  for (const mime of preference) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      // Some browsers throw on mime strings they can't parse; treat as unsupported.
    }
  }
  return null;
}

/** File extension (no dot) for a mime type, ignoring parameters such as `;codecs=vp9`. */
export function extensionForMimeType(mime: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  switch (base) {
    case 'image/png':
      return 'png';
    case 'video/mp4':
      return 'mp4';
    case 'video/x-matroska':
      return 'mkv';
    case 'video/webm':
    default:
      return 'webm';
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * `blockygotchi-<prefix>-YYYYMMDD-HHMMSS.<ext>` in the user's local time. The studio's files are
 * "dance" (the default); the home view's photo mode passes "village".
 */
export function captureFileName(date: Date, extension: string, prefix = 'dance'): string {
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  const kind = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dance';
  return `blockygotchi-${kind}-${day}-${time}.${extension.replace(/^\./, '')}`;
}

/** Elapsed recording time as `m:ss` (whole seconds, rounded down). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** True once a recording has run for the maximum length. */
export function reachedMaxLength(elapsedMs: number, maxMs: number = MAX_RECORDING_MS): boolean {
  return elapsedMs >= maxMs;
}
