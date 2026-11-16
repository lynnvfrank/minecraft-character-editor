import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNavGrid,
  findPath,
  hasClearLine,
  isClearAt,
  isWalkableAt,
  nearestWalkable,
  setBlocked,
  type GridXZ,
  type NavGrid,
} from './gridPath';

/** Grid from ASCII rows ('#' blocked), origin at 0,0, cell size 1. */
function gridFrom(rows: string[]): NavGrid {
  const g = createNavGrid(rows[0]!.length, rows.length, 0, 0, 1);
  rows.forEach((line, r) => [...line].forEach((ch, c) => ch === '#' && setBlocked(g, c, r)));
  return g;
}

/** Every leg of the walk stays clear of blocked cells. */
function assertWalkable(grid: NavGrid, from: GridXZ, path: GridXZ[], radius = 0): void {
  let prev = from;
  for (const p of path) {
    assert.ok(hasClearLine(grid, prev, p, radius), `blocked leg ${JSON.stringify(prev)} → ${JSON.stringify(p)}`);
    prev = p;
  }
}

describe('gridPath', () => {
  test('open ground is a single straight leg', () => {
    const g = gridFrom(['.....', '.....', '.....']);
    assert.deepEqual(findPath(g, { x: 0.5, z: 0.5 }, { x: 4.5, z: 2.5 }), [{ x: 4.5, z: 2.5 }]);
  });

  test('walks around a wall instead of through it', () => {
    const g = gridFrom([
      '.......',
      '...#...',
      '...#...',
      '...#...',
      '.......',
    ]);
    const from = { x: 1.5, z: 2.5 };
    const to = { x: 5.5, z: 2.5 };
    assert.equal(hasClearLine(g, from, to), false);
    const path = findPath(g, from, to, { radius: 0.3 })!;
    assert.ok(path.length >= 2, 'needs at least one corner');
    assert.deepEqual(path[path.length - 1], to);
    assertWalkable(g, from, path, 0.3);
  });

  test('no diagonal squeeze between two blocked corners', () => {
    const g = gridFrom([
      '.#.',
      '#..',
      '...',
    ]);
    // (0,0) is sealed off: its only open neighbor would be the diagonal through two walls.
    const path = findPath(g, { x: 2.5, z: 2.5 }, { x: 0.5, z: 0.5 }, { radius: 0.3 });
    assert.equal(path, null);
  });

  test('blocked goal ends at the nearest walkable cell', () => {
    const g = gridFrom(['.....', '..#..', '.....']);
    const path = findPath(g, { x: 0.5, z: 1.5 }, { x: 2.5, z: 1.5 })!;
    const end = path[path.length - 1]!;
    assert.ok(isWalkableAt(g, end));
    assert.ok(Math.hypot(end.x - 2.5, end.z - 1.5) <= 1.01);
  });

  test('unreachable goal returns null', () => {
    const g = gridFrom(['..#..', '..#..', '..#..']);
    assert.equal(findPath(g, { x: 0.5, z: 0.5 }, { x: 4.5, z: 0.5 }), null);
  });

  test('already at the goal returns an empty path', () => {
    const g = gridFrom(['...']);
    assert.deepEqual(findPath(g, { x: 1.5, z: 0.5 }, { x: 1.5, z: 0.5 }), []);
  });

  test('clearance keeps a body off the wall', () => {
    const g = gridFrom(['.#', '..']);
    assert.equal(isClearAt(g, { x: 0.5, z: 0.5 }, 0.3), true);
    assert.equal(isClearAt(g, { x: 0.9, z: 0.5 }, 0.3), false);
  });

  test('nearestWalkable finds the closest open cell', () => {
    const g = gridFrom(['###', '#..', '###']);
    assert.deepEqual(nearestWalkable(g, { x: 0.5, z: 1.5 }), { x: 1.5, z: 1.5 });
    assert.equal(nearestWalkable(gridFrom(['##']), { x: 0.5, z: 0.5 }), null);
  });
});
