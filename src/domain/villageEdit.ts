/**
 * Rules for the home view's village editor ("Build mode"): which tiles can be painted where, and
 * what makes a painted map acceptable. Pure (no three.js, no DOM) so it runs in unit tests; the
 * tool itself is controllers/villageEditorController.ts and the saved map is state/villageStore.ts.
 *
 * A map is the same shape as VILLAGE_MAP (domain/blockWorld.ts): one string per row, one legend
 * character per cell. Houses stay where they are in this version. The rules:
 * - Protected cells never change: under a house, the doorstep in front of each door, and the
 *   road cells on the map's edge (the gates characters walk in and out through).
 * - The four cells around the map's centre stay walkable (characters start there).
 * - Every walkable cell can be reached from the centre: no walling someone in, and no opening up
 *   a pocket nobody can get to.
 * - At most MAX_LAMP_POSTS lamp posts. (Only the four nearest the centre cast real light, see
 *   controllers/dayNightController.ts; the others still glow.)
 * The stone plaza is optional: without one, gatherings meet on any open ground (animation/crowd.ts).
 */
import { VILLAGE_HOUSES, VILLAGE_MAP, isBlockedTile, isKnownTile, type HouseSpec } from './blockWorld';

export const MAX_LAMP_POSTS = 12;

export type PaintTile = {
  /** Palette id (the eraser paints grass too, so the tile alone isn't unique). */
  id: string;
  /** Legend character written into the map. */
  tile: string;
  label: string;
  /** CSS color of the palette swatch and the paint preview. */
  swatch: string;
  /** Characters can't walk through it. */
  solid: boolean;
};

const paint = (id: string, tile: string, label: string, swatch: string): PaintTile => ({
  id, tile, label, swatch, solid: isBlockedTile(tile),
});

/** The Build palette, in display order. */
export const PAINT_TILES: readonly PaintTile[] = [
  paint('grass', '.', 'Grass', '#6fae4a'),
  paint('flower', ',', 'Flower', '#e0413a'),
  paint('path', '=', 'Dirt path', '#b59466'),
  paint('plaza', 'o', 'Stone plaza', '#9a9a9a'),
  paint('sand', 's', 'Sand', '#e0d29a'),
  paint('crops', 'w', 'Crops', '#c9b14a'),
  paint('water', '~', 'Water', '#3f7fd6'),
  paint('fence', 'f', 'Fence', '#8a6438'),
  paint('tree', 'T', 'Tree', '#3f8a36'),
  paint('lamp', 'L', 'Lamp post', '#ffd98a'),
  paint('boulder', 'r', 'Boulder', '#7d7d7d'),
  paint('eraser', '.', 'Eraser', '#6fae4a'),
];

export type VillageRules = {
  /** The built-in map: fixes the size and what the protected cells hold. */
  base: readonly string[];
  houses: readonly HouseSpec[];
  maxLamps: number;
};

export const DEFAULT_VILLAGE_RULES: VillageRules = { base: VILLAGE_MAP, houses: VILLAGE_HOUSES, maxLamps: MAX_LAMP_POSTS };

export type VillageEditResult =
  | { ok: true; map: readonly string[]; changed: boolean }
  | { ok: false; reason: string };

export const REFUSALS = {
  offMap: 'That spot is off the map.',
  unknown: "That tile isn't in the palette.",
  house: 'The houses stay where they are for now.',
  doorstep: 'Keep the doorstep clear so people can get home.',
  gate: 'Visitors come and go through here. Leave the road open.',
  spawn: 'Keep the middle clear. That is where everyone starts.',
  sealed: 'That would wall someone in.',
  pocket: 'Nobody could get there yet. Start from the edge.',
  lamps: `That is plenty of lamp posts (${MAX_LAMP_POSTS} at most).`,
} as const;

type Size = { cols: number; rows: number };
const sizeOf = (map: readonly string[]): Size => ({ rows: map.length, cols: map[0]?.length ?? 0 });

function underHouse(houses: readonly HouseSpec[], col: number, row: number): boolean {
  return houses.some((h) => col >= h.col0 && col <= h.col1 && row >= h.row0 && row <= h.row1);
}

function isDoorstep(houses: readonly HouseSpec[], col: number, row: number): boolean {
  return houses.some((h) =>
    h.door.at.some((i) => {
      const [c, r] =
        h.door.side === 'north' ? [i, h.row0 - 1] :
        h.door.side === 'south' ? [i, h.row1 + 1] :
        h.door.side === 'west' ? [h.col0 - 1, i] : [h.col1 + 1, i];
      return c === col && r === row;
    })
  );
}

/** Why this cell can't be painted at all, or null if it can. */
export function protectedReason(col: number, row: number, rules: VillageRules = DEFAULT_VILLAGE_RULES): string | null {
  const { cols, rows } = sizeOf(rules.base);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows) {
    return REFUSALS.offMap;
  }
  if (underHouse(rules.houses, col, row)) return REFUSALS.house;
  if (isDoorstep(rules.houses, col, row)) return REFUSALS.doorstep;
  const rim = col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
  if (rim && rules.base[row]![col] === '=') return REFUSALS.gate;
  return null;
}

/** The cells around the map's centre (the world origin), where characters first stand. */
export function spawnCells(rules: VillageRules = DEFAULT_VILLAGE_RULES): { col: number; row: number }[] {
  const { cols, rows } = sizeOf(rules.base);
  const c1 = Math.floor(cols / 2), r1 = Math.floor(rows / 2);
  const c0 = Math.max(0, Math.ceil(cols / 2) - 1), r0 = Math.max(0, Math.ceil(rows / 2) - 1);
  const out: { col: number; row: number }[] = [];
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) out.push({ col, row });
  return out;
}

/** 1 = blocked (a solid tile or a house), 0 = walkable; index = row * cols + col. */
function blockedGrid(map: readonly string[], rules: VillageRules): Uint8Array {
  const { cols, rows } = sizeOf(rules.base);
  const grid = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isBlockedTile(map[row]![col]!) || underHouse(rules.houses, col, row)) grid[row * cols + col] = 1;
    }
  }
  return grid;
}

/**
 * A walkable cell that can't be reached from the centre, or null when every one can (the same
 * four-way flood fill blockWorld.test.ts uses; paths never cut a blocked corner, so it matches
 * what the pathfinder can do).
 */
export function findSealedCell(
  map: readonly string[],
  rules: VillageRules = DEFAULT_VILLAGE_RULES
): { col: number; row: number } | null {
  const { cols, rows } = sizeOf(rules.base);
  const blocked = blockedGrid(map, rules);
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  for (const { col, row } of spawnCells(rules)) {
    const i = row * cols + col;
    if (!blocked[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % cols, r = Math.floor(i / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (seen[ni] || blocked[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  for (let i = 0; i < seen.length; i++) {
    if (!blocked[i] && !seen[i]) return { col: i % cols, row: Math.floor(i / cols) };
  }
  return null;
}

export function countTile(map: readonly string[], tile: string): number {
  let n = 0;
  for (const row of map) for (const t of row) if (t === tile) n++;
  return n;
}

/** Rules that look at the whole map (not at one cell): a refusal, or null when it is fine. */
function wholeMapProblem(map: readonly string[], rules: VillageRules): string | null {
  for (const { col, row } of spawnCells(rules)) {
    if (isBlockedTile(map[row]![col]!)) return REFUSALS.spawn;
  }
  if (countTile(map, 'L') > rules.maxLamps) return REFUSALS.lamps;
  if (findSealedCell(map, rules)) return REFUSALS.sealed;
  return null;
}

/**
 * Paint one cell. Returns the new map (the same array when nothing changed), or a friendly
 * reason why not. Never changes `map`.
 */
export function applyVillageEdit(
  map: readonly string[],
  col: number,
  row: number,
  tile: string,
  rules: VillageRules = DEFAULT_VILLAGE_RULES
): VillageEditResult {
  const locked = protectedReason(col, row, rules);
  if (locked) return { ok: false, reason: locked };
  if (!isKnownTile(tile)) return { ok: false, reason: REFUSALS.unknown };
  const before = map[row]![col]!;
  if (before === tile) return { ok: true, map, changed: false };

  const solid = isBlockedTile(tile);
  if (solid && spawnCells(rules).some((c) => c.col === col && c.row === row)) return { ok: false, reason: REFUSALS.spawn };
  if (tile === 'L' && countTile(map, 'L') >= rules.maxLamps) return { ok: false, reason: REFUSALS.lamps };

  const next = map.slice();
  next[row] = map[row]!.slice(0, col) + tile + map[row]!.slice(col + 1);
  // Walkability changed either way: solid can cut an area off, open ground can be a new island.
  if (solid !== isBlockedTile(before) && findSealedCell(next, rules)) {
    return { ok: false, reason: solid ? REFUSALS.sealed : REFUSALS.pocket };
  }
  return { ok: true, map: next, changed: true };
}

/**
 * Check a map from storage or a backup file: the right size, known tiles only, protected cells
 * as built, and every whole-map rule. Returns a clean copy, or null on any problem.
 */
export function parseVillageMap(raw: unknown, rules: VillageRules = DEFAULT_VILLAGE_RULES): string[] | null {
  const { cols, rows } = sizeOf(rules.base);
  if (!Array.isArray(raw) || raw.length !== rows) return null;
  const map: string[] = [];
  for (let row = 0; row < rows; row++) {
    const line: unknown = raw[row];
    if (typeof line !== 'string' || line.length !== cols) return null;
    for (let col = 0; col < cols; col++) {
      const t = line[col]!;
      if (!isKnownTile(t)) return null;
      if (t !== rules.base[row]![col] && protectedReason(col, row, rules)) return null;
    }
    map.push(line);
  }
  return wholeMapProblem(map, rules) ? null : map;
}

export function sameVillageMap(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i]);
}

/** Grid cells on the straight line from a to b, both ends included (so a fast drag leaves no gaps). */
export function cellsBetween(
  a: { col: number; row: number },
  b: { col: number; row: number }
): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  let { col, row } = a;
  const dc = Math.abs(b.col - col), dr = Math.abs(b.row - row);
  const sc = col < b.col ? 1 : -1, sr = row < b.row ? 1 : -1;
  let err = dc - dr;
  for (let guard = 0; guard <= dc + dr; guard++) {
    out.push({ col, row });
    if (col === b.col && row === b.row) break;
    const e2 = err * 2;
    if (e2 > -dr) {
      err -= dr;
      col += sc;
    }
    if (e2 < dc) {
      err += dc;
      row += sr;
    }
  }
  return out;
}
