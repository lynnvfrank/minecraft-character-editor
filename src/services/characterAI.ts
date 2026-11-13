/**
 * Character AI: state machine, procedural look-at, body turn, and interactive behaviors.
 * Makes the character feel alive when idle and responsive when the user returns.
 *
 * States: idle → wandering (after 30–60s) | noticing (on user activity) → approaching → interacting
 * - Idle: micro-emotes, gentle head look-at toward camera
 * - Wandering: walk to waypoints, small emotes at each stop
 * - Noticing: interrupt current, turn head/body, play greeting emote
 * - Approaching: walk toward screen center
 * - Interacting: play happy emote near user, then idle or wander
 */
import * as THREE from 'three';
import type { SequenceStep } from '../animation';
import { logFacingChange } from '../debug/debugFacing';
import { DEFAULT_CHARACTER_ID } from '../domain';

/** Minimal character state (matches main's CharacterState / CharacterStateLike) */
export type CharacterStateLike = {
  id: string;
  container: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | undefined;
};

export type CharacterAIDeps = {
  getCharacter: (id: string) => CharacterStateLike | undefined;
  fadeToAction: (char: CharacterStateLike, action: THREE.AnimationAction, duration: number) => void;
  getAction: (charId: string, name: string) => THREE.AnimationAction | undefined;
  getCamera: () => THREE.PerspectiveCamera;
  getClock: () => THREE.Clock;
  /** Animation manager for sequences, walkTo, stop, setLastActivity */
  animationManager: {
    playSequence: (steps: SequenceStep[]) => void;
    walkTo: (target: THREE.Vector3 | [number, number, number], speed?: number) => Promise<void>;
    stop: () => void;
    isBusy: () => boolean;
    isWalking?: () => boolean;
    isInWalkToPhase?: () => boolean;
    setLastActivity: () => void;
    startIdleWanderer: () => void;
    stopIdleWanderer: () => void;
    runOneWanderStep?: () => void;
  };
};

const CHAR_ID = DEFAULT_CHARACTER_ID;

/** Micro-emotes for idle variations — quick, non-disruptive */
const IDLE_MICRO_EMOTES = [
  'yawn',
  'shrugging',
  'bored',
  'bashful',
  'happy-idle'
];

/** Greeting emotes when user returns (curious, noticing) */
const GREETING_EMOTES = ['acknowledging', 'excited', 'happy'];

/** Happy/talking emotes when close to user */
const INTERACTING_EMOTES = ['happy-idle', 'clapping', 'laughing'];

/** Minimum idle seconds before we consider user "away" (then activity = "return") */
const USER_AWAY_THRESHOLD_SEC = 2;

/** Idle seconds before starting wandering */
const WANDER_START_SEC = 10;

/** Seconds between idle micro-emotes (randomized around this) */
const MICRO_EMOTE_INTERVAL = 12;

/** Head look-at: max yaw/pitch in radians (avoid unnatural twists) */
const HEAD_LOOK_LIMIT_YAW = Math.PI / 4;
const HEAD_LOOK_LIMIT_PITCH = Math.PI / 6;

/** Smoothing factors (0–1, higher = snappier) */
const HEAD_LOOK_SMOOTH = 0.08;
const BODY_TURN_SMOOTH = 0.06;

/** Distance in front of camera to walk toward (world units) */
const APPROACH_DISTANCE = 1.5;

export type AIState = 'idle' | 'wandering' | 'noticing' | 'approaching' | 'interacting';

export function createCharacterAI(deps: CharacterAIDeps) {
  const { getCharacter, fadeToAction, getAction, getCamera, animationManager } = deps;

  let state: AIState = 'idle';
  let lastInteractionTime = Date.now();
  /** For wander check — only reset by chat, key, clicks. NOT mousemove (so she can wander while user watches). */
  let lastExplicitActivityTime = Date.now();
  let lastMicroEmoteTime = Date.now();
  let headBone: THREE.Bone | null = null;
  /** Current head rotation offset (for procedural look-at, applied each frame) */
  let headLookQuat = new THREE.Quaternion();
  let targetHeadLookQuat = new THREE.Quaternion();
  /** Body yaw target (radians) for smooth turn toward camera */
  let targetBodyYaw = 0;
  let currentBodyYaw = 0;
  /** Store rest-pose head quat (captured on first find; may be overwritten by animations) */
  let headBoneOriginalQuat = new THREE.Quaternion();
  let headBoneInitialized = false;
  /** When a micro-emote plays, skip head look-at briefly so the emote shows through */
  let microEmoteEndTime = 0;

  /** Find the head bone in the model skeleton (Mixamo: mixamorigHead, Head, etc.) */
  function findHeadBone(model: THREE.Group): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    model.traverse((obj) => {
      if ((obj as THREE.Bone).isBone && !found) {
        const name = (obj as THREE.Bone).name.toLowerCase();
        if (name.includes('head') && !name.includes('shoulder')) {
          found = obj as THREE.Bone;
        }
      }
    });
    return found;
  }

  /** Initialize head bone reference and store rest pose (from bind pose or first frame) */
  function ensureHeadBone(char: CharacterStateLike): void {
    if (headBoneInitialized) return;
    headBone = findHeadBone(char.model);
    if (headBone) {
      headBoneOriginalQuat.copy(headBone.quaternion);
      headBoneInitialized = true;
    }
  }

  /** True if we should skip procedural head look (e.g. during a micro-emote) */
  function shouldSkipHeadLook(char: CharacterStateLike): boolean {
    if (Date.now() < microEmoteEndTime) return true;
    if (!char.currentAction) return false;
    const name = Object.entries(char.actions).find(([, a]) => a === char.currentAction)?.[0] ?? '';
    return IDLE_MICRO_EMOTES.includes(name);
  }

  /**
   * Procedural head look-at: smoothly rotate head toward camera/user position.
   * Limited yaw/pitch to avoid unnatural neck twists. Applied every frame.
   * Skipped during micro-emotes so yawn, shrug etc. show through.
   */
  function updateLookAt(deltaSec: number, char: CharacterStateLike): void {
    ensureHeadBone(char);
    if (!headBone || shouldSkipHeadLook(char)) return;

    const camera = getCamera();
    const model = char.model;

    // Target in world space
    const targetWorld = new THREE.Vector3();
    camera.getWorldPosition(targetWorld);

    // Head position in world space
    const headWorld = new THREE.Vector3();
    headBone.getWorldPosition(headWorld);

    // Direction from head to camera
    const dir = new THREE.Vector3().subVectors(targetWorld, headWorld).normalize();

    // In model's local space, forward is typically -Z for Mixamo-style rigs
    const modelForward = new THREE.Vector3(0, 0, -1).applyQuaternion(model.quaternion);

    // Approximate yaw (left-right) and pitch (up-down) in head's local space
    const flatDir = new THREE.Vector2(dir.x, dir.z).normalize();
    const flatForward = new THREE.Vector2(modelForward.x, modelForward.z).normalize();
    let yaw = Math.atan2(flatDir.x, flatDir.y) - Math.atan2(flatForward.x, flatForward.y);
    let pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));

    // Clamp to natural limits
    yaw = THREE.MathUtils.clamp(yaw, -HEAD_LOOK_LIMIT_YAW, HEAD_LOOK_LIMIT_YAW);
    pitch = THREE.MathUtils.clamp(pitch, -HEAD_LOOK_LIMIT_PITCH, HEAD_LOOK_LIMIT_PITCH);

    // Build target quaternion from yaw (Y) and pitch (X)
    targetHeadLookQuat.identity();
    targetHeadLookQuat.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
    );

    // Blend toward target
    const t = 1 - Math.exp(-HEAD_LOOK_SMOOTH * 60 * deltaSec);
    headLookQuat.slerpQuaternions(headLookQuat, targetHeadLookQuat, t);

    // Apply: blend original pose with look-at
    headBone.quaternion.copy(headBoneOriginalQuat);
    headBone.quaternion.premultiply(headLookQuat);
  }

  /**
   * Smooth body yaw rotation toward camera. Updates model.rotation.y via lerp.
   */
  function updateBodyTurn(deltaSec: number, char: CharacterStateLike): void {
    const camera = getCamera();
    const container = char.container;

    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    const charPos = new THREE.Vector3();
    container.getWorldPosition(charPos);

    const dx = camPos.x - charPos.x;
    const dz = camPos.z - charPos.z;
    targetBodyYaw = Math.atan2(dx, dz);

    const t = 1 - Math.exp(-BODY_TURN_SMOOTH * 60 * deltaSec);
    currentBodyYaw += (targetBodyYaw - currentBodyYaw) * t;

    // Apply to model (child of container) — model holds the visual, we rotate it for facing
    const prevYaw = char.model.rotation.y;
    char.model.rotation.y = currentBodyYaw;
    logFacingChange('updateBodyTurn', prevYaw, currentBodyYaw);
  }

  /** Stop whatever the character is doing: animations, movement, wander */
  function interruptCurrentBehavior(): void {
    animationManager.stop();
    animationManager.stopIdleWanderer();
  }

  /**
   * Walk toward a point in front of the camera (approximate screen center at ground level).
   */
  function walkToScreenCenter(speed = 1): Promise<void> {
    const char = getCharacter(CHAR_ID);
    if (!char) return Promise.resolve();

    const camera = getCamera();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    dir.y = 0;
    dir.normalize();

    const target = new THREE.Vector3();
    camera.getWorldPosition(target);
    target.addScaledVector(dir, APPROACH_DISTANCE);
    target.y = 0;

    return animationManager.walkTo(target, speed);
  }

  /** Play a random micro-emote (idle variation) */
  function playMicroEmote(): void {
    const char = getCharacter(CHAR_ID);
    if (!char || animationManager.isBusy()) return;

    const emote = IDLE_MICRO_EMOTES[Math.floor(Math.random() * IDLE_MICRO_EMOTES.length)];
    const action = getAction(CHAR_ID, emote);
    if (!action) return;

    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    fadeToAction(char, action, 0.3);

    // After emote duration, return to idle
    const duration = 1.5 + Math.random() * 1;
    microEmoteEndTime = Date.now() + duration * 1000;
    setTimeout(() => {
      const c = getCharacter(CHAR_ID);
      if (c?.idleAction && state === 'idle') {
        fadeToAction(c, c.idleAction!, 0.4);
      }
    }, duration * 1000);
  }

  /** Start the "noticing" flow: greet emote then transition to approaching */
  function startNoticingFlow(): void {
    state = 'noticing';
    const char = getCharacter(CHAR_ID);
    if (!char) return;
    currentBodyYaw = char.model.rotation.y;

    const greet = GREETING_EMOTES[Math.floor(Math.random() * GREETING_EMOTES.length)];
    const action = getAction(CHAR_ID, greet);
    if (!action) {
      transitionToApproaching();
      return;
    }

    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    fadeToAction(char, action, 0.3);

    const duration = 1.2 + Math.random() * 0.5;
    setTimeout(() => {
      if (state === 'noticing') transitionToApproaching();
    }, duration * 1000);
  }

  function transitionToApproaching(): void {
    state = 'approaching';
    walkToScreenCenter(1).then(() => {
      if (state === 'approaching') transitionToInteracting();
    });
  }

  function transitionToInteracting(): void {
    state = 'interacting';
    const char = getCharacter(CHAR_ID);
    if (!char) {
      transitionToIdle();
      return;
    }

    const emote = INTERACTING_EMOTES[Math.floor(Math.random() * INTERACTING_EMOTES.length)];
    const action = getAction(CHAR_ID, emote);
    if (action) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      fadeToAction(char, action, 0.4);
    }

    // Stay in interacting for a few seconds, then back to idle
    setTimeout(() => {
      if (state === 'interacting') transitionToIdle();
    }, 3 + Math.random() * 2);
  }

  function transitionToIdle(): void {
    state = 'idle';
    animationManager.stopIdleWanderer();
    const char = getCharacter(CHAR_ID);
    if (char?.idleAction) fadeToAction(char, char.idleAction, 0.5);
  }

  function transitionToWandering(): void {
    state = 'wandering';
    animationManager.startIdleWanderer();
    // Run first wander step immediately (otherwise it would wait 8s)
    if (animationManager.runOneWanderStep) {
      animationManager.runOneWanderStep();
    }
  }

  /** Called when user does something. explicit=true for chat/key/clicks; false for mousemove only. */
  function onUserActivity(explicit = false): boolean {
    const now = Date.now();
    const idleSec = (now - lastInteractionTime) / 1000;
    lastInteractionTime = now;
    if (explicit) {
      lastExplicitActivityTime = now;
      animationManager.setLastActivity();
    }

    if (idleSec < USER_AWAY_THRESHOLD_SEC) return false;

    if (state === 'idle' || state === 'wandering') {
      interruptCurrentBehavior();
      startNoticingFlow();
      return true;
    }
    return false;
  }

  /** Main update — call every frame from animate loop */
  function update(deltaSec: number): void {
    const char = getCharacter(CHAR_ID);
    if (!char) return;

    const now = Date.now();
    const explicitIdleSec = (now - lastExplicitActivityTime) / 1000;

    // --- State transitions ---
    if (state === 'idle') {
      // Use explicitIdleSec for wander — mousemove doesn't reset it (she can wander while user watches)
      if (explicitIdleSec >= WANDER_START_SEC) {
        transitionToWandering();
      } else {
        // Occasional micro-emote
        const elapsed = (now - lastMicroEmoteTime) / 1000;
        const nextEmote = MICRO_EMOTE_INTERVAL * (0.7 + Math.random() * 0.6);
        if (elapsed >= nextEmote && !animationManager.isBusy()) {
          lastMicroEmoteTime = now;
          playMicroEmote();
        }
      }
    }

    // --- Per-frame procedural updates ---
    const shouldLookAt = state === 'idle' || state === 'noticing' || state === 'approaching' || state === 'interacting';
    if (shouldLookAt) {
      updateLookAt(deltaSec, char);
    } else if (headBone && headBoneInitialized) {
      // Reset look-at toward neutral when wandering (animation drives the head)
      const t = 1 - Math.exp(-0.1 * 60 * deltaSec);
      headLookQuat.slerp(new THREE.Quaternion(), t);
    }

    // Don't override body rotation during turn or walk — animationManager owns facing
    const inWalkOrTurn = (animationManager.isWalking?.() ?? false) || (animationManager.isInWalkToPhase?.() ?? false);
    const shouldTurnBody =
      (state === 'noticing' || state === 'approaching' || state === 'interacting') && !inWalkOrTurn;
    if (shouldTurnBody) {
      updateBodyTurn(deltaSec, char);
    }
  }

  /** Reset head bone when character is reloaded */
  function resetHeadBone(): void {
    headBone = null;
    headBoneInitialized = false;
    headLookQuat.identity();
    targetHeadLookQuat.identity();
  }

  return {
    update,
    onUserActivity,
    interruptCurrentBehavior,
    walkToScreenCenter,
    setLastActivity: () => {
      const now = Date.now();
      lastInteractionTime = now;
      lastExplicitActivityTime = now;
      animationManager.setLastActivity();
    },
    getState: () => state,
    resetHeadBone
  };
}

/** Example sequences for greet → walk → happy flow (uses real animation names) */
export const EXAMPLE_SEQUENCES = [
  {
    id: 'greet-walk-happy',
    label: 'Acknowledging → Walk → Happy-Idle',
    steps: [
      { type: 'animation' as const, name: 'acknowledging', duration: 1.2 },
      { type: 'walkTo' as const, target: [0, 0, 1.2] as [number, number, number], speed: 1 },
      { type: 'animation' as const, name: 'happy-idle', duration: 2 }
    ]
  },
  {
    id: 'excited-approach-clap',
    label: 'Excited → Approach → Clapping',
    steps: [
      { type: 'animation' as const, name: 'excited', duration: 1.5 },
      { type: 'walkTo' as const, target: [0, 0, 1.5] as [number, number, number], speed: 1.2 },
      { type: 'animation' as const, name: 'clapping', duration: 2 }
    ]
  },
  {
    id: 'happy-walk-laugh',
    label: 'Happy → Walk → Laughing',
    steps: [
      { type: 'animation' as const, name: 'happy', duration: 1 },
      { type: 'walkTo' as const, target: [0, 0, 1] as [number, number, number], speed: 1 },
      { type: 'animation' as const, name: 'laughing', duration: 2 }
    ]
  }
];
