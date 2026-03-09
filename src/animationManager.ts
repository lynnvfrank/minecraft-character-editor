/**
 * Animation queue, playSequence, walkTo, and idle wanderer.
 * Integrates with characters, fadeToAction, and getAction from main.
 * Uses clock-driven lerp for movement (no TWEEN) so it runs in sync with the render loop.
 */
import * as THREE from 'three';
import { logger } from './logger';

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
  | { type: 'walkTo'; target: THREE.Vector3 | [number, number, number]; speed?: number };

type AnimationManagerDeps = {
  getCharacter: (id: string) => CharacterStateLike | undefined;
  fadeToAction: (char: CharacterStateLike, action: THREE.AnimationAction, duration: number) => void;
  getAction: (charId: string, name: string) => THREE.AnimationAction | undefined;
  clock?: THREE.Clock;
};

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

/** 5–6 waypoints within the ground circle (radius ~6 to stay on ground) */
const WAYPOINTS: THREE.Vector3[] = [
  new THREE.Vector3(-2, 0, -1.5),
  new THREE.Vector3(2, 0, -1),
  new THREE.Vector3(1.5, 0, 2),
  new THREE.Vector3(-1.5, 0, 2),
  new THREE.Vector3(-2.5, 0, 0.5),
  new THREE.Vector3(0, 0, -2)
];

export function createAnimationManager(deps: AnimationManagerDeps) {
  const { getCharacter, fadeToAction, getAction } = deps;
  const CHAR_ID = 'runningboy';

  let queue: SequenceStep[] = [];
  let isPlaying = false;
  let sequenceGeneration = 0;
  let wanderIntervalId: ReturnType<typeof setInterval> | null = null;
  let idleWanderEnabled = false;
  let lastActivityTime = Date.now();

  let activeWalk: {
    root: THREE.Group;
    start: THREE.Vector3;
    end: THREE.Vector3;
    durationSec: number;
    elapsed: number;
    /** Delay before position starts moving so walk animation can blend in (reduces sliding) */
    startDelaySec: number;
    resolve: () => void;
  } | null = null;

  /** True from start of walkTo until it resolves (includes turn phase). Lets characterAI avoid overwriting rotation. */
  let isInWalkTo = false;

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
      // Don't copy end position — leave character where they are
      activeWalk.resolve();
      activeWalk = null;
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
   * Face the target before walking. Uses turn animation only when angle ≤ 90°.
   * For larger angles: procedural rotation (avoids double-turn snap/pop).
   */
  async function playTurnToFace(
    char: CharacterStateLike,
    targetFacing: number,
    distance: number,
    gen: number
  ): Promise<void> {
    const MIN_DISTANCE_FOR_TURN = 0.5;
    const TURN_THRESHOLD = 0.3; // ~17° — skip turn when already roughly facing
    const MAX_TURN_ANIM_RAD = Math.PI / 2; // Use turn animation only for ≤90°

    if (distance < MIN_DISTANCE_FOR_TURN) return;

    let currentFacing = char.model.rotation.y;
    let angleDiff = targetFacing - currentFacing;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) < TURN_THRESHOLD) return;

    // For angles > 90°: smooth procedural turn (no turn anim) — avoids snap
    if (Math.abs(angleDiff) > MAX_TURN_ANIM_RAD) {
      const startYaw = char.model.rotation.y;
      const SMOOTH_TURN_DURATION_SEC = 0.45;
      const STEPS = 12;
      const stepMs = (SMOOTH_TURN_DURATION_SEC * 1000) / STEPS;
      for (let i = 1; i <= STEPS; i++) {
        if (gen !== sequenceGeneration) return;
        await new Promise<void>((r) => setTimeout(r, stepMs));
        const t = i / STEPS;
        const yaw = startYaw + angleDiff * t;
        char.model.rotation.y = yaw;
      }
      logFacingChange('turnToFace (smooth)', startYaw, targetFacing);
      return;
    }

    // Single turn animation for angles ≤ 90°
    const turnName = angleDiff > 0 ? 'left-turn' : 'right-turn';
    const turnAction = getAction(CHAR_ID, turnName);
    if (!turnAction) {
      char.model.rotation.y = targetFacing;
      return;
    }

    const clip = turnAction.getClip();
    const turnDurationSec = clip?.duration ?? 0.8;

    turnAction.reset();
    turnAction.setLoop(THREE.LoopOnce, 0);
    turnAction.clampWhenFinished = true;
    fadeToAction(char, turnAction, 0.15);

    await new Promise<void>((r) => setTimeout(r, turnDurationSec * 1000));
    if (gen !== sequenceGeneration) return;

    const prevYaw = char.model.rotation.y;
    char.model.rotation.y = targetFacing;
    logFacingChange('turnToFace (final)', prevYaw, targetFacing);
  }

  /** Move character to target over time. Turns to face target first (using turn animations), then walks. */
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
      const end =
        target instanceof THREE.Vector3 ? target.clone() : new THREE.Vector3(...target);
      const distance = start.distanceTo(end);
      const durationSec = Math.max(distance / Math.max(speed, 0.1), 0.1);

      logger.info('animation', 'Walk start', {
        start: [start.x, start.y, start.z],
        end: [end.x, end.y, end.z],
        durationSec,
        speed
      });

      const walkAction = getAction(CHAR_ID, 'walking');
      if (walkAction) {
        fadeToAction(char, walkAction, 0.2);
      } else if (char.idleAction) {
        fadeToAction(char, char.idleAction, 0.2);
      }

    const WALK_START_DELAY_SEC = 0.2;

    return new Promise<void>((resolve) => {
      activeWalk = {
        root,
        start,
        end,
        durationSec,
        elapsed: -WALK_START_DELAY_SEC,
        startDelaySec: WALK_START_DELAY_SEC,
        resolve: () => {
          logger.info('animation', 'Walk end', {
            pos: [root.position.x, root.position.y, root.position.z]
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
      logger.info('animation', 'Sequence step', {
        type: 'animation',
        name: step.name,
        duration: step.duration ?? 2
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
      await walkTo(target, step.speed ?? 1);
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

  /** Only pick waypoints within 90° of current facing. If none, pick smallest angle. */
  function pickWanderWaypoint(): THREE.Vector3 {
    const char = getCharacter(CHAR_ID);
    const currentFacing = char?.model.rotation.y ?? 0;
    const pos = char?.container.position ?? { x: 0, z: 0 };

    const withAngles = WAYPOINTS.map((wp) => {
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
    if (pool.length === 0) return WAYPOINTS[0].clone();
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
      { type: 'animation', name: emote, duration: 1.5 },
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
    if (activeWalk) {
      activeWalk.elapsed += deltaSec;
      const t = Math.min(activeWalk.elapsed / activeWalk.durationSec, 1);
      logger.trace('position', 'Walk tick', {
        t,
        x: activeWalk.root.position.x,
        y: activeWalk.root.position.y,
        z: activeWalk.root.position.z
      });
      activeWalk.root.position.lerpVectors(activeWalk.start, activeWalk.end, t);

      // Model already faces target from turn animations; keep facing during walk
      const char = getCharacter(CHAR_ID);
      if (char) {
        const dx = activeWalk.end.x - activeWalk.root.position.x;
        const dz = activeWalk.end.z - activeWalk.root.position.z;
        if (dx !== 0 || dz !== 0) {
          const prevYaw = char.model.rotation.y;
          const newYaw = Math.atan2(dx, dz);
          char.model.rotation.y = newYaw;
          logFacingChange('walkTo tick', prevYaw, newYaw);
        }
      }

      if (t >= 1) {
        activeWalk.root.position.copy(activeWalk.end);
        const { resolve } = activeWalk;
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

  return {
    playSequence,
    walkTo,
    isBusy,
    isWalking,
    isInWalkToPhase,
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
