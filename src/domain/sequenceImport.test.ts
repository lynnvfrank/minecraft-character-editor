import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SavedSequence } from './sequences';
import {
  cleanSequenceLabel,
  isSafeClipName,
  MAX_BLEND_LAYERS,
  MAX_SEQUENCE_LABEL_LENGTH,
  MAX_SEQUENCE_STEPS,
  mergeSequences,
  sanitizeSequence,
  sequenceContentKey,
  withoutUnknownClips,
} from './sequenceImport';

const blend = (name = 'waving', weight = 1) => ({ type: 'blend' as const, layers: [{ name, weight, timeScale: 1 }], duration: 3 });
const seq = (id: string, label: string, name = 'waving'): SavedSequence => ({ id, label, steps: [blend(name)] });

describe('isSafeClipName', () => {
  test('accepts slug-like keys', () => {
    for (const n of ['waving', 'blow-akiss', 'walk_forward-2', 'Idle']) assert.equal(isSafeClipName(n), true, n);
  });
  test('rejects everything else, including names every object has', () => {
    for (const n of ['', 'a b', '../x', 'a/b', '<b>', '-a', 'a-', 'a--b', 'constructor', '__proto__', 'toString', 'x'.repeat(65), 5, null]) {
      assert.equal(isSafeClipName(n), false, String(n));
    }
  });
});

describe('cleanSequenceLabel', () => {
  test('trims, collapses whitespace, strips control characters and caps the length', () => {
    assert.equal(cleanSequenceLabel('  My \n\t dance  '), 'My dance');
    assert.equal(cleanSequenceLabel('a' + String.fromCharCode(0x202e) + 'b'), 'a b');
    assert.equal(cleanSequenceLabel('x'.repeat(500)).length, MAX_SEQUENCE_LABEL_LENGTH);
  });
  test('keeps markup as plain characters (the UI renders labels as text)', () => {
    assert.equal(cleanSequenceLabel('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
  });
  test('falls back to a default name', () => {
    assert.equal(cleanSequenceLabel('   '), 'My combo');
    assert.equal(cleanSequenceLabel(42), 'My combo');
  });
});

describe('sanitizeSequence', () => {
  test('returns a clean copy of a valid sequence', () => {
    const out = sanitizeSequence({
      id: 'studio-abc-0',
      label: ' Hi ',
      steps: [blend(), { type: 'animation', name: 'bored' }, { type: 'pause', duration: 1 }],
      extra: 1,
    });
    assert.deepEqual(out, {
      id: 'studio-abc-0',
      label: 'Hi',
      steps: [blend(), { type: 'animation', name: 'bored' }, { type: 'pause', duration: 1 }],
    });
  });
  test('clamps durations, weights and speeds', () => {
    const out = sanitizeSequence({
      label: 'x',
      steps: [
        { type: 'blend', layers: [{ name: 'a', weight: 7, timeScale: -3 }, { name: 'b', weight: -1, timeScale: 99 }], duration: 9999 },
        { type: 'animation', name: 'a', duration: 0 },
        { type: 'pause', min: 1, max: 3 },
        { type: 'pause', duration: 1e9 },
      ],
    });
    assert.deepEqual(out?.steps, [
      { type: 'blend', layers: [{ name: 'a', weight: 1, timeScale: 0 }, { name: 'b', weight: 0, timeScale: 2 }], duration: 20 },
      { type: 'animation', name: 'a', duration: 0.25 },
      { type: 'pause', duration: 2 },
      { type: 'pause', duration: 20 },
    ]);
    assert.equal(out?.id, '');
  });
  test('rejects malformed input', () => {
    const bad: unknown[] = [
      null,
      'x',
      [],
      {},
      { label: 'x', steps: [] },
      { label: 'x', steps: 'nope' },
      { label: 'x', steps: [{ type: 'dance' }] },
      { label: 'x', steps: [{ type: 'animation', name: 'constructor' }] },
      { label: 'x', steps: [{ type: 'animation', name: 'a b' }] },
      { label: 'x', steps: [{ type: 'blend', layers: [] }] },
      { label: 'x', steps: [{ type: 'blend', layers: [{ name: 'a', weight: NaN }] }] },
      { label: 'x', steps: [{ type: 'blend', layers: [{ name: 'a', weight: 1, timeScale: 'fast' }] }] },
      { label: 'x', steps: [{ type: 'blend', layers: Array.from({ length: MAX_BLEND_LAYERS + 1 }, () => ({ name: 'a', weight: 1 })) }] },
      { label: 'x', steps: Array.from({ length: MAX_SEQUENCE_STEPS + 1 }, () => blend()) },
    ];
    for (const b of bad) assert.equal(sanitizeSequence(b), null, JSON.stringify(b)?.slice(0, 80));
  });
  test('drops ids that are not plain', () => {
    assert.equal(sanitizeSequence({ id: '<x>', label: 'x', steps: [blend()] })?.id, '');
    assert.equal(sanitizeSequence({ id: 'constructor', label: 'x', steps: [blend()] })?.id, '');
  });
});

describe('withoutUnknownClips', () => {
  const has = (n: string) => n === 'waving';
  test('keeps known clips untouched', () => {
    const steps = [blend('waving')];
    assert.deepEqual(withoutUnknownClips(steps, has), steps);
  });
  test('drops unknown layers and turns empty steps into pauses', () => {
    const out = withoutUnknownClips(
      [
        { type: 'blend', layers: [{ name: 'waving', weight: 0.5 }, { name: 'nope', weight: 0.5 }], duration: 2 },
        { type: 'blend', layers: [{ name: 'nope', weight: 1 }], duration: 4 },
        { type: 'animation', name: 'nope', duration: 1 },
        { type: 'pause', duration: 1 },
      ],
      has
    );
    assert.deepEqual(out, [
      { type: 'blend', layers: [{ name: 'waving', weight: 0.5 }], duration: 2 },
      { type: 'pause', duration: 4 },
      { type: 'pause', duration: 1 },
      { type: 'pause', duration: 1 },
    ]);
  });
});

describe('mergeSequences', () => {
  const ids = () => {
    let n = 0;
    return () => `new-${n++}`;
  };
  test('keeps existing, adds new ones after them', () => {
    const { list, added } = mergeSequences([seq('a', 'A')], [seq('b', 'B', 'bored')], ids());
    assert.equal(added, 1);
    assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
  });
  test('skips duplicates by content, whatever their id', () => {
    const { list, added } = mergeSequences([seq('a', 'A')], [seq('zzz', 'A'), seq('y', 'A')], ids());
    assert.equal(added, 0);
    assert.equal(list.length, 1);
  });
  test('skips duplicates inside the import itself', () => {
    assert.equal(mergeSequences([], [seq('a', 'A'), seq('b', 'A')], ids()).added, 1);
  });
  test('gives a new id on collision or when the id is missing', () => {
    const { list } = mergeSequences([seq('a', 'A')], [seq('a', 'Different'), seq('', 'Third', 'bored')], ids());
    assert.deepEqual(list.map((s) => s.id), ['a', 'new-0', 'new-1']);
  });
  test('a made-up id that is also taken is tried again', () => {
    const { list } = mergeSequences([seq('new-0', 'A')], [seq('', 'B')], ids());
    assert.deepEqual(list.map((s) => s.id), ['new-0', 'new-1']);
  });
  test('same steps under another name count as a different combo', () => {
    assert.notEqual(sequenceContentKey(seq('a', 'A')), sequenceContentKey(seq('a', 'B')));
    assert.equal(sequenceContentKey(seq('a', 'A')), sequenceContentKey(seq('b', 'A')));
  });
});
