/**
 * Background decoration props: static .glb models exported from Minecraft
 * schematics by scripts/export_schem_props.py (1 block = 1 unit, origin at
 * bottom-center). Placement lives in PROP_LAYOUT below.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type PropPlacement = {
  name: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
};

// Character stands at the origin, facing +Z (toward the default camera).
// Keep props behind/beside it so they frame without blocking the view.
const PROP_LAYOUT: PropPlacement[] = [
  { name: 'barrels-azure-quiver-x44-z128', position: [-5.5, 0, -4], rotationY: 0.4 },
  { name: 'boxes-brave-kelp-x170-z86', position: [5.5, 0, -4], rotationY: -0.5 },
  { name: 'chests-amber-crane-x380-z65', position: [1.5, 0, -12], rotationY: 0.1, scale: 0.7 },
  { name: 'vegetation-azure-walnut-x355-z33', position: [-9, 0, -9], rotationY: 0.3 },
  { name: 'vegetation-calm-grove-x334-z12', position: [10, 0, -10], rotationY: -0.4 }
];

export async function addProps(scene: THREE.Scene): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);
  const loader = new GLTFLoader();

  await Promise.all(
    PROP_LAYOUT.map(async (p) => {
      try {
        const gltf = await loader.loadAsync(`props/${p.name}.glb`);
        const obj = gltf.scene;
        obj.position.set(...p.position);
        obj.rotation.y = p.rotationY ?? 0;
        obj.scale.setScalar(p.scale ?? 1);
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Exported geometry is non-indexed quads, so this yields flat face normals.
          if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Shading is baked into vertex colors (Minecraft face shade); a matte
          // Lambert keeps that look while still reacting to scene lights.
          const src = mesh.material as THREE.MeshStandardMaterial;
          const map = src.map;
          if (map) {
            map.magFilter = THREE.NearestFilter;
            map.minFilter = THREE.NearestFilter;
            map.generateMipmaps = false;
            map.colorSpace = THREE.SRGBColorSpace;
          }
          mesh.material = new THREE.MeshLambertMaterial({
            map,
            vertexColors: true,
            alphaTest: 0.1,
            // Scene fog is a fixed dark color that doesn't follow the sky theme,
            // so props sitting in its range would go murky.
            fog: false,
            side: THREE.DoubleSide
          });
        });
        group.add(obj);
      } catch (err) {
        console.warn(`[props] failed to load ${p.name}`, err);
      }
    })
  );
  return group;
}
