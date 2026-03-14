# Blender: Merging/Combining FBX Animations and Verifying Frame Transitions

A guide for ensuring smooth transitions between two animations (e.g., turn → walk) when they are loaded as separate FBX files.

> **Project convention:** All FBX clips in this project are 30 fps. Frame counts (e.g. 16, 47, 57) refer to 30 fps. The viewer crossfades between clips; if the **last frame** of clip A and the **first frame** of clip B differ significantly, you'll see a stutter or jump at the transition.

---

## Table of Contents

1. [Why Last/First Frame Matters](#why-lastfirst-frame-matters)
2. [Inspecting Last and First Frames in Blender](#inspecting-last-and-first-frames-in-blender)
3. [Loading Multiple FBX Animations](#loading-multiple-fbx-animations)
4. [Making Last Frame Match First Frame](#making-last-frame-match-first-frame)
5. [Verifying the Transition](#verifying-the-transition)
6. [Common Transitions in This Viewer](#common-transitions-in-this-viewer)

---

## Why Last/First Frame Matters

When the viewer crossfades (e.g., turn → walk), both clips play simultaneously for a short period. The mixer blends their influence:

- **Clip A (turn)**: weight fades from 1 → 0
- **Clip B (walk)**: weight fades from 0 → 1

If the turn ends with the character in pose P1 (feet apart, weight shifted, spine rotated) and the walk starts with pose P2 (neutral stance, different arm/leg positions), the blend produces an intermediate pose that can look like a jump or stutter. The closer P1 and P2 are, the smoother the crossfade.

---

## Inspecting Last and First Frames in Blender

### 1. Load the Base Model and Both Animation FBXs

1. **File → Import → FBX** — Import the base model (e.g., RunningboyRig.fbx).
2. Import the **turn** clip FBX (e.g., left-turn or right-turn).
3. Import the **walk** clip FBX.

Each import may create a new armature or add an NLA strip. Depending on your setup, you may have one armature with multiple actions, or multiple armatures you need to unify.

### 2. Ensure Same Armature

- All clips must target the **same armature** as the base model.
- If Mixamo gave you separate FBXs per animation, they typically share the same skeleton; Blender may create one armature with multiple actions in the **Action Editor** or **NLA Editor**.
- Check **Outliner** — you should have one Armature object with the character mesh parented/skinned to it.

#### When Blender Creates Multiple Armatures (e.g., Bones:Character, Bones:Character:001, Bones:Character:002)

Mixamo FBX imports often create a new armature per file. To consolidate:

1. **Keep the main armature** — Usually `Bones:Character` (the one from the base model) with your mesh parented to it.
2. **Transfer actions to it** — Select each duplicate armature (`:001`, `:002`), note its action in the **Dope Sheet > Action Editor**. Select the main armature, then in the Action Editor dropdown, assign that same action. Mixamo uses identical rigs, so the bone names match and the animation will play correctly.
3. **Rename actions** (optional) — In the Outliner (Blender File view), expand **Actions** and rename for clarity (e.g., `left-turn`, `walking`).
4. **Delete the duplicates** — Remove `Bones:Character:001`, `Bones:Character:002` (right‑click → Delete Hierarchy). The actions remain in the file and are now used by the main armature.
5. **Sequence in NLA Editor** — Select the main armature, open **NLA Editor**. For each action: in **Action Editor**, click **Push Down** to create an NLA strip. Arrange strips back‑to‑back (e.g., turn at frames 0–35, walk at 36–80). To bake one continuous animation: **Pose Mode** → **Pose** → **Animation** → **Bake Action**, set start/end frames, bake.

### 3. View Clip Boundaries

1. Open **Dope Sheet** or **Timeline**.
2. Each action has a **start frame** and **end frame**.
3. Note:
   - **Turn clip last frame**: e.g. frame 35
   - **Walk clip first frame**: frame 0 (or 1)

### 4. Inspect Pose at Specific Frames

**Method A: Action Editor**

1. **Window → Toggling System → Animation → Action Editor**.
2. Select the armature.
3. Assign the turn action, scrub to the **last frame**.
4. In **Pose Mode**, inspect:
   - **BonesCharacter** (or armature root) — rotation
   - **Hips** — position and rotation
   - **Feet** — contact points, weight distribution

5. Switch to the walk action, go to **first frame**.
6. Compare the same bones.

**Method B: NLA Editor (if strips are stacked)**

1. **Window → Toggling System → Animation → NLA Editor**.
2. View the turn strip’s last frame and the walk strip’s first frame.
3. Scrub and observe the pose at each boundary.

### 5. Key Bones to Compare

| Bone | What to check |
|------|----------------|
| **BonesCharacter** (or root) | Y rotation (yaw) — turn clip animates this |
| **Hips / mixamorigHips** | Position (X, Y, Z), rotation |
| **Feet** | Which foot is forward; height (contact vs mid-stride) |
| **Spine / Chest** | Tilt, twist |
| **Arms** | Swing phase — walk often starts mid-swing |

---

## Loading Multiple FBX Animations

### Mixamo Workflow

1. Download the base character and each animation as **FBX**.
2. In Blender:
   - Import the **base model** first.
   - Import each **animation** FBX. Mixamo FBX typically brings the same rig; Blender appends actions.
   - Check **Action Editor**: you should see actions like `mixamo.com` (or the clip name).
3. Each action is a separate clip; the viewer loads them as separate files and switches with `fadeToAction`.

### Consolidating into One File (Optional)

If you prefer a single FBX with multiple animations:

1. Import the base model and one animation.
2. Import the second animation FBX — use **Append** or **Import** and merge into the same armature.
3. In the NLA Editor, create strips for each action.
4. Export the armature with all actions (or as one baked sequence) per your pipeline.

---

## Making Last Frame Match First Frame

### Strategy: Edit the Turn Clip’s Last Frame

Goal: make the turn’s last frame match the walk’s first frame so the crossfade blends seamlessly.

1. **Assign the walk action** and go to frame 0 (or 1).
2. **Pose Mode** — Note the pose (or use **Pose → Copy Pose** to store it).
3. **Assign the turn action** and go to its last frame.
4. **Pose Mode** — Adjust the pose to match the walk’s first frame:
   - Use **Pose Library** if you saved the walk-start pose.
   - Or manually match Hips, Feet, Spine, Arms.
5. **Insert keyframes** (I) on the changed bones at the last frame.
6. Re-export the turn FBX (or overwrite the action in your export pipeline).

### Strategy: Edit the Walk Clip’s First Frame

Alternatively, change the walk’s first frame to match the turn’s last frame. Use the same process in reverse.

### Strategy: Add a Transition Clip

Create a short (0.2–0.3s) transition action that:
- Starts with the turn’s end pose
- Ends with the walk’s start pose

Use it between turn and walk in the viewer if your pipeline supports three-way sequences.

---

## Verifying the Transition

### In Blender

1. **NLA Editor**:
   - Stack the turn strip and walk strip back-to-back.
   - Add a short blend (crossfade) between them.
   - Scrub through the blend region — the character should move smoothly, not jump.

2. **Graph Editor**:
   - For bones you edited, ensure the last keyframe of the turn matches the first keyframe of the walk.
   - No discontinuous jumps in the f-curves.

### In the Viewer

1. Enable step-frame logging: `?log=animation:debug,position:debug`
2. Pause, trigger a turn→walk (e.g. “Walk to waypoint”).
3. Step through frames at the transition.
4. Watch `bonesCharYawDeg`, `modelYawDeg`, `visualYawDeg` — they should change smoothly, not jump.

---

## Common Transitions in This Viewer

| From | To | Clip pair | Notes |
|------|----|-----------|-------|
| Turn | Walk | left-turn / right-turn → walking | Turn ends in rotated pose; walk starts neutral. Match Hips, BonesCharacter, feet. |
| Idle → Walk | Walk | start-walking → walking | **Approach 2 (implemented):** Start-walking plays frames 1–16; walking starts at frame 7. Frame 7 aligns between clips. |
| Walk | Idle | walking → stop-walking | Stop-walking frame 1 = walking frame 1. 47 frames for full deceleration. |
| Walk | Idle (fallback) | walking → bored / shrugging / etc. | Walk cycle has momentum; idle is static. End walk with a deceleration pose if possible. |
| Idle | Turn | bored → left-turn | Less critical; turn usually starts from a neutral pose. |

---

## Summary

1. **Load** base model and both animation FBXs in Blender.
2. **Inspect** last frame of clip A and first frame of clip B for the same armature.
3. **Compare** BonesCharacter, Hips, feet, spine — note differences.
4. **Edit** one clip (usually the “from” clip’s last frame) to match the other’s boundary pose.
5. **Verify** in NLA with a blend, then in the viewer with step-frame logs.
