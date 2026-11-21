import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  audioTimeAtPerf,
  beatInfoAt,
  beatLengthsFor,
  beatsToSeconds,
  bounceOffset,
  clampBpm,
  collectSteps,
  createTransport,
  firstStepAtOrAfter,
  formatBeats,
  MAX_BOUNCE_HEIGHT,
  nearestBeatLength,
  nextBarLine,
  perfTimeOfAudio,
  pushTap,
  rescaleSnapped,
  retime,
  snapSeconds,
  stepSeconds,
  stepTime,
  swingDelay,
  tapTempo,
  TAP_RESET_MS,
  type Transport,
} from './beatClock';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ~ ${b}`);

/** Run the scheduler over windows like the real timer does (jittery ticks), returning every step. */
function runWindows(tr: Transport, ticks: number[], lookahead = 0.1) {
  const out: { step: number; time: number }[] = [];
  let next = 0;
  for (const now of ticks) {
    const r = collectSteps(tr, next, now + lookahead);
    out.push(...r.steps);
    next = r.next;
  }
  return out;
}

describe('bpm', () => {
  test('clamps and rounds; junk falls back', () => {
    assert.equal(clampBpm(10), 70);
    assert.equal(clampBpm(999), 160);
    assert.equal(clampBpm(99.6), 100);
    assert.equal(clampBpm(NaN), 110);
    assert.equal(clampBpm('120', 90), 90);
  });
  test('a 16th at 120 BPM is 0.125 s', () => {
    close(stepSeconds(120), 0.125);
  });
});

describe('collectSteps across windows', () => {
  test('no dropped or doubled steps with jittery timer ticks', () => {
    const tr = createTransport(1, 120);
    const ticks: number[] = [];
    let t = 1;
    for (let i = 0; i < 400; i++) {
      t += 0.01 + ((i * 7919) % 31) / 1000; // 10-40 ms
      ticks.push(t);
    }
    const steps = runWindows(tr, ticks);
    assert.ok(steps.length > 50);
    steps.forEach((s, i) => assert.equal(s.step, i));
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i]!.time > steps[i - 1]!.time);
  });
  test('the same window twice adds nothing', () => {
    const tr = createTransport(0, 100);
    const a = collectSteps(tr, 0, 0.5);
    const b = collectSteps(tr, a.next, 0.5);
    assert.equal(b.steps.length, 0);
    assert.equal(b.next, a.next);
  });
  test('maxSteps bounds one call', () => {
    const tr = createTransport(0, 160);
    assert.equal(collectSteps(tr, 0, 100, 8).steps.length, 8);
  });
  test('after a stall, firstStepAtOrAfter skips ahead on the grid', () => {
    const tr = createTransport(0, 120);
    assert.equal(firstStepAtOrAfter(tr, 1), 8);
    assert.equal(firstStepAtOrAfter(tr, 1.01), 9);
  });
});

describe('swing', () => {
  test('only odd 16ths move, by a third of a step at full swing', () => {
    assert.equal(swingDelay(0, 120, 1), 0);
    assert.equal(swingDelay(2, 120, 1), 0);
    close(swingDelay(1, 120, 1), 0.125 / 3);
    close(swingDelay(3, 120, 0.5), 0.125 / 6);
    assert.equal(swingDelay(1, 120, 0), 0);
  });
  test('swung steps stay in order and windows still see each once', () => {
    const tr = createTransport(0, 90, 1);
    close(stepTime(tr, 1) - stepTime(tr, 0), stepSeconds(90) * (4 / 3));
    const ticks = Array.from({ length: 200 }, (_, i) => i * 0.025);
    runWindows(tr, ticks).forEach((s, i) => assert.equal(s.step, i));
  });
});

describe('tempo change mid-play', () => {
  test('re-pins at the next unscheduled step: no gap, no overlap, new spacing after', () => {
    let tr = createTransport(0, 120);
    const first = collectSteps(tr, 0, 1.0);
    const lastOld = first.steps.at(-1)!;
    tr = retime(tr, first.next, 80);
    const second = collectSteps(tr, first.next, 3);
    assert.equal(second.steps[0]!.step, lastOld.step + 1);
    close(second.steps[0]!.time - lastOld.time, stepSeconds(120)); // the pinned step keeps its place
    close(second.steps[1]!.time - second.steps[0]!.time, stepSeconds(80));
  });
});

describe('beat position and bar lines', () => {
  test('beatInfoAt', () => {
    const tr = createTransport(10, 120); // a beat every 0.5 s
    assert.equal(beatInfoAt(tr, 9), null);
    assert.deepEqual(beatInfoAt(tr, 10), { beat: 0, phase: 0, bar: 0 });
    const b = beatInfoAt(tr, 10.75)!;
    assert.equal(b.beat, 1);
    close(b.phase, 0.5);
    assert.equal(beatInfoAt(tr, 12.1)!.bar, 1);
  });
  test('nextBarLine', () => {
    const tr = createTransport(0, 120); // a bar every 2 s
    assert.deepEqual(nextBarLine(tr, 0.5), { step: 16, time: 2 });
    assert.deepEqual(nextBarLine(tr, 2), { step: 16, time: 2 });
    assert.deepEqual(nextBarLine(tr, 1.99, 0.06), { step: 32, time: 4 });
    assert.deepEqual(nextBarLine(tr, -1), { step: 0, time: 0 });
  });
  test('clock mapping is a round trip', () => {
    const anchor = { contextTime: 5, performanceTime: 20_000 };
    close(audioTimeAtPerf(anchor, 21_500), 6.5);
    close(perfTimeOfAudio(anchor, 6.5), 21_500);
  });
});

describe('tap tempo', () => {
  test('averages the gaps', () => {
    let taps: number[] = [];
    for (const t of [0, 500, 1000, 1500]) taps = pushTap(taps, t);
    assert.equal(tapTempo(taps), 120);
  });
  test('one tap is not a tempo; a long pause starts over', () => {
    assert.equal(tapTempo(pushTap([], 100)), null);
    assert.equal(pushTap([0, 600], 600 + TAP_RESET_MS + 1).length, 1);
  });
  test('keeps only the latest taps and clamps', () => {
    let taps: number[] = [];
    for (let i = 0; i < 20; i++) taps = pushTap(taps, i * 300);
    assert.ok(taps.length <= 6);
    assert.equal(tapTempo(taps), 160); // 200 BPM, clamped
  });
});

describe('snap to beat', () => {
  test('beats to seconds', () => {
    assert.equal(beatsToSeconds(4, 120), 2);
    assert.equal(beatsToSeconds(0.5, 100), 0.3);
  });
  test('half a beat drops out when too short', () => {
    assert.deepEqual(beatLengthsFor(100), [0.5, 1, 2, 4, 8]);
    assert.deepEqual(beatLengthsFor(150), [1, 2, 4, 8]);
  });
  test('nearest length by ratio, junk gives the default', () => {
    assert.equal(nearestBeatLength(1.6, 120), 4); // 3.2 beats
    assert.equal(nearestBeatLength(0.7, 120), 1);
    assert.equal(nearestBeatLength(NaN, 120), 4);
    assert.equal(snapSeconds(2.1, 120), 2);
  });
  test('changing BPM keeps the number of beats', () => {
    assert.equal(rescaleSnapped(2, 120, 60), 4); // 4 beats
    assert.equal(rescaleSnapped(0.3, 100, 150), 0.4); // half a beat no longer fits: 1 beat
  });
  test('labels', () => {
    assert.equal(formatBeats(0.5), '½ beat');
    assert.equal(formatBeats(1), '1 beat');
    assert.equal(formatBeats(8), '8 beats');
  });
});

describe('bounce', () => {
  test('down on the beat, up between, exactly 0 when off', () => {
    assert.equal(bounceOffset(1, 0), 0);
    close(bounceOffset(1, 0.5), MAX_BOUNCE_HEIGHT);
    assert.equal(bounceOffset(0, 0.5), 0);
    close(bounceOffset(0.5, 0.5), MAX_BOUNCE_HEIGHT / 2);
    assert.equal(bounceOffset(1, NaN), 0);
  });
});
