/**
 * Retargets Quaternius' Universal Animation Library (CC0) onto the Running boy rig.
 *
 * Source: assets-src/animations/quaternius/UAL1_Standard.glb (UE-mannequin bone names, Y-up, metres,
 *         root motion disabled) plus clips.json, which picks the clips we ship and names them.
 * Target: the Running boy skeleton in public/models/RunningboyRig.fbx (Mixamo-style tracks:
 *         BonesCharacter.position + one quaternion track per bone). The slim rig shares the skeleton.
 *
 * Method: world-space rotation deltas. Both rigs are put in a T-pose reference (the UAL `A_TPose`
 * clip, and the Running boy bind pose with its arms raised), both face +Z with their left side on +X.
 * For every mapped bone and frame:  targetWorld = sourceWorld * sourceRef^-1 * targetRef,
 * then converted back to a local rotation under the target parent. The hip position is scaled by the
 * ratio of leg lengths so feet stay on the ground.
 *
 * The glTF is parsed by hand (it's just nodes + animation samplers) because three's GLTFLoader needs
 * a DOM for its texture/material path, and this runs in Node.
 */

import fs from 'fs';
import * as THREE from 'three';

const FPS = 30;

/** Target bone -> UAL source bone. Order matters: parents before children. */
const BONE_MAP = [
  ['BonesCharacter', 'pelvis'],
  ['Body', 'spine_01'],
  ['Chest', 'spine_03'],
  ['Head', 'Head'],
  ['ArmLeftUpper', 'upperarm_l'],
  ['ArmLeftLower', 'lowerarm_l'],
  ['ArmRightUpper', 'upperarm_r'],
  ['ArmRightLower', 'lowerarm_r'],
  ['LegLeftUpper', 'thigh_l'],
  ['LegLeftLower', 'calf_l'],
  ['LegRightUpper', 'thigh_r'],
  ['LegRightLower', 'calf_r'],
];

/** Running boy hierarchy for the animated bones (Bone011 is the hips; it stays at identity). */
const TARGET_PARENT = {
  BonesCharacter: null,
  Bone011: 'BonesCharacter',
  Body: 'Bone011',
  Chest: 'Body',
  Head: 'Chest',
  ArmLeftUpper: 'Chest',
  ArmLeftLower: 'ArmLeftUpper',
  ArmRightUpper: 'Chest',
  ArmRightLower: 'ArmRightUpper',
  LegLeftUpper: 'Bone011',
  LegLeftLower: 'LegLeftUpper',
  LegRightUpper: 'Bone011',
  LegRightLower: 'LegRightUpper',
};

// ---------------------------------------------------------------------------
// Minimal GLB reader
// ---------------------------------------------------------------------------

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + len;
  }
  const accessorCache = new Map();
  const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  function accessor(index) {
    if (accessorCache.has(index)) return accessorCache.get(index);
    const acc = json.accessors[index];
    if (acc.componentType !== 5126) throw new Error(`accessor ${index}: only float data is supported`);
    if (acc.sparse) throw new Error(`accessor ${index}: sparse accessors are not supported`);
    const n = COMPONENTS[acc.type];
    const view = json.bufferViews[acc.bufferView];
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride ?? n * 4;
    const out = new Float32Array(acc.count * n);
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < n; k++) out[i * n + k] = bin.readFloatLE(start + i * stride + k * 4);
    }
    accessorCache.set(index, out);
    return out;
  }
  return { json, accessor };
}

// ---------------------------------------------------------------------------
// Source (UAL) skeleton sampling
// ---------------------------------------------------------------------------

function buildSource(glb) {
  const { json } = glb;
  const nodes = json.nodes.map((n, i) => ({
    index: i,
    name: n.name,
    parent: -1,
    t: new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]),
    r: new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
    s: new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]),
  }));
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (nodes[c].parent = i)));
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const clips = new Map(json.animations.map((a) => [a.name, a]));
  return { nodes, byName, clips };
}

/** Channels of one glTF animation, keyed by node index -> { translation, rotation, scale }. */
function clipChannels(glb, anim) {
  const channels = new Map();
  let duration = 0;
  for (const ch of anim.channels) {
    const sampler = anim.samplers[ch.sampler];
    if (sampler.interpolation && sampler.interpolation !== 'LINEAR') {
      throw new Error(`${anim.name}: only LINEAR interpolation is supported`);
    }
    const times = glb.accessor(sampler.input);
    const values = glb.accessor(sampler.output);
    duration = Math.max(duration, times[times.length - 1]);
    const entry = channels.get(ch.target.node) ?? {};
    entry[ch.target.path] = { times, values };
    channels.set(ch.target.node, entry);
  }
  return { channels, duration };
}

function sampleChannel({ times, values }, t, size, out) {
  const last = times.length - 1;
  if (t <= times[0]) return out.fromArray(values, 0);
  if (t >= times[last]) return out.fromArray(values, last * size);
  let i = 1;
  while (times[i] < t) i++;
  const a = (t - times[i - 1]) / (times[i] - times[i - 1]);
  if (size === 4) {
    THREE.Quaternion.slerpFlat(_tmp4, 0, values, (i - 1) * 4, values, i * 4, a);
    return out.fromArray(_tmp4);
  }
  return out.fromArray(values, (i - 1) * size).lerp(_v3.fromArray(values, i * size), a);
}
const _tmp4 = [0, 0, 0, 1];
const _v3 = new THREE.Vector3();

/** World matrices of every source node at time t of a clip (unanimated nodes use their rest TRS). */
function sourcePose(src, chans, t) {
  const world = new Array(src.nodes.length);
  const tr = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const visit = (n) => {
    if (world[n.index]) return world[n.index];
    const parentWorld = n.parent >= 0 ? visit(src.nodes[n.parent]) : null; // before touching the scratch values
    const local = new THREE.Matrix4();
    const ch = chans.get(n.index);
    tr.copy(n.t);
    rot.copy(n.r);
    sc.copy(n.s);
    if (ch?.translation) sampleChannel(ch.translation, t, 3, tr);
    if (ch?.rotation) sampleChannel(ch.rotation, t, 4, rot);
    if (ch?.scale) sampleChannel(ch.scale, t, 3, sc);
    local.compose(tr, rot, sc);
    const m = parentWorld ? parentWorld.clone().multiply(local) : local;
    world[n.index] = m;
    return m;
  };
  src.nodes.forEach(visit);
  return world;
}

const worldQuat = (m) => {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return q;
};
const worldPos = (m) => new THREE.Vector3().setFromMatrixPosition(m);

// ---------------------------------------------------------------------------
// Target (Running boy) reference pose
// ---------------------------------------------------------------------------

/**
 * World rotations of the Running boy bones in a T-pose. The rig's bind pose has the arms hanging
 * down, so the arms are swung up 90 degrees about Z (left arm toward +X, right toward -X).
 */
function targetReference(rigGroup) {
  rigGroup.updateMatrixWorld(true);
  const ref = {};
  for (const name of Object.keys(TARGET_PARENT)) {
    const obj = rigGroup.getObjectByName(name);
    if (!obj) throw new Error(`Running boy rig has no "${name}" node`);
    ref[name] = obj.getWorldQuaternion(new THREE.Quaternion());
  }
  const up = (sign) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (sign * Math.PI) / 2);
  for (const n of ['ArmLeftUpper', 'ArmLeftLower']) ref[n].premultiply(up(1));
  for (const n of ['ArmRightUpper', 'ArmRightLower']) ref[n].premultiply(up(-1));

  const hip = rigGroup.getObjectByName('LegLeftUpper').getWorldPosition(new THREE.Vector3());
  const foot = rigGroup.getObjectByName('LegLeftLower_end').getWorldPosition(new THREE.Vector3());
  return { ref, legLength: hip.y - foot.y };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} glbPath  UAL1_Standard.glb
 * @param {{ source: string, key: string, label: string }[]} picks  clips to export
 * @param {THREE.Object3D} rigGroup  loaded RunningboyRig.fbx
 * @returns {THREE.AnimationClip[]}
 */
export function retargetUalClips(glbPath, picks, rigGroup) {
  const glb = parseGlb(fs.readFileSync(glbPath));
  const src = buildSource(glb);
  const { ref: tRef, legLength: tLeg } = targetReference(rigGroup);

  // Source T-pose reference (frame 0 of A_TPose).
  const tpose = src.clips.get('A_TPose');
  if (!tpose) throw new Error('UAL file has no A_TPose clip');
  const refWorld = sourcePose(src, clipChannels(glb, tpose).channels, 0);
  const sRefInv = {};
  for (const [, s] of BONE_MAP) {
    const node = src.byName.get(s);
    if (!node) throw new Error(`UAL file has no "${s}" bone`);
    sRefInv[s] = worldQuat(refWorld[node.index]).invert();
  }
  const thighL = src.byName.get('thigh_l').index;
  const thighR = src.byName.get('thigh_r').index;
  const ground = Math.min(
    worldPos(refWorld[src.byName.get('ball_leaf_l').index]).y,
    worldPos(refWorld[src.byName.get('foot_l').index]).y,
  );
  const sLeg = (worldPos(refWorld[thighL]).y + worldPos(refWorld[thighR]).y) / 2 - ground;
  const scale = tLeg / sLeg;

  const clips = [];
  for (const pick of picks) {
    const anim = src.clips.get(pick.source);
    if (!anim) throw new Error(`UAL file has no clip "${pick.source}"`);
    const { channels, duration } = clipChannels(glb, anim);
    const frames = Math.max(2, Math.round(duration * FPS) + 1);
    const times = new Float32Array(frames);
    const pos = new Float32Array(frames * 3);
    const quats = Object.fromEntries(Object.keys(TARGET_PARENT).map((n) => [n, new Float32Array(frames * 4)]));

    for (let f = 0; f < frames; f++) {
      const t = Math.min(duration, f / FPS);
      times[f] = t;
      const world = sourcePose(src, channels, t);
      const tWorld = { Bone011: null };
      for (const [tName, sName] of BONE_MAP) {
        const sq = worldQuat(world[src.byName.get(sName).index]);
        tWorld[tName] = sq.multiply(sRefInv[sName]).multiply(tRef[tName]);
      }
      tWorld.Bone011 = tWorld.BonesCharacter.clone();
      for (const name of Object.keys(TARGET_PARENT)) {
        const parent = TARGET_PARENT[name];
        const local = parent ? tWorld[parent].clone().invert().multiply(tWorld[name]) : tWorld[name].clone();
        local.normalize().toArray(quats[name], f * 4);
      }
      // Hip point = midpoint of the thighs, measured from the reference ground, scaled to Running boy legs.
      const hip = worldPos(world[thighL]).add(worldPos(world[thighR])).multiplyScalar(0.5);
      pos[f * 3] = hip.x * scale;
      pos[f * 3 + 1] = (hip.y - ground) * scale;
      pos[f * 3 + 2] = hip.z * scale;
    }

    const tracks = [new THREE.VectorKeyframeTrack('BonesCharacter.position', times, pos)];
    for (const name of Object.keys(TARGET_PARENT)) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quats[name]));
    }
    clips.push(new THREE.AnimationClip(pick.key, duration, tracks));
  }
  return clips;
}
