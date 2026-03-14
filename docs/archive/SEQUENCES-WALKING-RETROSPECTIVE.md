# Sequences & Walking Retrospective

A technical retrospective on implementing composite animation sequences with movement for the Minecraft character viewer. The work was saved to a separate branch; the final state had the model **sliding** around the world with walking animations disabled.

**Code version:** branch `seq-sockets-fakechat`

---

## What I Thought About

### 1. Root Motion

The core problem: **Mixamo/FBX walking animations often have root motion baked in**. The hip/root bone moves the character forward in the animation itself. When we combined that with programmatic movement (tweening the container position), we got:

- **Double movement** — our tween moved the character, and the animation also moved it
- **Snap-back on loop** — when the walking clip loops, the root bone resets for the next stride, causing a visible jump
- **"Never stops walking"** — the animation kept playing and snapping, creating a continuous loop of move-reset-move-reset

### 2. Coordinate Systems

Three.js uses Y-up; the ground lies in the XZ plane. Mixamo/Blender often use Z-up. The FBX import might orient things differently, which could explain reports of the model moving "up in the air" when moving along Z — in some pipelines, axis mapping can be confusing.

### 3. TWEEN.js vs. Render Loop

TWEEN.js uses `update(time)` with a timestamp. Issues encountered:

- Passing `performance.now()` to both `start()` and `update()` should work, but timing mismatches caused tweens to complete instantly (teleport) or never complete
- `clock.getDelta()` was consumed by the mixer update in the main loop; when the animation manager called `clock.getDelta()` again, it received near-zero, so movement never advanced
- **Fixes that worked:** Pass the same delta from the main loop to the animation manager, and later replace TWEEN entirely with manual `lerpVectors()` driven by the render-loop delta

### 4. Idle Wanderer Interference

The wanderer starts after 60 seconds of no chat. It would fire even when the user had just run a sequence, because `setLastActivity` was only tied to chat. That led to sequences being interrupted or overlapped by wanderer walks.

---

## What I Tried

### Approach 1: Container Group

**Goal:** Isolate our positional movement from animation root motion.

**Implementation:** Wrap the model in a `THREE.Group` container. The container is what we move; the model stays at `(0,0,0)` inside it. Animations run on the model.

**Result:** Helped conceptually but didn’t fix root motion — the animation still moved the model within the container, causing snap-back when switching animations.

### Approach 2: Strip Root Position Tracks

**Goal:** Create an in-place walk by removing position tracks from the walking clip.

**Implementation:**
- Added `createInPlaceClip()` to filter out tracks containing `.position`
- Created a `walking-in-place` action from the stripped clip
- Used that action during `walkTo`

**Result:** Either broke the clip (e.g. no useful tracks left), or introduced new issues. Reports of the model moving “up in the air” and continuing to walk in place suggest the stripped clip behaved poorly or root motion was handled differently than expected.

### Approach 3: Don’t Play Walking During Movement

**Goal:** Avoid root-motion problems by not playing any walk animation.

**Implementation:** During `walkTo`, play the idle animation instead of walking. Only move the container.

**Result:** Movement worked (after fixing the delta), but the character **slides** instead of walking — not ideal visually.

### Approach 4: TWEEN.js for Movement

**Goal:** Smooth interpolation from start to target.

**Result:** Movement appeared as **teleports** — the tween seemed to complete in one frame or never advance. Likely causes: time-source mismatch or incorrect `update()` usage.

### Approach 5: Manual Lerp Driven by Render Loop

**Goal:** Guarantee smooth movement by using the same delta as the rest of the app.

**Implementation:**
- Store `activeWalk` state: `start`, `end`, `durationSec`, `elapsed`
- Each frame in `tick(deltaSec)`: `elapsed += deltaSec`, compute `t = elapsed / durationSec`, `position.lerpVectors(start, end, t)`
- Resolve the promise when `t >= 1`

**Result:** Worked after fixing the **delta-passing bug**: main must pass `clock.getDelta()` into `tick(delta)` instead of the animation manager calling `getDelta()` again (which returned near-zero).

---

## What Ultimately Did and Didn’t Work

### Worked

- **Container group** for separating movement from model hierarchy
- **Manual lerp** using `Vector3.lerpVectors()` and frame delta
- **Passing delta** from the main loop into the animation manager
- **Sequence queue and generation IDs** to replace sequences and cancel in-flight ones
- **Stop on animation button** to clear the queue and reset state
- **`setLastActivity`** on sequence/animation button clicks to avoid wanderer takeover
- **Socket.io with fake-mode fallback** (connection disabled by default)
- **Sequences defined in JSON** and shown as buttons

### Didn’t Work

- Playing the original walking animation during movement — root motion caused snapping and looping
- `walking-in-place` from track stripping — unreliable or broken
- TWEEN.js for movement — teleporting or no movement

### Final State

- The model **slides** to waypoints using the idle pose
- Walking animations are **disabled** during movement
- Movement is smooth and sequences (e.g. walk-in → clap → walk-back) run correctly in terms of timing and flow

---

## What’s Going On With Mixamo Animations

### Root Motion

Mixamo walk/run clips usually include **root motion**: the root (often `mixamorigHips` or equivalent) is animated to move forward. That’s intended for games that drive position from the animation. For a setup where we control position ourselves, we need **in-place** motion.

### Options in Mixamo

- Use Mixamo’s “**In Place**” option when downloading (if available for the clip)
- Some animations are in-place by default; others are not
- Naming and availability vary by character and clip

### Why Strip-in-Code Was Fragile

- Track names vary by rig and export (e.g. `.position`, `mixamorigHips.position`, object paths)
- Removing *all* position tracks can break rigs that use position on non-root bones
- A robust solution would need rig-specific logic to identify and remove only root-position tracks

---

## Next Steps & Workarounds

### 1. Use Blender + In Placer Addon

**In Placer** is a free Blender addon that removes forward and lateral root motion with one click. [BlenderNation article](https://www.blendernation.com/2021/11/09/in-placer-a-free-blender-addon-to-make-your-animation-in-place/)

**Requirements (often why “Make it in place!” fails):**

1. **Object mode** — Switch to Object Mode (not Pose or Edit).
2. **Only the armature selected** — Select just the armature object; deselect the mesh and everything else.
3. **Root bone must be named `mixamorig:Hips`** — In Placer looks for this exact bone. If your rig (e.g. RunningboyRig) uses different names, the addon won’t find the root and the rig will keep moving.

**If the rig keeps moving after “Make it in place!”:**

- **Check the root bone name:** In Edit Mode or the Outliner, find the hip/root bone. Mixamo typically uses `mixamorig:Hips` (with colon). Custom characters sometimes use `mixamorig:Hips` or a custom prefix like `Armature_Hips`.
- **Rename to match:** Temporarily rename the root bone to `mixamorig:Hips`, run In Placer, then export. (Revert the name if needed for your pipeline.)
- **Use “One Direction Only”:** Try removing forward and lateral motion separately; sometimes one axis still moves.
- **Verify action is active:** Ensure the walking action is assigned to the armature and playing (check the Dope Sheet / NLA).

**Workflow:**

1. Import the walking FBX into Blender.
2. Select only the armature, switch to Object Mode.
3. Confirm or fix root bone name → `mixamorig:Hips`.
4. Run “Make it in place!” from the In Placer panel (Properties → Armature Data, or Sidebar).
5. Export a new FBX.
6. Use this clip for movement; keep moving the container in code.

### 2. Identifying the Root Bone (Non-Mixamo Rigs)

If your rig uses bones like **Bone.011** and **Bones:Character** (not `mixamorig:Hips`), use these methods to find the root:

**Method A: No parent**
- In **Edit Mode** (Tab with armature selected), open the **Outliner** (Window → Outliner).
- Expand the armature → Bones. The root bone has **no parent** — it’s the top of the hierarchy.
- In **Properties → Bone → Relations**, the root bone has an empty **Parent** field.

**Method B: Visual hierarchy**
- Switch to **Edit Mode**, enable “Bone Names” (Overlays → Names).
- The root is typically the hip/spine bone from which legs and spine chain down.
- **Bone.011** being “most root-like” suggests it may be the root.

**Method C: Pose Mode + Graph Editor**
- In Pose Mode, select a bone and open **Graph Editor**.
- If it has **Location** f-curves with movement, it’s a bone that translates.
- The root usually has the strongest overall translation; limbs mostly rotate.

### 3. Exporting FBX Correctly (Avoid Errors & Locked Limbs)

“Selected Objects” and incomplete hierarchy often cause errors or limbs locking. Use this workflow:

**What to select**
- Select the **Armature object** (the green stick-figure icon in the Outliner), not the mesh or an empty.
- For Three.js/Mixamo-style use: export **both** the armature and the skinned mesh so the rig stays intact.

**Avoid “Selected Objects” for rigs**
- With “Selected Objects” enabled, the FBX exporter can omit the root armature node or break the bone hierarchy. That can lead to import errors or limbs stuck in place.
- **Preferred:** Uncheck “Selected Objects” and export the whole scene, or put only the character (armature + mesh) in a separate collection and export that collection.

**Export settings that usually work**
1. **File → Export → FBX**
2. **Include:** Uncheck “Selected Objects” (or ensure both armature and mesh are selected and properly parented).
3. **Object Types:** Enable **Armature** and **Mesh**. Disable **Camera** and **Light** (and any other types you don’t need) so you don’t export the default scene camera and lights — no need to delete them from your Blender project.
4. **Bake Animation:** Enable “All Actions” if you want all actions, or ensure the desired action is the current one and “All Actions” is off.
5. **Scale:** 1.0 or match your scene (e.g. 100 if you use cm).
6. **Path Mode:** Auto or Relative.
7. For a clean scene, use one scene/collection with only the character + animation.

**If you must use “Selected Objects”**
- Select **both** the armature and the mesh.
- Ensure the mesh has the **Armature modifier** and is parented to the armature (Ctrl+P → Armature Deform).
- If problems persist, use the older **FBX 6.1** format (if available) or avoid “Selected Objects” and export the full scene.

**Y-axis only movement**
- If the animation moves only on **Y** (e.g. vertical bob), that’s normal for some walks.
- To make it in-place: in the Graph Editor, select the root bone’s **Location Y** f-curve and set all keyframes to **0** (or remove the f-curve).
- Re-export after editing.

### 4. Manual Approach in Blender (if In Placer Fails)

1. Import the walking FBX.
2. Select the armature, switch to **Pose Mode**.
3. Select the **root/hip bone** (e.g. `Bone.011`, `mixamorig:Hips`, or the one with no parent).
4. Open **Graph Editor** (or Dope Sheet) and show **Location** f-curves for that bone.
5. For the **X**, **Y**, and **Z** channels you want to remove: select all keyframes and set the value to **0** (or delete the f-curves).
6. Export using the workflow above (avoid “Selected Objects” or select armature + mesh together).

### 5. Re-Download From Mixamo as In-Place

1. Open the character in Mixamo.
2. Select the walking animation.
3. Check for an “**In Place**” checkbox or equivalent at download.
4. Download and replace the walking FBX with the in-place version.

**Note:** Not all Mixamo animations have the In Place option.

### 6. Use a Different Animation Source

- **Quaternius** — free character packs with loops
- **Mixamo alternatives** — Turbosquid, Sketchfab, etc.
- Look for clips explicitly labeled “in place” or “cycle”

### 7. Use a Motion Library / Runtime Solution

- **Three.js + custom state machine** — blend between clips and drive position manually.
- **pmndrs/rapier** or similar for physics-based movement (likely more than you need).
- **Animation retargeting tools** — e.g. **Mixamo-to-Unity** style tools that can strip root motion.

### 8. Accept Sliding for Now

- Keep the current behavior: idle pose during movement.
- Improves later by swapping in an in-place walk once you have one.
- No Blender/export work required in the short term.

### 9. Procedural / Simple Walk

- Drive a simple leg/arm cycle in code (e.g. sine-based).
- More work and usually lower quality than a proper in-place clip.

### 10. Animation Libraries to Consider

- **@tweenjs/tween.js** — usable for UI/cameras; we had issues for character movement.
- **GSAP** — robust tweens, good for UI and simple motion.
- **Three.js AnimationMixer** — already in use; the right place for animation playback; movement is better handled with manual lerp or tweens on the container, not via animation clips with root motion.

---

## Summary

The main blocker was **root motion** in the walking animation. The robust fix is an **in-place** walk clip (from Blender, Mixamo, or another source). The final implementation used **manual lerp** for movement and **idle during movement**, which produced correct, smooth movement at the cost of the character sliding instead of walking.
