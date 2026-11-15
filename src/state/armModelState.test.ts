import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createArmModelState } from './armModelState';

describe('armModelState', () => {
  test('auto setting resolves to the detected model', () => {
    const s = createArmModelState({ initialSetting: 'auto' });
    assert.equal(s.getResolved(), 'slim');
    s.setDetected('classic');
    assert.equal(s.getResolved(), 'classic');
  });

  test('explicit setting overrides detection', () => {
    const s = createArmModelState({ initialSetting: 'slim', initialDetected: 'classic' });
    assert.equal(s.getResolved(), 'slim');
    assert.equal(s.isAuto(), false);
  });

  test('setSetting persists and notifies', () => {
    const persisted: string[] = [];
    let calls = 0;
    const s = createArmModelState({ initialSetting: 'auto', persist: (v) => persisted.push(v) });
    s.subscribe(() => calls++);
    s.setSetting('classic');
    assert.deepEqual(persisted, ['classic']);
    assert.equal(calls, 1);
    assert.equal(s.getResolved(), 'classic');
  });

  test('setDetected ignores null and unchanged values', () => {
    let calls = 0;
    const s = createArmModelState({ initialSetting: 'auto' });
    s.subscribe(() => calls++);
    assert.equal(s.setDetected(null), false);
    assert.equal(s.setDetected('slim'), false);
    assert.equal(calls, 0);
    assert.equal(s.setDetected('classic'), true);
    assert.equal(calls, 1);
  });

  test('unsubscribe stops notifications', () => {
    let calls = 0;
    const s = createArmModelState({ initialSetting: 'auto' });
    const off = s.subscribe(() => calls++);
    off();
    s.notify();
    assert.equal(calls, 0);
  });
});
