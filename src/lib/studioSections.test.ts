import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STUDIO_SECTIONS_OPEN,
  STUDIO_SECTION_ORDER,
  isStudioSectionId,
  normalizeStudioSections,
  parseStudioSections,
  setStudioSection,
  studioSectionIndex,
  toggleStudioSection,
} from './studioSections';

describe('studioSections', () => {
  test('the mixer comes first and starts open; the stage dressing starts collapsed', () => {
    assert.equal(STUDIO_SECTION_ORDER[0], 'clips');
    assert.equal(STUDIO_SECTION_ORDER.at(-1), 'capture');
    for (const id of ['clips', 'crossfade', 'routine'] as const) assert.equal(DEFAULT_STUDIO_SECTIONS_OPEN[id], true);
    for (const id of ['capture', 'dancers', 'backdrop', 'cameraMoves'] as const) {
      assert.equal(DEFAULT_STUDIO_SECTIONS_OPEN[id], false);
    }
    assert.deepEqual(Object.keys(DEFAULT_STUDIO_SECTIONS_OPEN).sort(), [...STUDIO_SECTION_ORDER].sort());
  });

  test('section ids and their order', () => {
    assert.ok(isStudioSectionId('backdrop'));
    assert.ok(!isStudioSectionId('nope'));
    assert.ok(!isStudioSectionId(3));
    assert.ok(studioSectionIndex('clips') < studioSectionIndex('routine'));
    assert.ok(studioSectionIndex('routine') < studioSectionIndex('capture'));
  });

  test('parse: nothing stored, broken JSON and wrong shapes give the defaults', () => {
    for (const json of [null, '', 'nope', '[]', '42', 'null', '"clips"']) {
      assert.deepEqual(parseStudioSections(json), DEFAULT_STUDIO_SECTIONS_OPEN);
    }
  });

  test('parse: keeps valid booleans, ignores junk values and unknown keys', () => {
    const parsed = parseStudioSections(JSON.stringify({ clips: false, dancers: true, routine: 'yes', extra: true }));
    assert.equal(parsed.clips, false);
    assert.equal(parsed.dancers, true);
    assert.equal(parsed.routine, true); // junk: default
    assert.ok(!('extra' in parsed));
  });

  test('normalize falls back to the given base', () => {
    const base = { ...DEFAULT_STUDIO_SECTIONS_OPEN, backdrop: true };
    assert.equal(normalizeStudioSections({ backdrop: 1 }, base).backdrop, true);
  });

  test('set and toggle return new records and leave the input alone', () => {
    const a = DEFAULT_STUDIO_SECTIONS_OPEN;
    const b = toggleStudioSection(a, 'dancers');
    assert.equal(b.dancers, true);
    assert.equal(a.dancers, false);
    assert.equal(toggleStudioSection(b, 'dancers').dancers, false);
    assert.equal(setStudioSection(a, 'clips', true), a); // unchanged: same object
    assert.equal(setStudioSection(a, 'clips', false).clips, false);
    assert.equal(toggleStudioSection(a, 'nope' as never), a);
  });
});
