import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlockWorld,
  isKnownTile,
  tileAt,
  walkableCellsWithin,
  VILLAGE_HOUSES,
  VILLAGE_MAP,
} from './blockWorld';
import { findPath, isWalkableAt, hasClearLine, cellAt } from '../lib/gridPath';

describe('blockWorld village', () => {
  test('map rows are all the same width and use known tiles', () => {
    const width = VILLAGE_MAP[0]!.length;
    VILLAGE_MAP.forEach((row, i) => {
      assert.equal(row.length, width, `row ${i} is ${row.length} wide, expected ${width}`);
      for (const t of row) assert.ok(isKnownTile(t), `row ${i}: unknown tile '${t}'`);
    });
  });

  test('houses sit on grass, inside the map, and have a door', () => {
    for (const h of VILLAGE_HOUSES) {
      assert.ok(h.door.at.length > 0);
      for (let r = h.row0; r <= h.row1; r++) {
        for (let c = h.col0; c <= h.col1; c++) {
          const t = tileAt(VILLAGE_MAP, c, r);
          assert.ok(t === '.' || t === ',', `house at ${h.col0},${h.row0} covers '${t}' at ${c},${r}`);
        }
      }
    }
  });

  const world = buildBlockWorld();

  test('the plaza at the origin is walkable; houses, trees and water are not', () => {
    assert.ok(isWalkableAt(world.nav, { x: 0, z: 0 }));
    const h = VILLAGE_HOUSES[0]!;
    const houseMid = { x: world.originX + (h.col0 + h.col1) / 2 + 0.5, z: world.originZ + (h.row0 + h.row1) / 2 + 0.5 };
    assert.equal(isWalkableAt(world.nav, houseMid), false);
    for (let r = 0; r < world.rows; r++) {
      for (let c = 0; c < world.cols; c++) {
        const t = tileAt(VILLAGE_MAP, c, r)!;
        if ('~fTLr'.includes(t)) {
          assert.equal(isWalkableAt(world.nav, { x: world.originX + c + 0.5, z: world.originZ + r + 0.5 }), false, t);
        }
      }
    }
  });

  test('every road leaving the map is a gate', () => {
    assert.equal(world.gates.length, 4);
    for (const g of world.gates) {
      const { col, row } = cellAt(world.nav, g);
      assert.ok(col === 0 || row === 0 || col === world.cols - 1 || row === world.rows - 1);
    }
  });

  test('every walkable cell can be reached from the plaza (no sealed-off pockets)', () => {
    const cells = walkableCellsWithin(world, Infinity);
    assert.ok(cells.length > 500);
    // Cheap flood fill rather than one A* per cell.
    const { cols, rows, nav } = world;
    const seen = new Uint8Array(cols * rows);
    const start = cellAt(nav, { x: 0.5, z: 0.5 });
    const stack = [start.row * cols + start.col];
    seen[stack[0]!] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const c = i % cols, r = Math.floor(i / cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (seen[ni] || nav.blocked[ni]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    for (const p of cells) {
      const { col, row } = cellAt(nav, p);
      assert.ok(seen[row * cols + col], `cell ${col},${row} is sealed off`);
    }
  });

  test('a walk from a gate to a garden bed goes through the gate, not the fence', () => {
    const gate = world.gates.find((g) => g.z > 10)!; // the south road
    const crop = { x: world.originX + 8.5, z: world.originZ + 27.5 };
    const path = findPath(world.nav, gate, crop, { radius: 0.3 })!;
    assert.ok(path, 'garden should be reachable');
    let prev = gate;
    for (const p of path) {
      assert.ok(hasClearLine(world.nav, prev, p, 0.3), 'leg crosses a blocked cell');
      prev = p;
    }
  });

  test('blocks are deterministic', () => {
    const again = buildBlockWorld();
    assert.equal(again.blocks.length, world.blocks.length);
    assert.deepEqual(again.blocks[123], world.blocks[123]);
  });
});
