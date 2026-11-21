import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { convertArmLayout } from './armConvert';
import { detectArmModelFromRGBA } from './armModel';

/** A skin with every texel of the classic right-arm block painted a color that encodes its position. */
function classicArmSkin(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(64 * 64 * 4);
  const paint = (bx: number, by: number) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const isCap = y < 4;
        if (isCap && (x < 4 || x >= 12)) continue; // unused cap corners
        const o = ((by + y) * 64 + bx + x) * 4;
        d.set([x * 10, y * 10, bx, 255], o);
      }
    }
  };
  paint(40, 16);
  paint(32, 48);
  return d;
}

const at = (d: Uint8ClampedArray, x: number, y: number) => Array.from(d.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));

describe('convertArmLayout', () => {
  test('same layout is a copy', () => {
    const d = classicArmSkin();
    assert.deepEqual(convertArmLayout(d, 'classic', 'classic'), d);
  });

  test('classic to slim moves faces left and drops a column', () => {
    const d = classicArmSkin();
    const slim = convertArmLayout(d, 'classic', 'slim');
    // Front face: classic columns 4,5,7 land at slim 4,5,6.
    assert.deepEqual(at(slim, 40 + 6, 16 + 8), at(d, 40 + 7, 16 + 8));
    // Left side starts at 7 in slim (was 8).
    assert.deepEqual(at(slim, 40 + 7, 16 + 8), at(d, 40 + 8, 16 + 8));
    // Back face: classic 12,13,15 at slim 11,12,13; columns 14-15 now empty.
    assert.deepEqual(at(slim, 40 + 13, 16 + 8), at(d, 40 + 15, 16 + 8));
    assert.equal(at(slim, 40 + 14, 16 + 8)[3], 0);
    assert.equal(at(slim, 40 + 15, 16 + 8)[3], 0);
    // The arm model detector now reads it as slim.
    assert.equal(detectArmModelFromRGBA(slim, 64), 'slim');
  });

  test('slim to classic and back gives the slim skin again', () => {
    const slim = convertArmLayout(classicArmSkin(), 'classic', 'slim');
    const classic = convertArmLayout(slim, 'slim', 'classic');
    assert.equal(at(classic, 40 + 15, 16 + 8)[3], 255);
    assert.deepEqual(convertArmLayout(classic, 'classic', 'slim'), slim);
  });

  test('other parts are untouched', () => {
    const d = classicArmSkin();
    d.set([1, 2, 3, 255], (10 * 64 + 10) * 4);
    assert.deepEqual(at(convertArmLayout(d, 'classic', 'slim'), 10, 10), [1, 2, 3, 255]);
  });
});
