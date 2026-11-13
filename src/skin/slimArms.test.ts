import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySlimArms, remapArmU } from './slimArms';

/** Minimal attribute stand-ins over plain arrays (stride 1 for x, 2 for uv). */
function attrs(xs: number[], us: number[], vs: number[]) {
  return {
    positions: { count: xs.length, getX: (i: number) => xs[i]!, setX: (i: number, x: number) => { xs[i] = x; } },
    uvs: {
      getX: (i: number) => us[i]!,
      getY: (i: number) => vs[i]!,
      setX: (i: number, u: number) => { us[i] = u; },
    },
  };
}
const px = (p: number) => p / 64;
const row = (y: number) => 1 - y / 64;

describe('slim arms UV remap', () => {
  test('classic faces map onto the Alex layout', () => {
    // side band (v 4–16): right stays, front 4→3 wide, left shifts, back shifts
    assert.equal(remapArmU(4, 2, 8), 4);
    assert.equal(remapArmU(8, 6, 8), 7); // front right edge
    assert.equal(remapArmU(8, 10, 8), 7); // left face start
    assert.equal(remapArmU(12, 10, 8), 11);
    assert.equal(remapArmU(16, 14, 8), 14); // back end
    // caps (v 0–4)
    assert.equal(remapArmU(8, 6, 2), 7); // top end
    assert.equal(remapArmU(12, 10, 2), 10); // bottom end
  });
});

describe('applySlimArms', () => {
  test('front-face triangle on the right arm: x compressed toward shoulder, u remapped', () => {
    // Right arm spans x -1.4 (shoulder) .. -1.8 (outer). Front face u 44..48, rows 20..32.
    const xs = [-1.4, -1.8, -1.8];
    const us = [px(44), px(48), px(48)];
    const vs = [row(20), row(20), row(32)];
    const a = attrs(xs, us, vs);
    const n = applySlimArms({ ...a, armSideOf: () => 'R', overlay: false });
    assert.equal(n, 3);
    assert.ok(Math.abs(xs[1]! - -1.7) < 1e-9, `outer x ${xs[1]}`);
    assert.equal(xs[0], -1.4);
    assert.deepEqual(us.map((u) => Math.round(u * 64 * 1000) / 1000), [44, 47, 47]);
  });

  test('non-arm vertices are untouched', () => {
    const xs = [0.3, 0.4, 0.5];
    const us = [px(20), px(22), px(24)];
    const vs = [row(20), row(20), row(30)];
    const a = attrs(xs, us, vs);
    assert.equal(applySlimArms({ ...a, armSideOf: () => null, overlay: false }), 0);
    assert.deepEqual(xs, [0.3, 0.4, 0.5]);
    assert.deepEqual(us, [px(20), px(22), px(24)]);
  });

  test('overlay uses the sleeve UV block (left sleeve at 48,48)', () => {
    const xs = [1.4, 1.8, 1.8];
    const us = [px(52), px(56), px(56)]; // left-sleeve front face
    const vs = [row(52), row(52), row(64)];
    const a = attrs(xs, us, vs);
    applySlimArms({ ...a, armSideOf: () => 'L', overlay: true });
    assert.deepEqual(us.map((u) => Math.round(u * 64 * 1000) / 1000), [52, 55, 55]);
    assert.ok(Math.abs(xs[2]! - 1.7) < 1e-9);
  });
});
