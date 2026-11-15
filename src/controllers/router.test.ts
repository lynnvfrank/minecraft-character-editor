import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presetPoseAt, shouldReloadCreatorSkin } from './router';
import { getPreviewPreset } from '../viewer/previewPresets';

describe('presetPoseAt', () => {
  test('offsets camera position and target by the character origin', () => {
    const preset = getPreviewPreset('fullOutfit');
    const { position, target } = presetPoseAt(preset, { x: 2, y: 0, z: -1 });
    assert.equal(position.x, preset.cameraPosition.x + 2);
    assert.equal(position.z, preset.cameraPosition.z - 1);
    assert.equal(target.y, preset.cameraTarget.y);
  });
});

describe('shouldReloadCreatorSkin', () => {
  test('no skin: never reload', () => {
    assert.equal(shouldReloadCreatorSkin(undefined, false, null), false);
    assert.equal(shouldReloadCreatorSkin('', false, null), false);
  });
  test('empty canvas: reload', () => {
    assert.equal(shouldReloadCreatorSkin('/a.png', false, '/a.png'), true);
  });
  test('same skin already loaded: keep edits', () => {
    assert.equal(shouldReloadCreatorSkin('/a.png', true, '/a.png'), false);
  });
  test('different skin picked on home: reload', () => {
    assert.equal(shouldReloadCreatorSkin('/b.png', true, '/a.png'), true);
  });
});
