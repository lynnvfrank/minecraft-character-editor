import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { degreeToMidi, GROOVES, grooveById, grooveEventsAt, isGrooveId, midiToFreq, PENTATONIC } from './beatGrooves';

describe('grooves', () => {
  test('5-6 grooves with unique ids and full 16-step rows', () => {
    assert.ok(GROOVES.length >= 5 && GROOVES.length <= 6);
    assert.equal(new Set(GROOVES.map((g) => g.id)).size, GROOVES.length);
    for (const g of GROOVES) {
      for (const row of [g.kick, g.snare, g.hat, g.bass, g.lead]) {
        assert.equal(row.length, 16, `${g.id}: ${row}`);
        assert.match(row, /^[.xX0-9]+$/);
      }
      assert.ok(g.swing >= 0 && g.swing <= 1);
      assert.ok(!/minecraft/i.test(g.label + g.blurb));
    }
  });
  test('every groove has a kick on the first step', () => {
    for (const g of GROOVES) assert.ok(grooveEventsAt(g, 0).some((e) => e.voice === 'kick'), g.id);
  });
  test('lookup and validation', () => {
    assert.ok(isGrooveId('disco'));
    assert.ok(!isGrooveId('nope'));
    assert.equal(grooveById('nope'), GROOVES[0]);
  });
  test('notes come from the pentatonic scale', () => {
    assert.equal(midiToFreq(69), 440);
    assert.equal(degreeToMidi(36, 0, 'major'), 36);
    assert.equal(degreeToMidi(36, 5, 'major'), 48);
    assert.equal(degreeToMidi(36, 2, 'minor'), 36 + PENTATONIC.minor[2]!);
  });
  test('events wrap round the bar and clap replaces snare', () => {
    const disco = grooveById('disco');
    assert.deepEqual(grooveEventsAt(disco, 4), grooveEventsAt(disco, 20));
    assert.ok(grooveEventsAt(disco, 4).some((e) => e.voice === 'clap'));
    assert.ok(!grooveEventsAt(disco, 4).some((e) => e.voice === 'snare'));
  });
});
