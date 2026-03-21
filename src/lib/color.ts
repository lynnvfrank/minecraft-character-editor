/**
 * Central Color type: validation, conversion, and helpers.
 */

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/** Normalize hex to lowercase #rrggbb. Returns null if invalid. */
export function normalizeHex(hex: string): string | null {
  const s = hex.slice(0, 7).trim().toLowerCase();
  return HEX_REGEX.test(s) ? s : null;
}

/** True if string is valid 6-digit hex color. */
export function isValidHex(hex: string): boolean {
  return HEX_REGEX.test(hex.trim());
}

/** Hex to [r, g, b] 0–255. Returns [0,0,0] for invalid. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.slice(1).match(/.{2}/g);
  if (!m) return [0, 0, 0];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

/** RGB 0–255 to hex #rrggbb. */
export function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** HSVA: h 0–360, s v a 0–100. */
export function hexToHsva(hex: string): { h: number; s: number; v: number; a: number } {
  const [r, g, b] = hexToRgb(hex);
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  const a = hex.length >= 9 ? (parseInt(hex.slice(7, 9), 16) / 255) * 100 : 100;
  return { h, s, v, a };
}

/** HSVA to hex. */
export function hsvaToHex(h: number, s: number, v: number, a: number): string {
  s /= 100;
  v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  const hex = '#' + [R, G, B].map((n) => n.toString(16).padStart(2, '0')).join('');
  if (a < 100) {
    const A = Math.round((a / 100) * 255);
    return hex + A.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Adjust brightness by delta (RGB points). Positive = brighter. */
export function adjustHexBrightness(hex: string, delta: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (n: number) => Math.round(Math.max(0, Math.min(255, n)));
  return rgbToHex(clamp(r + delta), clamp(g + delta), clamp(b + delta));
}

/** Immutable Color value. Use parse() or fromRgb() to create. */
export class Color {
  private readonly _hex: string;

  private constructor(hex: string) {
    this._hex = hex;
  }

  get hex(): string {
    return this._hex;
  }

  get rgb(): [number, number, number] {
    return hexToRgb(this._hex);
  }

  get hsva(): { h: number; s: number; v: number; a: number } {
    return hexToHsva(this._hex);
  }

  /** Create from hex. Returns null if invalid. */
  static parse(hex: string): Color | null {
    const normalized = normalizeHex(hex);
    return normalized ? new Color(normalized) : null;
  }

  /** Create from RGB. */
  static fromRgb(r: number, g: number, b: number): Color {
    return new Color(rgbToHex(r, g, b));
  }

  /** Create from HSVA. */
  static fromHsva(h: number, s: number, v: number, a: number): Color {
    return new Color(hsvaToHex(h, s, v, a));
  }

  /** New color with brightness adjusted. */
  adjustBrightness(delta: number): Color {
    return new Color(adjustHexBrightness(this._hex, delta));
  }

  toString(): string {
    return this._hex;
  }
}
