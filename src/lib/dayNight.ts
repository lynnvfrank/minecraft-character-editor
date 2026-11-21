/**
 * World day and night for the home view: time of day (hours in [0, 24)) → what the sky and lights
 * should look like. Pure numbers (no three.js, no DOM) so it runs in unit tests; the scene side is
 * viewer/scene.ts (setDayNightLighting) driven by controllers/dayNightController.ts.
 *
 * Everything here is *relative to midday*: at DEFAULT_TIME_OF_DAY the tints are white, the
 * intensities are 1 and the light comes from REFERENCE_LIGHT_DIRECTION, so applying the state on
 * top of a lighting preset leaves that preset exactly as it was. Other times dim, warm or cool it.
 */

/** Color as [r, g, b], each 0..1 (sRGB, like a hex color split into channels). */
export type RGB = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

export type SkyState = {
  /** The time this state is for, wrapped to [0, 24). */
  time: number;
  /** Sky / background / fog color on a clear day cycle (DAY_SKY_COLOR at midday). */
  skyColor: RGB;
  /** Unit vector toward the sun. Below the horizon (y < 0) at night. */
  sunDirection: Vec3;
  /** Unit vector toward the key light: the sun by day, the moon at night, never below ~11°. */
  lightDirection: Vec3;
  /** Key light tint (white at midday, orange at the horizon, pale blue moonlight). */
  sunColor: RGB;
  /** Key light strength relative to midday (1). */
  sunIntensity: number;
  /** Ambient (sky/bounce) tint, white at midday. */
  ambientTint: RGB;
  /** Ambient strength relative to midday (1). */
  ambientIntensity: number;
  /** 0 = day, 1 = full night. */
  night: number;
  /** 0 = lamps off, 1 = fully lit. On around dusk, off after dawn. */
  lampGlow: number;
  /** 1 around midday (the state is neutral there), 0 from dusk to dawn. */
  daylight: number;
};

export const HOURS_PER_DAY = 24;
/** Midday: the sky state is neutral here, so the home view looks like the plain lighting preset. */
export const DEFAULT_TIME_OF_DAY = 12;
/** Auto-cycle: one full day in four minutes. */
export const DEFAULT_DAY_LENGTH_SECONDS = 240;
/** The clear midday sky (matches the bright theme's sky in ui/theme.ts). */
export const DAY_SKY_COLOR: RGB = [0xcf / 255, 0xe6 / 255, 0xff / 255];

const SUNRISE = 6;
const SUNSET = 18;

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Where the light comes from at midday: the default lighting preset's sun (2.5, 5, 3 in
 * viewer/scene.ts). The sun's arc passes through it at noon.
 */
export const REFERENCE_LIGHT_DIRECTION: Vec3 = normalize([2.5, 5, 3]);
/** Horizontal direction of sunrise: at right angles to the noon sun, so the arc is a great circle. */
const SUNRISE_DIRECTION: Vec3 = normalize([REFERENCE_LIGHT_DIRECTION[2], 0, -REFERENCE_LIGHT_DIRECTION[0]]);
/** The key light never drops lower than this (unit-vector y), so shadows don't stretch forever. */
const MIN_LIGHT_HEIGHT = 0.2;

/** Wrap any number of hours into [0, 24). */
export function wrapHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_TIME_OF_DAY;
  const t = hours % HOURS_PER_DAY;
  const wrapped = t < 0 ? t + HOURS_PER_DAY : t;
  // -1e-17 % 24 + 24 rounds to exactly 24.
  return wrapped >= HOURS_PER_DAY ? 0 : wrapped;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const rgb = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

type Keyframe = {
  hour: number;
  sky: RGB;
  sunColor: RGB;
  sunIntensity: number;
  ambientTint: RGB;
  ambientIntensity: number;
  night: number;
  daylight: number;
};

const WHITE: RGB = [1, 1, 1];
const NIGHT = {
  sky: rgb(0x0a1030),
  sunColor: [0.55, 0.68, 1] as RGB, // moonlight
  sunIntensity: 0.22,
  ambientTint: [0.5, 0.62, 1] as RGB,
  ambientIntensity: 0.26,
  night: 1,
  daylight: 0,
};
const MIDDAY = {
  sky: DAY_SKY_COLOR,
  sunColor: WHITE,
  sunIntensity: 1,
  ambientTint: WHITE,
  ambientIntensity: 1,
  night: 0,
  daylight: 1,
};

/**
 * The day, in order. The last frame wraps round to the first across midnight. The key light is
 * nearly out at sunrise and sunset, which hides the hand-over between sun and moon.
 */
const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, ...NIGHT },
  { hour: 4.5, ...NIGHT },
  {
    hour: SUNRISE, sky: rgb(0xf2a884), sunColor: [1, 0.6, 0.38], sunIntensity: 0.05,
    ambientTint: [1, 0.8, 0.78], ambientIntensity: 0.5, night: 0.5, daylight: 0,
  },
  {
    hour: 7.5, sky: rgb(0xb4d6f5), sunColor: [1, 0.86, 0.68], sunIntensity: 0.75,
    ambientTint: [1, 0.95, 0.9], ambientIntensity: 0.85, night: 0, daylight: 0,
  },
  { hour: 11, ...MIDDAY },
  { hour: 13, ...MIDDAY },
  {
    hour: 16.5, sky: rgb(0xbcd8f2), sunColor: [1, 0.88, 0.7], sunIntensity: 0.8,
    ambientTint: [1, 0.95, 0.88], ambientIntensity: 0.88, night: 0, daylight: 0,
  },
  {
    hour: SUNSET, sky: rgb(0xf08a5a), sunColor: [1, 0.5, 0.3], sunIntensity: 0.05,
    ambientTint: [1, 0.78, 0.72], ambientIntensity: 0.5, night: 0.5, daylight: 0,
  },
  { hour: 19.5, ...NIGHT },
];

/** Lamps: fully on by 19:00 (starting 17:30), fully off by 7:00 (starting 5:30). */
function lampGlowAt(t: number): number {
  return t < 12 ? 1 - smoothstep(5.5, 7, t) : smoothstep(17.5, 19, t);
}

/** The sun's place on its arc: rises at 6, passes REFERENCE_LIGHT_DIRECTION at noon, sets at 18. */
function sunDirectionAt(t: number): Vec3 {
  const angle = ((t - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c * SUNRISE_DIRECTION[0] + s * REFERENCE_LIGHT_DIRECTION[0],
    c * SUNRISE_DIRECTION[1] + s * REFERENCE_LIGHT_DIRECTION[1],
    c * SUNRISE_DIRECTION[2] + s * REFERENCE_LIGHT_DIRECTION[2],
  ];
}

/** What the sky and lights look like at `hours` (any number; wrapped to a day). */
export function skyStateAt(hours: number): SkyState {
  const time = wrapHours(hours);

  let i = KEYFRAMES.length - 1;
  while (i > 0 && KEYFRAMES[i].hour > time) i--;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[(i + 1) % KEYFRAMES.length];
  const span = (b.hour > a.hour ? b.hour : b.hour + HOURS_PER_DAY) - a.hour;
  const k = smoothstep(0, 1, (time - a.hour) / span);

  const sunDirection = sunDirectionAt(time);
  // Sun below the horizon: light from the moon, opposite it in the sky.
  const up = sunDirection[1] >= 0 ? 1 : -1;
  const lightDirection = normalize([
    sunDirection[0] * up,
    Math.max(sunDirection[1] * up, MIN_LIGHT_HEIGHT),
    sunDirection[2] * up,
  ]);

  return {
    time,
    skyColor: lerpRgb(a.sky, b.sky, k),
    sunDirection,
    lightDirection,
    sunColor: lerpRgb(a.sunColor, b.sunColor, k),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, k),
    ambientTint: lerpRgb(a.ambientTint, b.ambientTint, k),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, k),
    night: lerp(a.night, b.night, k),
    lampGlow: lampGlowAt(time),
    daylight: lerp(a.daylight, b.daylight, k),
  };
}

/**
 * Auto-cycle: move `hours` on by `dtSeconds` of real time, where a whole day takes
 * `dayLengthSeconds`. Wraps past midnight.
 */
export function advanceTimeOfDay(
  hours: number,
  dtSeconds: number,
  dayLengthSeconds: number = DEFAULT_DAY_LENGTH_SECONDS
): number {
  if (!(dayLengthSeconds > 0) || !Number.isFinite(dtSeconds)) return wrapHours(hours);
  return wrapHours(hours + (dtSeconds / dayLengthSeconds) * HOURS_PER_DAY);
}

/** "Night", "Dawn", "Morning", "Midday", "Afternoon", "Dusk" or "Evening". */
export function partOfDay(hours: number): string {
  const t = wrapHours(hours);
  if (t < 5) return 'Night';
  if (t < 7) return 'Dawn';
  if (t < 11) return 'Morning';
  if (t < 13.5) return 'Midday';
  if (t < 17) return 'Afternoon';
  if (t < 19) return 'Dusk';
  if (t < 22) return 'Evening';
  return 'Night';
}

/** Friendly clock label, to the nearest 5 minutes: "Noon", "Midnight", "6:30 pm". */
export function formatTimeOfDay(hours: number): string {
  const minutes = (Math.round((wrapHours(hours) * 60) / 5) * 5) % (HOURS_PER_DAY * 60);
  if (minutes === 0) return 'Midnight';
  if (minutes === 12 * 60) return 'Noon';
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** Sun or moon? (For the control's icon.) */
export function isNightTime(hours: number): boolean {
  return skyStateAt(hours).night > 0.5;
}
