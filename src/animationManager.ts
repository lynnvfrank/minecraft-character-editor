/**
 * Animation queue, playSequence, walkTo, and idle wanderer.
 * Integrates with characters, fadeToAction, and getAction from main.
 * Uses clock-driven lerp for movement (no TWEEN) so it runs in sync with the render loop.
 */
import * as THREE from 'three';

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
  clock: THREE.Clock;
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
  const { getCharacter, fadeToAction, getAction, clock } = deps;
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
    resolve: () => void;
  } | null = null;

  /** Check if a sequence is currently playing */
  function isBusy(): boolean {
    return isPlaying;
  }

  /** Stop current sequence and clear queue */
  function stop() {
    sequenceGeneration++;
    queue = [];
    isPlaying = false;
    if (activeWalk) {
      activeWalk.root.position.copy(activeWalk.end);
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

  /** Move character to target over time using clock-driven lerp. Plays walking animation (in-place) during move. */
  function walkTo(
    target: THREE.Vector3 | [number, number, number],
    speed = 1
  ): Promise<void> {
    return new Promise((resolve) => {
      const char = getCharacter(CHAR_ID);
      if (!char) {
        resolve();
        return;
      }

      const root = char.container;
      const start = root.position.clone();
      const end =
        target instanceof THREE.Vector3 ? target.clone() : new THREE.Vector3(...target);
      const distance = start.distanceTo(end);
      const durationSec = Math.max(distance / Math.max(speed, 0.1), 0.1);

      const walkAction = getAction(CHAR_ID, 'walking');
      if (walkAction) {
        fadeToAction(char, walkAction, 0.2);
      } else if (char.idleAction) {
        fadeToAction(char, char.idleAction, 0.2);
      }

      activeWalk = {
        root,
        start,
        end,
        durationSec,
        elapsed: 0,
        resolve: () => {
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
      await playAnimationForDuration(char, step.name, step.duration ?? 2);
    } else if (step.type === 'walkTo') {
      const target =
        step.target instanceof THREE.Vector3
          ? step.target
          : new THREE.Vector3(...step.target);
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
    runNextStep(sequenceGeneration);
  }

  function doOneWanderStep(): void {
    const char = getCharacter(CHAR_ID);
    if (!char || !idleWanderEnabled || isPlaying) return;

    const idx = Math.floor(Math.random() * WAYPOINTS.length);
    const target = WAYPOINTS[idx];
    const emote =
      WANDER_EMOTES[Math.floor(Math.random() * WANDER_EMOTES.length)];

    playSequence([
      { type: 'walkTo', target, speed: 0.8 },
      { type: 'animation', name: emote, duration: 1.5 },
      { type: 'walkTo', target: new THREE.Vector3(0, 0, 0), speed: 0.8 }
    ]);
  }

  function startIdleWanderer() {
    if (wanderIntervalId) return;
    idleWanderEnabled = true;
    wanderIntervalId = setInterval(() => {
      if (!idleWanderEnabled || isPlaying) return;
      doOneWanderStep();
    }, 8000);
  }

  function stopIdleWanderer() {
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
      activeWalk.root.position.lerpVectors(activeWalk.start, activeWalk.end, t);
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
  }

  /** 30s no messages → idle anim. 60s no messages → start wanderer. */
  function checkIdleTimers() {
    const now = Date.now();
    const idleSec = (now - lastActivityTime) / 1000;

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

  return {
    playSequence,
    walkTo,
    isBusy,
    stop,
    tick,
    setLastActivity,
    checkIdleTimers,
    startIdleWanderer,
    stopIdleWanderer
  };
}
