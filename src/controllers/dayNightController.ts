/**
 * World day and night for the home view: turns the stored time of day (state/timeOfDay.ts) into a
 * sky state (lib/dayNight.ts) and lays it over the scene's lighting (viewer/scene.ts
 * setDayNightLighting), lights the village lamps after dusk, and runs the auto-cycle.
 *
 * Day/night *modulates* the active lighting preset rather than replacing it: tints and scales on
 * the preset's own colors and strengths, all neutral at midday. It applies on the home route only
 * and hands the plain preset back the moment the route changes, so the creator, preview and studio
 * are lit exactly as they are without it (thumbnail captures also suspend it themselves).
 */
import * as THREE from 'three';
import {
  DAY_SKY_COLOR,
  DEFAULT_DAY_LENGTH_SECONDS,
  REFERENCE_LIGHT_DIRECTION,
  advanceTimeOfDay,
  skyStateAt,
  type SkyState,
} from '../lib/dayNight';
import { setDayNightLighting } from '../viewer/scene';
import { DEFAULT_LAMP_EMISSIVE, LAMP_LIGHT_NAME } from '../viewer/blockWorldMesh';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type DayNightControllerDeps = {
  scene: THREE.Scene;
  store: {
    get: () => { readonly time: number; readonly auto: boolean };
    setTime: (time: number, save?: boolean) => void;
    persist: () => void;
  };
  /** The village's lamps (omit with `?world=0`: the sky and lights still change). */
  lamps?: {
    positions: readonly { x: number; y: number; z: number }[];
    setGlow: (emissiveIntensity: number) => void;
    isShown: () => boolean;
  } | null;
  /** Seconds of real time for a full day while Auto is on. */
  dayLengthSeconds?: number;
};

/** Real lights cost every pixel: only this many lamps (nearest the plaza) cast light. */
const MAX_LAMP_LIGHTS = 4;
const LAMP_LIGHT_COLOR = 0xffb45a;
/** Point light strength at full glow, and how far it reaches (world units = blocks). */
const LAMP_LIGHT_INTENSITY = 7;
const LAMP_LIGHT_DISTANCE = 9;
/** Lamp block emissive: a soft unlit lantern by day, bright at night. */
const LAMP_EMISSIVE_DAY = 0.6;
const LAMP_EMISSIVE_NIGHT = 2.4;
/** While Auto runs, write the time to storage this often (not every frame). */
const AUTO_SAVE_SECONDS = 5;

export type DayNightController = ReturnType<typeof createDayNightController>;

export function createDayNightController(deps: DayNightControllerDeps) {
  const { scene, store, lamps = null, dayLengthSeconds = DEFAULT_DAY_LENGTH_SECONDS } = deps;

  /** Lamp lights are made the first time the village shows at home, so other routes never pay for them. */
  let lampLights: THREE.PointLight[] | null = null;
  function ensureLampLights(): THREE.PointLight[] {
    if (lampLights) return lampLights;
    const nearest = [...(lamps?.positions ?? [])]
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
      .slice(0, MAX_LAMP_LIGHTS);
    lampLights = nearest.map((p) => {
      const light = new THREE.PointLight(LAMP_LIGHT_COLOR, 0, LAMP_LIGHT_DISTANCE, 2);
      light.name = LAMP_LIGHT_NAME;
      light.position.set(p.x, p.y, p.z);
      light.castShadow = false;
      light.visible = false;
      scene.add(light);
      return light;
    });
    return lampLights;
  }

  function applyLamps(glow: number, lightsOn: boolean): void {
    lamps?.setGlow(lightsOn ? THREE.MathUtils.lerp(LAMP_EMISSIVE_DAY, LAMP_EMISSIVE_NIGHT, glow) : DEFAULT_LAMP_EMISSIVE);
    if (!lightsOn && !lampLights) return;
    for (const light of ensureLampLights()) {
      // Visible for the whole home visit, not just at night: showing or hiding a light makes
      // three.js rebuild every material's shader, which would hitch at each dusk and dawn.
      light.visible = lightsOn;
      light.intensity = lightsOn ? LAMP_LIGHT_INTENSITY * glow : 0;
    }
  }

  function applySky(s: SkyState): void {
    setDayNightLighting({
      // The sky color is defined against a clear midday; scale whatever sky the preset/theme has.
      skyScale: [
        s.skyColor[0] / DAY_SKY_COLOR[0],
        s.skyColor[1] / DAY_SKY_COLOR[1],
        s.skyColor[2] / DAY_SKY_COLOR[2],
      ],
      lightDirection: s.lightDirection,
      referenceDirection: REFERENCE_LIGHT_DIRECTION,
      presetDirection: s.daylight,
      sunTint: s.sunColor,
      sunScale: s.sunIntensity,
      ambientTint: s.ambientTint,
      ambientScale: s.ambientIntensity,
    });
  }

  let applied = false;
  let appliedTime = NaN;
  let appliedLampsShown: boolean | null = null;
  let sinceSave = 0;

  /** Give the scene back to the plain lighting preset. */
  function release(): void {
    if (!applied) return;
    applied = false;
    appliedTime = NaN;
    appliedLampsShown = null;
    setDayNightLighting(null);
    applyLamps(0, false);
    if (sinceSave > 0) {
      store.persist();
      sinceSave = 0;
    }
  }

  /** Per frame (after the block world's own update, so its visibility is current). */
  function update(delta: number, route: Route): void {
    if (route !== 'viewer') {
      release();
      return;
    }
    const { auto, time: before } = store.get();
    if (auto && delta > 0) {
      store.setTime(advanceTimeOfDay(before, delta, dayLengthSeconds), false);
      sinceSave += delta;
      if (sinceSave >= AUTO_SAVE_SECONDS) {
        store.persist();
        sinceSave = 0;
      }
    }
    const time = store.get().time;
    const lampsShown = lamps?.isShown() ?? false;
    if (applied && time === appliedTime && lampsShown === appliedLampsShown) return;
    applied = true;
    appliedTime = time;
    appliedLampsShown = lampsShown;
    const s = skyStateAt(time);
    applySky(s);
    applyLamps(s.lampGlow, lampsShown);
  }

  return { update, release };
}
