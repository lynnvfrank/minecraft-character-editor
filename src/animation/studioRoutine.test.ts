import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { BlendStep } from '../domain/sequences';
import { createEmptyMix, mixToBlendStep, resolveMixWeights, type ResolvedLayer } from './studioMix';
import {
  addPause,
  addStep,
  blendStepToMix,
  clampStepDuration,
  DEFAULT_PAUSE_SEC,
  DEFAULT_STEP_SEC,
  describeRoutineLength,
  hasBlend,
  MAX_STEP_SEC,
  MIN_STEP_SEC,
  moveStep,
  removeStep,
  routineWeightsAt,
  selectionAfterMove,
  selectionAfterRemove,
  setStepDuration,
  stepAtTime,
  toSavedSteps,
  totalDuration,
  updateStep,
  type RoutineStep,
} from './studioRoutine';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const blend = (...layers: [string, number, number?][]): BlendStep => ({
  type: 'blend',
  layers: layers.map(([name, weight, timeScale]) => ({ name, weight, ...(timeScale != null ? { timeScale } : {}) })),
});
const wave = blend(['wave', 1]);
const clap = blend(['clap', 0.6], ['spin', 0.4, 1.5]);
const names = (steps: readonly RoutineStep[]) =>
  steps.map((s) => (s.type === 'blend' ? s.layers[0]!.name : 'pause'));

function routine(): RoutineStep[] {
  let r: RoutineStep[] = [];
  r = addStep(r, wave, 2);
  r = addStep(r, clap, 3);
  r = addPause(r, 1);
  return r;
}

describe('clampStepDuration', () => {
  test('clamps to the allowed range', () => {
    assert.equal(clampStepDuration(0), MIN_STEP_SEC);
    assert.equal(clampStepDuration(-5), MIN_STEP_SEC);
    assert.equal(clampStepDuration(999), MAX_STEP_SEC);
    assert.equal(clampStepDuration(1.5), 1.5);
  });
  test('junk falls back to the default', () => {
    assert.equal(clampStepDuration(NaN), DEFAULT_STEP_SEC);
    assert.equal(clampStepDuration(Infinity, 7), 7);
  });
});

describe('editing a routine', () => {
  test('addStep appends a blend with a clamped length and does not mutate', () => {
    const a: RoutineStep[] = [];
    const b = addStep(a, wave, 100);
    assert.equal(a.length, 0);
    assert.deepEqual(b, [{ type: 'blend', layers: wave.layers, duration: MAX_STEP_SEC }]);
  });
  test('addStep ignores the blend\'s own duration', () => {
    const b = addStep([], { ...wave, duration: 9 }, 2);
    assert.equal(b[0]!.duration, 2);
  });
  test('addPause appends a pause', () => {
    assert.deepEqual(addPause([]), [{ type: 'pause', duration: DEFAULT_PAUSE_SEC }]);
    assert.deepEqual(addPause([], NaN), [{ type: 'pause', duration: DEFAULT_PAUSE_SEC }]);
  });
  test('moveStep swaps neighbours and ignores moves off the ends', () => {
    const r = routine();
    assert.deepEqual(names(moveStep(r, 0, 1)), ['clap', 'wave', 'pause']);
    assert.deepEqual(names(moveStep(r, 2, -1)), ['wave', 'pause', 'clap']);
    assert.equal(moveStep(r, 0, -1), r);
    assert.equal(moveStep(r, 2, 1), r);
    assert.equal(moveStep(r, 9, -1), r);
    assert.deepEqual(names(r), ['wave', 'clap', 'pause']);
  });
  test('removeStep drops one step', () => {
    const r = routine();
    assert.deepEqual(names(removeStep(r, 1)), ['wave', 'pause']);
    assert.equal(removeStep(r, -1), r);
    assert.equal(removeStep(r, 3), r);
  });
  test('updateStep swaps the clips and keeps the length', () => {
    const r = routine();
    const u = updateStep(r, 0, { ...clap, duration: 50 });
    assert.deepEqual(u[0], { type: 'blend', layers: clap.layers, duration: 2 });
    assert.equal(u[1], r[1]);
    assert.equal(updateStep(r, 5, clap), r);
  });
  test('updateStep turns a pause into a blend of the same length', () => {
    const u = updateStep(routine(), 2, wave);
    assert.deepEqual(u[2], { type: 'blend', layers: wave.layers, duration: 1 });
  });
  test('setStepDuration clamps; junk keeps the old length', () => {
    const r = routine();
    assert.equal(setStepDuration(r, 1, 0.01)[1]!.duration, MIN_STEP_SEC);
    assert.equal(setStepDuration(r, 1, NaN)[1]!.duration, 3);
    assert.equal(setStepDuration(r, 2, 4)[2]!.type, 'pause');
    assert.equal(setStepDuration(r, 7, 4), r);
  });
  test('selection follows moves and removals', () => {
    assert.equal(selectionAfterMove(1, 1, -1, 3), 0);
    assert.equal(selectionAfterMove(0, 1, -1, 3), 1);
    assert.equal(selectionAfterMove(2, 1, -1, 3), 2);
    assert.equal(selectionAfterMove(0, 0, -1, 3), 0); // move was a no-op
    assert.equal(selectionAfterMove(null, 0, 1, 3), null);
    assert.equal(selectionAfterRemove(1, 1), null);
    assert.equal(selectionAfterRemove(2, 1), 1);
    assert.equal(selectionAfterRemove(0, 1), 0);
  });
});

describe('timing', () => {
  test('totalDuration sums step lengths', () => {
    assert.equal(totalDuration([]), 0);
    assert.equal(totalDuration(routine()), 6);
    assert.equal(describeRoutineLength(routine()), '3 steps · 6s');
    assert.equal(describeRoutineLength(addStep([], wave, 2.5)), '1 step · 2.5s');
  });
  test('stepAtTime finds the step and the time into it', () => {
    const r = routine();
    assert.deepEqual(stepAtTime(r, 0), { index: 0, localTime: 0 });
    assert.deepEqual(stepAtTime(r, 1.5), { index: 0, localTime: 1.5 });
    assert.deepEqual(stepAtTime(r, 2), { index: 1, localTime: 0 }); // boundary → next step
    assert.deepEqual(stepAtTime(r, 5.5), { index: 2, localTime: 0.5 });
  });
  test('stepAtTime is null outside the routine', () => {
    const r = routine();
    assert.equal(stepAtTime(r, -0.1), null);
    assert.equal(stepAtTime(r, 6), null);
    assert.equal(stepAtTime(r, NaN), null);
    assert.equal(stepAtTime([], 0), null);
  });
});

describe('routineWeightsAt', () => {
  const rest = new Map<string, ResolvedLayer>([['idle', { weight: 1, timeScale: 1 }]]);
  const sum = (m: Map<string, ResolvedLayer>) => [...m.values()].reduce((s, r) => s + r.weight, 0);

  test('holds a step\'s weights after the fade', () => {
    const w = routineWeightsAt(routine(), 3, rest, 0.3);
    assert.deepEqual([...w.keys()].sort(), ['clap', 'spin']);
    assert.ok(near(w.get('clap')!.weight, 0.6));
    assert.equal(w.get('spin')!.timeScale, 1.5);
  });
  test('the first step starts at full weight (no fade in)', () => {
    assert.deepEqual(routineWeightsAt(routine(), 0, rest, 0.3), new Map([['wave', { weight: 1, timeScale: 1 }]]));
  });
  test('crossfades from the previous step and keeps the total weight', () => {
    const w = routineWeightsAt(routine(), 2.15, rest, 0.3); // halfway through the fade
    assert.ok(near(w.get('wave')!.weight, 0.5));
    assert.ok(near(w.get('clap')!.weight, 0.3));
    assert.ok(near(w.get('spin')!.weight, 0.2));
    assert.ok(near(sum(w), 1));
    // Just before the boundary it is still all wave.
    assert.deepEqual([...routineWeightsAt(routine(), 1.99, rest, 0.3).keys()], ['wave']);
  });
  test('a clip in both steps eases its speed', () => {
    let r: RoutineStep[] = addStep([], blend(['wave', 1, 1]), 1);
    r = addStep(r, blend(['wave', 1, 2]), 1);
    const w = routineWeightsAt(r, 1.25, rest, 0.5);
    assert.ok(near(w.get('wave')!.weight, 1));
    assert.ok(near(w.get('wave')!.timeScale, 1.5));
  });
  test('a pause holds the blend before it', () => {
    const w = routineWeightsAt(routine(), 5.5, rest, 0.3);
    assert.ok(near(w.get('clap')!.weight, 0.6));
    assert.ok(near(w.get('spin')!.weight, 0.4));
  });
  test('a leading pause shows the rest pose, then fades into the first blend', () => {
    const r = addStep(addPause([], 1), wave, 1);
    assert.equal(routineWeightsAt(r, 0.5, rest, 0.4), rest);
    const w = routineWeightsAt(r, 1.1, rest, 0.4);
    assert.ok(near(w.get('idle')!.weight, 0.75));
    assert.ok(near(w.get('wave')!.weight, 0.25));
  });
  test('the fade never outlasts a short step', () => {
    let r: RoutineStep[] = addStep([], wave, 1);
    r = addStep(r, clap, 0.25);
    r = addStep(r, wave, 1);
    // Step 2 lasts 0.25s with a 1s fade asked for: halfway through it is half blended.
    const w = routineWeightsAt(r, 1.125, rest, 1);
    assert.ok(near(w.get('wave')!.weight, 0.5));
  });
  test('empty outside the routine', () => {
    assert.equal(routineWeightsAt(routine(), 6, rest).size, 0);
    assert.equal(routineWeightsAt([], 0, rest).size, 0);
  });
});

describe('blendStepToMix', () => {
  test('round-trips through mixToBlendStep', () => {
    const mix = createEmptyMix();
    mix.layers = {
      wave: { playing: true, weight: 0.9, timeScale: 1.25 },
      clap: { playing: true, weight: 0.3, timeScale: 1 },
      off: { playing: false, weight: 1, timeScale: 1 },
    };
    mix.crossfade = { a: 'spin', b: 'bow', t: 0.3, curve: 'equal-power' };
    const step = mixToBlendStep(mix, 2)!;
    const back = blendStepToMix(step);
    assert.equal(back.normalize, true);
    assert.equal(back.crossfade.a, null);
    assert.deepEqual(Object.keys(back.layers).sort(), step.layers.map((l) => l.name).sort());
    for (const [key, r] of resolveMixWeights(mix)) {
      assert.ok(near(resolveMixWeights(back).get(key)!.weight, r.weight, 2e-3), key);
    }
  });
  test('every layer plays at its saved weight and speed', () => {
    const mix = blendStepToMix(clap);
    assert.deepEqual(mix.layers, {
      clap: { playing: true, weight: 0.6, timeScale: 1 },
      spin: { playing: true, weight: 0.4, timeScale: 1.5 },
    });
  });
  test('weights that don\'t add up to 100% stay un-normalized', () => {
    const mix = blendStepToMix(blend(['wave', 0.3], ['clap', 0.3]));
    assert.equal(mix.normalize, false);
    assert.ok(near(resolveMixWeights(mix).get('wave')!.weight, 0.3));
  });
  test('zero-weight layers are dropped', () => {
    assert.deepEqual(Object.keys(blendStepToMix(blend(['wave', 1], ['clap', 0])).layers), ['wave']);
  });
});

describe('saving', () => {
  test('toSavedSteps copies every step with its length', () => {
    const r = routine();
    const saved = toSavedSteps(r);
    assert.deepEqual(saved, [
      { type: 'blend', layers: wave.layers, duration: 2 },
      { type: 'blend', layers: clap.layers, duration: 3 },
      { type: 'pause', duration: 1 },
    ]);
    assert.notEqual((saved[0] as BlendStep).layers, wave.layers);
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
  });
  test('hasBlend', () => {
    assert.equal(hasBlend([]), false);
    assert.equal(hasBlend(addPause([])), false);
    assert.equal(hasBlend(routine()), true);
  });
});
