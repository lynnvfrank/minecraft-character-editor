/**
 * Crowd in the home "creative space": loads extra characters, drives them from the pure crowd
 * simulation (animation/crowd.ts), and hands one over to the primary slot when the user picks it.
 *
 * The primary character (DEFAULT_CHARACTER_ID) is the one the creator, Move panel and animation
 * manager act on. Picking a crowd character swaps the two CharacterState records: the picked one
 * becomes the primary and the previous primary joins the crowd where it stands (and will wander
 * off in time). Nothing moves on screen, so the swap is invisible.
 *
 * The world stops outside the home view: the simulation and crowd mixers pause and the crowd is
 * hidden (it would clutter the creator and the preview/thumbnail captures).
 */
import * as THREE from 'three';
import { createCrowdSim, DEFAULT_CROWD_CONFIG, type CrowdConfig, type CrowdEvent } from '../animation/crowd';
import { logger } from '../lib';
import type { SkinEntry, AnimationEntry } from '../domain';
import { buildCharacterConfig, type CharacterConfig, type CharacterState } from './characterTypes';

type Route = 'creator' | 'viewer' | 'preview';

export type CrowdControllerDeps = {
  getSceneContext: () => { scene: THREE.Scene; characters: Record<string, CharacterState> };
  getPrimaryCharacterId: () => string;
  loadCharacter: (config: CharacterConfig, skins: SkinEntry[]) => void;
  fadeToAction: (char: CharacterState, action: THREE.AnimationAction, duration?: number) => void;
  getAction: (charId: string, key: string) => THREE.AnimationAction | undefined;
  getSkins: () => SkinEntry[];
  getAnimations: () => AnimationEntry[];
  /** Rig for a skin (slim or classic arms). */
  resolveModelPath: (skinPath: string) => Promise<string>;
  config?: Partial<CrowdConfig>;
};

/** Give up on a crowd model that hasn't loaded after this long. */
const LOAD_TIMEOUT_SEC = 30;
const FADE_SEC = 0.35;

export type CrowdController = ReturnType<typeof createCrowdController>;

export function createCrowdController(deps: CrowdControllerDeps) {
  const config: CrowdConfig = { ...DEFAULT_CROWD_CONFIG, ...deps.config };
  const sim = createCrowdSim(config);
  /** Agents whose model is still loading → seconds waited. */
  const pending = new Map<string, number>();
  /** Timed-out loads: if the model shows up after all, remove it instead of leaving it orphaned. */
  const abandoned = new Set<string>();
  let started = false;

  const zoneRing = createZoneRing(config.zoneRadius);
  deps.getSceneContext().scene.add(zoneRing);

  function getChar(id: string): CharacterState | undefined {
    return deps.getSceneContext().characters[id];
  }

  function isCrowdCharacter(id: string): boolean {
    return sim.get(id) !== undefined;
  }

  /** Crowd mixers only run in the home view; the primary always runs. */
  function shouldUpdateCharacter(char: CharacterState, route: Route): boolean {
    return route === 'viewer' || !isCrowdCharacter(char.id);
  }

  function playLoop(char: CharacterState, action: THREE.AnimationAction | undefined): void {
    if (!action) return;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    deps.fadeToAction(char, action, FADE_SEC);
  }

  function playForPhase(id: string): void {
    const agent = sim.get(id);
    const char = getChar(id);
    if (!agent || !char) return;
    switch (agent.phase) {
      case 'entering':
      case 'walking':
      case 'exiting':
        playLoop(char, char.actions['walking'] ?? char.idleAction);
        break;
      case 'emoting':
        playLoop(char, (agent.emote && char.actions[agent.emote]) || char.idleAction);
        break;
      default:
        playLoop(char, char.idleAction);
    }
  }

  /** Skins already worn by someone in the scene, so the crowd isn't full of twins. */
  function pickSkin(): string | null {
    const skins = deps.getSkins();
    if (skins.length === 0) return null;
    const worn = new Set(Object.values(deps.getSceneContext().characters).map((c) => c.currentSkin));
    const free = skins.filter((s) => !worn.has(s.path));
    const pool = free.length > 0 ? free : skins;
    return pool[Math.floor(Math.random() * pool.length)]!.path;
  }

  function spawn(): void {
    const skin = pickSkin();
    if (!skin) return;
    const id = sim.reserve();
    if (!id) return;
    pending.set(id, 0);
    const agent = sim.get(id)!;
    void deps.resolveModelPath(skin).then((modelPath) => {
      if (!sim.get(id)) return; // removed while resolving
      const cfg = buildCharacterConfig(skin, deps.getAnimations(), id, modelPath);
      cfg.label = `Crowd ${id}`;
      cfg.position = new THREE.Vector3(agent.x, 0, agent.z);
      deps.loadCharacter(cfg, deps.getSkins());
      logger.debug('general', 'Crowd spawn', { id, skin });
    });
  }

  function despawn(id: string): void {
    pending.delete(id);
    const chars = deps.getSceneContext().characters;
    const char = chars[id];
    if (!char) return;
    char.mixer.stopAllAction();
    char.mixer.uncacheRoot(char.model);
    char.container.removeFromParent();
    char.container.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m?.dispose();
      }
    });
    delete chars[id];
    logger.debug('general', 'Crowd despawn', { id });
  }

  function handleEvents(events: CrowdEvent[]): void {
    for (const e of events) {
      if (e.type === 'spawn-request') spawn();
      else if (e.type === 'phase') playForPhase(e.id);
      else if (e.type === 'despawn') despawn(e.id);
    }
  }

  function checkPending(dt: number): void {
    for (const id of abandoned) {
      if (!getChar(id)) continue;
      abandoned.delete(id);
      despawn(id);
    }
    for (const [id, waited] of pending) {
      const char = getChar(id);
      if (char) {
        pending.delete(id);
        sim.activate(id);
        continue;
      }
      if (waited + dt > LOAD_TIMEOUT_SEC) {
        pending.delete(id);
        sim.remove(id);
        abandoned.add(id);
        logger.warn('general', 'Crowd model never loaded; dropped', { id });
      } else {
        pending.set(id, waited + dt);
      }
    }
  }

  function applyTransforms(): void {
    for (const agent of sim.list()) {
      const char = getChar(agent.id);
      if (!char) continue;
      char.container.position.set(agent.x, 0, agent.z);
      char.model.rotation.y = agent.facing;
    }
  }

  function setCrowdVisible(visible: boolean): void {
    // With a walkable world the whole map is the zone; the ring would cut through houses.
    zoneRing.visible = visible && !config.nav;
    for (const agent of sim.list()) {
      const char = getChar(agent.id);
      if (char) char.container.visible = visible;
    }
  }

  /** Per frame. `running` is false while the world is paused (creator, transitions). */
  function update(dt: number, route: Route, running: boolean): void {
    setCrowdVisible(route === 'viewer');
    // Wait for the primary so its load always wins the race for "first character ready".
    if (!started) {
      if (!getChar(deps.getPrimaryCharacterId()) || deps.getSkins().length === 0) return;
      started = true;
    }
    if (route !== 'viewer' || !running) return;
    const step = Math.min(dt, 0.1); // a backgrounded tab returns with a huge delta
    checkPending(step);
    handleEvents(sim.tick(step));
    applyTransforms();
  }

  /**
   * Make crowd character `id` the primary. The previous primary joins the crowd where it stands.
   * Returns the new primary, or null if `id` isn't a (loaded) crowd character.
   */
  function swapIntoPrimary(id: string): CharacterState | null {
    const chars = deps.getSceneContext().characters;
    const primaryId = deps.getPrimaryCharacterId();
    const picked = chars[id];
    const previous = chars[primaryId];
    if (!picked || !previous || !isCrowdCharacter(id) || pending.has(id)) return null;

    sim.remove(id);
    picked.id = primaryId;
    previous.id = id;
    chars[primaryId] = picked;
    chars[id] = previous;

    const p = previous.container.position;
    sim.addAgentAt(id, p.x, p.z, previous.model.rotation.y);
    playLoop(previous, previous.idleAction);
    logger.info('general', 'Crowd character selected', { skin: picked.currentSkin, previousNowCrowd: id });
    return picked;
  }

  return {
    update,
    shouldUpdateCharacter,
    isCrowdCharacter,
    swapIntoPrimary,
    zoneRadius: config.zoneRadius,
    edgeRadius: config.edgeRadius,
    /** For tests and debugging. */
    sim,
  };
}

/** Faint ring on the ground marking the edge of the creative zone. */
function createZoneRing(radius: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(radius - 0.04, radius + 0.04, 128);
  const mat = new THREE.MeshBasicMaterial({
    // Mid blue reads on both the dark and the light theme's ground.
    color: 0x6f8cff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.name = 'creative-zone-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.renderOrder = 1;
  return ring;
}
