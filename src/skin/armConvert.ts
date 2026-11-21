/**
 * Convert a 64x64 skin's arm textures between classic (4px, "Steve") and slim (3px, "Alex").
 *
 * Arms are the only part whose texture layout differs between the two models: the front, back
 * and caps are 4 or 3 pixels wide, and the faces after them shift left. So that any outfit fits
 * the arm shape a person chose, the arm blocks are rebuilt in the other layout: classic to slim
 * keeps columns 0, 1 and 3 of each 4-wide face (drops one inner column); slim to classic repeats
 * the middle column. Sides (4px deep) are copied as they are. Pure; RGBA, 64 pixels wide.
 */
import type { ArmModel } from './armModel';

/** Origins of each arm's 16x16 block, base and overlay layers, both arms. */
const ARM_BLOCKS: readonly { x: number; y: number }[] = [
  { x: 40, y: 16 }, // right arm
  { x: 40, y: 32 }, // right sleeve
  { x: 32, y: 48 }, // left arm
  { x: 48, y: 48 }, // left sleeve
];

type Face = { y0: number; h: number; classic: [number, number]; slim: [number, number] };

/** Faces as [start, width] per layout, relative to the block origin. */
const FACES: readonly Face[] = [
  { y0: 0, h: 4, classic: [4, 4], slim: [4, 3] }, // top cap
  { y0: 0, h: 4, classic: [8, 4], slim: [7, 3] }, // bottom cap
  { y0: 4, h: 12, classic: [0, 4], slim: [0, 4] }, // right side
  { y0: 4, h: 12, classic: [4, 4], slim: [4, 3] }, // front
  { y0: 4, h: 12, classic: [8, 4], slim: [7, 4] }, // left side
  { y0: 4, h: 12, classic: [12, 4], slim: [11, 3] }, // back
];

/** Which source column feeds each destination column when a face changes width. */
function columnMap(from: number, to: number): number[] {
  if (from === to) return Array.from({ length: to }, (_, i) => i);
  if (from === 4 && to === 3) return [0, 1, 3];
  return [0, 1, 1, 2]; // 3 -> 4: repeat the middle
}

/**
 * A copy of `data` (64x64, `stride` values per pixel: 4 for RGBA, 1 for a feature map) with the
 * arm blocks rebuilt for `to`; `from` is the current layout.
 */
export function convertArmLayout<T extends Uint8ClampedArray | Uint8Array>(data: T, from: ArmModel, to: ArmModel, stride = 4): T {
  const out = data.slice() as T;
  if (from === to) return out;
  for (const block of ARM_BLOCKS) {
    // Clear the block, then lay each face back in at its new place and width.
    for (let y = 0; y < 16; y++) out.fill(0, ((block.y + y) * 64 + block.x) * stride, ((block.y + y) * 64 + block.x + 16) * stride);
    for (const face of FACES) {
      const [sx, sw] = face[from];
      const [dx, dw] = face[to];
      const cols = columnMap(sw, dw);
      for (let y = face.y0; y < face.y0 + face.h; y++) {
        for (let i = 0; i < dw; i++) {
          const src = ((block.y + y) * 64 + block.x + sx + cols[i]!) * stride;
          const dst = ((block.y + y) * 64 + block.x + dx + i) * stride;
          out.set(data.subarray(src, src + stride), dst);
        }
      }
    }
  }
  return out;
}
