/**
 * Plays saved combos (blend steps) on crowd characters by setting clip weights on their mixers
 * every frame. The timing and weights are animation/crowdCombo.ts; this file only applies them.
 *
 * While a combo plays, the character's actions are driven here instead of through fadeToAction.
 * `stop` hands the character back: the heaviest clip becomes `currentAction` again, so the next
 * fadeToAction crossfades from it, and the other clips fade out.
 */
import * as THREE from 'three';
import { comboWeightsAt } from '../animation/crowdCombo';
import type { RoutineStep } from '../animation/studioRoutine';
import type { ResolvedLayer } from '../animation/studioMix';
import type { CharacterState } from './characterTypes';

const HAND_BACK_FADE_SEC = 0.3;

type Playing = {
  routine: readonly RoutineStep[];
  t: number;
  rest: Map<string, ResolvedLayer>;
  /** Actions this player has running. */
  active: Set<THREE.AnimationAction>;
};

export function createCrowdComboPlayer() {
  const playing = new Map<CharacterState, Playing>();

  function apply(char: CharacterState, p: Playing): void {
    const weights = comboWeightsAt(p.routine, p.t, p.rest);
    for (const [key, action] of Object.entries(char.actions)) {
      const layer = weights.get(key);
      if (!layer) {
        if (p.active.delete(action)) action.stop();
        continue;
      }
      if (!p.active.has(action) || !action.isRunning()) {
        if (!p.active.has(action)) action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.paused = false;
        action.play();
        p.active.add(action);
      }
      action.enabled = true;
      action.setEffectiveTimeScale(layer.timeScale);
      action.setEffectiveWeight(layer.weight); // also cancels a fade left over from fadeToAction
    }
  }

  /** Start (or restart) a combo on `char`, easing in from what it is doing now. */
  function start(char: CharacterState, routine: readonly RoutineStep[]): void {
    stop(char);
    const rest = new Map<string, ResolvedLayer>();
    const active = new Set<THREE.AnimationAction>();
    const from = char.currentAction ?? char.idleAction;
    const fromKey = from && Object.keys(char.actions).find((k) => char.actions[k] === from);
    if (from && fromKey) {
      rest.set(fromKey, { weight: 1, timeScale: 1 });
      if (from.isRunning()) active.add(from);
    }
    const p: Playing = { routine, t: 0, rest, active };
    playing.set(char, p);
    apply(char, p);
  }

  /** Per frame, with the same delta the character's mixer gets. */
  function update(dt: number): void {
    for (const [char, p] of playing) {
      p.t += dt;
      apply(char, p);
    }
  }

  /** Hand `char` back to fadeToAction. Does nothing if it isn't playing a combo. */
  function stop(char: CharacterState): void {
    const p = playing.get(char);
    if (!p) return;
    playing.delete(char);
    let lead: THREE.AnimationAction | null = null;
    for (const action of p.active) {
      if (!lead || action.getEffectiveWeight() > lead.getEffectiveWeight()) lead = action;
    }
    for (const action of p.active) {
      if (action !== lead) action.fadeOut(HAND_BACK_FADE_SEC);
    }
    if (lead) {
      lead.setEffectiveWeight(1);
      lead.setEffectiveTimeScale(1);
    }
    char.currentAction = lead;
  }

  /** Forget `char` without touching its mixer (it is being disposed). */
  function drop(char: CharacterState): void {
    playing.delete(char);
  }

  return { start, update, stop, drop, isPlaying: (char: CharacterState) => playing.has(char) };
}

export type CrowdComboPlayer = ReturnType<typeof createCrowdComboPlayer>;
