import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_BACKDROP_ID,
  DEFAULT_BACKDROP_SETTINGS,
  STUDIO_BACKDROPS,
  backdropSwatchCss,
  findBackdrop,
  gradientColorAt,
  gradientCss,
  isBackdropId,
  parseBackdropSettings,
  resolveBackdrop,
} from './studioBackdrop';
import { isValidHex } from './color';

describe('studio backdrop catalogue', () => {
  test('ids are unique, Default comes first, and every color is valid hex', () => {
    const ids = STUDIO_BACKDROPS.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(STUDIO_BACKDROPS[0].kind, 'default');
    assert.ok(!ids.includes(CUSTOM_BACKDROP_ID));
    for (const b of STUDIO_BACKDROPS) {
      if (b.kind === 'solid') assert.ok(isValidHex(b.color), b.id);
      if (b.kind === 'spotlight') assert.ok(isValidHex(b.color) && isValidHex(b.light), b.id);
      if (b.kind === 'gradient') {
        assert.ok(b.stops.length >= 2, b.id);
        assert.equal(b.stops[0].at, 0);
        assert.equal(b.stops[b.stops.length - 1].at, 1);
        b.stops.forEach((s, i) => {
          assert.ok(isValidHex(s.color), b.id);
          if (i > 0) assert.ok(s.at > b.stops[i - 1].at, `${b.id} stops sorted`);
        });
      }
    }
  });

  test('has solids, at least three gradients and a spotlight; no trademarked names', () => {
    const kinds = STUDIO_BACKDROPS.map((b) => b.kind);
    assert.ok(kinds.filter((k) => k === 'solid').length >= 4);
    assert.ok(kinds.filter((k) => k === 'gradient').length >= 3);
    assert.ok(kinds.includes('spotlight'));
    for (const b of STUDIO_BACKDROPS) assert.ok(!/minecraft/i.test(b.label));
  });

  test('isBackdropId accepts catalogue ids and custom only', () => {
    assert.ok(isBackdropId('default'));
    assert.ok(isBackdropId('sunset'));
    assert.ok(isBackdropId(CUSTOM_BACKDROP_ID));
    assert.ok(!isBackdropId('nope'));
    assert.ok(!isBackdropId(3));
    assert.equal(findBackdrop('nope'), undefined);
  });
});

describe('parseBackdropSettings', () => {
  test('falls back to the default for missing or broken JSON', () => {
    for (const bad of [null, '', '{', 'null', '42', '"x"']) {
      assert.deepEqual(parseBackdropSettings(bad), DEFAULT_BACKDROP_SETTINGS);
    }
  });

  test('keeps valid fields and repairs invalid ones', () => {
    assert.deepEqual(parseBackdropSettings(JSON.stringify({ id: 'ocean', customColor: '#ABCDEF', floor: false })), {
      id: 'ocean',
      customColor: '#abcdef',
      floor: false,
    });
    assert.deepEqual(parseBackdropSettings(JSON.stringify({ id: 'lava', customColor: 'red', floor: 'no' })), DEFAULT_BACKDROP_SETTINGS);
    assert.equal(parseBackdropSettings(JSON.stringify({ id: CUSTOM_BACKDROP_ID })).id, CUSTOM_BACKDROP_ID);
  });

  test('returns a fresh object each time', () => {
    assert.notEqual(parseBackdropSettings(null), parseBackdropSettings(null));
  });
});

describe('resolveBackdrop', () => {
  test('custom becomes a solid of the custom color', () => {
    assert.deepEqual(resolveBackdrop({ id: CUSTOM_BACKDROP_ID, customColor: '#123456' }), {
      id: CUSTOM_BACKDROP_ID,
      label: 'Custom',
      kind: 'solid',
      color: '#123456',
    });
  });

  test('catalogue ids resolve to their entry; unknown ids to Default', () => {
    assert.equal(resolveBackdrop({ id: 'spotlight', customColor: '#000000' }).kind, 'spotlight');
    assert.equal(resolveBackdrop({ id: 'gone', customColor: '#000000' }).kind, 'default');
  });
});

describe('gradients', () => {
  const stops = [
    { at: 0, color: '#000000' },
    { at: 0.5, color: '#ff0000' },
    { at: 1, color: '#ff00ff' },
  ];

  test('gradientColorAt returns the stop colors at the stops', () => {
    assert.equal(gradientColorAt(stops, 0), '#000000');
    assert.equal(gradientColorAt(stops, 0.5), '#ff0000');
    assert.equal(gradientColorAt(stops, 1), '#ff00ff');
  });

  test('gradientColorAt mixes between neighbouring stops', () => {
    assert.equal(gradientColorAt(stops, 0.25), '#800000');
    assert.equal(gradientColorAt(stops, 0.75), '#ff0080');
  });

  test('gradientColorAt clamps outside the range and survives odd input', () => {
    assert.equal(gradientColorAt(stops, -1), '#000000');
    assert.equal(gradientColorAt(stops, 2), '#ff00ff');
    assert.equal(gradientColorAt(stops, NaN), '#000000');
    assert.equal(gradientColorAt([], 0.5), '#000000');
    assert.equal(gradientColorAt([{ at: 0, color: '#112233' }], 0.7), '#112233');
  });

  test('gradientCss lists the stops top to bottom', () => {
    assert.equal(gradientCss(stops), 'linear-gradient(to bottom, #000000 0%, #ff0000 50%, #ff00ff 100%)');
  });

  test('backdropSwatchCss: empty for Default, a color or gradient otherwise', () => {
    for (const b of STUDIO_BACKDROPS) {
      const css = backdropSwatchCss(b);
      if (b.kind === 'default') assert.equal(css, '');
      else assert.ok(css.length > 0, b.id);
    }
    assert.equal(backdropSwatchCss({ id: 'x', label: 'X', kind: 'solid', color: '#abcdef' }), '#abcdef');
  });
});
