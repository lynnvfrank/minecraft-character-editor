import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SavedSequenceStep } from './sequences';
import {
  decodeShareCode,
  encodeShareCode,
  MAX_SHARE_CODE_LENGTH,
  SHARE_CODE_PREFIX,
  shareLink,
  urlWithoutShareParam,
} from './shareCode';

const steps: SavedSequenceStep[] = [
  { type: 'blend', layers: [{ name: 'waving', weight: 0.6 }, { name: 'hip-hop', weight: 0.4, timeScale: 1.5 }], duration: 3 },
  { type: 'pause', duration: 0.5 },
  { type: 'animation', name: 'backflip', duration: 2 },
];

/** Build a code from raw JSON, the way someone tampering with a link would. */
const forge = (payload: unknown) => SHARE_CODE_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const encodeOk = (label: string, s: SavedSequenceStep[]) => {
  const r = encodeShareCode({ label, steps: s });
  assert.ok(r.ok);
  return r.code;
};

describe('share codes', () => {
  test('round trip', () => {
    const code = encodeOk('Party time', steps);
    assert.match(code, /^b1\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeShareCode(code), { ok: true, combo: { label: 'Party time', steps } });
  });

  test('round trip with emoji and non-Latin labels', () => {
    const label = 'Tanz 💃 ダンス';
    const decoded = decodeShareCode(encodeOk(label, steps));
    assert.ok(decoded.ok);
    assert.equal(decoded.combo.label, label);
  });

  test('numbers are rounded to two decimals and default speed is left out', () => {
    const code = encodeOk('x', [{ type: 'blend', layers: [{ name: 'a', weight: 0.33333, timeScale: 1 }], duration: 1.2312 }]);
    const decoded = decodeShareCode(code);
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.combo.steps, [{ type: 'blend', layers: [{ name: 'a', weight: 0.33 }], duration: 1.23 }]);
    // Encoding the decoded combo gives the same code (stable).
    assert.equal(encodeOk('x', decoded.combo.steps), code);
  });

  test('steps without a length stay without one', () => {
    const decoded = decodeShareCode(encodeOk('x', [{ type: 'animation', name: 'bored' }]));
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.combo.steps, [{ type: 'animation', name: 'bored' }]);
  });

  test('a typical routine stays short', () => {
    assert.ok(encodeOk('Party time', steps).length < 200);
  });

  test('refuses to encode invalid or oversized combos', () => {
    assert.equal(encodeShareCode({ label: 'x', steps: [] }).ok, false);
    assert.equal(encodeShareCode({ label: 'x', steps: [{ type: 'animation', name: 'not a slug' }] }).ok, false);
    const big: SavedSequenceStep[] = Array.from({ length: 24 }, () => ({
      type: 'blend' as const,
      layers: Array.from({ length: 8 }, (_, i) => ({ name: `${'clip-name-that-is-long'.repeat(2)}-${i}`, weight: 0.11, timeScale: 0.77 })),
      duration: 1.11,
    }));
    assert.deepEqual(encodeShareCode({ label: 'big', steps: big }), { ok: false, reason: 'This combo is too long to share as a link.' });
  });

  test('rejects junk, wrong versions and oversized codes with a reason', () => {
    const bad: unknown[] = [
      null,
      42,
      '',
      'hello',
      'b2.abcd',
      'b1.',
      'b1.!!!!',
      'b1.abc=',
      'b1.' + 'A'.repeat(MAX_SHARE_CODE_LENGTH),
      'b1.' + Buffer.from('not json').toString('base64url'),
      'b1.' + Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url'),
    ];
    for (const code of bad) {
      const r = decodeShareCode(code);
      assert.equal(r.ok, false, String(code).slice(0, 30));
      if (!r.ok) assert.ok(r.reason.length > 0);
    }
  });

  test('rejects tampered payloads', () => {
    const bad: unknown[] = [
      [],
      'text',
      {},
      { n: 'x' },
      { n: 5, s: [['p', 1]] },
      { n: 'x', s: [] },
      { n: 'x', s: 'nope' },
      { n: 'x', s: [['z', 1]] },
      { n: 'x', s: [{ type: 'pause' }] },
      { n: 'x', s: [['a', 'constructor', 1]] },
      { n: 'x', s: [['a', '__proto__', 1]] },
      { n: 'x', s: [['a', '../../etc/passwd', 1]] },
      { n: 'x', s: [['a', '<script>', 1]] },
      { n: 'x', s: [['a', { toString: 1 }, 1]] },
      { n: 'x', s: [['b', 1, []]] },
      { n: 'x', s: [['b', 1, [['a']]]] },
      { n: 'x', s: [['b', 1, [['a', 'heavy']]]] },
      { n: 'x', s: [['b', 1, [['a', 1, 'fast']]]] },
      { n: 'x', s: [['b', 1, 'layers']] },
      { n: 'x', s: Array.from({ length: 25 }, () => ['p', 1]) },
      { n: 'x', s: [['b', 1, Array.from({ length: 9 }, () => ['a', 1])]] },
    ];
    for (const payload of bad) assert.equal(decodeShareCode(forge(payload)).ok, false, JSON.stringify(payload).slice(0, 60));
  });

  test('clamps out-of-range numbers and cleans the label of a forged code', () => {
    const r = decodeShareCode(
      forge({ n: `  ${'L'.repeat(300)}  `, s: [['b', 1e9, [['a', 50, -4]]], ['p', 1e9], ['a', 'b', 0.001]], extra: { deep: true } })
    );
    assert.ok(r.ok);
    assert.equal(r.combo.label, 'L'.repeat(40));
    assert.deepEqual(r.combo.steps, [
      { type: 'blend', layers: [{ name: 'a', weight: 1, timeScale: 0 }], duration: 20 },
      { type: 'pause', duration: 20 },
      { type: 'animation', name: 'b', duration: 0.25 },
    ]);
  });

  test('a changed character never throws', () => {
    const code = encodeOk('Party time', steps);
    for (let i = SHARE_CODE_PREFIX.length; i < code.length; i++) {
      const tampered = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
      assert.equal(typeof decodeShareCode(tampered).ok, 'boolean');
      assert.equal(typeof decodeShareCode(code.slice(0, i)).ok, 'boolean');
    }
  });
});

describe('share links', () => {
  test('query goes before the hash', () => {
    assert.equal(shareLink('b1.abc', 'https://example.test', '/'), 'https://example.test/?combo=b1.abc#/');
    assert.equal(shareLink('b1.abc', 'https://example.test', '/app/'), 'https://example.test/app/?combo=b1.abc#/');
  });
  test('a link round-trips through URL parsing', () => {
    const code = encodeOk('Party time', steps);
    const url = new URL(shareLink(code, 'https://example.test'));
    assert.equal(url.searchParams.get('combo'), code);
    assert.equal(url.hash, '#/');
  });
  test('removing the param keeps the rest of the address', () => {
    assert.equal(urlWithoutShareParam('/', '?combo=b1.abc', '#/'), '/#/');
    assert.equal(
      urlWithoutShareParam('/', '?log=animation%3Adebug&combo=b1.abc&world=0', '#/studio'),
      '/?log=animation%3Adebug&world=0#/studio'
    );
    assert.equal(urlWithoutShareParam('/app/', '', ''), '/app/');
  });
});
