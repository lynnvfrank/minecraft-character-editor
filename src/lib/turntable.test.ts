import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_FRAMINGS,
  CAMERA_FRAMING_ORDER,
  TURNTABLE_SPEEDS,
  TURNTABLE_SPEED_ORDER,
  easeInOut,
  framingPose,
  lerpAngle,
  lerpOrbit,
  orbitFromOffset,
  orbitPosition,
  stepTurntable,
  wrapAngle,
  approach,
  groupFramingPose,
  GROUP_FRAMINGS,
} from './turntable';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('turntable orbit', () => {
  test('orbitPosition: angle 0 is +Z of the center, a quarter turn is +X', () => {
    const c = { x: 1, y: 2, z: 3 };
    assert.deepEqual(orbitPosition(c, 0, 5, 0.5), { x: 1, y: 2.5, z: 8 });
    const q = orbitPosition(c, Math.PI / 2, 5, 0);
    near(q.x, 6);
    near(q.y, 2);
    near(q.z, 3);
  });

  test('orbitFromOffset is the inverse of orbitPosition', () => {
    const c = { x: -2, y: 1, z: 4 };
    for (const angle of [0, 0.7, -2.5, 3]) {
      const p = orbitPosition(c, angle, 4.2, 0.8);
      const pose = orbitFromOffset(p.x - c.x, p.y - c.y, p.z - c.z);
      near(pose.angle, angle);
      near(pose.radius, 4.2);
      near(pose.height, 0.8);
    }
  });

  test('ten seconds of turning keeps distance and height', () => {
    const c = { x: 0, y: 1, z: 0 };
    let pose = orbitFromOffset(3, 0.8, 4);
    for (let i = 0; i < 600; i++) {
      const angle = stepTurntable(pose.angle, 'fast', 1 / 60);
      const p = orbitPosition(c, angle, pose.radius, pose.height);
      pose = orbitFromOffset(p.x - c.x, p.y - c.y, p.z - c.z);
    }
    near(pose.radius, 5, 1e-6);
    near(pose.height, 0.8, 1e-9);
  });

  test('stepTurntable: one full turn in secondsPerTurn, faster speeds turn further', () => {
    for (const id of TURNTABLE_SPEED_ORDER) {
      near(stepTurntable(0.3, id, TURNTABLE_SPEEDS[id].secondsPerTurn), 0.3, 1e-9);
    }
    const slow = stepTurntable(0, 'slow', 1);
    const medium = stepTurntable(0, 'medium', 1);
    const fast = stepTurntable(0, 'fast', 1);
    assert.ok(0 < slow && slow < medium && medium < fast);
    assert.equal(stepTurntable(1, 'fast', 0), 1);
  });

  test('wrapAngle keeps angles in (-π, π]', () => {
    near(wrapAngle(Math.PI * 3), Math.PI);
    near(wrapAngle(-Math.PI * 2.5), -Math.PI / 2);
    near(wrapAngle(0.25), 0.25);
  });

  test('lerpAngle goes the short way round', () => {
    near(Math.abs(lerpAngle(3, -3, 0.5)), Math.PI);
    near(lerpAngle(0.2, 1.2, 0.5), 0.7);
    near(lerpAngle(1, 2, 0), 1);
    near(lerpAngle(1, 2, 1), 2);
  });

  test('lerpOrbit mixes radius and height', () => {
    const o = lerpOrbit({ angle: 0, radius: 2, height: 0 }, { angle: 1, radius: 6, height: 2 }, 0.25);
    near(o.angle, 0.25);
    near(o.radius, 3);
    near(o.height, 0.5);
  });

  test('easeInOut runs 0 to 1, is symmetric and clamps', () => {
    assert.equal(easeInOut(0), 0);
    assert.equal(easeInOut(1), 1);
    assert.equal(easeInOut(0.5), 0.5);
    assert.equal(easeInOut(-3), 0);
    assert.equal(easeInOut(3), 1);
    assert.ok(easeInOut(0.2) < 0.2);
  });
});

describe('camera framings', () => {
  test('three framings: close-up nearest, wide furthest', () => {
    assert.deepEqual([...CAMERA_FRAMING_ORDER], ['fullBody', 'closeUp', 'wide']);
    assert.ok(CAMERA_FRAMINGS.closeUp.distance < CAMERA_FRAMINGS.fullBody.distance);
    assert.ok(CAMERA_FRAMINGS.fullBody.distance < CAMERA_FRAMINGS.wide.distance);
    for (const id of CAMERA_FRAMING_ORDER) assert.ok(!/minecraft/i.test(CAMERA_FRAMINGS[id].label + CAMERA_FRAMINGS[id].title));
  });

  test('framingPose puts the camera in front of the character, wherever it stands and faces', () => {
    const f = CAMERA_FRAMINGS.fullBody;
    const front = framingPose({ ...f, side: 0 }, { x: 2, y: 0, z: -1, yaw: 0 });
    assert.deepEqual(front.target, { x: 2, y: 1, z: -1 });
    const cam = orbitPosition(front.target, front.orbit.angle, front.orbit.radius, front.orbit.height);
    near(cam.x, 2);
    near(cam.y, f.cameraHeight);
    near(cam.z, -1 + f.distance);

    // Facing +X: the camera is on the +X side.
    const turned = framingPose({ ...f, side: 0 }, { x: 0, y: 0, z: 0, yaw: Math.PI / 2 });
    const cam2 = orbitPosition(turned.target, turned.orbit.angle, turned.orbit.radius, turned.orbit.height);
    near(cam2.x, f.distance);
    near(cam2.z, 0);
  });

  test('full body matches the shot the studio opens with', () => {
    const { target, orbit } = framingPose(CAMERA_FRAMINGS.fullBody, { x: 0, y: 0, z: 0, yaw: 0 });
    const cam = orbitPosition(target, orbit.angle, orbit.radius, orbit.height);
    near(cam.x, Math.sin(0.45) * 5.2);
    near(cam.y, 1.8);
    near(cam.z, Math.cos(0.45) * 5.2);
  });
});

describe('group framings and re-centring', () => {
  const anchor = { x: 2, y: 0, z: -3, yaw: 0.4 };

  test('no group: the plain framing at the lead', () => {
    assert.deepEqual(groupFramingPose(CAMERA_FRAMINGS.fullBody, anchor, null), framingPose(CAMERA_FRAMINGS.fullBody, anchor));
  });

  test('a group moves the target to its middle and pulls the camera back', () => {
    const solo = framingPose(CAMERA_FRAMINGS.wide, anchor);
    const group = groupFramingPose(CAMERA_FRAMINGS.wide, anchor, { dx: 1, dz: -0.5, extraDistance: 1.8 });
    assert.ok(Math.abs(group.target.x - (solo.target.x + 1)) < 1e-9);
    assert.ok(Math.abs(group.target.z - (solo.target.z - 0.5)) < 1e-9);
    assert.equal(group.target.y, solo.target.y);
    assert.ok(Math.abs(group.orbit.radius - (solo.orbit.radius + 1.8)) < 1e-9);
    assert.equal(group.orbit.angle, solo.orbit.angle);
    assert.equal(group.orbit.height, solo.orbit.height);
  });

  test('a negative extra distance never brings the camera closer', () => {
    const solo = framingPose(CAMERA_FRAMINGS.fullBody, anchor);
    const group = groupFramingPose(CAMERA_FRAMINGS.fullBody, anchor, { dx: 0, dz: 0, extraDistance: -2 });
    assert.equal(group.orbit.radius, solo.orbit.radius);
  });

  test('full body and wide show the group; the close-up stays on the lead', () => {
    assert.ok(GROUP_FRAMINGS.includes('fullBody'));
    assert.ok(GROUP_FRAMINGS.includes('wide'));
    assert.ok(!GROUP_FRAMINGS.includes('closeUp'));
  });

  test('approach closes the gap without overshooting', () => {
    assert.equal(approach(1, 5, 3, 0), 1);
    assert.equal(approach(1, 5, 0, 0.1), 1);
    const step = approach(0, 10, 3, 1 / 60);
    assert.ok(step > 0 && step < 10);
    assert.ok(approach(0, 10, 3, 100) <= 10);
    assert.ok(Math.abs(approach(0, 10, 3, 100) - 10) < 1e-6);
    // Two half steps land where one full step does (frame-rate independent).
    const half = approach(approach(0, 10, 3, 0.05), 10, 3, 0.05);
    assert.ok(Math.abs(half - approach(0, 10, 3, 0.1)) < 1e-9);
    assert.ok(approach(10, 0, 3, 0.1) < 10);
  });
});
