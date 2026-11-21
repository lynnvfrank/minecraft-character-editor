import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySaveFile,
  backupFileName,
  buildSaveFile,
  createSaveRegistry,
  MAX_SAVE_FILE_LENGTH,
  parseSaveFile,
  type AnySaveSection,
  type SaveSection,
} from './saveFile';

/** A section backed by a plain variable. */
function numberSection(key: string, initial: number | undefined) {
  const state = { value: initial, writes: 0 };
  const section: SaveSection<number> = {
    key,
    label: `Label ${key}`,
    read: () => state.value,
    parse: (raw) => (typeof raw === 'number' ? raw : null),
    write: (v) => {
      state.value = v;
      state.writes++;
    },
  };
  return { state, section };
}

const envelope = (data: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ app: 'blockygotchi', version: 1, savedAt: '2026-11-21T10:00:00.000Z', data, ...extra });

describe('buildSaveFile', () => {
  test('wraps parts in the versioned envelope and leaves out undefined', () => {
    const file = buildSaveFile({ a: 1, b: undefined, c: null }, new Date('2026-11-21T10:00:00Z'));
    assert.deepEqual(file, { app: 'blockygotchi', version: 1, savedAt: '2026-11-21T10:00:00.000Z', data: { a: 1, c: null } });
  });
});

describe('parseSaveFile', () => {
  test('returns entries for known sections, in registration order', () => {
    const a = numberSection('a', 0);
    const b = numberSection('b', 0);
    const parsed = parseSaveFile(envelope({ b: 2, a: 1 }), [a.section, b.section]);
    assert.ok(parsed.ok);
    assert.deepEqual(
      parsed.entries.map((e) => [e.key, e.label, e.summary]),
      [['a', 'Label a', 'Label a'], ['b', 'Label b', 'Label b']]
    );
    assert.equal(parsed.savedAt, '2026-11-21T10:00:00.000Z');
    // Nothing is applied until asked.
    assert.equal(a.state.writes + b.state.writes, 0);
    assert.deepEqual(applySaveFile(parsed), []);
    assert.deepEqual([a.state.value, b.state.value], [1, 2]);
  });

  test('ignores unknown keys (forward compatible) and reports them', () => {
    const a = numberSection('a', 0);
    const parsed = parseSaveFile(envelope({ a: 1, weather: { kind: 'snow' }, outfits: [] }, { futureField: true }), [a.section]);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.unknown, ['weather', 'outfits']);
    assert.equal(parsed.entries.length, 1);
  });

  test('skips sections that fail their own check or throw, keeps the rest', () => {
    const a = numberSection('a', 0);
    const b = numberSection('b', 0);
    const thrower: AnySaveSection = {
      key: 'c',
      label: 'Boom',
      read: () => 1,
      parse: () => {
        throw new Error('x');
      },
      write: () => {},
    };
    const parsed = parseSaveFile(envelope({ a: 'not a number', b: 5, c: 1 }), [a.section, b.section, thrower]);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.entries.map((e) => e.key), ['b']);
    assert.deepEqual(parsed.skipped, ['Label a', 'Boom']);
  });

  test('sections missing from the file are left alone', () => {
    const a = numberSection('a', 7);
    const b = numberSection('b', 8);
    const parsed = parseSaveFile(envelope({ a: 1 }), [a.section, b.section]);
    assert.ok(parsed.ok);
    applySaveFile(parsed);
    assert.deepEqual([a.state.value, b.state.value], [1, 8]);
  });

  test('uses describe for the summary', () => {
    const a = numberSection('a', 0);
    const parsed = parseSaveFile(envelope({ a: 3 }), [{ ...a.section, describe: (v: number) => `${v} things` }]);
    assert.ok(parsed.ok);
    assert.equal(parsed.entries[0]!.summary, '3 things');
  });

  test('rejects files that are not ours, with a friendly reason', () => {
    const s = [numberSection('a', 0).section];
    const cases: Array<[unknown, RegExp]> = [
      [null, /empty/],
      ['', /empty/],
      ['   ', /empty/],
      ['{not json', /a Blockygotchi backup/],
      ['[1,2]', /a Blockygotchi backup/],
      ['"text"', /a Blockygotchi backup/],
      [JSON.stringify({ app: 'other', version: 1, data: { a: 1 } }), /a Blockygotchi backup/],
      [JSON.stringify({ version: 1, data: { a: 1 } }), /a Blockygotchi backup/],
      [JSON.stringify({ app: 'blockygotchi', version: 2, data: { a: 1 } }), /newer version/],
      [JSON.stringify({ app: 'blockygotchi', version: '1', data: { a: 1 } }), /damaged/],
      [JSON.stringify({ app: 'blockygotchi', version: 0, data: { a: 1 } }), /damaged/],
      [JSON.stringify({ app: 'blockygotchi', version: 1.5, data: { a: 1 } }), /damaged/],
      [JSON.stringify({ app: 'blockygotchi', version: 1 }), /damaged/],
      [JSON.stringify({ app: 'blockygotchi', version: 1, data: [1] }), /damaged/],
      [envelope({}), /nothing in that backup/],
      [envelope({ unknownOnly: 1 }), /nothing in that backup/],
      [envelope({ a: 'bad' }), /nothing in that backup/],
    ];
    for (const [json, reason] of cases) {
      const parsed = parseSaveFile(json, s);
      assert.equal(parsed.ok, false, String(json).slice(0, 40));
      if (!parsed.ok) assert.match(parsed.reason, reason);
    }
  });

  test('enforces the size limit before parsing', () => {
    const huge = envelope({ a: 1, pad: 'x'.repeat(MAX_SAVE_FILE_LENGTH) });
    const parsed = parseSaveFile(huge, [numberSection('a', 0).section]);
    assert.deepEqual(parsed, { ok: false, reason: 'That file is too big to be a Blockygotchi backup.' });
  });

  test('inherited property names are not treated as sections', () => {
    const proto = numberSection('constructor', 0);
    const parsed = parseSaveFile(envelope({ a: 1 }), [proto.section, numberSection('a', 0).section]);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.entries.map((e) => e.key), ['a']);
  });

  test('a bad savedAt is dropped, not fatal', () => {
    const parsed = parseSaveFile(envelope({ a: 1 }, { savedAt: '<b>yesterday</b>' }), [numberSection('a', 0).section]);
    assert.ok(parsed.ok);
    assert.equal(parsed.savedAt, null);
  });

  test('one failing write does not stop the others', () => {
    const a: AnySaveSection = {
      key: 'a',
      label: 'A',
      read: () => 1,
      parse: (r: unknown) => r,
      write: () => {
        throw new Error('x');
      },
    };
    const b = numberSection('b', 0);
    const parsed = parseSaveFile(envelope({ a: 1, b: 2 }), [a, b.section]);
    assert.ok(parsed.ok);
    assert.deepEqual(applySaveFile(parsed), ['A']);
    assert.equal(b.state.value, 2);
  });
});

describe('createSaveRegistry', () => {
  test('build then parse round-trips every registered section', () => {
    const a = numberSection('a', 1);
    const b = numberSection('b', undefined);
    const registry = createSaveRegistry();
    registry.register(a.section);
    registry.register(b.section);
    const json = registry.build(new Date('2026-11-21T10:00:00Z'));
    assert.deepEqual(JSON.parse(json), { app: 'blockygotchi', version: 1, savedAt: '2026-11-21T10:00:00.000Z', data: { a: 1 } });
    a.state.value = 99;
    const parsed = registry.parse(json);
    assert.ok(parsed.ok);
    applySaveFile(parsed);
    assert.equal(a.state.value, 1);
  });

  test('registering a key twice replaces the first section', () => {
    const registry = createSaveRegistry();
    registry.register(numberSection('a', 1).section);
    registry.register(numberSection('a', 2).section);
    assert.equal(registry.sections().length, 1);
    assert.equal(JSON.parse(registry.build()).data.a, 2);
  });

  test('a section whose read throws is left out of the backup', () => {
    const registry = createSaveRegistry();
    registry.register({
      key: 'bad',
      label: 'Bad',
      read: () => {
        throw new Error('x');
      },
      parse: () => null,
      write: () => {},
    });
    registry.register(numberSection('a', 1).section);
    assert.deepEqual(JSON.parse(registry.build()).data, { a: 1 });
  });
});

describe('backupFileName', () => {
  test('blockygotchi-backup-YYYYMMDD-HHMMSS.json in local time', () => {
    assert.equal(backupFileName(new Date(2026, 10, 21, 9, 5, 7)), 'blockygotchi-backup-20261121-090507.json');
  });
});
