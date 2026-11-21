/**
 * Held items in 3D: builds an item from the catalogue (domain/heldItems.ts) and hangs it on a
 * character's right hand. The item is a child of the hand bone, so it follows every animation
 * by itself.
 *
 * Bone: the best match by name (see classifyHandBone). The bundled rigs have no hand bone; theirs
 * is `ArmRightLower_end`, the tip of the right forearm. With no match nothing is attached.
 *
 * Scale: bones carry the rig's scale (the FBX is scaled by 0.01 and its armature by ~62), so the
 * holder group is given the inverse of the bone's scale relative to the character's root. Inside
 * it one unit is one skin pixel, whatever the rig.
 *
 * Materials: skin application walks every mesh under the model and sets `material.map`; the item
 * materials ignore that (see `ignoreSkinMap`), so an item keeps its own colours through skin changes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { classifyHandBone, type HandBoneKind, type HeldItem, type HeldItemBox } from '../domain/heldItems';
import { logger } from '../lib';

/** Name of the group added under the hand bone (captures look it up to hide items). */
export const HELD_ITEM_NAME = 'held-item';

/**
 * World size of one item unit (one skin pixel) on a character at scale 1: the 32-pixel-tall rig
 * stands about 2.01 units high. Raise to make every item bigger.
 */
export const HELD_ITEM_PIXEL_SIZE = 2.01 / 32;

/**
 * Hand space (+Y toward the shoulder, +Z forward) expressed in the bone's own axes. On the bundled
 * rigs the arm bones point down the arm (+Y) with +Z backward, so it is a half turn around X.
 * A rig whose items come out upside down or backward needs a different value here.
 */
const HAND_SPACE_IN_BONE = new THREE.Euler(Math.PI, 0, 0);

/**
 * Middle of the fist relative to the bone's origin, in hand space and skin pixels: the forearm's
 * end is the bottom of the arm (fist one pixel up), a forearm or arm bone starts at the elbow or
 * shoulder (fist further down the arm).
 */
const FIST_FROM_BONE: Record<HandBoneKind, readonly [number, number, number]> = {
  hand: [0, 0, 0],
  'forearm-end': [0, 1, 0],
  forearm: [0, -5, 0],
  arm: [0, -9, 0],
};

/** Brightness of glowing boxes by day and at full night (the renderer tone-maps values above 1). */
const GLOW_DAY = 1;
const GLOW_NIGHT = 1.7;

type Attached = { itemId: string; holder: THREE.Group; glow: THREE.MeshBasicMaterial | null };
const attachedByModel = new WeakMap<THREE.Object3D, Attached>();
let warnedNoBone = false;

/** The bone to hang an item from, or null. Prefers a hand, then the forearm's end, then the arm. */
export function findHandBone(model: THREE.Object3D): { bone: THREE.Object3D; kind: HandBoneKind } | null {
  let best: { bone: THREE.Object3D; kind: HandBoneKind; score: number } | null = null;
  model.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const match = classifyHandBone(obj.name);
    // `>=`: rigs can nest a bone inside a same-named one; the deeper (later) one carries the pose.
    if (match && (!best || match.score >= best.score)) best = { bone: obj, ...match };
  });
  return best;
}

/** Skin application must not put the skin texture on an item: make `map` read-only null. */
function ignoreSkinMap<T extends THREE.Material>(material: T): T {
  Object.defineProperty(material, 'map', { get: () => null, set: () => {}, configurable: true });
  return material;
}

function boxesGeometry(boxes: readonly HeldItemBox[]): THREE.BufferGeometry | null {
  if (boxes.length === 0) return null;
  const color = new THREE.Color();
  const parts = boxes.map((box) => {
    const geo = new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2]);
    geo.translate(box.at[0], box.at[1], box.at[2]);
    color.set(box.color);
    const count = geo.attributes.position!.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.deleteAttribute('uv');
    return geo;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

/**
 * An item as a group in item space (units: skin pixels, origin: the grip). At most two meshes:
 * the lit boxes and the glowing ones. `glow` is the glowing mesh's material, if any.
 */
export function buildHeldItem(item: HeldItem): { group: THREE.Group; glow: THREE.MeshBasicMaterial | null } {
  const group = new THREE.Group();
  group.name = `${HELD_ITEM_NAME}:${item.id}`;
  let glow: THREE.MeshBasicMaterial | null = null;

  const solid = boxesGeometry(item.boxes.filter((b) => !b.emissive));
  if (solid) {
    const mesh = new THREE.Mesh(solid, ignoreSkinMap(new THREE.MeshLambertMaterial({ vertexColors: true })));
    mesh.name = 'held-item-solid';
    mesh.castShadow = true;
    group.add(mesh);
  }
  const lit = boxesGeometry(item.boxes.filter((b) => b.emissive));
  if (lit) {
    glow = ignoreSkinMap(new THREE.MeshBasicMaterial({ vertexColors: true }));
    glow.color.setScalar(GLOW_DAY);
    const mesh = new THREE.Mesh(lit, glow);
    mesh.name = 'held-item-glow';
    group.add(mesh);
  }
  return { group, glow };
}

function disposeHolder(holder: THREE.Object3D): void {
  holder.removeFromParent();
  holder.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
}

/** Id of the item this model holds right now, or null. */
export function heldItemIdOf(model: THREE.Object3D): string | null {
  return attachedByModel.get(model)?.itemId ?? null;
}

/**
 * Put `item` in the right hand of `model` (null: empty the hand). Whatever it held before is
 * removed and disposed. `root` is the character's own root (its container): the item is sized
 * relative to it, so a scaled-up character gets a scaled-up item. Returns false when the rig has
 * no bone to hold with.
 */
export function attachHeldItem(model: THREE.Object3D, item: HeldItem | null, root: THREE.Object3D = model): boolean {
  const previous = attachedByModel.get(model);
  if (previous) {
    disposeHolder(previous.holder);
    attachedByModel.delete(model);
  }
  if (!item) return true;

  const found = findHandBone(model);
  if (!found) {
    if (!warnedNoBone) {
      warnedNoBone = true;
      logger.debug('general', 'Held item: no right-hand bone on this rig; nothing attached');
    }
    return false;
  }
  const { bone, kind } = found;

  // Undo the bone's scale (relative to the character's root) so one unit inside is one pixel.
  root.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(true, false);
  const boneScale = bone.getWorldScale(new THREE.Vector3());
  const rootScale = root.getWorldScale(new THREE.Vector3());
  const unit = (b: number, r: number) => (Math.abs(b) > 1e-9 ? (HELD_ITEM_PIXEL_SIZE * r) / b : 1);

  const holder = new THREE.Group();
  holder.name = HELD_ITEM_NAME;
  holder.scale.set(unit(boneScale.x, rootScale.x), unit(boneScale.y, rootScale.y), unit(boneScale.z, rootScale.z));

  const hand = new THREE.Group();
  hand.rotation.copy(HAND_SPACE_IN_BONE);
  const fist = FIST_FROM_BONE[kind];
  hand.position.set(fist[0], fist[1], fist[2]).applyEuler(HAND_SPACE_IN_BONE);

  const built = buildHeldItem(item);
  const deg = THREE.MathUtils.degToRad;
  built.group.position.set(item.grip.offset[0], item.grip.offset[1], item.grip.offset[2]);
  built.group.rotation.set(deg(item.grip.rotation[0]), deg(item.grip.rotation[1]), deg(item.grip.rotation[2]), 'ZYX');

  hand.add(built.group);
  holder.add(hand);
  bone.add(holder);
  attachedByModel.set(model, { itemId: item.id, holder, glow: built.glow });
  return true;
}

/** Brightness of the model's glowing boxes: 0 = day, 1 = full night. */
export function setHeldItemNight(model: THREE.Object3D, night: number): void {
  const glow = attachedByModel.get(model)?.glow;
  if (glow) glow.color.setScalar(GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * Math.min(1, Math.max(0, night)));
}

/**
 * Hide every held item in `scene` and return a function that shows them again (for captures that
 * should show the bare character).
 */
export function hideHeldItems(scene: THREE.Object3D): () => void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj.name === HELD_ITEM_NAME && obj.visible) hidden.push(obj);
  });
  hidden.forEach((o) => (o.visible = false));
  return () => hidden.forEach((o) => (o.visible = true));
}
