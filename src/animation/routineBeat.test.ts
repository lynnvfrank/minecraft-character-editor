import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rescaleRoutine, snapRoutine } from './routineBeat';
import type { RoutineStep } from './studioRoutine';

const steps: RoutineStep[] = [
  { type: 'blend', layers: [{ name: 'dance', weight: 1 }], duration: 2.1 },
  { type: 'pause', duration: 0.5 },
];

describe('routine snap to beat', () => {
  test('snapping moves lengths onto beats and keeps the rest', () => {
    const snapped = snapRoutine(steps, 120);
    assert.deepEqual(snapped.map((s) => s.duration), [2, 0.5]);
    assert.equal(snapped[1], steps[1]); // already on the grid: same object
    assert.equal(snapRoutine(snapped, 120), snapped);
  });
  test('a tempo change keeps the number of beats in each step', () => {
    const snapped = snapRoutine(steps, 120); // 4 beats, 1 beat
    assert.deepEqual(rescaleRoutine(snapped, 120, 60).map((s) => s.duration), [4, 1]);
    assert.equal(rescaleRoutine(snapped, 120, 120), snapped);
  });
});
