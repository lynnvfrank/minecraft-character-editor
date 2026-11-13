/**
 * Animation queue, playSequence, walkTo, and idle wanderer.
 * Integrates with characters, fadeToAction, and getAction from main.
 * Uses clock-driven lerp for movement (no TWEEN) so it runs in sync with the render loop.
 * Character movement is constrained to a trapezoid derived from the camera view frustum.
 */
import * as THREE from 'three';
import { logger } from '../lib';
import { logFacingChange } from '../debug/debugFacing';
import {
  getTrapezoidBounds,
  clampToTrapezoid,
  WALK_CYCLE_DISTANCE
} from '../lib/trapezoidBounds';
import { DEFAULT_CHARACTER_ID } from '../domain';

/** Minimal character state required for animation manager (main's CharacterState extends this) */
export type CharacterStateLike = {
  id: string;
  container: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | undefined;
};

export type SequenceStep =
  | { type: 'animation'; name: string; duration?: number }
  | { type: 'walkTo'; target: THREE.Vector3 | [number, number, number]; speed?: number }
  | {
      type: 'pause';
      /** Fixed duration in seconds */
      duration?: number;
      /** Variable duration: random in [min, max] seconds. Use when both present. */
      min?: number;
      max?: number;
    };

export type TurnStrategy = 'snap' | 'lerp' | 'reset';

type AnimationManagerDeps = {
  getCharacter: (id: string) => CharacterStateLike | undefined;
  fadeToAction: (char: CharacterStateLike, action: THREE.AnimationAction, duration: number) => void;
  getAction: (charId: string, name: string) => THREE.AnimationAction | undefined;
  getCamera: () => THREE.PerspectiveCamera;
  clock?: THREE.Clock;
  /** @deprecated Ignored. Turns now use root-yaw compensation for any angle. */
  getTurnStrategy?: () => TurnStrategy;
};

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Find BonesCharacter (armature root). Turn clip animates its quaternion. */
function findBonesCharacter(model: THREE.Group): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  model.traverse((obj) => {
    if (obj.name === 'BonesCharacter') result = obj;
  });
  return result;
}

/** Get BonesCharacter Y rotation (deg). Turn clip animates this. Returns null if not found. */
function getBonesCharacterYawDeg(model: THREE.Group): number | null {
  const bc = findBonesCharacter(model);
  if (!bc) return null;
  const euler = new THREE.Euler().setFromQuaternion(bc.quaternion, 'YXZ');
  return (euler.y * 180) / Math.PI;
}

/** Small emotes for idle wanderer — quick, non-disruptive */
const WANDER_EMOTES = [
  'acknowledging',
  'bashful',
  'blow-akiss',
  'bored',
  'shrugging',
  'yawn',
  'happy',
  'happy-idle'
];

/** All FBX clips are 30 fps. Frame-aligned walk transitions (Approach 2). */
const FPS = 30;
const START_WALKING_FRAMES = 16;   // frames 1–16: acceleration phase
const WALKING_START_FRAME = 7;     // walking starts at frame 7 (aligns with start-walking)
const STOP_WALKING_FRAMES = 7;    // stop-walking length; frame 1 matches walking frame 1

/** Relative waypoints: [depth in walk-units, lateral fraction -1..1]. Converted to world via bounds. */
const WAYPOINT_RELATIVE: [number, number][] = [
  [0, 0],
  [-1.5, 0.4],
  [-1.5, -0.4],
  [-2.5, 0],
  [-0.5, 0.5],
  [-0.5, -0.5]
];

export function createAnimationManager(deps: AnimationManagerDeps) {
  // getTurnStrategy is accepted for compatibility but no longer used: facing is driven by
  // live root-yaw compensation (see 'Facing model' below), which works for any turn angle.
  const { getCharacter, fadeToAction, getAction, getCamera } = deps;
  const CHAR_ID = DEFAULT_CHARACTER_ID;

  let queue: SequenceStep[] = [];
  let isPlaying = false;
  let sequenceGeneration = 0;
  let wanderIntervalId: ReturnType<typeof setInterval> | null = null;
  let idleWanderEnabled = false;
  let lastActivityTime = Date.now();

  type WalkPhase = 0 | 1 | 2; // 0=start-walking, 1=walking, 2=stop-walking
  let activeWalk: {
    root: THREE.Group;
    start: THREE.Vector3;
    end: THREE.Vector3;
    /** Duration of position lerp (main walking) */
    walkPhaseSec: number;
    /** Durations for transition clips (0 if clip missing) */
    startPhaseSec: number;
    stopPhaseSec: number;
    totalSec: number;
    elapsed: number;
    phase: WalkPhase;
    resolve: () => void;
  } | null = null;

  /**
   * Facing model
   * ------------
   * Turn clips rotate the rig root (BonesCharacter) by a fixed amount (~90°), but real turns
   * can be anywhere from ~17° to 180°. Instead of guessing the clip's rotation, we keep one
   * "desired visual facing" and every tick set:
   *
   *     model.rotation.y = facing - (rigYaw - rigYawBaseline)
   *
   * where rigYaw is read live from BonesCharacter after the mixer update. The clip's root
   * rotation (including crossfades into/out of it) is cancelled exactly, so the on-screen
   * heading follows only the eased curve we choose — the clip just supplies the footwork.
   */
  let facing: number | null = null;
  /** Rig yaw when no turn clip is influencing it (bind pose offset). */
  let rigYawBaseline = 0;
  /** Seconds to keep compensating after a turn while the turn clip fades out. */
  let settleSec = 0;
  /** True while manager should write model.rotation.y (turn, walk, settle). */
  let ownsFacing = false;

  let activeTurn: {
    action: THREE.AnimationAction | null;
    startYaw: number;
    targetYaw: number;
    elapsed: number;
    durationSec: number;
    resolvePromise: () => void;
  } | null = null;

  /** Fade time used when leaving the turn clip; compensation must outlast it. */
  const TURN_SETTLE_SEC = 0.6;
  /** How quickly facing steers toward the walk direction (higher = snappier). */
  const WALK_STEER_RATE = 8;

  function wrapAngle(a: number): number {
    a = (a + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
  }

  /** Lerp angle taking shortest path (avoids 270° swing on large turns) */
  function lerpAngleRad(from: number, to: number, t: number): number {
    return wrapAngle(from + wrapAngle(to - from) * t);
  }

  function smoothstep(t: number): number {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
  }

  function getRigYaw(model: THREE.Group): number {
    const bc = findBonesCharacter(model);
    if (!bc) return 0;
    return new THREE.Euler().setFromQuaternion(bc.quaternion, 'YXZ').y;
  }

  /** Current visual facing (radians, wrapped). */
  function getFacing(): number {
    const char = getCharacter(CHAR_ID);
    if (!char) return facing ?? 0;
    if (!ownsFacing || facing == null) {
      facing = wrapAngle(char.model.rotation.y + wrapAngle(getRigYaw(char.model) - rigYawBaseline));
    }
    return facing;
  }

  /** Set visual facing directly (e.g. characterAI turning toward the camera). */
  function setFacing(yaw: number): void {
    const char = getCharacter(CHAR_ID);
    facing = wrapAngle(yaw);
    if (!char) return;
    const comp = ownsFacing ? wrapAngle(getRigYaw(char.model) - rigYawBaseline) : 0;
    char.model.rotation.y = wrapAngle(facing - comp);
  }

  /** True from start of walkTo until it resolves (includes turn phase). Lets characterAI avoid overwriting rotation. */
  let isInWalkTo = false;

  /** Character home position (trapezoid origin) — fixed at spawn */
  const CHAR_START_X = 0;
  const CHAR_START_Z = 0;

  function getBounds(): ReturnType<typeof getTrapezoidBounds> | null {
    const cam = getCamera();
    return getTrapezoidBounds(cam, CHAR_START_X, CHAR_START_Z, WALK_CYCLE_DISTANCE);
  }

  /** Convert relative waypoint to world position, clamped to trapezoid */
  function waypointToWorld(rel: [number, number], bounds: ReturnType<typeof getTrapezoidBounds>): THREE.Vector3 {
    const [depthRel, lateralFrac] = rel;
    const depth = depthRel * WALK_CYCLE_DISTANCE;
    const depthClamped = THREE.MathUtils.clamp(depth, bounds.depthAway, bounds.depthToward);
    const halfWidth = bounds.getHalfWidthAtDepth(depthClamped);
    const lateral = lateralFrac * halfWidth;
    const x = bounds.startX + depthClamped * bounds.depthDirX + lateral * bounds.perpDirX;
    const z = bounds.startZ + depthClamped * bounds.depthDirZ + lateral * bounds.perpDirZ;
    return new THREE.Vector3(x, 0, z);
  }

  /** Check if a sequence is currently playing */
  function isBusy(): boolean {
    return isPlaying;
  }

  /** Stop current sequence and clear queue. Leaves character at current position (no teleport). */
  function stop() {
    sequenceGeneration++;
    logger.info('animation', 'Sequence cancelled', { generation: sequenceGeneration });
    queue = [];
    isPlaying = false;
    isInWalkTo = false;
    if (activeWalk) {
      activeWalk.resolve();
      activeWalk = null;
    }
    if (activeTurn) {
      activeTurn.resolvePromise();
      activeTurn = null;
      // Let the turn clip fade out without the body snapping
      settleSec = TURN_SETTLE_SEC;
    }
    stopIdleWanderer();
  }

  /** Play animation for a duration (looping) */
  function playAnimationForDuration(
    char: CharacterStateLike,
    name: string,
    duration: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const action = getAction(CHAR_ID, name);
      if (!action) {
        resolve();
        return;
      }
      action.setLoop(THREE.LoopRepeat, Infinity);
      fadeToAction(char, action, 0.3);
      setTimeout(() => resolve(), (duration || 2) * 1000);
    });
  }

  /**
   * Turn in place to face targetFacing (visual heading, radians).
   * The visual heading eases from current → target over the turn; the turn clip only
   * provides footwork. Its root rotation is cancelled in tick(), so any angle works.
   */
  async function playTurnToFace(
    char: CharacterStateLike,
    targetFacing: number,
    distance: number,
    _gen: number,
    _beforeWalk = false
  ): Promise<void> {
    const MIN_DISTANCE_FOR_TURN = 0.5;
    const TURN_THRESHOLD = 0.3; // ~17° — small corrections are handled by walk steering

    if (distance < MIN_DISTANCE_FOR_TURN) {
      logger.debug('animation', 'Turn skipped', { reason: 'distance', distance });
      return;
    }

    const startYaw = getFacing();
    const target = wrapAngle(targetFacing);
    const angleDiff = wrapAngle(target - startYaw);
    const absDeg = Math.abs((angleDiff * 180) / Math.PI);

    if (Math.abs(angleDiff) < TURN_THRESHOLD) {
      logger.debug('animation', 'Turn skipped', { reason: 'already_facing', angleDiffDeg: absDeg.toFixed(1) });
      return;
    }

    const turnName = angleDiff > 0 ? 'left-turn' : 'right-turn';
    const turnAction = getAction(CHAR_ID, turnName);
    const clipDurationSec = turnAction?.getClip()?.duration ?? 0.8;
    // Scale duration with angle: small turns are quick, 180° turns take a bit longer than the clip.
    const durationSec = THREE.MathUtils.clamp(clipDurationSec * (absDeg / 90), 0.35, clipDurationSec * 1.6);

    logger.info('animation', 'Turn start', {
      clip: turnAction ? turnName : 'none (procedural)',
      startYawDeg: ((startYaw * 180) / Math.PI).toFixed(1),
      targetFacingDeg: ((target * 180) / Math.PI).toFixed(1),
      angleDiffDeg: ((angleDiff * 180) / Math.PI).toFixed(1),
      durationSec: durationSec.toFixed(2)
    });

    // Take ownership of facing; capture rig baseline before the turn clip influences it.
    if (!ownsFacing && settleSec <= 0) rigYawBaseline = getRigYaw(char.model);
    facing = startYaw;
    ownsFacing = true;

    if (turnAction) {
      turnAction.reset();
      turnAction.setLoop(THREE.LoopOnce, 0);
      turnAction.clampWhenFinished = true;
      // Stretch/compress the clip so the steps line up with the eased rotation.
      turnAction.timeScale = clipDurationSec / durationSec;
      fadeToAction(char, turnAction, 0.15);
    }

    return new Promise<void>((resolve) => {
      activeTurn = {
        action: turnAction ?? null,
        startYaw,
        targetYaw: target,
        elapsed: 0,
        durationSec,
        resolvePromise: () => {
          logFacingChange('turnToFace (final)', startYaw, target);
          if (turnAction) turnAction.timeScale = 1;
          resolve();
        }
      };
    });
  }

  /** Turn to face a world angle (radians) without walking. For isolated turn testing. */
  async function turnTo(targetFacingRad: number): Promise<void> {
    const char = getCharacter(CHAR_ID);
    if (!char) return;
    await playTurnToFace(char, targetFacingRad, 1, sequenceGeneration, false);
  }

  /** Move character to target over time. Target is clamped to trapezoid bounds. */
  async function walkTo(
    target: THREE.Vector3 | [number, number, number],
    speed = 1,
    gen = sequenceGeneration
  ): Promise<void> {
    const char = getCharacter(CHAR_ID);
    if (!char) return;

    isInWalkTo = true;

    const root = char.container;
    const start = root.position.clone();
    let end =
      target instanceof THREE.Vector3 ? target.clone() : new THREE.Vector3(...target);
    const bounds = getBounds();
    if (bounds) clampToTrapezoid(end, bounds);
    const distance = start.distanceTo(end);
    const durationSec = Math.max(distance / Math.max(speed, 0.1), 0.1);

    const targetFacing = Math.atan2(end.x - start.x, end.z - start.z);
    await playTurnToFace(char, targetFacing, distance, gen, true);
    if (gen !== sequenceGeneration) return;

    // Walk steering owns facing from here (also keeps cancelling the turn clip as it fades)
    if (!ownsFacing) {
      facing = getFacing();
      rigYawBaseline = getRigYaw(char.model);
      ownsFacing = true;
    }

    const walkAction = getAction(CHAR_ID, 'walking');
    const startWalkingAction = getAction(CHAR_ID, 'start-walking');
    const stopWalkingAction = getAction(CHAR_ID, 'stop-walking');

    const startPhaseSec = startWalkingAction ? START_WALKING_FRAMES / FPS : 0;
    const stopPhaseSec = stopWalkingAction ? STOP_WALKING_FRAMES / FPS : 0;

    const walkPhaseSec = durationSec;
    const totalSec = startPhaseSec + walkPhaseSec + stopPhaseSec;

    logger.info('animation', 'Walk start', {
      start: [start.x, start.y, start.z],
      end: [end.x, end.y, end.z],
      walkPhaseSec,
      startPhaseSec,
      stopPhaseSec,
      totalSec,
      speed
    });

    if (startWalkingAction) {
      startWalkingAction.reset();
      startWalkingAction.setLoop(THREE.LoopOnce, 0);
      startWalkingAction.clampWhenFinished = true;
      fadeToAction(char, startWalkingAction, 0.3);
    } else if (walkAction) {
      fadeToAction(char, walkAction, 0.4);
    } else if (char.idleAction) {
      fadeToAction(char, char.idleAction, 0.4);
    }

    return new Promise<void>((resolve) => {
      activeWalk = {
        root,
        start,
        end,
        walkPhaseSec,
        startPhaseSec,
        stopPhaseSec,
        totalSec,
        elapsed: 0,
        phase: 0,
        resolve: () => {
          const facingDeg = ((char.model.rotation.y * 180) / Math.PI).toFixed(1);
          logger.info('animation', 'Walk end', {
            pos: [root.position.x, root.position.y, root.position.z],
            facingDeg
          });
          if (char.idleAction) fadeToAction(char, char.idleAction!, 0.3);
          isInWalkTo = false;
          settleSec = Math.max(settleSec, 0.3);
          resolve();
        }
      };
    });
  }

  /** Execute next step in queue */
  async function runNextStep(gen: number): Promise<void> {
    if (gen !== sequenceGeneration) return;

    const step = queue.shift();
    if (!step) {
      isPlaying = false;
      const char = getCharacter(CHAR_ID);
      if (char?.idleAction) fadeToAction(char, char.idleAction, 0.5);
      return;
    }

    const char = getCharacter(CHAR_ID);
    if (!char) {
      await runNextStep(gen);
      return;
    }

    if (step.type === 'animation') {
      const facingDeg = ((char.model.rotation.y * 180) / Math.PI).toFixed(1);
      logger.info('animation', 'Sequence step', {
        type: 'animation',
        name: step.name,
        duration: step.duration ?? 2
      });
      logger.info('animation', 'Emote start', {
        name: step.name,
        facingDeg,
        pos: [char.container.position.x, char.container.position.y, char.container.position.z]
      });
      await playAnimationForDuration(char, step.name, step.duration ?? 2);
    } else if (step.type === 'walkTo') {
      const target =
        step.target instanceof THREE.Vector3
          ? step.target
          : new THREE.Vector3(...step.target);
      logger.info('animation', 'Sequence step', {
        type: 'walkTo',
        target: Array.isArray(step.target) ? step.target : [target.x, target.y, target.z],
        speed: step.speed ?? 1
      });
      await walkTo(target, step.speed ?? 1, gen);
    } else if (step.type === 'pause') {
      const durationSec =
        step.min != null && step.max != null
          ? randomInRange(step.min, step.max)
          : (step.duration ?? 0.5);
      logger.info('animation', 'Sequence step', {
        type: 'pause',
        durationSec,
        ...(step.min != null && step.max != null ? { min: step.min, max: step.max } : {})
      });
      await new Promise<void>((r) => setTimeout(r, durationSec * 1000));
    }

    if (gen !== sequenceGeneration) return;
    if (queue.length > 0) {
      await runNextStep(gen);
    } else {
      isPlaying = false;
      if (char.idleAction) fadeToAction(char, char.idleAction, 0.5);
    }
  }

  /** Play a sequence of animation + movement steps. Replaces any current sequence. */
  function playSequence(sequence: SequenceStep[]): void {
    if (sequence.length === 0) return;

    sequenceGeneration++;
    queue = [...sequence];
    isPlaying = true;
    logger.info('animation', 'Sequence started', { generation: sequenceGeneration, steps: sequence.length });
    runNextStep(sequenceGeneration);
  }

  /** Only pick waypoints within 90° of current facing. Waypoints are inside the trapezoid bounds. */
  function pickWanderWaypoint(): THREE.Vector3 {
    const char = getCharacter(CHAR_ID);
    const bounds = getBounds();
    const currentFacing = getFacing();
    const pos = char?.container.position ?? { x: 0, z: 0 };

    if (!bounds) return new THREE.Vector3(0, 0, 0);

    const waypoints = WAYPOINT_RELATIVE.map((rel) => waypointToWorld(rel, bounds));
    const withAngles = waypoints.map((wp) => {
      const dx = wp.x - pos.x;
      const dz = wp.z - pos.z;
      if (dx === 0 && dz === 0) return { wp, angle: 0 };
      const targetFacing = Math.atan2(dx, dz);
      let diff = targetFacing - currentFacing;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      return { wp, angle: Math.abs(diff) };
    }).filter(({ wp }) => wp.x !== pos.x || wp.z !== pos.z);

    const within90 = withAngles.filter(({ angle }) => angle <= Math.PI / 2);
    const pool = within90.length > 0 ? within90 : withAngles;
    if (pool.length === 0) return waypoints[0].clone();
    const byAngle = [...pool].sort((a, b) => a.angle - b.angle);
    return byAngle[0].wp.clone();
  }

  function doOneWanderStep(): void {
    const char = getCharacter(CHAR_ID);
    if (!char || !idleWanderEnabled || isPlaying) return;

    const target = pickWanderWaypoint();
    const emote =
      WANDER_EMOTES[Math.floor(Math.random() * WANDER_EMOTES.length)];

    playSequence([
      { type: 'walkTo', target: target, speed: 0.8 },
      { type: 'pause', min: 0.5, max: 1.2 },
      { type: 'animation', name: emote, duration: 1.5 },
      { type: 'pause', min: 0.6, max: 1.5 },
      { type: 'walkTo', target: new THREE.Vector3(0, 0, 0), speed: 0.8 }
    ]);
  }

  function startIdleWanderer() {
    if (wanderIntervalId) return;
    idleWanderEnabled = true;
    logger.info('stateMachine', 'Idle wanderer start', {});
    wanderIntervalId = setInterval(() => {
      if (!idleWanderEnabled || isPlaying) return;
      doOneWanderStep();
    }, 8000);
  }

  function stopIdleWanderer() {
    if (idleWanderEnabled || wanderIntervalId) {
      logger.info('stateMachine', 'Idle wanderer stop', {});
    }
    idleWanderEnabled = false;
    if (wanderIntervalId) {
      clearInterval(wanderIntervalId);
      wanderIntervalId = null;
    }
  }

  /** Turn progress: ease visual facing from start → target. */
  function tickTurn(deltaSec: number): void {
    if (!activeTurn) return;
    const turn = activeTurn;
    turn.elapsed += deltaSec;
    const t = Math.min(turn.elapsed / turn.durationSec, 1);
    facing = lerpAngleRad(turn.startYaw, turn.targetYaw, smoothstep(t));
    if (t >= 1) {
      facing = turn.targetYaw;
      activeTurn = null;
      settleSec = TURN_SETTLE_SEC;
      logger.info('animation', 'Turn done', { facingDeg: ((facing * 180) / Math.PI).toFixed(1) });
      turn.resolvePromise();
    }
  }

  /**
   * Apply facing to the model, cancelling any root yaw the current clips put on BonesCharacter.
   * Runs after mixer.update so the rig yaw is this frame's value.
   */
  function applyFacing(deltaSec: number): void {
    if (!ownsFacing || facing == null) return;
    const char = getCharacter(CHAR_ID);
    if (!char) return;
    const comp = wrapAngle(getRigYaw(char.model) - rigYawBaseline);
    char.model.rotation.y = wrapAngle(facing - comp);

    if (!activeTurn && !activeWalk) {
      settleSec -= deltaSec;
      if (settleSec <= 0) {
        // Turn clip has faded out; rig yaw is back at baseline. Hand facing back.
        settleSec = 0;
        char.model.rotation.y = facing;
        ownsFacing = false;
      }
    }
  }

  function tick(deltaSec: number) {
    tickTurn(deltaSec);
    if (activeWalk) {
      const aw = activeWalk;
      const prevElapsed = aw.elapsed;
      aw.elapsed += deltaSec;

      const transitionToWalk = prevElapsed < aw.startPhaseSec && aw.elapsed >= aw.startPhaseSec;
      const transitionToStop =
        aw.elapsed >= aw.startPhaseSec + aw.walkPhaseSec &&
        prevElapsed < aw.startPhaseSec + aw.walkPhaseSec;

      if (aw.elapsed < aw.startPhaseSec) {
        aw.phase = 0;
      } else if (aw.elapsed < aw.startPhaseSec + aw.walkPhaseSec) {
        aw.phase = 1;
      } else {
        aw.phase = 2;
      }

      const char = getCharacter(CHAR_ID);
      if (char) {
        if (transitionToWalk) {
          const walkAction = getAction(CHAR_ID, 'walking');
          if (walkAction) {
            walkAction.reset();
            walkAction.time = WALKING_START_FRAME / FPS;
            walkAction.setLoop(THREE.LoopRepeat, Infinity);
            fadeToAction(char, walkAction, 0.3);
          }
        } else if (transitionToStop) {
          const stopAction = getAction(CHAR_ID, 'stop-walking');
          if (stopAction) {
            stopAction.reset();
            stopAction.setLoop(THREE.LoopOnce, 0);
            stopAction.clampWhenFinished = true;
            fadeToAction(char, stopAction, 0.3);
          }
        }
      }

      let t: number;
      if (aw.phase === 0) {
        aw.root.position.copy(aw.start);
        t = 0;
      } else if (aw.phase === 1) {
        const walkT = Math.min(
          (aw.elapsed - aw.startPhaseSec) / aw.walkPhaseSec,
          1
        );
        aw.root.position.lerpVectors(aw.start, aw.end, walkT);
        t = walkT;
      } else {
        aw.root.position.copy(aw.end);
        t = 1;
      }
      const bounds = getBounds();
      if (bounds) clampToTrapezoid(aw.root.position, bounds);

      if (char && facing != null) {
        // Steer smoothly toward the walk direction (handles small angles the turn skipped).
        // Use the full start→end heading, not position→end, so it never jitters near the end.
        const dx = aw.end.x - aw.start.x;
        const dz = aw.end.z - aw.start.z;
        if (dx * dx + dz * dz > 1e-6) {
          const walkTargetYaw = Math.atan2(dx, dz);
          const k = 1 - Math.exp(-WALK_STEER_RATE * deltaSec);
          facing = lerpAngleRad(facing, walkTargetYaw, k);
        }
      }

      logger.trace('position', 'Walk tick', {
        phase: aw.phase,
        t,
        x: aw.root.position.x,
        y: aw.root.position.y,
        z: aw.root.position.z
      });

      if (aw.elapsed >= aw.totalSec) {
        aw.root.position.copy(aw.end);
        const { resolve } = aw;
        activeWalk = null;
        resolve();
      }
    }
    applyFacing(deltaSec);
  }

  function setLastActivity() {
    lastActivityTime = Date.now();
    logger.debug('stateMachine', 'User activity', { explicit: true });
  }

  /** 30s no messages → idle anim. 60s no messages → start wanderer. */
  function checkIdleTimers() {
    const now = Date.now();
    const idleSec = (now - lastActivityTime) / 1000;

    logger.trace('stateMachine', 'Timer check', { idleSec });
    if (idleSec >= 60) {
      if (!idleWanderEnabled) startIdleWanderer();
    } else if (idleSec >= 30) {
      stopIdleWanderer();
      const char = getCharacter(CHAR_ID);
      if (char?.idleAction && !isPlaying) fadeToAction(char, char.idleAction, 0.5);
    } else {
      stopIdleWanderer();
    }
  }

  function isWalking(): boolean {
    return activeWalk !== null;
  }

  /** True during turn phase and walk (so characterAI does not override rotation) */
  function isInWalkToPhase(): boolean {
    return isInWalkTo;
  }

  /** Debug state for step-frame and overlay. Call after tick to inspect current frame. */
  function getDebugState(): {
    activeWalk: { t: number; phase: WalkPhase; start: [number, number, number]; end: [number, number, number]; pos: [number, number, number] } | null;
    activeTurn: { actionTime: number; clipDurationSec: number; progress: number } | null;
    facingDeg: number | null;
    ownsFacing: boolean;
    isInWalkToPhase: boolean;
    isWalking: boolean;
    isBusy: boolean;
    modelYawDeg: number | null;
    bonesCharYawDeg: number | null;
    containerPos: [number, number, number] | null;
  } {
    const char = getCharacter(CHAR_ID);
    const modelYawDeg = char ? (char.model.rotation.y * 180) / Math.PI : null;
    const bonesCharYawDeg = char ? getBonesCharacterYawDeg(char.model) : null;
    const containerPos: [number, number, number] | null = char
      ? [char.container.position.x, char.container.position.y, char.container.position.z]
      : null;

    const aw = activeWalk
      ? {
          t: activeWalk.totalSec > 0 ? activeWalk.elapsed / activeWalk.totalSec : 1,
          phase: activeWalk.phase,
          start: [activeWalk.start.x, activeWalk.start.y, activeWalk.start.z] as [number, number, number],
          end: [activeWalk.end.x, activeWalk.end.y, activeWalk.end.z] as [number, number, number],
          pos: [
            activeWalk.root.position.x,
            activeWalk.root.position.y,
            activeWalk.root.position.z
          ] as [number, number, number]
        }
      : null;

    const at = activeTurn
      ? {
          actionTime: activeTurn.action?.time ?? 0,
          clipDurationSec: activeTurn.durationSec,
          progress: activeTurn.durationSec > 0 ? activeTurn.elapsed / activeTurn.durationSec : 0
        }
      : null;

    return {
      activeWalk: aw,
      activeTurn: at,
      facingDeg: facing != null ? (facing * 180) / Math.PI : null,
      ownsFacing,
      isInWalkToPhase: isInWalkTo,
      isWalking: activeWalk !== null,
      isBusy: isPlaying,
      modelYawDeg,
      bonesCharYawDeg,
      containerPos
    };
  }

  return {
    playSequence,
    walkTo,
    turnTo,
    getFacing,
    setFacing,
    isBusy,
    isWalking,
    isInWalkToPhase,
    getDebugState,
    stop,
    tick,
    setLastActivity,
    checkIdleTimers,
    startIdleWanderer,
    stopIdleWanderer,
    /** Run one wander step immediately (walk to waypoint + emote). Used by characterAI. */
    runOneWanderStep: doOneWanderStep
  };
}
