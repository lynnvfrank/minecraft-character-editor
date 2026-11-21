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
 *
 * Residents (optional `getRoster`): once the user has chosen who lives in the village, the crowd
 * only wears those skins, one character each, and `syncRoster` applies changes live: characters
 * whose skin was switched off are removed on the spot, new ones appear at a walkable spot.
 * Residents still stroll out and come back like any visitor. The primary is never removed.
 * With no roster (null) nothing changes: random visitors from every skin.
 * A character wearing a skin that isn't in the skin list (an edited design, e.g. a former primary
 * swapped back into the crowd) is never removed by the roster and doesn't use up a resident's place.
 * The user's own outfits (optional `outfits`) are residents too: the roster names one as
 * `outfit:<id>`, which is turned into the outfit's image and rig when the character appears.
 * Everything here that compares skins with the roster does so by roster key (`keyOf`).
 *
 * Social life (the sim decides who does what, this file picks the clips):
 * - Greeting: the sim's emote (a wave, a nod...) on each of the two, idle while waiting to answer.
 * - Plaza gathering: one of the user's saved combos (`getCombos`) on everyone in the group, in
 *   step (controllers/crowdComboPlayer.ts sets the blend weights); with no combos, or none whose
 *   clips exist, the sim's dance clip.
 * - Night: `getTimeOfDay` is turned into a 0..1 night level for the sim.
 * Clips are looked up by a preference list and fall back to idle, so a missing clip never breaks
 * a character.
 */
import * as THREE from 'three';
import { createCrowdSim, DEFAULT_CROWD_CONFIG, type CrowdConfig, type CrowdEvent } from '../animation/crowd';
import { comboToRoutine } from '../animation/crowdCombo';
import type { RoutineStep } from '../animation/studioRoutine';
import type { XZ } from '../animation/wander';
import { crowdSkinsFor, diffResidents, isCustomSkin, isOutfitKey } from '../domain/residents';
import type { SavedSequence } from '../domain/sequences';
import { logger } from '../lib';
import { skyStateAt } from '../lib/dayNight';
import { createCrowdComboPlayer } from './crowdComboPlayer';
import type { SkinEntry, AnimationEntry } from '../domain';
import { buildCharacterConfig, type CharacterConfig, type CharacterState } from './characterTypes';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

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
  /** Skins chosen to live in the village (primary included), or null for the default crowd. */
  getRoster?: () => readonly string[] | null;
  /** The user's outfits as residents (controllers/outfitResidents.ts). */
  outfits?: {
    /** Roster keys (`outfit:<id>`) of the outfits that exist. */
    keys: () => readonly string[];
    /** Roster key for a worn skin: an outfit's key for its image, any other skin unchanged. */
    keyOf: (skin: string) => string;
    /** Image and rig for an outfit key; null if there is no such outfit (any more). */
    resolve: (key: string) => { skin: string; modelPath: string } | null;
  };
  /** The user's saved combos; a plaza gathering dances one of them. */
  getCombos?: () => readonly SavedSequence[];
  /** Time of day in hours [0, 24); after dusk residents slow down and keep to the lamps. */
  getTimeOfDay?: () => number;
  config?: Partial<CrowdConfig>;
};

/** Tried in order after the sim's own pick when that clip is missing; idle is the last resort. */
const GREET_FALLBACK = ['waving', 'acknowledging', 'hard-head-nod'];
const DANCE_FALLBACK = ['groove', 'dancing-twerk', 'happy', 'excited', 'clapping'];

/** Give up on a crowd model that hasn't loaded after this long. */
const LOAD_TIMEOUT_SEC = 30;
const FADE_SEC = 0.35;
/** After a roster change, missing residents appear one at a time this far apart (spreads the loads). */
const QUICK_FILL_SEC = 0.4;

export type CrowdController = ReturnType<typeof createCrowdController>;

export function createCrowdController(deps: CrowdControllerDeps) {
  const config: CrowdConfig = { ...DEFAULT_CROWD_CONFIG, ...deps.config };
  /** The sim reads config.maxAgents live; with a roster it shrinks to the residents still to host. */
  const baseMaxAgents = config.maxAgents;
  const sim = createCrowdSim(config);
  /** Agents whose model is still loading → seconds waited and the skin on its way. */
  const pending = new Map<string, { waited: number; skin: string }>();
  /** Timed-out loads: if the model shows up after all, remove it instead of leaving it orphaned. */
  const abandoned = new Set<string>();
  let started = false;
  /** Roster just changed: bring missing residents in right away instead of waiting for the spawn timer. */
  let quickFill = false;
  let quickFillTimer = 0;

  const combos = createCrowdComboPlayer();
  /** What the gathering in progress dances: a saved combo as routine steps, or null for a clip. */
  let groupDance: { gatheringId: number; routine: RoutineStep[] | null } | null = null;

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

  /** The first of `keys` this character has a clip for, else idle. */
  function clipFor(char: CharacterState, keys: readonly (string | null)[]): THREE.AnimationAction | undefined {
    for (const key of keys) {
      const action = key ? char.actions[key] : undefined;
      if (action) return action;
    }
    return char.idleAction;
  }

  /** A random saved combo this rig can play, as routine steps; null if there is none. */
  function pickCombo(): RoutineStep[] | null {
    const list = deps.getCombos?.() ?? [];
    if (list.length === 0) return null;
    const known = new Set(deps.getAnimations().map((a) => a.key));
    const start = Math.floor(Math.random() * list.length);
    for (let i = 0; i < list.length; i++) {
      const routine = comboToRoutine(list[(start + i) % list.length]!.steps, (name) => known.has(name));
      if (routine.length > 0) return routine;
    }
    return null;
  }

  function playForPhase(id: string): void {
    const agent = sim.get(id);
    const char = getChar(id);
    if (!agent || !char) return;
    // Whatever comes next goes through fadeToAction again.
    combos.stop(char);
    switch (agent.phase) {
      case 'entering':
      case 'walking':
      case 'exiting':
      case 'gathering':
        playLoop(char, char.actions['walking'] ?? char.idleAction);
        break;
      case 'emoting':
        playLoop(char, clipFor(char, [agent.emote]));
        break;
      case 'greeting':
        // The answering side idles (and turns) until its reply starts.
        playLoop(char, agent.emote ? clipFor(char, [agent.emote, ...GREET_FALLBACK]) : char.idleAction);
        break;
      case 'performing': {
        const routine = groupDance && groupDance.gatheringId === agent.group ? groupDance.routine : null;
        // Only clips this character really has (a rig that failed to load some keeps idling).
        if (routine && routine.some((s) => s.type === 'blend' && s.layers.every((l) => char.actions[l.name]))) {
          combos.start(char, routine);
        } else {
          playLoop(char, clipFor(char, [agent.emote, ...DANCE_FALLBACK]));
        }
        break;
      }
      default:
        playLoop(char, char.idleAction);
    }
  }

  /** What a character wears, as the roster names it (an outfit's key rather than its image). */
  function keyOf(skin: string | null | undefined): string | null {
    if (skin == null) return null;
    return deps.outfits?.keyOf(skin) ?? skin;
  }

  /** Everything a roster may name: bundled skin paths and outfit keys. */
  function rosterKeys(): string[] {
    return [...deps.getSkins().map((s) => s.path), ...(deps.outfits?.keys() ?? [])];
  }

  function primarySkin(): string | null {
    return keyOf(getChar(deps.getPrimaryCharacterId())?.currentSkin);
  }

  /** Skins the crowd should wear under the roster (null = no roster, anything goes). */
  function wantedCrowdSkins(): string[] | null {
    const roster = deps.getRoster?.() ?? null;
    if (!roster) return null;
    const known = new Set(rosterKeys());
    return crowdSkinsFor(roster.filter((s) => known.has(s)), primarySkin());
  }

  /** Wanted skins nobody in the scene wears (or is loading) yet. */
  function missingResidents(wanted: readonly string[]): string[] {
    const worn = new Set(Object.values(deps.getSceneContext().characters).map((c) => keyOf(c.currentSkin)));
    for (const p of pending.values()) worn.add(p.skin);
    return wanted.filter((s) => !worn.has(s));
  }

  /** Skins already worn by someone in the scene, so the crowd isn't full of twins. */
  function pickSkin(): string | null {
    const wanted = wantedCrowdSkins();
    if (wanted) {
      // Residents: one character per chosen skin, never a twin.
      const missing = missingResidents(wanted);
      return missing.length > 0 ? missing[Math.floor(Math.random() * missing.length)]! : null;
    }
    const skins = deps.getSkins();
    if (skins.length === 0) return null;
    const worn = new Set(Object.values(deps.getSceneContext().characters).map((c) => c.currentSkin));
    const free = skins.filter((s) => !worn.has(s.path));
    const pool = free.length > 0 ? free : skins;
    return pool[Math.floor(Math.random() * pool.length)]!.path;
  }

  /** A walkable spot with nobody standing on it (a new resident appears there). */
  function pickSpot(): XZ {
    const spots = config.nav?.spots ?? [];
    const taken: XZ[] = sim.list().map((a) => ({ x: a.x, z: a.z }));
    const primary = getChar(deps.getPrimaryCharacterId())?.container.position;
    if (primary) taken.push({ x: primary.x, z: primary.z });
    let spot: XZ = { x: 0, z: 0 };
    for (let i = 0; i < 12; i++) {
      if (spots.length > 0) {
        spot = spots[Math.floor(Math.random() * spots.length)]!;
      } else {
        const r = config.zoneRadius * 0.85 * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        spot = { x: Math.sin(a) * r, z: Math.cos(a) * r };
      }
      const p = spot;
      if (taken.every((t) => Math.hypot(t.x - p.x, t.z - p.z) >= config.personalSpace * 2)) break;
    }
    return spot;
  }

  /** Start loading a crowd character. Walks in from the edge unless `at` says where it appears. */
  function spawn(skin: string | null = pickSkin(), at?: XZ): boolean {
    if (!skin) return false;
    // `skin` is a roster key: an outfit brings its own image and rig.
    const outfit = deps.outfits?.resolve(skin) ?? null;
    if (!outfit && isOutfitKey(skin)) return false; // deleted outfit: nothing to wear
    const id = sim.reserve(at);
    if (!id) return false;
    pending.set(id, { waited: 0, skin });
    const agent = sim.get(id)!;
    void (outfit ? Promise.resolve(outfit.modelPath) : deps.resolveModelPath(skin)).then((modelPath) => {
      if (!sim.get(id)) return; // removed while resolving
      const cfg = buildCharacterConfig(outfit?.skin ?? skin, deps.getAnimations(), id, modelPath);
      cfg.label = `Crowd ${id}`;
      cfg.position = new THREE.Vector3(agent.x, 0, agent.z);
      deps.loadCharacter(cfg, deps.getSkins());
      logger.debug('general', 'Crowd spawn', { id, skin });
    });
    return true;
  }

  function despawn(id: string): void {
    pending.delete(id);
    const chars = deps.getSceneContext().characters;
    const char = chars[id];
    if (!char) return;
    combos.drop(char);
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
      else if (e.type === 'gathering') {
        // 'performing' arrives just before the members' phase events, which start the dance.
        if (e.stage === 'performing') groupDance = { gatheringId: e.id, routine: pickCombo() };
        else if (e.stage === 'ended' && groupDance?.gatheringId === e.id) groupDance = null;
        logger.debug('general', 'Crowd gathering', { id: e.id, stage: e.stage, members: e.ids.length });
      }
    }
  }

  function checkPending(dt: number): void {
    for (const id of abandoned) {
      if (!getChar(id)) continue;
      abandoned.delete(id);
      despawn(id);
    }
    for (const [id, entry] of pending) {
      const char = getChar(id);
      if (char) {
        pending.delete(id);
        sim.activate(id);
        continue;
      }
      if (entry.waited + dt > LOAD_TIMEOUT_SEC) {
        pending.delete(id);
        sim.remove(id);
        abandoned.add(id);
        logger.warn('general', 'Crowd model never loaded; dropped', { id });
      } else {
        entry.waited += dt;
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
    applyRosterLimits(step);
    // The selected character isn't in the sim; the crowd keeps clear of it.
    const primary = getChar(deps.getPrimaryCharacterId())?.container.position;
    const night = deps.getTimeOfDay ? skyStateAt(deps.getTimeOfDay()).night : 0;
    handleEvents(sim.tick(step, primary ? [{ x: primary.x, z: primary.z }] : [], { night }));
    combos.update(step);
    applyTransforms();
  }

  /** Take a crowd character out of the world right now (its skin left the roster). */
  function removeResident(id: string): void {
    const stillLoading = pending.has(id) && !getChar(id);
    sim.remove(id);
    // Not in the scene yet: if the model shows up later, checkPending disposes of it.
    if (stillLoading) abandoned.add(id);
    despawn(id);
  }

  /** Per frame: with a roster, the crowd is only as big as the residents it still has to host. */
  function applyRosterLimits(dt: number): void {
    const wanted = wantedCrowdSkins();
    // Custom-skin characters are guests on top of the roster, not one of its residents.
    config.maxAgents = wanted ? Math.min(baseMaxAgents, wanted.length) + customSkinCount() : baseMaxAgents;
    if (!wanted) {
      quickFill = false;
      return;
    }
    if (!quickFill) return;
    quickFillTimer -= dt;
    if (quickFillTimer > 0) return;
    const missing = missingResidents(wanted);
    // Done, or no room (someone is still on their way out): the spawn timer takes it from here.
    if (missing.length === 0 || !spawn(missing[0]!, pickSpot())) {
      quickFill = false;
      return;
    }
    quickFillTimer = QUICK_FILL_SEC;
  }

  /** Crowd characters wearing a skin that isn't in the skin list (an edited design). */
  function customSkinCount(): number {
    const available = rosterKeys();
    return sim.list().filter((a) => isCustomSkin(keyOf(getChar(a.id)?.currentSkin), available)).length;
  }

  /**
   * The roster changed (Residents panel): remove crowd characters whose skin is no longer wanted
   * (and twins), then let the missing ones appear. The primary is not in the sim, so it is never
   * removed here, and neither is anyone wearing a custom skin (the roster can't name those).
   * Does nothing without a roster.
   */
  function syncRoster(): void {
    const wanted = wantedCrowdSkins();
    if (!wanted || !started) return;
    const current = sim.list().map((a) => ({
      id: a.id,
      skin: keyOf(getChar(a.id)?.currentSkin) ?? pending.get(a.id)?.skin ?? null,
    }));
    const { toAdd, toRemove } = diffResidents(current, wanted, rosterKeys());
    for (const id of toRemove) removeResident(id);
    if (toAdd.length > 0) {
      quickFill = true;
      quickFillTimer = 0;
    }
    logger.debug('general', 'Crowd roster applied', { added: toAdd.length, removed: toRemove.length });
  }

  /** Skins in the world right now as roster keys, the primary's first (crowd models still loading included). */
  function presentSkins(): string[] {
    const out: string[] = [];
    const main = primarySkin();
    if (main) out.push(main);
    for (const a of sim.list()) {
      const skin = keyOf(getChar(a.id)?.currentSkin) ?? pending.get(a.id)?.skin;
      if (skin) out.push(skin);
    }
    return out;
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

    // Leaves its greeting or gathering (the sim lets the others carry on) and any combo it danced.
    sim.remove(id);
    combos.stop(picked);
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
    syncRoster,
    presentSkins,
    primarySkin,
    /** Most skins the village holds at once: the crowd's limit plus the primary. */
    residentsCap: baseMaxAgents + 1,
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
