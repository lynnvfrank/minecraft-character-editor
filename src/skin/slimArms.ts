/**
 * Derive slim ("Alex", 3px) arms from the classic ("Steve", 4px) rig at load time.
 *
 * Why not a separate FBX: Blender's FBX importer misplaces the 2nd-layer overlay of
 * RunningboyRig.fbx, so a Blender-built slim rig rendered the jacket/sleeves/pants
 * far below the body. Three.js reads the classic rig correctly, so we edit its
 * geometry here instead.
 *
 * Two edits on arm vertices (identified by dominant bone weight):
 *  1. Position: compress the body-outward axis toward the shoulder by 3/4.
 *  2. UV: remap each arm face from the classic layout to the exact slim layout,
 *     so real slim skins line up pixel-for-pixel.
 */

export type ArmSide = 'L' | 'R';

/** Skin-pixel origin of each arm's 16×16 block in the 64×64 layout. */
export const ARM_UV_ORIGINS: Record<'base' | 'overlay', Record<ArmSide, { x: number; y: number }>> = {
  base: { R: { x: 40, y: 16 }, L: { x: 32, y: 48 } },
  overlay: { R: { x: 40, y: 32 }, L: { x: 48, y: 48 } },
};

/** [classicStart, classicEnd, slimStart, slimEnd] in pixels relative to the arm block origin. */
type URange = readonly [number, number, number, number];

/** Top row band (y 0–4): top and bottom caps. */
const CAP_FACES: readonly URange[] = [
  [4, 8, 4, 7], // top
  [8, 12, 7, 10], // bottom
];
/** Side band (y 4–16): right, front, left, back. */
const SIDE_FACES: readonly URange[] = [
  [0, 4, 0, 4], // right (depth face, width unchanged)
  [4, 8, 4, 7], // front
  [8, 12, 7, 11], // left (depth face, shifted)
  [12, 16, 11, 14], // back
];

/** Map a classic-layout u (pixels, relative to block) using the face that contains `centroidU`. */
export function remapArmU(u: number, centroidU: number, centroidV: number): number {
  const faces = centroidV < 4 ? CAP_FACES : SIDE_FACES;
  const face = faces.find(([a, b]) => centroidU >= a && centroidU <= b);
  if (!face) return u;
  const [a, b, sa, sb] = face;
  return sa + ((u - a) / (b - a)) * (sb - sa);
}

export type SlimArmsInput = {
  /** xyz per vertex, non-indexed triangles (FBXLoader output). Modified in place. */
  positions: { count: number; getX(i: number): number; setX(i: number, x: number): void };
  /** uv per vertex, u = x/64, v = 1 - y/64. Modified in place. */
  uvs: { getX(i: number): number; getY(i: number): number; setX(i: number, u: number): void };
  /** Which arm a vertex belongs to (dominant bone), or null. */
  armSideOf: (i: number) => ArmSide | null;
  /** Overlay (2nd layer) mesh uses the sleeve UV blocks. */
  overlay: boolean;
  /** Slim width factor (3/4). */
  factor?: number;
};

/** Apply slim arms to a non-indexed triangle mesh's attributes. Returns arm vertex count. */
export function applySlimArms({ positions, uvs, armSideOf, overlay, factor = 3 / 4 }: SlimArmsInput): number {
  const sides: (ArmSide | null)[] = [];
  const inner: Record<ArmSide, number> = { L: Infinity, R: Infinity };
  for (let i = 0; i < positions.count; i++) {
    const side = armSideOf(i);
    sides.push(side);
    if (side) inner[side] = Math.min(inner[side], Math.abs(positions.getX(i)));
  }

  // 1. UVs, per triangle so shared-edge u values map with their own face.
  const origins = ARM_UV_ORIGINS[overlay ? 'overlay' : 'base'];
  for (let t = 0; t + 2 < positions.count; t += 3) {
    const side = sides[t];
    if (!side || sides[t + 1] !== side || sides[t + 2] !== side) continue;
    const o = origins[side];
    let cu = 0;
    let cv = 0;
    for (let k = 0; k < 3; k++) {
      cu += uvs.getX(t + k) * 64 - o.x;
      cv += (1 - uvs.getY(t + k)) * 64 - o.y;
    }
    cu /= 3;
    cv /= 3;
    if (cu < 0 || cu > 16 || cv < 0 || cv > 16) continue; // not this arm's block
    for (let k = 0; k < 3; k++) {
      const u = uvs.getX(t + k) * 64 - o.x;
      uvs.setX(t + k, (o.x + remapArmU(u, cu, cv)) / 64);
    }
  }

  // 2. Positions: compress outward from the shoulder edge.
  let n = 0;
  for (let i = 0; i < positions.count; i++) {
    const side = sides[i];
    if (!side) continue;
    const x = positions.getX(i);
    const sign = Math.sign(x) || 1;
    const edge = inner[side] * sign;
    positions.setX(i, edge + (x - edge) * factor);
    n++;
  }
  return n;
}
