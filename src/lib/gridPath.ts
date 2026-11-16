/**
 * Walkability grid and A* pathfinding on the XZ plane. Pure (no three.js) so it runs in unit tests.
 *
 * The grid is a set of square cells; a cell is either walkable or blocked. Paths are found
 * cell-to-cell with A* (8 directions, no cutting past a blocked corner) and then shortened by
 * dropping waypoints that have a clear straight line between them, so characters walk in straight
 * lines across open ground and only turn at corners.
 */

export type GridXZ = { x: number; z: number };

export type NavGrid = {
  cols: number;
  rows: number;
  /** World X/Z of the grid's minimum corner (cell 0,0 starts here). */
  originX: number;
  originZ: number;
  cellSize: number;
  /** 1 = blocked, 0 = walkable; index = row * cols + col. */
  blocked: Uint8Array;
};

export function createNavGrid(
  cols: number,
  rows: number,
  originX: number,
  originZ: number,
  cellSize = 1
): NavGrid {
  return { cols, rows, originX, originZ, cellSize, blocked: new Uint8Array(cols * rows) };
}

export function inBounds(grid: NavGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

export function setBlocked(grid: NavGrid, col: number, row: number, blocked = true): void {
  if (inBounds(grid, col, row)) grid.blocked[row * grid.cols + col] = blocked ? 1 : 0;
}

/** Walkable cell? Cells outside the grid count as blocked. */
export function isCellWalkable(grid: NavGrid, col: number, row: number): boolean {
  return inBounds(grid, col, row) && grid.blocked[row * grid.cols + col] === 0;
}

export function cellAt(grid: NavGrid, p: GridXZ): { col: number; row: number } {
  return {
    col: Math.floor((p.x - grid.originX) / grid.cellSize),
    row: Math.floor((p.z - grid.originZ) / grid.cellSize),
  };
}

export function cellCenter(grid: NavGrid, col: number, row: number): GridXZ {
  return {
    x: grid.originX + (col + 0.5) * grid.cellSize,
    z: grid.originZ + (row + 0.5) * grid.cellSize,
  };
}

export function isWalkableAt(grid: NavGrid, p: GridXZ): boolean {
  const { col, row } = cellAt(grid, p);
  return isCellWalkable(grid, col, row);
}

/**
 * Walkable with `radius` of clearance: the point and the four points `radius` away along X and Z
 * are all on walkable cells. Keeps a character's body out of walls, not just its center.
 */
export function isClearAt(grid: NavGrid, p: GridXZ, radius: number): boolean {
  if (!isWalkableAt(grid, p)) return false;
  if (radius <= 0) return true;
  return (
    isWalkableAt(grid, { x: p.x + radius, z: p.z }) &&
    isWalkableAt(grid, { x: p.x - radius, z: p.z }) &&
    isWalkableAt(grid, { x: p.x, z: p.z + radius }) &&
    isWalkableAt(grid, { x: p.x, z: p.z - radius })
  );
}

/** True if a body of `radius` can walk the straight segment a→b without touching a blocked cell. */
export function hasClearLine(grid: NavGrid, a: GridXZ, b: GridXZ, radius = 0): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const step = grid.cellSize * 0.1;
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isClearAt(grid, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, radius)) return false;
  }
  return true;
}

/** Nearest walkable cell center to `p` (searching outward ring by ring), or null if none. */
export function nearestWalkable(grid: NavGrid, p: GridXZ, maxRings = Math.max(grid.cols, grid.rows)): GridXZ | null {
  const { col, row } = cellAt(grid, p);
  if (isCellWalkable(grid, col, row)) return cellCenter(grid, col, row);
  for (let ring = 1; ring <= maxRings; ring++) {
    let best: GridXZ | null = null;
    let bestDist = Infinity;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        if (!isCellWalkable(grid, col + dc, row + dr)) continue;
        const c = cellCenter(grid, col + dc, row + dr);
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Binary min-heap of cell indices keyed by f-score. */
class OpenHeap {
  private items: number[] = [];
  constructor(private readonly f: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.f[a[p]!]! <= this.f[a[k]!]!) break;
      [a[p], a[k]] = [a[k]!, a[p]!];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.f[a[l]!]! < this.f[a[m]!]!) m = l;
        if (r < a.length && this.f[a[r]!]! < this.f[a[m]!]!) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k]!, a[m]!];
        k = m;
      }
    }
    return top;
  }
}

/** A* over cells. Returns the cell indices from start to goal (inclusive), or null. */
function astarCells(grid: NavGrid, start: number, goal: number): number[] | null {
  const n = grid.cols * grid.rows;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % grid.cols;
  const gr = Math.floor(goal / grid.cols);
  const h = (i: number) => {
    const dc = Math.abs((i % grid.cols) - gc);
    const dr = Math.abs(Math.floor(i / grid.cols) - gr);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr); // octile distance
  };
  const open = new OpenHeap(f);
  g[start] = 0;
  f[start] = h(start);
  open.push(start);
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      const out: number[] = [];
      for (let i = cur; i !== -1; i = came[i]!) out.push(i);
      return out.reverse();
    }
    closed[cur] = 1;
    const cc = cur % grid.cols;
    const cr = Math.floor(cur / grid.cols);
    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!isCellWalkable(grid, nc, nr)) continue;
      // No diagonal squeeze past a blocked corner.
      if (dc !== 0 && dr !== 0 && (!isCellWalkable(grid, cc + dc, cr) || !isCellWalkable(grid, cc, cr + dr))) continue;
      const ni = nr * grid.cols + nc;
      if (closed[ni]) continue;
      const tentative = g[cur]! + cost;
      if (tentative < g[ni]!) {
        g[ni] = tentative;
        f[ni] = tentative + h(ni);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
}

/** Drop waypoints that a straight walk can skip ("string pulling"). */
export function smoothPath(grid: NavGrid, points: GridXZ[], radius = 0): GridXZ[] {
  if (points.length <= 2) return points.slice();
  const out: GridXZ[] = [points[0]!];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let j = points.length - 1; j > anchor + 1; j--) {
      if (hasClearLine(grid, points[anchor]!, points[j]!, radius)) {
        next = j;
        break;
      }
    }
    out.push(points[next]!);
    anchor = next;
  }
  return out;
}

export type FindPathOptions = {
  /** Body clearance used when straightening the path (world units). */
  radius?: number;
};

/**
 * Waypoints from `from` to `to`, excluding `from` and ending exactly at `to`.
 * If `to` is blocked, the path ends at the nearest walkable cell to it instead.
 * Returns [] when already there, null when unreachable or `from` is off the grid.
 */
export function findPath(grid: NavGrid, from: GridXZ, to: GridXZ, opts: FindPathOptions = {}): GridXZ[] | null {
  const radius = opts.radius ?? 0;
  let goal: GridXZ = to;
  if (!isWalkableAt(grid, goal)) {
    const near = nearestWalkable(grid, goal);
    if (!near) return null;
    goal = near;
  }
  if (Math.hypot(goal.x - from.x, goal.z - from.z) < 1e-6) return [];

  let startCell = cellAt(grid, from);
  if (!isCellWalkable(grid, startCell.col, startCell.row)) {
    // Standing in a wall (e.g. spawned or dropped there): path out from the nearest open cell.
    const near = nearestWalkable(grid, from);
    if (!near) return null;
    startCell = cellAt(grid, near);
  }
  const goalCell = cellAt(grid, goal);
  const start = startCell.row * grid.cols + startCell.col;
  const end = goalCell.row * grid.cols + goalCell.col;

  if (start === end || hasClearLine(grid, from, goal, radius)) return [goal];

  const cells = astarCells(grid, start, end);
  if (!cells) return null;
  // Cell centers, with the real endpoints swapped in for the first and last cell.
  const pts: GridXZ[] = cells.map((i) => cellCenter(grid, i % grid.cols, Math.floor(i / grid.cols)));
  pts[0] = { x: from.x, z: from.z };
  pts[pts.length - 1] = goal;
  return smoothPath(grid, pts, radius).slice(1);
}

/** Total length of walking `from` through `points`. */
export function pathLength(from: GridXZ, points: readonly GridXZ[]): number {
  let len = 0;
  let prev = from;
  for (const p of points) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return len;
}
