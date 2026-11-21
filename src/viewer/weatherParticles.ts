/**
 * Rain and snow for the home view: a fixed set of particles in a box around a centre (the
 * camera's target), recycled as they fall (lib/weather.ts recycleParticle), so the field follows
 * the camera without respawning anything.
 *
 * - Rain: short slanted streaks, one line segment per drop.
 * - Snow: square (blocky) flakes that drift sideways as they fall, one point per flake.
 *
 * Both use the stock three.js materials (no custom shaders), don't write depth, and are built the
 * first time their kind is needed. Nothing is allocated per frame.
 * controllers/weatherController.ts drives this; thumbnail captures hide the group by name
 * (viewer/thumbnailCapture.ts).
 */
import * as THREE from 'three';
import {
  easeWeatherLevel,
  recycleParticle,
  weatherParticleCount,
  type ParticleBox,
  type WeatherLevels,
} from '../lib/weather';

export const WEATHER_NAME = 'weather';

/** Half the side of the square column of weather, and its height above the ground. */
const BOX_HALF_WIDTH = 12;
const BOX_TOP = 11;

/** Rain: fall speed (units/s), wind, and how long a streak is in seconds of travel. */
const RAIN_FALL = 15;
const RAIN_WIND_X = 2.6;
const RAIN_WIND_Z = 1.1;
const RAIN_STREAK_SECONDS = 0.035;
const RAIN_COLOR = 0xa9c6ea;
const RAIN_OPACITY = 0.55;

/** Snow: fall speed, a steady breeze, and how far flakes sway either side of it. */
const SNOW_FALL = 1.3;
const SNOW_BREEZE_X = 0.45;
const SNOW_SWAY = 0.7;
/** Flake size in world units (a block is 1). */
const SNOW_SIZE = 0.11;
const SNOW_COLOR = 0xffffff;
const SNOW_OPACITY = 0.92;

/** Cheap deterministic hash in [0, 1). */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return s - Math.floor(s);
}

function scatter(out: Float32Array, count: number): void {
  for (let i = 0; i < count; i++) {
    out[i * 3] = (hash(i * 3 + 1) * 2 - 1) * BOX_HALF_WIDTH;
    out[i * 3 + 1] = hash(i * 3 + 2) * BOX_TOP;
    out[i * 3 + 2] = (hash(i * 3 + 3) * 2 - 1) * BOX_HALF_WIDTH;
  }
}

export type WeatherScreen = { width: number; height: number; pixelRatio: number };

export type WeatherParticles = ReturnType<typeof createWeatherParticles>;

export function createWeatherParticles(scene: THREE.Scene, screen: WeatherScreen | null = null) {
  const group = new THREE.Group();
  group.name = WEATHER_NAME;
  group.visible = false;
  scene.add(group);

  const box: ParticleBox = { centerX: 0, centerZ: 0, halfWidth: BOX_HALF_WIDTH, bottom: 0, top: BOX_TOP };
  const disposables: { dispose(): void }[] = [];
  let time = 0;

  type Rain = {
    lines: THREE.LineSegments;
    material: THREE.LineBasicMaterial;
    attribute: THREE.BufferAttribute;
    heads: Float32Array;
    segments: Float32Array;
    speed: Float32Array;
    count: number;
  };
  let rain: Rain | null = null;
  function ensureRain(): Rain {
    if (rain) return rain;
    const count = weatherParticleCount('rain', screen);
    const heads = new Float32Array(count * 3);
    scatter(heads, count);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) speed[i] = 0.8 + 0.4 * hash(i + 0.5);
    const segments = new Float32Array(count * 6);
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(segments, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: RAIN_COLOR, transparent: true, opacity: 0, depthWrite: false });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = 'weather-rain';
    // The particles move every frame; the box is always around the camera target.
    lines.frustumCulled = false;
    lines.visible = false;
    group.add(lines);
    disposables.push(geometry, material);
    return (rain = { lines, material, attribute, heads, segments, speed, count });
  }

  type Snow = {
    points: THREE.Points;
    material: THREE.PointsMaterial;
    attribute: THREE.BufferAttribute;
    positions: Float32Array;
    seed: Float32Array;
    count: number;
  };
  let snow: Snow | null = null;
  function ensureSnow(): Snow {
    if (snow) return snow;
    const count = weatherParticleCount('snow', screen);
    const positions = new Float32Array(count * 3);
    scatter(positions, count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = hash(i + 0.25);
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    // No texture: points draw as squares, which is the blocky flake we want.
    const material = new THREE.PointsMaterial({
      color: SNOW_COLOR,
      size: SNOW_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'weather-snow';
    points.frustumCulled = false;
    points.visible = false;
    group.add(points);
    disposables.push(geometry, material);
    return (snow = { points, material, attribute, positions, seed, count });
  }

  function updateRain(dt: number, level: number, brightness: number): void {
    if (level <= 0) {
      if (rain) rain.lines.visible = false;
      return;
    }
    const r = ensureRain();
    const eased = easeWeatherLevel(level);
    const drawn = Math.min(r.count, Math.ceil(r.count * eased));
    const { heads, segments, speed } = r;
    for (let i = 0; i < drawn; i++) {
      const k = speed[i]!;
      const vx = RAIN_WIND_X * k;
      const vy = -RAIN_FALL * k;
      const vz = RAIN_WIND_Z * k;
      recycleParticle(heads, i, vx, vy, vz, dt, box);
      const h = i * 3;
      const s = i * 6;
      const x = heads[h]!;
      const y = heads[h + 1]!;
      const z = heads[h + 2]!;
      segments[s] = x;
      segments[s + 1] = y;
      segments[s + 2] = z;
      segments[s + 3] = x - vx * RAIN_STREAK_SECONDS;
      segments[s + 4] = y - vy * RAIN_STREAK_SECONDS;
      segments[s + 5] = z - vz * RAIN_STREAK_SECONDS;
    }
    r.attribute.needsUpdate = true;
    r.lines.geometry.setDrawRange(0, drawn * 2);
    r.material.opacity = RAIN_OPACITY * eased;
    r.material.color.setHex(RAIN_COLOR).multiplyScalar(brightness);
    r.lines.visible = true;
  }

  function updateSnow(dt: number, level: number, brightness: number): void {
    if (level <= 0) {
      if (snow) snow.points.visible = false;
      return;
    }
    const s = ensureSnow();
    const eased = easeWeatherLevel(level);
    const drawn = Math.min(s.count, Math.ceil(s.count * eased));
    const { positions, seed } = s;
    for (let i = 0; i < drawn; i++) {
      const k = seed[i]!;
      const phase = k * 6.2832;
      recycleParticle(
        positions,
        i,
        SNOW_BREEZE_X + Math.sin(time * 0.9 + phase) * SNOW_SWAY,
        -SNOW_FALL * (0.7 + 0.6 * k),
        Math.cos(time * 0.7 + phase * 1.7) * SNOW_SWAY * 0.7,
        dt,
        box
      );
    }
    s.attribute.needsUpdate = true;
    s.points.geometry.setDrawRange(0, drawn);
    s.material.opacity = SNOW_OPACITY * eased;
    s.material.color.setHex(SNOW_COLOR).multiplyScalar(brightness);
    s.points.visible = true;
  }

  /**
   * Per frame while weather shows. `center` is where the box of particles sits (the camera
   * target); `brightness` (0..1) dims the particles with the daylight so they don't glow at night.
   */
  function update(
    dtSeconds: number,
    center: { x: number; z: number },
    levels: Readonly<WeatherLevels>,
    brightness = 1
  ): void {
    const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
    time += dt;
    box.centerX = center.x;
    box.centerZ = center.z;
    updateRain(dt, levels.rain, brightness);
    updateSnow(dt, levels.snow, brightness);
    group.visible = levels.rain > 0 || levels.snow > 0;
  }

  /** Nothing on screen (other routes, clear weather). */
  function hide(): void {
    group.visible = false;
  }

  return {
    group,
    update,
    hide,
    dispose: () => {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
