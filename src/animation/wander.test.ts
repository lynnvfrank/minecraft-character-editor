import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapAngle,
  lerpAngleRad,
  smoothstep,
  yawToward,
  waypointToWorld,
  pickWanderWaypoint,
  WAYPOINT_RELATIVE,
} from './wander';
import type { TrapezoidBounds } from '../lib/trapezoidBounds';

const PI = Math.PI;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('angles', () => {
  test('wrapAngle maps into [-π, π)', () => {
    assert.ok(near(wrapAngle(0), 0));
    assert.ok(near(wrapAngle(3 * PI / 2), -PI / 2));
    assert.ok(near(wrapAngle(-3 * PI / 2), PI / 2));
    assert.ok(near(wrapAngle(PI), -PI));
    assert.ok(near(wrapAngle(4 * PI + 0.1), 0.1));
  });

  test('lerpAngleRad takes the short way across ±π', () => {
    // 170° → -170° is a 20° turn, not 340°
    const from = (170 * PI) / 180;
    const to = (-170 * PI) / 180;
    const mid = lerpAngleRad(from, to, 0.5);
    assert.ok(near(Math.abs(mid), PI, 1e-9), `expected ±π, got ${mid}`);
  });

  test('lerpAngleRad endpoints', () => {
    assert.ok(near(lerpAngleRad(0.2, 1.0, 0), 0.2));
    assert.ok(near(lerpAngleRad(0.2, 1.0, 1), 1.0));
  });

  test('smoothstep is clamped and symmetric', () => {
    assert.equal(smoothstep(-1), 0);
    assert.equal(smoothstep(2), 1);
    assert.equal(smoothstep(0.5), 0.5);
    assert.ok(smoothstep(0.25) < 0.25, 'eases in');
  });

  test('yawToward: +Z is 0, +X is π/2', () => {
    assert.ok(near(yawToward({ x: 0, z: 0 }, { x: 0, z: 1 }), 0));
    assert.ok(near(yawToward({ x: 0, z: 0 }, { x: 1, z: 0 }), PI / 2));
  });
});

/** Axis-aligned trapezoid: depth along +Z (toward camera), lateral along +X, half-width 1 + |depth|. */
const bounds: TrapezoidBounds = {
  startX: 0,
  startZ: 0,
  depthDirX: 0,
  depthDirZ: 1,
  perpDirX: 1,
  perpDirZ: 0,
  depthToward: 0.4,
  depthAway: -3,
  getHalfWidthAtDepth: (d) => 1 + Math.abs(d),
};

describe('waypointToWorld', () => {
  test('origin maps to start', () => {
    assert.deepEqual(waypointToWorld([0, 0], bounds, 0.8), { x: 0, z: 0 });
  });
  test('depth scales by walk distance; lateral by half-width at that depth', () => {
    const p = waypointToWorld([-1.5, 0.5], bounds, 0.8);
    assert.ok(near(p.z, -1.2));
    assert.ok(near(p.x, 0.5 * (1 + 1.2)));
  });
  test('depth is clamped to the trapezoid', () => {
    assert.ok(near(waypointToWorld([-10, 0], bounds, 0.8).z, -3));
    assert.ok(near(waypointToWorld([10, 0], bounds, 0.8).z, 0.4));
  });
  test('all built-in waypoints stay inside the bounds', () => {
    for (const rel of WAYPOINT_RELATIVE) {
      const p = waypointToWorld(rel, bounds, 0.8);
      assert.ok(p.z >= bounds.depthAway && p.z <= bounds.depthToward);
      assert.ok(Math.abs(p.x) <= bounds.getHalfWidthAtDepth(p.z) + 1e-9);
    }
  });
});

describe('pickWanderWaypoint', () => {
  const ahead = { x: 0, z: 2 };
  const right = { x: 2, z: 0.1 };
  const behind = { x: 0, z: -2 };

  test('picks the smallest turn from current facing', () => {
    assert.deepEqual(pickWanderWaypoint([behind, right, ahead], { x: 0, z: 0 }, 0), ahead);
  });
  test('skips the waypoint at the current position', () => {
    assert.deepEqual(pickWanderWaypoint([{ x: 0, z: 0 }, behind], { x: 0, z: 0 }, PI), behind);
  });
  test('falls back to the nearest turn when nothing is within 90°', () => {
    // facing +Z; only waypoints behind and behind-right exist → choose the smaller turn
    const behindRight = { x: 1, z: -2 };
    assert.deepEqual(pickWanderWaypoint([behind, behindRight], { x: 0, z: 0 }, 0), behindRight);
  });
  test('only the current position: returns the first waypoint', () => {
    assert.deepEqual(pickWanderWaypoint([{ x: 0, z: 0 }], { x: 0, z: 0 }, 0), { x: 0, z: 0 });
  });
});
