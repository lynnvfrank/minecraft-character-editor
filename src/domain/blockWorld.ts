/**
 * The home view's tiny block village: what is where, which cells can be walked, and the list of
 * blocks to draw. Pure data and functions (no three.js) so it runs in unit tests; the renderer is
 * viewer/blockWorldMesh.ts and pathfinding is lib/gridPath.ts.
 *
 * One cell = one block = 1 world unit (characters are ~1.9 units tall, about two blocks, like the
 * game they're styled after). The ground's top surface is y = 0. Map rows run along +Z (toward
 * the default camera), columns along +X, and the map is centered on the origin so the plaza in the
 * middle is where the first character stands.
 *
 * To change the village, edit VILLAGE_MAP (ground and small things) and VILLAGE_HOUSES.
 * Players repaint the map in the home view's Build mode; the rules for that are domain/villageEdit.ts.
 * blockWorld.test.ts checks the map is well-formed and every walkable spot is reachable.
 */
import { createNavGrid, isCellWalkable, setBlocked, cellCenter, type GridXZ, type NavGrid } from '../lib/gridPath';

/**
 * Map legend (one character per cell):
 *   .  grass             ,  grass with a flower    =  dirt path        o  stone plaza
 *   s  sand              w  crops (walkable)       ~  water (blocked)  f  fence (blocked)
 *   T  tree (blocked)    L  lamp post (blocked)    r  boulder (blocked)
 * Houses are listed separately (VILLAGE_HOUSES) and sit on grass.
 */
export const VILLAGE_MAP: readonly string[] = [
  '.................==.................',
  '.................==.................',
  '..T..........,,..==.......,.........',
  '..............T..==......,......,T..',
  '.................==..T....,..,,....,',
  '.........,.....,.==.................',
  '.................==....,............',
  '...,,............==.................',
  '.................==.,.....==.......,',
  '........==.,.....==.T.....==........',
  '.....,..==...T...==...,...==........',
  '.T......==.....,.==....T..===......,',
  '......,.==.......==.......==........',
  '...,....=====LooooooooL...==........',
  '........==...oooooooooo.,.==........',
  '........==...oooooooooo...==.......T',
  '........==.,.oooooooooo...==........',
  '=============oooooooooo=============',
  '=============oooooooooo=============',
  '..T=...,.....oooooooooo,......T.....',
  '..........T..oooooooooo....,........',
  '..........,..oooooooooo........,....',
  '.............LooooooooL.,.,.......r.',
  '......,..........==...............,.',
  '.....ffffffff....==...ssssssss......',
  '.....fwwwwwwf..,.==..ss~~~~~~ss.....',
  '.....fwwwwwwf....==..s~~~~~~~~s.,...',
  '.....fwwwwww=======..s~~~~~~~~s....,',
  '.....fwwwwwwf....==..s~~~~~~~~s.....',
  '.,...fwwwwwwf....==..ss~~~~~~ss.....',
  '...T.ffffffff....==...ssssssss......',
  ',......,.,.......==...,..,.....r....',
  '...,...........T.==.................',
  '......r..........==,.....T.......T..',
  '.T..,....,.......==............,....',
  '....,............==.................',
];

export type DoorSide = 'north' | 'south' | 'east' | 'west';

export type HouseSpec = {
  /** Inclusive cell rectangle of the walls. */
  col0: number;
  row0: number;
  col1: number;
  row1: number;
  /** Wall height in blocks. */
  wallHeight: number;
  wall: 'planks' | 'birch' | 'brick';
  roof: 'roofRed' | 'roofBlue' | 'roofGreen';
  /** Side the door is on; `at` is the column (north/south) or row (east/west) of each door block. */
  door: { side: DoorSide; at: readonly number[] };
};

export const VILLAGE_HOUSES: readonly HouseSpec[] = [
  { col0: 5, row0: 3, col1: 12, row1: 8, wallHeight: 3, wall: 'planks', roof: 'roofRed', door: { side: 'south', at: [8, 9] } },
  { col0: 23, row0: 2, col1: 30, row1: 7, wallHeight: 3, wall: 'birch', roof: 'roofBlue', door: { side: 'south', at: [26, 27] } },
  { col0: 29, row0: 9, col1: 34, row1: 14, wallHeight: 3, wall: 'brick', roof: 'roofGreen', door: { side: 'west', at: [11] } },
  { col0: 1, row0: 20, col1: 5, row1: 23, wallHeight: 2, wall: 'planks', roof: 'roofBlue', door: { side: 'north', at: [3] } },
];

export type BlockKind =
  | 'grass' | 'dirt' | 'path' | 'stone' | 'sand' | 'soil' | 'water'
  | 'planks' | 'birch' | 'brick' | 'log' | 'cobble' | 'glass' | 'door'
  | 'roofRed' | 'roofBlue' | 'roofGreen'
  | 'leaves' | 'crop' | 'flowerRed' | 'flowerYellow' | 'stem' | 'fence' | 'lamp';

/** An axis-aligned box: center x/y/z and size sx/sy/sz, in world units. */
export type WorldBlock = { kind: BlockKind; x: number; y: number; z: number; sx: number; sy: number; sz: number };

export type BlockWorld = {
  cols: number;
  rows: number;
  /** World X/Z of the map's minimum corner. */
  originX: number;
  originZ: number;
  blocks: WorldBlock[];
  nav: NavGrid;
  /** Where characters walk in from and back out to: road ends at the edge of the map. */
  gates: GridXZ[];
  /** Plaza cells well inside the stone square (room for a small group to stand around them). */
  plaza: GridXZ[];
  /** Walkable cells right next to a lamp post. */
  lampSides: GridXZ[];
  /** The walkable cell in front of each door block. */
  doorsteps: GridXZ[];
};

/** A gathering's centre keeps this many plaza cells between itself and the plaza's edge. */
const PLAZA_INSET = 2;

const BLOCKED_TILES = new Set(['~', 'f', 'T', 'L', 'r']);
const KNOWN_TILES = new Set(['.', ',', '=', 'o', 's', 'w', '~', 'f', 'T', 'L', 'r']);

/** Cheap deterministic hash in [0, 1) so the village looks the same on every load. */
function hash01(a: number, b: number, salt = 0): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function tileAt(map: readonly string[], col: number, row: number): string | undefined {
  return map[row]?.[col];
}

export function buildBlockWorld(
  map: readonly string[] = VILLAGE_MAP,
  houses: readonly HouseSpec[] = VILLAGE_HOUSES
): BlockWorld {
  const rows = map.length;
  const cols = map[0]?.length ?? 0;
  const originX = -cols / 2;
  const originZ = -rows / 2;
  const nav = createNavGrid(cols, rows, originX, originZ, 1);
  const blocks: WorldBlock[] = [];

  const cx = (col: number) => originX + col + 0.5;
  const cz = (row: number) => originZ + row + 0.5;
  /** Unit block whose bottom sits at `level` (ground layer is level -1). */
  const cube = (kind: BlockKind, col: number, row: number, level: number) =>
    blocks.push({ kind, x: cx(col), y: level + 0.5, z: cz(row), sx: 1, sy: 1, sz: 1 });
  const box = (kind: BlockKind, x: number, yBottom: number, z: number, sx: number, sy: number, sz: number) =>
    blocks.push({ kind, x, y: yBottom + sy / 2, z, sx, sy, sz });

  const isFence = (col: number, row: number) => tileAt(map, col, row) === 'f';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = tileAt(map, col, row) ?? '.';
      if (BLOCKED_TILES.has(t)) setBlocked(nav, col, row);

      // Ground layer, plus a dirt skirt under the island's rim so it reads as a chunk of land.
      const ground: BlockKind =
        t === '=' ? 'path' : t === 'o' || t === 'L' ? 'stone' : t === 's' ? 'sand' : t === 'w' ? 'soil' : 'grass';
      if (t === '~') {
        box('water', cx(col), -1, cz(row), 1, 0.85, 1);
        box('sand', cx(col), -2, cz(row), 1, 1, 1);
      } else {
        cube(ground, col, row, -1);
      }
      const rim = row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
      if (rim) {
        const depth = 2 + Math.floor(hash01(col, row, 1) * 3);
        for (let d = 2; d <= depth; d++) cube(d === depth ? 'stone' : 'dirt', col, row, -d);
      }

      switch (t) {
        case ',': {
          const kind: BlockKind = hash01(col, row, 2) < 0.5 ? 'flowerRed' : 'flowerYellow';
          const ox = (hash01(col, row, 3) - 0.5) * 0.5;
          const oz = (hash01(col, row, 4) - 0.5) * 0.5;
          box('stem', cx(col) + ox, 0, cz(row) + oz, 0.06, 0.28, 0.06);
          box(kind, cx(col) + ox, 0.28, cz(row) + oz, 0.2, 0.16, 0.2);
          break;
        }
        case 'w':
          box('crop', cx(col), 0, cz(row), 0.8, 0.35 + hash01(col, row, 5) * 0.25, 0.8);
          break;
        case 'r':
          cube('cobble', col, row, 0);
          if (hash01(col, row, 6) < 0.6) box('cobble', cx(col), 1, cz(row), 0.6, 0.5, 0.6);
          break;
        case 'L':
          box('fence', cx(col), 0, cz(row), 0.2, 2.1, 0.2);
          box('lamp', cx(col), 2.1, cz(row), 0.45, 0.45, 0.45);
          break;
        case 'f': {
          box('fence', cx(col), 0, cz(row), 0.24, 1.0, 0.24);
          // Rails toward fence neighbors to the east and south (each pair drawn once).
          for (const h of [0.4, 0.8]) {
            if (isFence(col + 1, row)) box('fence', cx(col) + 0.5, h - 0.06, cz(row), 0.76, 0.12, 0.1);
            if (isFence(col, row + 1)) box('fence', cx(col), h - 0.06, cz(row) + 0.5, 0.1, 0.12, 0.76);
          }
          break;
        }
        case 'T': {
          const height = 4 + Math.floor(hash01(col, row, 7) * 2);
          for (let y = 0; y < height; y++) cube('log', col, row, y);
          // Leaves: a wide layer, a narrower one, and a cap, skipping the trunk and the corners.
          const top = height - 1;
          for (const [level, reach] of [[top - 1, 2], [top, 2], [top + 1, 1], [top + 2, 0]] as const) {
            for (let dr = -reach; dr <= reach; dr++) {
              for (let dc = -reach; dc <= reach; dc++) {
                if (reach > 0 && Math.abs(dr) === reach && Math.abs(dc) === reach) continue;
                if (dr === 0 && dc === 0 && level < height) continue;
                cube('leaves', col + dc, row + dr, level);
              }
            }
          }
          break;
        }
      }
    }
  }

  for (const house of houses) addHouse(house);

  function addHouse(h: HouseSpec): void {
    const doorCells = new Set(
      h.door.at.map((i) =>
        h.door.side === 'north' ? `${i},${h.row0}` :
        h.door.side === 'south' ? `${i},${h.row1}` :
        h.door.side === 'west' ? `${h.col0},${i}` : `${h.col1},${i}`
      )
    );
    for (let row = h.row0; row <= h.row1; row++) {
      for (let col = h.col0; col <= h.col1; col++) {
        setBlocked(nav, col, row);
        const edgeX = col === h.col0 || col === h.col1;
        const edgeZ = row === h.row0 || row === h.row1;
        if (!edgeX && !edgeZ) continue; // hollow inside, nobody sees it
        const corner = edgeX && edgeZ;
        const isDoor = doorCells.has(`${col},${row}`);
        // Windows on the middle level of long walls, every other block, away from corners and doors.
        const along = edgeZ ? col - h.col0 : row - h.row0;
        const length = edgeZ ? h.col1 - h.col0 : h.row1 - h.row0;
        for (let level = 0; level < h.wallHeight; level++) {
          let kind: BlockKind = corner ? 'log' : level === 0 ? 'cobble' : h.wall;
          if (isDoor && level < 2) kind = 'door';
          else if (!corner && !isDoor && level === 1 && along % 2 === 0 && along > 1 && along < length - 1) {
            kind = 'glass';
          }
          cube(kind, col, row, level);
        }
      }
    }
    // Stepped roof: one block of overhang, shrinking by one on every side per layer.
    let c0 = h.col0 - 1, c1 = h.col1 + 1, r0 = h.row0 - 1, r1 = h.row1 + 1;
    for (let level = h.wallHeight; c0 <= c1 && r0 <= r1; level++) {
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          // Fill only each layer's rim, except the very top which is solid.
          const rimCell = row === r0 || row === r1 || col === c0 || col === c1;
          const topLayer = c1 - c0 < 2 || r1 - r0 < 2;
          if (rimCell || topLayer) cube(h.roof, col, row, level);
        }
      }
      c0++; c1--; r0++; r1--;
    }
  }

  // Gates: walkable road cells on the map's edge, one per road end (centered across its width).
  const gates: GridXZ[] = [];
  const edgeCells: [number, number][] = [];
  for (let col = 0; col < cols; col++) edgeCells.push([col, 0], [col, rows - 1]);
  for (let row = 1; row < rows - 1; row++) edgeCells.push([0, row], [cols - 1, row]);
  const roadEdge = edgeCells.filter(([c, r]) => tileAt(map, c, r) === '=' && isCellWalkable(nav, c, r));
  const seen = new Set<string>();
  for (const [c, r] of roadEdge) {
    const key = `${c},${r}`;
    if (seen.has(key)) continue;
    // Group with adjacent road-edge cells (a two-wide road is one gate).
    const group = roadEdge.filter(([c2, r2]) => Math.abs(c2 - c) + Math.abs(r2 - r) <= 1);
    group.forEach(([c2, r2]) => seen.add(`${c2},${r2}`));
    const centers = group.map(([c2, r2]) => cellCenter(nav, c2, r2));
    gates.push({
      x: centers.reduce((s, p) => s + p.x, 0) / centers.length,
      z: centers.reduce((s, p) => s + p.z, 0) / centers.length,
    });
  }

  // Social spots (after the houses, so their cells count as blocked).
  const plaza: GridXZ[] = [];
  const lampSides: GridXZ[] = [];
  const near = (col: number, row: number, reach: number, test: (t: string | undefined) => boolean, all: boolean) => {
    let any = false;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (dr === 0 && dc === 0) continue;
        const hit = test(tileAt(map, col + dc, row + dr));
        if (all && !hit) return false;
        any ||= hit;
      }
    }
    return all || any;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!isCellWalkable(nav, col, row)) continue;
      if (tileAt(map, col, row) === 'o' && near(col, row, PLAZA_INSET, (t) => t === 'o', true)) {
        plaza.push(cellCenter(nav, col, row));
      }
      if (near(col, row, 1, (t) => t === 'L', false)) lampSides.push(cellCenter(nav, col, row));
    }
  }
  const doorsteps: GridXZ[] = [];
  for (const h of houses) {
    for (const i of h.door.at) {
      const [col, row] =
        h.door.side === 'north' ? [i, h.row0 - 1] :
        h.door.side === 'south' ? [i, h.row1 + 1] :
        h.door.side === 'west' ? [h.col0 - 1, i] : [h.col1 + 1, i];
      if (isCellWalkable(nav, col, row)) doorsteps.push(cellCenter(nav, col, row));
    }
  }

  return { cols, rows, originX, originZ, blocks, nav, gates, plaza, lampSides, doorsteps };
}

/** Every walkable cell center within `radius` of the origin (where wandering characters may go). */
export function walkableCellsWithin(world: BlockWorld, radius: number): GridXZ[] {
  const out: GridXZ[] = [];
  for (let row = 0; row < world.rows; row++) {
    for (let col = 0; col < world.cols; col++) {
      if (!isCellWalkable(world.nav, col, row)) continue;
      const p = cellCenter(world.nav, col, row);
      if (Math.hypot(p.x, p.z) <= radius) out.push(p);
    }
  }
  return out;
}

export function isKnownTile(t: string): boolean {
  return KNOWN_TILES.has(t);
}

/** Tiles nobody can walk on (water, fence, tree, lamp post, boulder). */
export function isBlockedTile(t: string): boolean {
  return BLOCKED_TILES.has(t);
}
