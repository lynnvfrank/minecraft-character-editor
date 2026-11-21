import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotHistory } from './snapshotHistory';

describe('snapshotHistory', () => {
  test('empty history has no answer', () => {
    assert.equal(createSnapshotHistory<string>(1).at(5), undefined);
  });

  test('answers with the value that was in force at that time', () => {
    const h = createSnapshotHistory<string>(10);
    h.record(0, 'idle');
    h.record(1, 'wave');
    h.record(2.5, 'clap');
    assert.equal(h.at(0), 'idle');
    assert.equal(h.at(0.99), 'idle');
    assert.equal(h.at(1), 'wave');
    assert.equal(h.at(2.49), 'wave');
    assert.equal(h.at(2.5), 'clap');
    assert.equal(h.at(99), 'clap');
  });

  test('before the first record, the first value stands in', () => {
    const h = createSnapshotHistory<string>(10);
    h.record(4, 'wave');
    assert.equal(h.at(3.5), 'wave');
  });

  test('a delayed reader sees each change exactly `offset` later', () => {
    const h = createSnapshotHistory<string>(1);
    const offsetTicks = 5; // 0.5 s at 10 ticks per second
    const seen: string[] = [];
    for (let i = 0; i <= 20; i++) {
      h.record(i / 10, i < 10 ? 'a' : 'b'); // the lead switches at t = 1
      seen.push(h.at((i - offsetTicks) / 10)!);
    }
    assert.equal(seen[14], 'a'); // t = 1.4: still the old move
    assert.equal(seen[15], 'b'); // t = 1.5: the switch arrives
    assert.ok(seen.slice(0, 15).every((v) => v === 'a'));
    assert.ok(seen.slice(15).every((v) => v === 'b'));
  });

  test('offset 0 is always the latest value', () => {
    const h = createSnapshotHistory<number>(1);
    for (let i = 0; i < 50; i++) {
      h.record(i * 0.016, i);
      assert.equal(h.at(i * 0.016), i);
    }
  });

  test('recording an unchanged value stores nothing new', () => {
    const h = createSnapshotHistory<string>(1);
    for (let i = 0; i < 100; i++) h.record(i, 'idle');
    assert.equal(h.size(), 1);
    assert.equal(h.at(99.5), 'idle');
  });

  test('old entries are dropped, but not the one still in force at the window edge', () => {
    const h = createSnapshotHistory<number>(1);
    for (let i = 0; i <= 100; i++) h.record(i / 10, i);
    assert.ok(h.size() <= 12, `kept ${h.size()}`);
    // 1 s back is still answered exactly.
    assert.equal(h.at(9), 90);
    assert.equal(h.at(9.05), 90);
  });

  test('custom equality, clear, and a clock that restarts', () => {
    const h = createSnapshotHistory<{ k: string }>(5, (a, b) => a.k === b.k);
    h.record(0, { k: 'x' });
    h.record(1, { k: 'x' });
    assert.equal(h.size(), 1);
    h.record(2, { k: 'y' });
    assert.equal(h.size(), 2);
    h.record(0.5, { k: 'z' }); // time went backwards: start over
    assert.equal(h.size(), 1);
    assert.equal(h.at(0.5)!.k, 'z');
    h.clear();
    assert.equal(h.at(1), undefined);
  });
});
