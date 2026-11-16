/**
 * Draws a BlockWorld (domain/blockWorld.ts): one InstancedMesh per block kind, sharing a unit box
 * and a small pixel-noise texture so flat colors read as blocks. Our own colors and procedural
 * texture, no game textures (see docs/ATTRIBUTION-ASSESSMENT.md).
 */
import * as THREE from 'three';
import type { BlockKind, BlockWorld } from '../domain/blockWorld';

type KindStyle = {
  color: number;
  /** ± random brightness per block, so a field of grass isn't one flat color. */
  jitter?: number;
  opacity?: number;
  emissive?: number;
  castShadow?: boolean;
  /** Skip the noise texture (water, glass, lamp). */
  smooth?: boolean;
};

const STYLES: Record<BlockKind, KindStyle> = {
  grass: { color: 0x6fae4a, jitter: 0.06 },
  dirt: { color: 0x8a5d3b, jitter: 0.05 },
  path: { color: 0xb59466, jitter: 0.05 },
  stone: { color: 0x9a9a9a, jitter: 0.06 },
  sand: { color: 0xe0d29a, jitter: 0.04 },
  soil: { color: 0x5e3f28, jitter: 0.04 },
  water: { color: 0x3f7fd6, opacity: 0.8, smooth: true },
  planks: { color: 0xb8894f, jitter: 0.04, castShadow: true },
  birch: { color: 0xddd3b8, jitter: 0.03, castShadow: true },
  brick: { color: 0xa0523f, jitter: 0.05, castShadow: true },
  log: { color: 0x6b4a2b, jitter: 0.04, castShadow: true },
  cobble: { color: 0x7d7d7d, jitter: 0.08, castShadow: true },
  glass: { color: 0xbfe3ff, opacity: 0.45, smooth: true },
  door: { color: 0x7a5230, castShadow: true },
  roofRed: { color: 0xa63a32, jitter: 0.04, castShadow: true },
  roofBlue: { color: 0x3d5f9e, jitter: 0.04, castShadow: true },
  roofGreen: { color: 0x3f7a4c, jitter: 0.04, castShadow: true },
  leaves: { color: 0x3f8a36, jitter: 0.1, castShadow: true },
  crop: { color: 0xc9b14a, jitter: 0.1 },
  flowerRed: { color: 0xe0413a, smooth: true },
  flowerYellow: { color: 0xf2d43a, smooth: true },
  stem: { color: 0x3c7a2a, smooth: true },
  fence: { color: 0x8a6438, jitter: 0.03, castShadow: true },
  lamp: { color: 0xffd98a, emissive: 0xffc860, smooth: true },
};

/** Cheap deterministic hash in [0, 1) from a position. */
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** 16×16 grayscale speckle, nearest-filtered: the "pixel art" look on every block face. */
function createNoiseTexture(): THREE.Texture {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(255 * (0.82 + 0.18 * hash3(x, y, 7)));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const BLOCK_WORLD_NAME = 'block-world';

/** Build the scene group for `world`. Call `dispose` on the result's userData when removing it. */
export function createBlockWorldMesh(world: BlockWorld): THREE.Group {
  const group = new THREE.Group();
  group.name = BLOCK_WORLD_NAME;

  const byKind = new Map<BlockKind, typeof world.blocks>();
  for (const b of world.blocks) {
    let list = byKind.get(b.kind);
    if (!list) byKind.set(b.kind, (list = []));
    list.push(b);
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const noise = createNoiseTexture();
  const disposables: { dispose(): void }[] = [geometry, noise];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  for (const [kind, blocks] of byKind) {
    const style = STYLES[kind];
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: style.smooth ? null : noise,
      roughness: kind === 'water' || kind === 'glass' ? 0.2 : 0.95,
      metalness: 0,
      transparent: style.opacity !== undefined,
      opacity: style.opacity ?? 1,
      depthWrite: style.opacity === undefined,
      emissive: style.emissive ?? 0x000000,
      emissiveIntensity: style.emissive ? 1.2 : 0,
    });
    disposables.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
    mesh.name = `block-world-${kind}`;
    blocks.forEach((b, i) => {
      pos.set(b.x, b.y, b.z);
      scale.set(b.sx, b.sy, b.sz);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
      const j = style.jitter ?? 0;
      color.setHex(style.color).multiplyScalar(1 + (hash3(b.x, b.y, b.z) * 2 - 1) * j);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = style.castShadow ?? false;
    mesh.receiveShadow = style.opacity === undefined;
    // Instances span the whole map; the default bounding sphere is the unit box's.
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  group.userData.dispose = () => disposables.forEach((d) => d.dispose());
  return group;
}
