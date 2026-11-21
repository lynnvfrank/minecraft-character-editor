/**
 * Pure rules for the home view's photo mode (no DOM, no Three), tested in photoMode.test.ts:
 * lens and tilt ranges and the Polaroid card layout.
 * The controller is controllers/photoModeController.ts; the bar is ui/photoModeBar.ts.
 */
/** Lens (vertical field of view, degrees): small = zoomed in. */
export const PHOTO_FOV_MIN = 15;
export const PHOTO_FOV_MAX = 80;
/** Camera roll, degrees either way. */
export const PHOTO_TILT_MAX = 25;
/** Photo mode lets the camera get down low (the home view stops at 84 degrees). */
export const PHOTO_MAX_POLAR_DEG = 89;
/** ...and wander a little past the village's edge. */
export const PHOTO_ROAM_SCALE = 1.5;

export function clampFov(fov: number, fallback = 45): number {
  if (!Number.isFinite(fov)) return fallback;
  return Math.min(PHOTO_FOV_MAX, Math.max(PHOTO_FOV_MIN, fov));
}

export function clampTilt(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return Math.min(PHOTO_TILT_MAX, Math.max(-PHOTO_TILT_MAX, degrees));
}

export type PolaroidLayout = {
  /** The whole card. */
  width: number;
  height: number;
  /** Where the photo goes on the card (drawn at its own size). */
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  /** Caption: centered on `captionX`, vertically centered on `captionY`. */
  captionX: number;
  captionY: number;
  fontPx: number;
};

/**
 * A white instant-photo card around an image: an even margin on three sides and a taller strip
 * below for the caption. Sizes follow the image's shorter side, so any shape of shot works.
 */
export function polaroidLayout(imageWidth: number, imageHeight: number): PolaroidLayout {
  const w = Math.max(1, Math.round(Number.isFinite(imageWidth) ? imageWidth : 1));
  const h = Math.max(1, Math.round(Number.isFinite(imageHeight) ? imageHeight : 1));
  const short = Math.min(w, h);
  const margin = Math.max(8, Math.round(short * 0.05));
  const strip = Math.max(28, Math.round(short * 0.2));
  return {
    width: w + margin * 2,
    height: h + margin + strip,
    imageX: margin,
    imageY: margin,
    imageWidth: w,
    imageHeight: h,
    captionX: margin + Math.round(w / 2),
    captionY: margin + h + Math.round(strip / 2),
    fontPx: Math.max(12, Math.round(strip * 0.34)),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Nov 2026 · Evening": the real date and the village's time of day. */
export function polaroidCaption(date: Date, partOfDay: string): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  const part = partOfDay.trim();
  return part ? `${day} · ${part.charAt(0).toUpperCase()}${part.slice(1)}` : day;
}
