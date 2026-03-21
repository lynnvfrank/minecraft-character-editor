/**
 * Animation queue, playSequence, walkTo, and idle wanderer.
 * Integrates with characters, fadeToAction, and getAction from main.
 * Uses clock-driven lerp for movement (no TWEEN) so it runs in sync with the render loop.
 * Character movement is constrained to a trapezoid derived from the camera view frustum.
 */
import * as THREE from 'three';
import { logger } from '../logger';
import { logFacingChange } from '../debugFacing';
import {
  getTrapezoidBounds,
  clampToTrapezoid,
  WALK_CYCLE_DISTANCE
} from './trapezoidBounds';

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
  /** Turn strategy: snap=instant 90°, lerp=lerp model.y during turn, reset=lerp+reset BonesCharacter after turn. */
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

/** Reset BonesCharacter quaternion to identity (for turn strategy 'reset'). */
function resetBonesCharacter(model: THREE.Group): void {
  const bonesChar = findBonesCharacter(model);
  if (bonesChar) bonesChar.quaternion.identity();
}

/** Get BonesCharacter Y rotation (deg). Turn clip animates this. Returns null if not found. */
function getBonesCharacterYawDeg(model: THREE.Group): number | null {
  const bc = findBonesCharacter(model);
  if (!bc) return null;
  const euler = new THREE.Euler().setFromQuaternion(bc.quaternion, 'YXZ');
  return (euler.y * 180) / Math.PI;
}

/** Get root/hip bone Y rotation (deg) for turn diagnostics. Returns null if not found. */
function getRootBoneYawDeg(model: THREE.Group): number | null {
  let bone: THREE.Bone | null = null;
  model.traverse((obj) => {
    if (bone) return;
    const mesh = obj as THREE.Mesh & { skeleton?: THREE.Skeleton };
    if (mesh.isMesh && mesh.skeleton?.bones?.length) {
      bone =
        mesh.skeleton.bones.find(
          (b) =>
            b.name.toLowerCase().includes('hip') ||
            b.name.toLowerCase().includes('spine')
        ) ?? mesh.skeleton.bones[0] ?? null;
    }
  });
  if (!bone) return null;
  const euler = new THREE.Euler().setFromQuaternion(
    (bone as THREE.Bone).quaternion,
    'YXZ'
  );
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
  const { getCharacter, fadeToAction, getAction, getCamera, getTurnStrategy } = deps;

  function getStrategy(): TurnStrategy {
    return getTurnStrategy?.() ?? 'lerp';
  }
  const CHAR_ID = 'runningboy';

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

  let activeTurn: {
    action: THREE.AnimationAction;
    clipDurationSec: number;
    resolvePromise: () => void;
    onComplete: () => void;
  } | null = null;

  /** Lerp angle taking shortest path (avoids 270° swing on large turns) */
  function lerpAngleRad(from: number, to: number, t: number): number {
    let diff = to - from;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return from + diff * t;
  }

  /** At turn start: lerp model.rotation.y from startYaw to modelTargetYaw (avoids 90° snap) */
  let turnStartLerpState: {
    char: CharacterStateLike;
    startYaw: number;
    modelTargetYaw: number;
    elapsed: number;
    durationSec: number;
  } | null = null;

  /** After turn: lerp model.rotation.y over crossfade so we don't overturn */
  let turnLerpState: {
    startYaw: number;
    targetFacing: number;
    remainingSec: number;
    totalSec: number;
  } | null = null;

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
    }
    turnLerpState = null;
    turnStartLerpState = null;
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
   * Face the target before walking. Uses turn animation only when angle ≤ 90°.
   * For larger angles: procedural rotation (avoids double-turn snap/pop).
   */
  async function playTurnToFace(
    char: CharacterStateLike,
    targetFacing: number,
    distance: number,
    _gen: number,
    beforeWalk = false
  ): Promise<void> {
    const MIN_DISTANCE_FOR_TURN = 0.5;
    const TURN_THRESHOLD = 0.3; // ~17° — skip turn when already roughly facing

    if (distance < MIN_DISTANCE_FOR_TURN) {
      logger.debug('animation', 'Turn skipped', { reason: 'distance', distance });
      return;
    }

    let currentFacing = char.model.rotation.y;
    let angleDiff = targetFacing - currentFacing;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) < TURN_THRESHOLD) {
      logger.debug('animation', 'Turn skipped', {
        reason: 'already_facing',
        angleDiffDeg: ((angleDiff * 180) / Math.PI).toFixed(1)
      });
      return;
    }

    logger.debug('animation', 'Turn to face', {
      currentFacingDeg: ((currentFacing * 180) / Math.PI).toFixed(1),
      targetFacingDeg: ((targetFacing * 180) / Math.PI).toFixed(1),
      angleDiffDeg: ((angleDiff * 180) / Math.PI).toFixed(1),
      distance
    });

    const turnName = angleDiff > 0 ? 'left-turn' : 'right-turn';
    const turnAction = getAction(CHAR_ID, turnName);
    if (!turnAction) {
      logger.debug('animation', 'Turn done', {
        method: 'snap',
        reason: 'no_turn_clip',
        clip: turnName
      });
      char.model.rotation.y = targetFacing;
      return;
    }

    const clip = turnAction.getClip();
    const turnDurationSec = clip?.duration ?? 0.8;
    const trackNames = clip?.tracks?.map((t) => t.name).slice(0, 5) ?? [];

    const CLIP_ROTATION_RAD = Math.PI / 2;
    const clipRotation = angleDiff > 0 ? CLIP_ROTATION_RAD : -CLIP_ROTATION_RAD;
    const modelTargetYaw = targetFacing - clipRotation;
    const startYaw = char.model.rotation.y;
    const rootBoneStart = getRootBoneYawDeg(char.model);

    const strategy = getStrategy();
    let modelDelta = modelTargetYaw - startYaw;
    while (modelDelta > Math.PI) modelDelta -= 2 * Math.PI;
    while (modelDelta < -Math.PI) modelDelta += 2 * Math.PI;
    const modelDeltaDeg = Math.abs((modelDelta * 180) / Math.PI);
    const lerpDurationSec = modelDeltaDeg > 45 ? turnDurationSec : 0.15;

    logger.info('animation', 'Turn start', {
      clip: turnName,
      turnDurationSec,
      strategy,
      modelDeltaDeg: modelDeltaDeg.toFixed(1),
      startLerpDurationSec: strategy === 'snap' ? 'n/a (snap)' : lerpDurationSec,
      angleDiffDeg: ((angleDiff * 180) / Math.PI).toFixed(1),
      startYawDeg: ((startYaw * 180) / Math.PI).toFixed(1),
      modelTargetYawDeg: ((modelTargetYaw * 180) / Math.PI).toFixed(1),
      targetFacingDeg: ((targetFacing * 180) / Math.PI).toFixed(1),
      clipRotationDeg: ((clipRotation * 180) / Math.PI).toFixed(1),
      rootBoneYawDeg: rootBoneStart != null ? rootBoneStart.toFixed(1) : 'n/a',
      clipTrackSample: trackNames
    });

    turnAction.reset();
    turnAction.setLoop(THREE.LoopOnce, 0);
    turnAction.clampWhenFinished = true;

    if (strategy === 'snap') {
      char.model.rotation.y = modelTargetYaw;
      logger.debug('animation', 'Turn start snap', {
        modelYawSetDeg: ((modelTargetYaw * 180) / Math.PI).toFixed(1)
      });
    } else {
      turnStartLerpState = {
        char,
        startYaw,
        modelTargetYaw,
        elapsed: 0,
        durationSec: lerpDurationSec
      };
    }

    fadeToAction(char, turnAction, 0.15);

    const midTurnMs = (turnDurationSec * 500) | 0;
    setTimeout(() => {
      const rootBoneMid = getRootBoneYawDeg(char.model);
      const modelYawDeg = (char.model.rotation.y * 180) / Math.PI;
      const visualDeg =
        rootBoneMid != null ? modelYawDeg + rootBoneMid : modelYawDeg;
      logger.info('animation', 'Turn mid', {
        clip: turnName,
        modelYawDeg: modelYawDeg.toFixed(1),
        rootBoneYawDeg: rootBoneMid != null ? rootBoneMid.toFixed(1) : 'n/a',
        visualDeg: rootBoneMid != null ? visualDeg.toFixed(1) : 'n/a',
        targetFacingDeg: ((targetFacing * 180) / Math.PI).toFixed(1)
      });
    }, midTurnMs);

    return new Promise<void>((resolve) => {
      const onComplete = () => {
        if (!activeTurn) return;
        const rootBoneEnd = getRootBoneYawDeg(char.model);
        const modelYawBeforeSet = (char.model.rotation.y * 180) / Math.PI;
        const visualBeforeSet =
          rootBoneEnd != null ? modelYawBeforeSet + rootBoneEnd : modelYawBeforeSet;
        logger.info('animation', 'Turn done', {
          clip: turnName,
          durationSec: turnDurationSec,
          modelYawBeforeSetDeg: modelYawBeforeSet.toFixed(1),
          rootBoneYawDeg: rootBoneEnd != null ? rootBoneEnd.toFixed(1) : 'n/a',
          visualBeforeSetDeg:
            rootBoneEnd != null ? visualBeforeSet.toFixed(1) : 'n/a',
          targetFacingDeg: ((targetFacing * 180) / Math.PI).toFixed(1)
        });
        logFacingChange('turnToFace (final)', startYaw, targetFacing);

        if (beforeWalk) {
          // Called from walkTo: lerp model.rotation.y over walk crossfade (0.4s)
          const WALK_FADE_SEC = 0.4;
          turnLerpState = {
            startYaw: modelTargetYaw,
            targetFacing,
            remainingSec: WALK_FADE_SEC,
            totalSec: WALK_FADE_SEC
          };
        } else {
          // Standalone turn: lerp model.rotation.y over idle crossfade (0.3s)
          // so we don't double-count BonesCharacter rotation
          const STANDALONE_FADE_SEC = 0.3;
          turnLerpState = {
            startYaw: modelTargetYaw,
            targetFacing,
            remainingSec: STANDALONE_FADE_SEC,
            totalSec: STANDALONE_FADE_SEC
          };
        }
        activeTurn.resolvePromise();
        activeTurn = null;
      };
      activeTurn = {
        action: turnAction,
        clipDurationSec: turnDurationSec,
        resolvePromise: resolve,
        onComplete
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
    const currentFacing = char?.model.rotation.y ?? 0;
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

  function tick(deltaSec: number) {
    if (activeTurn && activeTurn.action.time >= activeTurn.clipDurationSec) {
      activeTurn.onComplete();
    }
    if (turnStartLerpState) {
      turnStartLerpState.elapsed += deltaSec;
      const t = Math.min(turnStartLerpState.elapsed / turnStartLerpState.durationSec, 1);
      turnStartLerpState.char.model.rotation.y = lerpAngleRad(
        turnStartLerpState.startYaw,
        turnStartLerpState.modelTargetYaw,
        t
      );
      if (logger.isEnabled('animation', 'trace') && (turnStartLerpState.elapsed <= deltaSec * 1.5 || t >= 1)) {
        logger.trace('animation', 'Turn start lerp', {
          t: t.toFixed(3),
          elapsedSec: turnStartLerpState.elapsed.toFixed(3),
          modelYawDeg: ((turnStartLerpState.char.model.rotation.y * 180) / Math.PI).toFixed(1),
          done: t >= 1
        });
      }
      if (t >= 1) {
        turnStartLerpState.char.model.rotation.y = turnStartLerpState.modelTargetYaw;
        turnStartLerpState = null;
      }
    }
    if (turnLerpState && turnLerpState.remainingSec > 0 && !activeWalk) {
      const char = getCharacter(CHAR_ID);
      if (char) {
        turnLerpState.remainingSec -= deltaSec;
        const t = 1 - turnLerpState.remainingSec / turnLerpState.totalSec;
        const tClamped = Math.min(Math.max(t, 0), 1);
        char.model.rotation.y = lerpAngleRad(
          turnLerpState.startYaw,
          turnLerpState.targetFacing,
          tClamped
        );
        if (turnLerpState.remainingSec <= 0) {
          char.model.rotation.y = turnLerpState.targetFacing;
          if (getStrategy() === 'reset') resetBonesCharacter(char.model);
          turnLerpState = null;
        }
      }
    }
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

      if (char) {
        const dx = aw.end.x - aw.root.position.x;
        const dz = aw.end.z - aw.root.position.z;
        const walkTargetYaw = dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : char.model.rotation.y;

        if (turnLerpState && turnLerpState.remainingSec > 0) {
          turnLerpState.remainingSec -= deltaSec;
          const tLerp = 1 - turnLerpState.remainingSec / turnLerpState.totalSec;
          const tClamped = Math.min(Math.max(tLerp, 0), 1);
          char.model.rotation.y = lerpAngleRad(
            turnLerpState.startYaw,
            turnLerpState.targetFacing,
            tClamped
          );
          if (turnLerpState.remainingSec <= 0) {
            char.model.rotation.y = turnLerpState.targetFacing;
            if (getStrategy() === 'reset') resetBonesCharacter(char.model);
            turnLerpState = null;
          }
        } else {
          char.model.rotation.y = walkTargetYaw;
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
    turnStartLerpState: { t: number; elapsed: number; durationSec: number } | null;
    turnLerpState: { remainingSec: number; totalSec: number } | null;
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
          actionTime: activeTurn.action.time,
          clipDurationSec: activeTurn.clipDurationSec,
          progress: activeTurn.clipDurationSec > 0 ? activeTurn.action.time / activeTurn.clipDurationSec : 0
        }
      : null;

    const tsl = turnStartLerpState
      ? {
          t: turnStartLerpState.elapsed / turnStartLerpState.durationSec,
          elapsed: turnStartLerpState.elapsed,
          durationSec: turnStartLerpState.durationSec
        }
      : null;

    const tl = turnLerpState
      ? { remainingSec: turnLerpState.remainingSec, totalSec: turnLerpState.totalSec }
      : null;

    return {
      activeWalk: aw,
      activeTurn: at,
      turnStartLerpState: tsl,
      turnLerpState: tl,
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
