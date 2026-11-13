import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectArmModel, detectArmModelFromRGBA, resolveArmModel, armModelFromPath } from './armModel';

function rgba(size: number, opaque: (x: number, y: number) => boolean): Uint8ClampedArray {
  const d = new Uint8ClampedArray(size * size * 4);
  const s = size / 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (opaque(Math.floor(x / s), Math.floor(y / s))) d[(y * size + x) * 4 + 3] = 255;
    }
  }
  return d;
}

const armRect = (x: number, y: number) => x >= 40 && x < 56 && y >= 16 && y < 32;
const slimArm = (x: number, y: number) => armRect(x, y) && !(x >= 54 && y >= 20) && !(x >= 50 && y < 20);

describe('arm model detection', () => {
  test('classic skin (full arm columns) → classic', () => {
    assert.equal(detectArmModelFromRGBA(rgba(64, armRect), 64), 'classic');
  });

  test('slim skin (blank strip) → slim, at 64 and 128 working resolution', () => {
    assert.equal(detectArmModelFromRGBA(rgba(64, slimArm), 64), 'slim');
    assert.equal(detectArmModelFromRGBA(rgba(128, slimArm), 128), 'slim');
  });

  test('empty canvas is undecidable (regression: empty creator canvas read as slim)', () => {
    assert.equal(detectArmModelFromRGBA(new Uint8ClampedArray(128 * 128 * 4), 128), null);
  });

  test('legacy 64×32 skins are always classic', () => {
    assert.equal(detectArmModel(() => 0, 32), 'classic');
    assert.equal(detectArmModelFromRGBA(new Uint8ClampedArray(64 * 32 * 4), 64, 32), 'classic');
  });

  test('setting overrides detection unless auto', () => {
    assert.equal(resolveArmModel('auto', 'slim'), 'slim');
    assert.equal(resolveArmModel('classic', 'slim'), 'classic');
  });

  test('model path → arm model', () => {
    assert.equal(armModelFromPath('/models/RunningboyRigSlim.fbx'), 'slim');
    assert.equal(armModelFromPath('/models/RunningboyRig.fbx#slim'), 'slim');
    assert.equal(armModelFromPath('/models/RunningboyRig.fbx'), 'classic');
  });
});
