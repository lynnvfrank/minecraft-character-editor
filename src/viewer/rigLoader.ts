/**
 * Loads character rigs. A model path may carry a `#slim` suffix, meaning
 * "load this FBX and derive slim arms from it" (see skin/slimArms.ts).
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { applySlimArms, type ArmSide } from '../skin/slimArms';
import { logger } from '../lib';

export function parseRigPath(path: string): { file: string; slim: boolean } {
  const [file, frag] = path.split('#');
  return { file: file!, slim: frag === 'slim' };
}

function armSideFromBoneName(name: string): ArmSide | null {
  const n = name.toLowerCase();
  if (!n.includes('arm') && !n.includes('hand')) return null;
  if (n.includes('left')) return 'L';
  if (n.includes('right')) return 'R';
  return null;
}

/** Apply slim arms to every skinned mesh of a loaded classic rig. */
export function slimifyRig(model: THREE.Object3D): void {
  model.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const g = mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    const si = g.attributes.skinIndex as THREE.BufferAttribute | undefined;
    const sw = g.attributes.skinWeight as THREE.BufferAttribute | undefined;
    if (!uv || !si || !sw || g.index) return;

    const boneSides = mesh.skeleton.bones.map((b) => armSideFromBoneName(b.name));
    const armSideOf = (i: number): ArmSide | null => {
      let best = -1;
      let bw = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = si.getComponent(i, k);
        }
      }
      return best >= 0 ? boneSides[best] ?? null : null;
    };

    const n = applySlimArms({
      positions: pos,
      uvs: uv,
      armSideOf,
      overlay: /2nd/i.test(mesh.name),
    });
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    logger.debug('general', 'Slim arms applied', { mesh: mesh.name, armVertices: n });
  });
}

export function loadRig(
  path: string,
  onLoad: (model: THREE.Group) => void,
  onError?: (err: unknown) => void
): void {
  const { file, slim } = parseRigPath(path);
  new FBXLoader().load(
    file,
    (model) => {
      if (slim) slimifyRig(model);
      onLoad(model);
    },
    undefined,
    onError
  );
}
