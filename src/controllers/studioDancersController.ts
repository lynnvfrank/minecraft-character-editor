/**
 * Backup dancers in the dance studio (`#/studio`): up to two extra characters that stand around
 * the lead (the primary character) and copy what the studio is doing to it.
 *
 * They exist only on the studio stage. They are loaded when the studio is open and the "Dancers"
 * count is above 0, and removed from the scene and disposed as soon as the route changes or the
 * count is lowered, so the home view, creator, preview and thumbnail captures never see them.
 *
 * They are loaded with the shared `loadCharacter` (like the crowd), which registers a character
 * in the scene's `characters` record when its clips are in. This controller takes it straight
 * back out of that record and keeps it privately: backup dancers are not part of the crowd
 * simulation, can't be selected, are ignored by the character AI and the animation manager, and
 * the main loop doesn't update their mixers (this controller does).
 *
 * Driving: every frame the lead's effective clip weights (the studio controller's `applied` map,
 * for the live mix and the routine preview alike) go into a short history. Each dancer gets the
 * weights from `offsetSec` ago on its own mixer. With no delay the clip times are copied from the
 * lead as well, so the group stays frame-exact; with a delay each clip starts where the lead's was
 * `offsetSec` earlier and then runs on its own clock.
 */
import * as THREE from 'three';
import { logger } from '../lib';
import { createSnapshotHistory } from '../lib/snapshotHistory';
import {
  formationOffsets,
  groupFraming,
  groupShot,
  MAX_DANCE_OFFSET_SEC,
  pickDancerSkins,
  reframeDecision,
  stageToWorld,
  type Formation,
  type GroupDanceSettings,
  type GroupShot,
  type PendingReframe,
} from '../domain/groupDance';
import type { SkinEntry, AnimationEntry } from '../domain';
import { buildCharacterConfig, type CharacterConfig, type CharacterState } from './characterTypes';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';
type ClipWeights = ReadonlyMap<string, { weight: number; timeScale: number }>;

export type StudioDancersDeps = {
  getSceneContext: () => {
    scene: THREE.Scene;
    characters: Record<string, CharacterState>;
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; update: () => void };
  };
  /** The character the studio mixes on (the primary). */
  getLead: () => CharacterState | undefined;
  /** What the studio applies to the lead right now (`studio.getSnapshot().applied`). */
  getLeadWeights: () => ClipWeights;
  /** Visual heading of the lead (radians). */
  getFacing: () => number;
  getSettings: () => GroupDanceSettings;
  loadCharacter: (config: CharacterConfig, skins: SkinEntry[]) => void;
  getSkins: () => SkinEntry[];
  getAnimations: () => AnimationEntry[];
  /** Rig for a skin (slim or classic arms). */
  resolveModelPath: (skinPath: string) => Promise<string>;
  /** Skins chosen to live in the village, or null when the user never chose. */
  getRoster: () => readonly string[] | null;
  /**
   * How many times the user has taken the camera (drag, framing button, turntable). The group is
   * framed again once its dancers have loaded, but only while this hasn't changed.
   */
  getCameraSerial?: () => number;
  random?: () => number;
};

/** Give up on a dancer whose model hasn't loaded after this long. */
const LOAD_TIMEOUT_SEC = 30;
/** Models load far below the stage, so a load that fails halfway leaves nothing in view. */
const OFFSTAGE_Y = -1000;
/** Same three-quarter angle and heights as the studio's own solo framing. */
const CAMERA_SIDE_ANGLE = 0.45;
const CAMERA_TARGET_HEIGHT = 1;
const CAMERA_HEIGHT = 1.8;

type Slot = {
  id: string;
  skin: string;
  /** Null while the model is loading. */
  char: CharacterState | null;
  /** loadCharacter was called, so a character with this id will show up in the scene. */
  requested: boolean;
  waited: number;
};

export function createStudioDancersController(deps: StudioDancersDeps) {
  const random = deps.random ?? Math.random;
  /** One per backup dancer; the index is the formation place. */
  const slots: Slot[] = [];
  /** Dancers dropped while loading: dispose of them if they show up after all. */
  const abandoned = new Set<string>();
  const history = createSnapshotHistory<ClipWeights>(MAX_DANCE_OFFSET_SEC + 0.5);
  let clock = 0;
  let serial = 0;
  let onStage = false;
  /** A load failed or timed out: don't retry until the studio is opened again. */
  let loadFailed = false;
  let framedFor: string | null = null;
  /** Set when the group changes: frame once more when the dancers are in (see reframeDecision). */
  let pendingReframe: PendingReframe | null = null;
  let lastOffsetSec = 0;

  function dispose(char: CharacterState): void {
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
  }

  /** Take a loaded dancer out of the shared record (see the header) and keep it hidden for now. */
  function adoptLoaded(): void {
    const chars = deps.getSceneContext().characters;
    for (const id of abandoned) {
      const late = chars[id];
      if (!late) continue;
      abandoned.delete(id);
      delete chars[id];
      dispose(late);
    }
    for (const slot of slots) {
      if (slot.char) continue;
      const loaded = chars[slot.id];
      if (!loaded) continue;
      delete chars[slot.id];
      loaded.container.visible = false;
      slot.char = loaded;
      logger.debug('general', 'Studio dancer ready', { id: slot.id, skin: slot.skin });
    }
  }

  function removeSlot(slot: Slot): void {
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    if (slot.char) dispose(slot.char);
    else if (slot.requested) abandoned.add(slot.id);
  }

  function addSlot(lead: CharacterState): boolean {
    const skins = deps.getSkins();
    const [skin] = pickDancerSkins({
      roster: deps.getRoster(),
      available: skins.map((s) => s.path),
      exclude: [lead.currentSkin, ...slots.map((s) => s.skin)],
      count: 1,
      random,
    });
    if (!skin) return false;
    const slot: Slot = { id: `studio-dancer-${++serial}`, skin, char: null, requested: false, waited: 0 };
    slots.push(slot);
    deps.resolveModelPath(skin).then(
      (modelPath) => {
        if (!slots.includes(slot)) return; // removed while resolving
        const cfg = buildCharacterConfig(skin, deps.getAnimations(), slot.id, modelPath);
        cfg.label = `Dancer ${slot.id}`;
        cfg.position = new THREE.Vector3(0, OFFSTAGE_Y, 0);
        slot.requested = true;
        deps.loadCharacter(cfg, deps.getSkins());
        logger.debug('general', 'Studio dancer loading', { id: slot.id, skin });
      },
      (err) => {
        logger.warn('general', 'Studio dancer rig lookup failed', { skin, error: String(err) });
        if (slots.includes(slot)) removeSlot(slot);
        loadFailed = true;
      }
    );
    return true;
  }

  function checkTimeouts(dt: number): void {
    for (const slot of [...slots]) {
      if (slot.char) continue;
      slot.waited += dt;
      if (slot.waited <= LOAD_TIMEOUT_SEC) continue;
      logger.warn('general', 'Studio dancer never loaded; dropped', { id: slot.id });
      removeSlot(slot);
      loadFailed = true;
    }
  }

  /** Put the weights on one dancer's actions, then advance (or, in sync, just evaluate) its mixer. */
  function pose(dancer: CharacterState, lead: CharacterState, weights: ClipWeights, offsetSec: number, delta: number): void {
    let copiedTimes = offsetSec === 0;
    for (const [key, action] of Object.entries(dancer.actions)) {
      const r = weights.get(key);
      if (!r) {
        if (action.isScheduled()) action.stop();
        continue;
      }
      const leadAction = lead.actions[key];
      const leadPlays = leadAction?.isScheduled() ?? false;
      // isScheduled, not isRunning: a clip frozen at time scale 0 must keep its pose.
      if (!action.isScheduled()) {
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.play();
        // Start where the lead's clip was `offsetSec` ago.
        const duration = action.getClip().duration;
        if (leadPlays && duration > 0) {
          const t = (leadAction!.time - offsetSec * r.timeScale) % duration;
          action.time = t < 0 ? t + duration : t;
        }
      }
      action.enabled = true;
      action.paused = false;
      action.setEffectiveTimeScale(r.timeScale);
      action.setEffectiveWeight(r.weight);
      if (offsetSec === 0) {
        if (leadPlays) action.time = leadAction!.time;
        else copiedTimes = false;
      }
    }
    // In sync the times come from the lead (already advanced this frame); otherwise run freely.
    dancer.mixer.update(copiedTimes ? 0 : delta);
  }

  /**
   * Frame the whole group the way the studio frames the lead alone, just centred on the group
   * and further back. Only on entering the studio, when the group changes shape and once more
   * when its dancers have loaded, so the user's own orbiting is otherwise left alone.
   */
  function frameCamera(lead: CharacterState, formation: Formation, count: number): void {
    const ctx = deps.getSceneContext();
    const yaw = deps.getFacing();
    const framing = groupFraming(formationOffsets(formation, count));
    const c = stageToWorld(framing.center, yaw);
    const p = lead.container.position;
    ctx.controls.target.set(p.x + c.x, p.y + CAMERA_TARGET_HEIGHT, p.z + c.z);
    ctx.camera.position.set(
      ctx.controls.target.x + Math.sin(yaw + CAMERA_SIDE_ANGLE) * framing.distance,
      p.y + CAMERA_HEIGHT,
      ctx.controls.target.z + Math.cos(yaw + CAMERA_SIDE_ANGLE) * framing.distance
    );
    ctx.camera.lookAt(ctx.controls.target);
    ctx.controls.update();
  }

  /** Every frame, on every route (off stage it only cleans up). Call after the studio's own update. */
  function update(delta: number, route: Route): void {
    adoptLoaded();
    const lead = deps.getLead();
    const settings = deps.getSettings();

    if (route !== 'studio' || !lead) {
      for (const slot of [...slots]) removeSlot(slot);
      if (onStage) {
        onStage = false;
        loadFailed = false;
        framedFor = null;
        pendingReframe = null;
        history.clear();
        clock = 0;
      }
      return;
    }

    const entered = !onStage;
    onStage = true;

    while (slots.length > settings.count) removeSlot(slots[slots.length - 1]!);
    if (!loadFailed && deps.getSkins().length > 0) {
      while (slots.length < settings.count && addSlot(lead)) {
        /* one per missing dancer */
      }
    }
    checkTimeouts(Math.min(delta, 0.1));

    // Solo and never touched: leave the studio's own framing alone.
    const shape = settings.count > 0 ? `${settings.count}:${settings.formation}` : 'solo';
    const cameraSerial = deps.getCameraSerial?.() ?? 0;
    if (entered ? shape !== 'solo' : shape !== framedFor) {
      frameCamera(lead, settings.formation, settings.count);
      // The dancers are still loading: frame again when they are in, unless the user moves the camera first.
      pendingReframe = settings.count > 0 ? { cameraSerial } : null;
    }
    framedFor = shape;
    // After a failed load nobody else is coming: the group is whoever made it.
    const expected = loadFailed ? slots.length : settings.count;
    const stillLoading = expected - slots.filter((s) => s.char).length;
    const decision = reframeDecision(pendingReframe, stillLoading, cameraSerial);
    if (decision === 'frame') frameCamera(lead, settings.formation, slots.length);
    if (decision === 'frame' || decision === 'skip') pendingReframe = null;

    clock += delta;
    history.record(clock, deps.getLeadWeights());
    const offsetSec = settings.offsetSec;
    if (offsetSec !== lastOffsetSec) {
      // Restart the dancers' clips so they pick up the new phase.
      lastOffsetSec = offsetSec;
      for (const slot of slots) slot.char?.mixer.stopAllAction();
    }
    const weights = history.at(clock - offsetSec) ?? deps.getLeadWeights();

    const yaw = deps.getFacing();
    const offsets = formationOffsets(settings.formation, slots.length);
    const p = lead.container.position;
    slots.forEach((slot, i) => {
      const dancer = slot.char;
      const offset = offsets[i];
      if (!dancer || !offset) return;
      const d = stageToWorld(offset, yaw);
      dancer.container.position.set(p.x + d.x, p.y, p.z + d.z);
      dancer.model.rotation.copy(lead.model.rotation);
      dancer.container.visible = true;
      pose(dancer, lead, weights, offsetSec, delta);
    });
  }

  return {
    update,
    /** Dancers on stage right now (loaded ones only). */
    count: (): number => slots.filter((s) => s.char).length,
    /** The loaded dancers (they aren't in the scene's `characters` record). */
    characters: (): CharacterState[] => slots.flatMap((s) => (s.char ? [s.char] : [])),
    /**
     * The lead and its backup dancers as one group, for the framing buttons and the turntable.
     * Null when the lead dances alone (or the studio is closed).
     */
    groupShot: (): GroupShot | null => {
      if (!onStage || slots.length === 0) return null;
      return groupShot(formationOffsets(deps.getSettings().formation, slots.length), deps.getFacing());
    },
  };
}

export type StudioDancersController = ReturnType<typeof createStudioDancersController>;
