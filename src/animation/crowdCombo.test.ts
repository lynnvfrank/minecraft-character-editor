import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { comboToRoutine, comboWeightsAt } from './crowdCombo';
import type { SavedSequenceStep } from '../domain/sequences';
import type { ResolvedLayer } from './studioMix';

const has = (...names: string[]) => (name: string) => names.includes(name);
const weight = (m: Map<string, ResolvedLayer>, key: string) => m.get(key)?.weight ?? 0;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

describe('comboToRoutine', () => {
  test('blend, animation and pause steps all get a fixed length', () => {
    const steps: SavedSequenceStep[] = [
      { type: 'blend', layers: [{ name: 'groove', weight: 0.7 }, { name: 'happy', weight: 0.3, timeScale: 1.5 }], duration: 3 },
      { type: 'animation', name: 'waving' },
      { type: 'pause', min: 1, max: 2 },
      { type: 'pause' },
    ];
    assert.deepEqual(comboToRoutine(steps, () => true), [
      { type: 'blend', layers: [{ name: 'groove', weight: 0.7 }, { name: 'happy', weight: 0.3, timeScale: 1.5 }], duration: 3 },
      { type: 'blend', layers: [{ name: 'waving', weight: 1 }], duration: 2 },
      { type: 'pause', duration: 1.5 },
      { type: 'pause', duration: 0.5 },
    ]);
  });

  test('clips the character does not have are dropped; nothing playable gives []', () => {
    const steps: SavedSequenceStep[] = [
      { type: 'blend', layers: [{ name: 'groove', weight: 1 }, { name: 'gone', weight: 1 }], duration: 2 },
      { type: 'blend', layers: [{ name: 'gone', weight: 1 }], duration: 1 },
      { type: 'animation', name: 'gone', duration: 1 },
    ];
    assert.deepEqual(comboToRoutine(steps, has('groove')), [
      { type: 'blend', layers: [{ name: 'groove', weight: 1 }], duration: 2 },
      { type: 'pause', duration: 1 },
      { type: 'pause', duration: 1 },
    ]);
    assert.deepEqual(comboToRoutine(steps, has()), []);
    assert.deepEqual(comboToRoutine([{ type: 'pause', duration: 2 }], () => true), []);
  });
});

describe('comboWeightsAt', () => {
  const routine = comboToRoutine(
    [
      { type: 'blend', layers: [{ name: 'groove', weight: 1 }], duration: 2 },
      { type: 'blend', layers: [{ name: 'happy', weight: 0.5 }, { name: 'clapping', weight: 0.5 }], duration: 2 },
    ],
    () => true
  );
  const rest = new Map<string, ResolvedLayer>([['idle', { weight: 1, timeScale: 1 }]]);

  test('eases in from what the character was doing', () => {
    const start = comboWeightsAt(routine, 0, rest, 0.4);
    near(weight(start, 'idle'), 1);
    near(weight(start, 'groove'), 0);
    const mid = comboWeightsAt(routine, 0.2, rest, 0.4);
    near(weight(mid, 'idle'), 0.5);
    near(weight(mid, 'groove'), 0.5);
    const done = comboWeightsAt(routine, 0.4, rest, 0.4);
    assert.equal(done.has('idle'), false);
    near(weight(done, 'groove'), 1);
  });

  test('holds each step and crossfades into the next', () => {
    near(weight(comboWeightsAt(routine, 1.5, rest, 0.4), 'groove'), 1);
    const fade = comboWeightsAt(routine, 2.1, rest, 0.4);
    near(weight(fade, 'groove'), 0.75);
    near(weight(fade, 'happy'), 0.125);
    const held = comboWeightsAt(routine, 3, rest, 0.4);
    assert.deepEqual([...held.keys()].sort(), ['clapping', 'happy']);
  });

  test('loops: the first step of the next round fades in from the last step, not from idle', () => {
    const wrap = comboWeightsAt(routine, 4.1, rest, 0.4);
    near(weight(wrap, 'groove'), 0.25);
    near(weight(wrap, 'happy'), 0.375);
    assert.equal(wrap.has('idle'), false);
    assert.deepEqual(comboWeightsAt(routine, 4 * 5 + 1.5, rest, 0.4), comboWeightsAt(routine, 1.5, rest, 0.4));
  });

  test('an empty routine or a bad time just shows the rest pose', () => {
    assert.deepEqual(comboWeightsAt([], 1, rest), rest);
    assert.deepEqual(comboWeightsAt(routine, Number.NaN, rest), rest);
    assert.deepEqual(comboWeightsAt(routine, -1, rest), rest);
  });
});
