/**
 * World weather for the home view: turns the stored choice (state/weather.ts) into how much rain
 * and snow is in the air right now (lib/weather.ts levels, fading in and out over a few seconds),
 * runs the auto weather ("Surprise me"), and moves the particles (viewer/weatherParticles.ts).
 *
 * Like day/night it applies on the home route only, and only while the village is shown. Anywhere
 * else (creator, preview, studio) the levels are 0 and the particles are hidden, so nothing of the
 * weather is left on screen. The lighting side is not done here: controllers/dayNightController.ts
 * reads getLevels() and lays the overcast over its own sky state, so there is one owner of the
 * scene lighting and one place that hands the plain preset back.
 *
 * No three.js in here: the particles are injected, so the rules run in unit tests.
 */
import { skyStateAt } from '../lib/dayNight';
import {
  advanceAutoWeather,
  advanceWeatherLevels,
  isClearWeather,
  setWeatherLevels,
  type AutoWeather,
  type WeatherKind,
  type WeatherLevels,
  type WeatherMode,
} from '../lib/weather';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type WeatherParticlesLike = {
  update: (dtSeconds: number, center: { x: number; z: number }, levels: Readonly<WeatherLevels>, brightness?: number) => void;
  hide: () => void;
};

export type WeatherControllerDeps = {
  store: {
    get: () => { readonly mode: WeatherMode; readonly current: WeatherKind };
    setCurrent: (kind: WeatherKind) => void;
  };
  /** Builds the particles the first time any weather shows (clear-sky visits never pay for them). */
  createParticles: () => WeatherParticlesLike;
  /** Where the box of particles sits: the camera target. */
  getCenter: () => { x: number; z: number };
  /** Weather only falls on the village (home view with the block world on screen). */
  isVillageShown: () => boolean;
  /** Hours in [0, 24): particles dim at night. Omit for full brightness. */
  getTimeOfDay?: () => number;
  /** For the auto weather; tests pass a seeded one. */
  random?: () => number;
};

/** Particle brightness at full night (1 by day), so rain and snow don't glow in the dark. */
const NIGHT_PARTICLE_BRIGHTNESS = 0.4;

export type WeatherController = ReturnType<typeof createWeatherController>;

export function createWeatherController(deps: WeatherControllerDeps) {
  const { store, random = Math.random } = deps;

  /** Mutated in place; all zero whenever the weather isn't applied. */
  const levels: WeatherLevels = { rain: 0, snow: 0 };
  let particles: WeatherParticlesLike | null = null;
  let applied = false;
  let auto: AutoWeather | null = null;

  let brightnessTime = NaN;
  let brightness = 1;
  function particleBrightness(): number {
    const time = deps.getTimeOfDay?.();
    if (time === undefined) return 1;
    if (time !== brightnessTime) {
      brightnessTime = time;
      brightness = 1 - (1 - NIGHT_PARTICLE_BRIGHTNESS) * skyStateAt(time).night;
    }
    return brightness;
  }

  /** Take the weather off the scene: no particles, levels at 0 (so day/night lights as without it). */
  function release(): void {
    if (!applied) return;
    applied = false;
    levels.rain = 0;
    levels.snow = 0;
    particles?.hide();
  }

  /** Per frame, before the day/night controller's update (it reads getLevels()). */
  function update(delta: number, route: Route): void {
    if (route !== 'viewer' || !deps.isVillageShown()) {
      release();
      return;
    }
    const { mode } = store.get();
    let target: WeatherKind;
    if (mode === 'auto') {
      // The auto weather's clock only runs while it is on screen.
      auto = advanceAutoWeather(auto, applied ? delta : 0, random);
      store.setCurrent(auto.kind);
      target = auto.kind;
    } else {
      auto = null;
      target = mode;
    }
    if (!applied) {
      // Arriving on the home view: it is already raining, no fade.
      applied = true;
      setWeatherLevels(levels, target);
    } else {
      advanceWeatherLevels(levels, target, delta);
    }
    if (isClearWeather(levels)) {
      particles?.hide();
      return;
    }
    particles ??= deps.createParticles();
    particles.update(delta, deps.getCenter(), levels, particleBrightness());
  }

  return {
    update,
    release,
    /** How much rain and snow is in the air (0..1 each); both 0 off the home view. */
    getLevels: (): Readonly<WeatherLevels> => levels,
    /** 0..1: how hard it is raining (for the residents, who head for shelter). */
    getRain: (): number => levels.rain,
  };
}
