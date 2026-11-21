/**
 * World weather for the home view: clear, rain or snow, or "auto" (it changes by itself every few
 * minutes). Pure numbers (no three.js, no DOM) so it runs in unit tests. The scene side is
 * viewer/weatherParticles.ts (the falling rain and snow) and controllers/weatherController.ts;
 * the lighting goes through day/night (applyWeatherToSky below, used by
 * controllers/dayNightController.ts).
 *
 * Like day/night, everything is a modulation that is neutral when the weather is clear: with both
 * levels at 0, applyWeatherToSky hands back the very sky state it was given.
 */
import { DAY_SKY_COLOR, type RGB, type SkyState } from './dayNight';

export const WEATHER_KINDS = ['clear', 'rain', 'snow'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
/** What the user picked: a fixed kind, or 'auto' ("Surprise me"). */
export const WEATHER_MODES = [...WEATHER_KINDS, 'auto'] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

export const DEFAULT_WEATHER_MODE: WeatherMode = 'clear';

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === 'string' && (WEATHER_KINDS as readonly string[]).includes(value);
}

export function isWeatherMode(value: unknown): value is WeatherMode {
  return typeof value === 'string' && (WEATHER_MODES as readonly string[]).includes(value);
}

/** Read a mode from untrusted data; anything else is the default (clear). */
export function parseWeatherMode(value: unknown): WeatherMode {
  return isWeatherMode(value) ? value : DEFAULT_WEATHER_MODE;
}

/** The mode after `mode` in Clear → Rain → Snow → Surprise me → Clear (the single cycling button). */
export function nextWeatherMode(mode: WeatherMode): WeatherMode {
  return WEATHER_MODES[(WEATHER_MODES.indexOf(mode) + 1) % WEATHER_MODES.length]!;
}

export const WEATHER_LABELS: Record<WeatherMode, string> = {
  clear: 'Clear skies',
  rain: 'Rain',
  snow: 'Snow',
  auto: 'Surprise me',
};

// --- Fading in and out ---

/** How much of each kind is in the air, 0..1. Both can be above 0 while rain turns to snow. */
export type WeatherLevels = { rain: number; snow: number };

/** Seconds for weather to come in fully (and to clear again). */
export const WEATHER_FADE_SECONDS = 4;

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/**
 * Move `levels` (in place) toward `target`: that kind's level rises to 1, the other falls to 0,
 * each over `fadeSeconds`. Returns true if anything changed.
 */
export function advanceWeatherLevels(
  levels: WeatherLevels,
  target: WeatherKind,
  dtSeconds: number,
  fadeSeconds: number = WEATHER_FADE_SECONDS
): boolean {
  const step = fadeSeconds > 0 && Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) / fadeSeconds : 1;
  const rain = approach(levels.rain, target === 'rain' ? 1 : 0, step);
  const snow = approach(levels.snow, target === 'snow' ? 1 : 0, step);
  if (rain === levels.rain && snow === levels.snow) return false;
  levels.rain = rain;
  levels.snow = snow;
  return true;
}

/** Jump straight to `target` (arriving on the home view: it is already raining). True if changed. */
export function setWeatherLevels(levels: WeatherLevels, target: WeatherKind): boolean {
  return advanceWeatherLevels(levels, target, 1, 0);
}

/** A level (linear in time) as the eye should see it: soft start, soft end. */
export function easeWeatherLevel(level: number): number {
  const t = Math.min(1, Math.max(0, level));
  return t * t * (3 - 2 * t);
}

// --- Lighting: overcast on top of day/night ---

type Overcast = {
  /** Key light strength and tint under full cloud. */
  sunScale: number;
  sunTint: RGB;
  ambientScale: number;
  ambientTint: RGB;
  /** The cloud color at midday; darker times of day scale it down. */
  sky: RGB;
  /** How far the sky goes toward the cloud color. */
  skyMix: number;
  /** Multiplier on the fog's near and far distances (below 1 = thicker). */
  fogScale: number;
};

/** Full rain: a dim, cool, grey day. */
const RAIN_OVERCAST: Overcast = {
  sunScale: 0.45,
  sunTint: [0.8, 0.87, 1],
  ambientScale: 0.8,
  ambientTint: [0.86, 0.91, 1],
  sky: [0.6, 0.65, 0.72],
  skyMix: 0.85,
  fogScale: 0.82,
};
/** Full snow: brighter and whiter than rain (snow light is soft, not gloomy). */
const SNOW_OVERCAST: Overcast = {
  sunScale: 0.68,
  sunTint: [0.93, 0.96, 1],
  ambientScale: 0.96,
  ambientTint: [0.95, 0.97, 1],
  sky: [0.86, 0.89, 0.93],
  skyMix: 0.8,
  fogScale: 0.78,
};

/** What weather does to the light, as multipliers on day/night. All neutral when clear. */
export type WeatherLook = {
  sunScale: number;
  sunTint: RGB;
  ambientScale: number;
  ambientTint: RGB;
  /** Cloud color at midday brightness, and how far (0..1) the sky goes toward it. */
  cloudColor: RGB;
  cloudMix: number;
  fogScale: number;
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mulRgb = (a: RGB, b: RGB): RGB => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const WHITE: RGB = [1, 1, 1];
const luminance = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function isClearWeather(levels: Readonly<WeatherLevels>): boolean {
  return levels.rain <= 0 && levels.snow <= 0;
}

/** The light under `levels` of rain and snow (eased; the two stack while one turns into the other). */
export function weatherLook(levels: Readonly<WeatherLevels>): WeatherLook {
  const r = easeWeatherLevel(levels.rain);
  const s = easeWeatherLevel(levels.snow);
  const R = RAIN_OVERCAST;
  const S = SNOW_OVERCAST;
  const total = r + s;
  return {
    sunScale: mix(1, R.sunScale, r) * mix(1, S.sunScale, s),
    sunTint: mulRgb(mixRgb(WHITE, R.sunTint, r), mixRgb(WHITE, S.sunTint, s)),
    ambientScale: mix(1, R.ambientScale, r) * mix(1, S.ambientScale, s),
    ambientTint: mulRgb(mixRgb(WHITE, R.ambientTint, r), mixRgb(WHITE, S.ambientTint, s)),
    cloudColor: total > 0 ? mixRgb(R.sky, S.sky, s / total) : WHITE,
    cloudMix: Math.min(1, R.skyMix * r + S.skyMix * s),
    fogScale: mix(1, R.fogScale, r) * mix(1, S.fogScale, s),
  };
}

/** A sky state plus the fog multiplier (1 = the scene's own fog). */
export type WeatherSky = { sky: SkyState; fogScale: number };

/**
 * Lay the weather over a day/night sky state: dimmer, cooler sun and ambient, a greyer sky.
 * The cloud color follows the time of day (dark grey at night, never brighter than by day).
 * Clear weather returns `sky` itself with a fog scale of exactly 1.
 */
export function applyWeatherToSky(sky: SkyState, levels: Readonly<WeatherLevels>): WeatherSky {
  if (isClearWeather(levels)) return { sky, fogScale: 1 };
  const look = weatherLook(levels);
  const brightness = Math.min(1, luminance(sky.skyColor) / luminance(DAY_SKY_COLOR));
  const cloud: RGB = [look.cloudColor[0] * brightness, look.cloudColor[1] * brightness, look.cloudColor[2] * brightness];
  return {
    sky: {
      ...sky,
      skyColor: mixRgb(sky.skyColor, cloud, look.cloudMix),
      sunColor: mulRgb(sky.sunColor, look.sunTint),
      sunIntensity: sky.sunIntensity * look.sunScale,
      ambientTint: mulRgb(sky.ambientTint, look.ambientTint),
      ambientIntensity: sky.ambientIntensity * look.ambientScale,
    },
    fogScale: look.fogScale,
  };
}

// --- Auto weather ("Surprise me") ---

export type AutoWeather = { kind: WeatherKind; /** Seconds until the next change. */ remaining: number };

/** [min, max] seconds each kind lasts. Clear spells are the longest, so it is mostly clear. */
export const AUTO_WEATHER_DURATIONS: Record<WeatherKind, readonly [number, number]> = {
  clear: [120, 300],
  rain: [60, 150],
  snow: [50, 120],
};
/** After a clear spell: chance of snow (otherwise rain), so snow is the rarer one. */
const AUTO_SNOW_CHANCE = 0.3;
/** After rain or snow: chance it turns into the other one instead of clearing up. */
const AUTO_SWITCH_CHANCE = 0.15;

/** What follows `previous` (always a change), and for how long. `random` returns [0, 1). */
export function nextAutoWeather(previous: WeatherKind, random: () => number = Math.random): AutoWeather {
  let kind: WeatherKind;
  if (previous === 'clear') kind = random() < AUTO_SNOW_CHANCE ? 'snow' : 'rain';
  else if (random() < AUTO_SWITCH_CHANCE) kind = previous === 'rain' ? 'snow' : 'rain';
  else kind = 'clear';
  const [min, max] = AUTO_WEATHER_DURATIONS[kind];
  return { kind, remaining: min + random() * (max - min) };
}

/**
 * Run the auto weather on by `dtSeconds`. Returns `state` itself until its time is up, then the
 * next spell. Pass null to start: "Surprise me" opens with rain or snow, not more clear sky.
 */
export function advanceAutoWeather(
  state: AutoWeather | null,
  dtSeconds: number,
  random: () => number = Math.random
): AutoWeather {
  if (!state) return nextAutoWeather('clear', random);
  if (!(dtSeconds > 0)) return state;
  if (state.remaining > dtSeconds) {
    state.remaining -= dtSeconds;
    return state;
  }
  return nextAutoWeather(state.kind, random);
}

// --- Particles ---

/** The volume particles live in: a square column around a centre (the camera's target). */
export type ParticleBox = { centerX: number; centerZ: number; halfWidth: number; bottom: number; top: number };

/** Wrap `value` into [min, min + size). */
export function wrapInto(value: number, min: number, size: number): number {
  if (!(size > 0) || !Number.isFinite(value)) return min;
  const t = (value - min) % size;
  const wrapped = (t < 0 ? t + size : t) + min;
  // A tiny negative `t` plus `size` can round up to exactly `size`.
  return wrapped >= min + size ? min : wrapped;
}

/**
 * Move particle `index` of `positions` (x, y, z triples) by its velocity and wrap it back into
 * `box`: one that falls out of the bottom comes back in at the top, one left behind when the box
 * moves re-enters on the far side. So a fixed set of particles follows the camera with no
 * respawning and no allocation. Writes in place.
 */
export function recycleParticle(
  positions: { [index: number]: number },
  index: number,
  vx: number,
  vy: number,
  vz: number,
  dtSeconds: number,
  box: Readonly<ParticleBox>
): void {
  const i = index * 3;
  const width = box.halfWidth * 2;
  positions[i] = wrapInto(positions[i]! + vx * dtSeconds, box.centerX - box.halfWidth, width);
  positions[i + 1] = wrapInto(positions[i + 1]! + vy * dtSeconds, box.bottom, box.top - box.bottom);
  positions[i + 2] = wrapInto(positions[i + 2]! + vz * dtSeconds, box.centerZ - box.halfWidth, width);
}

/** Most particles ever drawn per kind. */
export const MAX_WEATHER_PARTICLES: Record<Exclude<WeatherKind, 'clear'>, number> = { rain: 1500, snow: 900 };

/** Particle budget for a kind: the cap, or about half of it on small or very dense screens. */
export function weatherParticleCount(
  kind: WeatherKind,
  screen: { width: number; height: number; pixelRatio: number } | null = null
): number {
  if (kind === 'clear') return 0;
  const max = MAX_WEATHER_PARTICLES[kind];
  if (!screen) return max;
  const small = Math.min(screen.width, screen.height) < 600 || screen.pixelRatio > 2;
  return small ? Math.round(max * 0.55) : max;
}
