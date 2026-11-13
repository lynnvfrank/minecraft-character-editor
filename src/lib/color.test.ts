import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Color, hexToRgb, rgbToHex, hexToHsva, hsvaToHex, normalizeHex, adjustHexBrightness } from './color';

describe('color', () => {
  test('hex ↔ rgb', () => {
    assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
    assert.equal(rgbToHex(255, 128, 0), '#ff8000');
    assert.equal(rgbToHex(300, -5, 12.6), '#ff000d'); // clamps + rounds
  });

  test('hsva round trip for primaries and greys', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#808080', '#000000', '#ffffff', '#3c8dbc']) {
      const { h, s, v, a } = hexToHsva(hex);
      assert.equal(hsvaToHex(h, s, v, a), hex);
    }
  });

  test('normalizeHex', () => {
    assert.equal(normalizeHex('#ABCDEF'), '#abcdef');
    assert.equal(normalizeHex('abcdef'), null);
  });

  test('brightness clamps', () => {
    assert.equal(adjustHexBrightness('#f0f0f0', 40), '#ffffff');
    assert.equal(adjustHexBrightness('#101010', -40), '#000000');
  });

  test('Color.parse rejects garbage', () => {
    assert.equal(Color.parse('nope'), null);
    assert.equal(Color.parse('#00FF00')?.hex, '#00ff00');
  });
});
