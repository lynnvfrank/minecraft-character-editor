# Animation Glossary

A reference for understanding the character animation system. Use these terms when describing issues (e.g. "the **model** snaps before the **crossfade** completes").

**Project convention:** All FBX clips are 30 fps.

---

## Hierarchy & Structure

### Model

The **model** is the `THREE.Group` that holds the character mesh and skeleton. It is a child of the **container** and stays at `(0, 0, 0)` in the container's local space.

- **Position**: `model.position` is always `(0, 0, 0)` — we never move the model in world space directly.
- **Rotation**: `model.rotation.y` (yaw) is the character's **facing direction** in radians. We set it procedurally (e.g. toward the walk target or camera).
- **Scale**: Set once at load (e.g. 0.01 for FBX). Not changed during playback.
- **Skeleton**: Inside the model — meshes are skinned to bones. Animation clips drive bone transforms.

When reporting issues, say "model" when you mean the whole character (mesh + rig), or "model.rotation.y" when you mean facing.

---

### Bones

**Bones** are `THREE.Bone` objects in the skeleton. Each bone has `position`, `quaternion`, and `scale`. Animation clips contain keyframe tracks that animate these properties over time.

Important bones in this project:

| Bone | Purpose |
|------|---------|
| **BonesCharacter** | Armature root. Turn clips animate its `quaternion` (yaw). |
| **Hip / Spine** | Root of the body. Used for diagnostics (`getRootBoneYawDeg`). |
| **Head** | Used for procedural look-at in characterAI. |

Mixamo rigs use names like `mixamorigHips`, `mixamorigSpine`, etc. The turn clip animates `BonesCharacter.quaternion`; other clips animate various bones.

When reporting issues: "BonesCharacter" = rotation from the turn clip; "hip bone" = body orientation.

---

### Container

The **container** is a `THREE.Group` that is the parent of the model. It is what we actually move in the world.

- **Position**: `container.position` is updated during `walkTo` via `lerpVectors(start, end, t)`. This is the character's world position.
- **Children**: The model is the only child (at local 0,0,0).

Separation of model and container lets us:
1. Move the character in the world (container) without touching the rig.
2. Rotate the character to face a direction (model.rotation.y) independently.
3. Keep the walk animation in-place (no root motion) while we drive position in code.

When reporting: "container position" = where the character is in the scene; "model" = facing and skeleton.

---

## Blending & Interpolation

### Lerp (linear interpolation)

**Lerp** = smoothly interpolate between two values over time.

- **Position lerp**: `container.position.lerpVectors(start, end, t)` — character moves from start to end over the walk duration.
- **Rotation lerp**: `model.rotation.y = startYaw + (endYaw - startYaw) * t` — we use `lerpAngleRad` to take the shortest path for angles.
- **Walk tick**: `t` goes from 0 to 1 over `durationSec`, driven by the render loop delta.

Lerp is code-driven and deterministic. No animation clips — we compute the value each frame.

---

### Crossfade

**Crossfade** = blend between two animation actions over time. One action fades out while the other fades in.

- **API**: `currentAction.crossFadeTo(nextAction, duration, false)`
- **Effect**: The mixer blends the two clips' influence on the skeleton. Both run simultaneously; their weights change over `duration` seconds.
- **Used for**: turn → walk, walk → idle, idle → emote, etc.

Crossfade is clip-driven. The pose at any moment = blend of both clips. If the last frame of the turn and the first frame of the walk differ a lot, the transition can look like a jump.

---

## Combining Model, Bones, and Clips

**Visual facing** = `model.rotation.y` + BonesCharacter rotation (when turn clip is active).

- **model.rotation.y**: Procedural yaw we control in code.
- **BonesCharacter.quaternion**: From the turn clip. Adds ~90° during a turn.
- **Total**: `visualYaw ≈ model.rotation.y + rootBoneYaw` (simplified).

Turn logic splits the rotation: some from the model (lerped), some from the clip (animated), so we don't double-count.

---

## Extracting Pose Data from Clips

You *can* read the pose (position/rotation of bones) at a specific time from an animation clip without playing it.

### Approach 1: Sample keyframe tracks

Each `AnimationClip` has a `tracks` array. Each track has:

- `name`: e.g. `"BonesCharacter.quaternion"`, `"mixamorigHips.position"`
- `times`: Array of keyframe times (seconds)
- `values`: Flat array of values (4 per keyframe for quaternion, 3 for position)

Each track has `times` and `values` arrays. You can:

1. **Use the track's interpolant** (recommended): `track.createInterpolant()` returns an interpolant; call `evaluate(time)` to get the value at that time.
2. **Manual interpolation**: Find the two keyframes surrounding `time`, compute a blend fraction, and interpolate. For quaternions use `THREE.Quaternion.slerpQuaternions()` (not linear interpolation).

Example — inspect tracks and sample at a time:

```typescript
// List all tracks (see track names for your clips)
clip.tracks.forEach(t => console.log(t.name, t.times.length, 'keyframes'));

// Sample: use track.createInterpolant() then .evaluate(time)
// See three.js KeyframeTrack docs for the exact API.
```

Filter by names like `BonesCharacter.quaternion` or `mixamorigHips.position` to compare turn-end vs walk-start poses.

### Approach 2: One-off mixer sample

Create a temporary mixer, apply the clip at the desired time, read bone transforms, then dispose:

```typescript
function sampleClipAtTime(model: THREE.Group, clip: THREE.AnimationClip, time: number): void {
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.time = time;
  action.play();
  mixer.update(0); // Apply without advancing
  // Read bone transforms from model now...
  mixer.uncacheClip(clip);
}
```

This modifies the live model temporarily. Use a cloned model if you need to avoid affecting the scene.

### What to compare

For turn → walk transition debugging:

- **Turn clip, last frame**: Sample at `clip.duration`. Read `BonesCharacter.quaternion`, `mixamorigHips.position`, etc.
- **Walk clip, first frame**: Sample at `0`. Read the same bones.

If positions/rotations differ, that mismatch causes the visible jump. Fix by editing the clips in Blender so the turn ends in a walk-ready pose (or vice versa).

---

## Quick Reference

| Term | What it is |
|------|------------|
| **Model** | Character mesh + rig; `model.rotation.y` = facing |
| **Bones** | Skeleton joints; clips animate them |
| **Container** | Parent of model; `container.position` = world position |
| **Lerp** | Code-driven interpolation (position, rotation) |
| **Crossfade** | Blend between two animation actions over time |
