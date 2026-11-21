import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BEAT_SETTINGS,
  describeBeatSettings,
  masterGain,
  normalizeBeatSettings,
  parseBeatSettings,
  parseBeatSettingsValue,
} from './beatSettings';

describe('beat settings', () => {
  test('defaults: bounce and snap off', () => {
    assert.equal(DEFAULT_BEAT_SETTINGS.bounce, 0);
    assert.equal(DEFAULT_BEAT_SETTINGS.snap, false);
  });
  test('junk JSON gives the defaults', () => {
    for (const j of [null, '', 'nope', '[]', '3']) assert.deepEqual(parseBeatSettings(j), DEFAULT_BEAT_SETTINGS);
  });
  test('validates each field', () => {
    const s = normalizeBeatSettings({ groove: 'chill', bpm: 500, volume: 2, muted: 'yes', snap: true, bounce: -1 });
    assert.deepEqual(s, { groove: 'chill', bpm: 160, volume: 1, muted: false, snap: true, bounce: 0 });
    assert.equal(normalizeBeatSettings({ groove: 'nope' }).groove, DEFAULT_BEAT_SETTINGS.groove);
  });
  test('backup parse needs an object', () => {
    assert.equal(parseBeatSettingsValue('x'), null);
    assert.equal(parseBeatSettingsValue([]), null);
    assert.equal(parseBeatSettingsValue({ bpm: 90 })!.bpm, 90);
  });
  test('gain and description', () => {
    assert.equal(masterGain({ volume: 0.5, muted: false }), 0.25);
    assert.equal(masterGain({ volume: 1, muted: true }), 0);
    assert.equal(describeBeatSettings({ ...DEFAULT_BEAT_SETTINGS, groove: 'disco', bpm: 120 }), 'Disco · 120 BPM');
  });
});
