import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cameraMatchesPreset, cameraSignature, type CameraSnapshot } from './previewCamera';
import { getPreviewPreset } from '../viewer/previewPresets';

const head = getPreviewPreset('head');
const onPreset = (fov = head.fov ?? 40): CameraSnapshot => ({
  position: { ...head.cameraPosition },
  target: { ...head.cameraTarget },
  fov,
});

describe('cameraMatchesPreset', () => {
  test('exact preset matches', () => {
    assert.equal(cameraMatchesPreset(onPreset(), head, 40), true);
  });
  test('float noise below epsilon still matches', () => {
    const cam = onPreset();
    cam.position.x += 0.0001;
    assert.equal(cameraMatchesPreset(cam, head, 40), true);
  });
  test('orbiting away breaks the match', () => {
    const cam = onPreset();
    cam.target.y += 0.01;
    assert.equal(cameraMatchesPreset(cam, head, 40), false);
  });
  test('preset without fov compares against default fov', () => {
    const noFov = { ...head, fov: undefined };
    assert.equal(cameraMatchesPreset(onPreset(55), noFov, 55), true);
    assert.equal(cameraMatchesPreset(onPreset(55), noFov, 40), false);
  });
});

describe('cameraSignature', () => {
  test('rounds to 3 decimals and labels custom when no preset', () => {
    const sig = cameraSignature(null, { position: { x: 1.23456, y: 0, z: -2 }, target: { x: 0, y: 1, z: 0 }, fov: 40 });
    assert.equal(sig, 'custom|1.235|0.000|-2.000|0.000|1.000|0.000|40.000');
  });
  test('ignores sub-rounding changes', () => {
    const a = onPreset();
    const b = onPreset();
    b.position.z += 0.0001;
    assert.equal(cameraSignature('head', a), cameraSignature('head', b));
  });
});
