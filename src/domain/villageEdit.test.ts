import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockWorld, isKnownTile, tileAt, VILLAGE_HOUSES, VILLAGE_MAP } from './blockWorld';
import {
  applyVillageEdit,
  cellsBetween,
  countTile,
  DEFAULT_VILLAGE_RULES,
  findSealedCell,
  MAX_LAMP_POSTS,
  PAINT_TILES,
  parseVillageMap,
  protectedReason,
  REFUSALS,
  sameVillageMap,
  spawnCells,
  type VillageRules,
} from './villageEdit';
import { cellAt, findPath, isWalkableAt } from '../lib/gridPath';

/** Paint and expect it to work. */
function painted(map: readonly string[], col: number, row: number, tile: string, rules?: VillageRules): readonly string[] {
  const result = applyVillageEdit(map, col, row, tile, rules);
  assert.ok(result.ok, result.ok ? '' : `refused: ${result.reason}`);
  return result.map;
}

function refusal(map: readonly string[], col: number, row: number, tile: string, rules?: VillageRules): string {
  const result = applyVillageEdit(map, col, row, tile, rules);
  assert.equal(result.ok, false, `expected a refusal at ${col},${row}`);
  return result.ok ? '' : result.reason;
}

/** A tiny open field with no houses: easy to reason about walls. */
const FIELD: VillageRules = {
  base: ['.....', '.....', '.....', '.....', '.....'],
  houses: [],
  maxLamps: 2,
};

describe('village palette', () => {
  test('offers every legend tile plus an eraser that paints grass', () => {
    for (const t of PAINT_TILES) assert.ok(isKnownTile(t.tile), t.id);
    assert.deepEqual([...new Set(PAINT_TILES.map((t) => t.tile))].sort(), ['.', ',', '=', 'o', 's', 'w', '~', 'f', 'T', 'L', 'r'].sort());
    assert.equal(PAINT_TILES.find((t) => t.id === 'eraser')?.tile, '.');
    assert.equal(new Set(PAINT_TILES.map((t) => t.id)).size, PAINT_TILES.length);
    for (const t of PAINT_TILES) assert.ok(!/minecraft/i.test(t.label));
    for (const text of Object.values(REFUSALS)) assert.ok(!/minecraft/i.test(text));
  });
});

describe('applyVillageEdit', () => {
  test('painting returns a new map and leaves the old one alone', () => {
    const next = painted(VILLAGE_MAP, 0, 2, 'T');
    assert.equal(tileAt(next, 0, 2), 'T');
    assert.equal(tileAt(VILLAGE_MAP, 0, 2), '.');
    assert.notEqual(next, VILLAGE_MAP);
    assert.equal(next.length, VILLAGE_MAP.length);
    next.forEach((row, i) => assert.equal(row.length, VILLAGE_MAP[i]!.length));
  });

  test('painting the tile that is already there changes nothing', () => {
    const result = applyVillageEdit(VILLAGE_MAP, 0, 2, '.');
    assert.deepEqual(result, { ok: true, map: VILLAGE_MAP, changed: false });
  });

  test('off the map and unknown tiles are refused', () => {
    assert.equal(refusal(VILLAGE_MAP, -1, 0, '.'), REFUSALS.offMap);
    assert.equal(refusal(VILLAGE_MAP, 0, VILLAGE_MAP.length, '.'), REFUSALS.offMap);
    assert.equal(refusal(VILLAGE_MAP, 0.5, 2, '.'), REFUSALS.offMap);
    assert.equal(refusal(VILLAGE_MAP, 0, 2, 'X'), REFUSALS.unknown);
  });

  test('cells under houses, doorsteps and gates are protected, even for walkable paint', () => {
    for (const h of VILLAGE_HOUSES) {
      assert.equal(refusal(VILLAGE_MAP, h.col0, h.row0, ','), REFUSALS.house);
      assert.equal(refusal(VILLAGE_MAP, h.col1, h.row1, 'T'), REFUSALS.house);
    }
    const world = buildBlockWorld();
    assert.ok(world.doorsteps.length > 0);
    for (const p of world.doorsteps) {
      const { col, row } = cellAt(world.nav, p);
      assert.equal(refusal(VILLAGE_MAP, col, row, 'T'), REFUSALS.doorstep);
    }
    // Every road cell on the rim (two per gate here) is locked.
    let gateCells = 0;
    const rows = VILLAGE_MAP.length, cols = VILLAGE_MAP[0]!.length;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const rim = row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
        if (!rim || tileAt(VILLAGE_MAP, col, row) !== '=') continue;
        gateCells++;
        assert.equal(refusal(VILLAGE_MAP, col, row, '.'), REFUSALS.gate);
        assert.equal(protectedReason(col, row), REFUSALS.gate);
      }
    }
    assert.equal(gateCells, 8);
    // A plain rim cell is fine.
    assert.equal(protectedReason(0, 2), null);
  });

  test('the centre stays walkable: solid tiles are refused there, ground is fine', () => {
    const cells = spawnCells();
    assert.equal(cells.length, 4);
    let map = VILLAGE_MAP;
    for (const { col, row } of cells) {
      assert.equal(refusal(map, col, row, 'T'), REFUSALS.spawn);
      assert.equal(refusal(map, col, row, '~'), REFUSALS.spawn);
      map = painted(map, col, row, '.');
    }
    assert.ok(isWalkableAt(buildBlockWorld(map).nav, { x: 0, z: 0 }));
  });

  test('refuses the edit that would wall an area in, with a friendly hint', () => {
    // Ring a cell with fence: the last post would seal the middle.
    let map = FIELD.base;
    for (const [c, r] of [[0, 0], [1, 0], [0, 1]] as const) map = painted(map, c, r, '.', FIELD);
    // Corner cell 0,0: its two neighbours close it off.
    map = painted(map, 1, 0, 'f', FIELD);
    assert.equal(refusal(map, 0, 1, 'f', FIELD), REFUSALS.sealed);
    assert.match(REFUSALS.sealed, /wall someone in/);
    // Filling the corner itself first makes the same wall fine (nothing walkable is cut off).
    map = painted(map, 0, 0, 'r', FIELD);
    map = painted(map, 0, 1, 'f', FIELD);
    assert.equal(findSealedCell(map, FIELD), null);
  });

  test('refuses opening a pocket nobody can reach (the middle of the pond)', () => {
    // Pond interior at col 25,row 27 is water with water all round.
    assert.equal(tileAt(VILLAGE_MAP, 25, 27), '~');
    assert.equal(refusal(VILLAGE_MAP, 25, 27, 's'), REFUSALS.pocket);
    // From the shore inward works.
    let map = VILLAGE_MAP;
    for (const col of [22, 23, 24, 25]) map = painted(map, col, 27, 's');
    assert.equal(findSealedCell(map), null);
  });

  test('the fenced garden keeps its one gate', () => {
    // The garden's only opening is the path through the east fence at col 12,row 27.
    assert.equal(tileAt(VILLAGE_MAP, 12, 27), '=');
    assert.equal(refusal(VILLAGE_MAP, 12, 27, 'f'), REFUSALS.sealed);
    // Open a second gate and the first may close.
    const map = painted(VILLAGE_MAP, 12, 25, '.');
    painted(map, 12, 27, 'f');
  });

  test('lamp posts are capped', () => {
    assert.ok(countTile(VILLAGE_MAP, 'L') <= MAX_LAMP_POSTS);
    let map = FIELD.base;
    map = painted(map, 0, 0, 'L', FIELD);
    map = painted(map, 4, 0, 'L', FIELD);
    assert.equal(refusal(map, 4, 4, 'L', FIELD), REFUSALS.lamps);
    // Swapping one out makes room again.
    map = painted(map, 0, 0, '.', FIELD);
    painted(map, 4, 4, 'L', FIELD);
  });

  test('the plaza can be paved over: gatherings then have no plaza centres and paths still work', () => {
    let map = VILLAGE_MAP;
    const rows = map.length, cols = map[0]!.length;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (tileAt(map, col, row) === 'o') map = painted(map, col, row, '.');
      }
    }
    const world = buildBlockWorld(map);
    assert.deepEqual(world.plaza, []); // animation/crowd.ts falls back to any wander spot
    assert.equal(world.gates.length, 4);
    assert.ok(isWalkableAt(world.nav, { x: 0, z: 0 }));
    for (const gate of world.gates) assert.ok(findPath(world.nav, gate, { x: 0.5, z: 0.5 }, { radius: 0.3 }));
    assert.ok(parseVillageMap(map));
  });

  test('whatever gets painted, every walkable cell of the built world is reachable from every gate', () => {
    // Scribble solid tiles all over; keep whatever the rules allow.
    let map = VILLAGE_MAP;
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const solids = ['T', 'f', '~', 'r'];
    let accepted = 0;
    for (let i = 0; i < 1500; i++) {
      const col = Math.floor(rand() * 36), row = Math.floor(rand() * 36);
      const result = applyVillageEdit(map, col, row, solids[Math.floor(rand() * solids.length)]!);
      if (result.ok) {
        map = result.map;
        accepted++;
      }
    }
    assert.ok(accepted > 300, `accepted ${accepted}`);
    assert.equal(findSealedCell(map), null);
    assert.ok(parseVillageMap(map), 'a map built from allowed edits is a valid saved map');
    const world = buildBlockWorld(map);
    assert.equal(world.gates.length, 4);
    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        if (world.nav.blocked[row * world.cols + col]) continue;
        const p = { x: world.originX + col + 0.5, z: world.originZ + row + 0.5 };
        assert.ok(findPath(world.nav, world.gates[0]!, p, { radius: 0.3 }), `no path to ${col},${row}`);
      }
    }
  });
});

describe('parseVillageMap', () => {
  test('the built-in map is valid and comes back as a copy', () => {
    const parsed = parseVillageMap(VILLAGE_MAP);
    assert.ok(parsed);
    assert.ok(sameVillageMap(parsed, VILLAGE_MAP));
    assert.notEqual(parsed, VILLAGE_MAP);
    assert.equal(findSealedCell(VILLAGE_MAP), null);
  });

  test('junk, wrong sizes and unknown tiles are rejected', () => {
    for (const junk of [null, undefined, 'map', 42, {}, [], [1, 2, 3], VILLAGE_MAP.slice(1)]) {
      assert.equal(parseVillageMap(junk), null);
    }
    const short = VILLAGE_MAP.map((row, i) => (i === 3 ? row.slice(1) : row));
    assert.equal(parseVillageMap(short), null);
    const odd = VILLAGE_MAP.map((row, i) => (i === 3 ? 'X' + row.slice(1) : row));
    assert.equal(parseVillageMap(odd), null);
    const notStrings = VILLAGE_MAP.map((row, i) => (i === 3 ? [...row] : row));
    assert.equal(parseVillageMap(notStrings), null);
  });

  const withTile = (map: readonly string[], col: number, row: number, tile: string) =>
    map.map((line, r) => (r === row ? line.slice(0, col) + tile + line.slice(col + 1) : line));

  test('a map that breaks a rule is rejected', () => {
    const h = VILLAGE_HOUSES[0]!;
    assert.equal(parseVillageMap(withTile(VILLAGE_MAP, h.col0, h.row0, 'T')), null, 'tree under a house');
    assert.equal(parseVillageMap(withTile(VILLAGE_MAP, 17, 0, '.')), null, 'gate changed');
    assert.equal(parseVillageMap(withTile(VILLAGE_MAP, 18, 18, 'T')), null, 'centre blocked');
    assert.equal(parseVillageMap(withTile(VILLAGE_MAP, 12, 27, 'f')), null, 'garden sealed');
    let lamps: string[] = [...VILLAGE_MAP];
    for (let col = 0; col < 12; col++) lamps = withTile(lamps, col * 2, 1, 'L');
    assert.ok(countTile(lamps, 'L') > MAX_LAMP_POSTS);
    assert.equal(parseVillageMap(lamps), null, 'too many lamps');
  });

  test('an edited map survives a JSON round trip', () => {
    const map = painted(painted(VILLAGE_MAP, 0, 2, 'T'), 3, 30, 'L');
    const parsed = parseVillageMap(JSON.parse(JSON.stringify(map)));
    assert.ok(parsed && sameVillageMap(parsed, map));
  });

  test('rules default to the built-in village', () => {
    assert.equal(DEFAULT_VILLAGE_RULES.base, VILLAGE_MAP);
    assert.equal(DEFAULT_VILLAGE_RULES.houses, VILLAGE_HOUSES);
  });
});

describe('cellsBetween', () => {
  test('covers a fast drag without gaps, both ends included', () => {
    assert.deepEqual(cellsBetween({ col: 2, row: 2 }, { col: 2, row: 2 }), [{ col: 2, row: 2 }]);
    assert.deepEqual(cellsBetween({ col: 0, row: 0 }, { col: 3, row: 0 }).map((c) => c.col), [0, 1, 2, 3]);
    const line = cellsBetween({ col: 5, row: 1 }, { col: 0, row: 4 });
    assert.deepEqual(line[0], { col: 5, row: 1 });
    assert.deepEqual(line[line.length - 1], { col: 0, row: 4 });
    for (let i = 1; i < line.length; i++) {
      assert.ok(Math.max(Math.abs(line[i]!.col - line[i - 1]!.col), Math.abs(line[i]!.row - line[i - 1]!.row)) === 1);
    }
  });
});
