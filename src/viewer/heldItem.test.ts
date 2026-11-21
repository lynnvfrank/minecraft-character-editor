import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachHeldItem, findHandBone, heldItemIdOf, hideHeldItems, HELD_ITEM_NAME, HELD_ITEM_PIXEL_SIZE } from './heldItem';
import { getHeldItem } from '../domain/heldItems';

/** Shaped like the bundled rig: model at 0.01, armature scaled ~62, forearm end bone. */
function fakeRig() {
  const container = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(0.01);
  container.add(model);
  const armature = new THREE.Bone();
  armature.name = 'BonesCharacter';
  armature.scale.setScalar(62.04);
  model.add(armature);
  const lower = new THREE.Bone();
  lower.name = 'ArmRightLower';
  armature.add(lower);
  const end = new THREE.Bone();
  end.name = 'ArmRightLower_end';
  lower.add(end);
  const left = new THREE.Bone();
  left.name = 'ArmLeftLower_end';
  armature.add(left);
  return { container, model, end };
}

describe('held item in 3D', () => {
  test('finds the right forearm end on the bundled-style rig', () => {
    const { model, end } = fakeRig();
    assert.equal(findHandBone(model)?.bone, end);
    assert.equal(findHandBone(new THREE.Group()), null);
  });

  test('attach sizes the item in world units regardless of bone scale, and replaces cleanly', () => {
    const { container, model, end } = fakeRig();
    container.scale.setScalar(2);
    assert.ok(attachHeldItem(model, getHeldItem('torch'), container));
    assert.equal(heldItemIdOf(model), 'torch');
    const holder = end.children.find((c) => c.name === HELD_ITEM_NAME)!;
    container.updateMatrixWorld(true);
    const s = holder.getWorldScale(new THREE.Vector3());
    assert.ok(Math.abs(s.x - HELD_ITEM_PIXEL_SIZE * 2) < 1e-9, String(s.x));

    attachHeldItem(model, getHeldItem('flag'), container);
    assert.equal(end.children.filter((c) => c.name === HELD_ITEM_NAME).length, 1);
    assert.equal(heldItemIdOf(model), 'flag');

    const restore = hideHeldItems(container);
    assert.equal(end.children.find((c) => c.name === HELD_ITEM_NAME)!.visible, false);
    restore();
    assert.equal(end.children.find((c) => c.name === HELD_ITEM_NAME)!.visible, true);

    attachHeldItem(model, null);
    assert.equal(end.children.length, 0);
    assert.equal(heldItemIdOf(model), null);
  });

  test('a rig with no hand bone holds nothing', () => {
    assert.equal(attachHeldItem(new THREE.Group(), getHeldItem('torch')), false);
  });

  test('skin application cannot put a texture on an item', () => {
    const { container, model } = fakeRig();
    attachHeldItem(model, getHeldItem('torch'), container);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      (mesh.material as THREE.MeshBasicMaterial).map = new THREE.Texture();
      assert.equal((mesh.material as THREE.MeshBasicMaterial).map, null);
    });
  });
});
