# Animation & Movement Guide

A guide to the character animation system, state machine, movement, and how to prepare and use animations in this webapp. Combines technical notes from the Sequences & Walking Retrospective with current implementation details and best practices.

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [State Machine Approach](#state-machine-approach)
3. [Benefits and Drawbacks](#benefits-and-drawbacks)
4. [Known Glitches and Limitations](#known-glitches-and-limitations)
5. [Alternative Approaches (IK, etc.)](#alternative-approaches)
6. [Preparing Animations for the Webapp](#preparing-animations-for-the-webapp)
7. [Exporting from Mixamo](#exporting-from-mixamo)
8. [Editing Animations in Blender](#editing-animations-in-blender)
9. [Best Practices: Length, Frames, Looping](#best-practices-length-frames-looping)

---

## Current Architecture

### Overview

- **animationManager.ts** — Queue-based sequence player, `walkTo` with turn-before-walk, idle wanderer, clock-driven position lerp
- **characterAI.ts** — State machine (idle, wandering, noticing, approaching, interacting), procedural head look-at, body turn toward camera, user-activity detection
- **main.ts** — Three.js scene, `fadeToAction` / `getAction`, mixer updates, event wiring

### Movement Pipeline

1. **Position** — A `THREE.Group` container holds the model. The container is moved with `Vector3.lerpVectors(start, end, t)` driven by the render loop delta. The model stays at `(0,0,0)` inside the container.
2. **Facing** — `model.rotation.y` is set procedurally during walks (toward walk target) and by characterAI (toward camera) when not walking.
3. **Turn animations** — Before walking, if the angle to target is significant, `left-turn` or `right-turn` FBX clips play (once or twice for ~90° or 180°). Then the walk animation plays and position lerps.
4. **Walk animation** — In-place walking clip; position is driven entirely by code. A short start delay (0.2s) lets the walk blend in before movement begins.
5. **Cross-fades** — `fadeToAction` uses `crossFadeTo` between `AnimationAction`s. No IK; all motion comes from keyframed clips.

### Activity Timers

- **lastInteractionTime** — Updated on any input (including mousemove). Used for “user returned” → noticing flow.
- **lastExplicitActivityTime** — Updated only on chat, keypress, button clicks. Used for “idle long enough to wander.” Mousemove does not block wandering.

---

## State Machine Approach

### States

| State       | Trigger                          | Behavior                                                                 |
|------------|-----------------------------------|---------------------------------------------------------------------------|
| **idle**   | Default; after interacting ends   | Micro-emotes (yawn, shrug, bored, etc.), head look-at toward camera      |
| **wandering** | idle for 10+ sec, no explicit activity | Walk to waypoints, play emotes at stops; interval-driven wander steps   |
| **noticing**  | User returns (explicit activity after 2+ sec away) | Interrupt current behavior, turn head/body toward camera, play greeting emote |
| **approaching** | After greeting                   | Walk toward point in front of camera                                     |
| **interacting** | After arriving                   | Play happy emote; after 3–5 sec, transition back to idle                  |

### Transitions

- **idle → wandering** — `explicitIdleSec >= WANDER_START_SEC` (10 sec)
- **idle/wandering → noticing** — User does explicit action (chat, key, click) after 2+ sec of no activity
- **noticing → approaching** — After greeting emote duration
- **approaching → interacting** — After `walkToScreenCenter` completes
- **interacting → idle** — After 3–5 sec timeout

---

## Benefits and Drawbacks

### Benefits

- **Lightweight** — No external IK or physics. Procedural look-at and body turn are simple quaternion/rotation updates.
- **Predictable** — State machine is explicit; transitions are easy to reason about.
- **Extensible** — New states or emotes can be added without changing core movement logic.
- **Control** — Position is fully code-driven; no root-motion surprises from clips.
- **Responsive** — User activity interrupts and redirects behavior; stop mid-walk does not teleport (character stays where they are).
- **Separation of concerns** — Animation manager handles clips and movement; characterAI handles behavior and timers.

### Drawbacks

- **Turn → walk not smooth** — Turn animation ends, then walk starts. No blend between turn and walk; visible pop or stiffness.
- **Sliding** — In-place walk + programmatic position can look like feet sliding if stride timing does not match movement speed. A 0.2s start delay helps but does not fully fix it.
- **Turn animation rigidity** — Assumes ~90° per turn; real clips may differ. Running turn twice for 180° can feel mechanical.
- **No foot placement** — Feet do not adapt to ground or slopes. Pure keyframe playback.
- **Head/body conflicts** — Procedural look-at and body turn can fight with animated poses during emotes; we skip head look during micro-emotes to reduce this.

---

## Known Glitches and Limitations

- **Turn does not transition to walking smoothly** — Abrupt cut from turn to walk. No blend.
- **Sliding persists** — Step cycle and movement speed are not synchronized; some sliding remains.
- **No IK** — Limbs and feet do not conform to surfaces or match movement rate.
- **Turn angle assumptions** — 90° per turn clip may not match actual FBX rotation.
- **Stop behavior** — Interrupting a walk leaves the character in place (correct) but may leave animation state slightly out of sync.

---

## Alternative Approaches

### Inverse Kinematics (IK)

**What it solves:** Foot placement, reaching toward targets, looking at points, more natural leg motion.

**How it could help:**
- **Foot IK** — Constrain feet to ground during walk; reduce sliding.
- **Look-at IK** — Replace procedural head rotation with IK-driven head/neck/eyes.
- **Reach IK** — For pointing or touching objects.

**Considerations:**
- **Libraries** — Three.js has no built-in IK. Options include custom CCD/FABRIK, `ik.ts`-style solvers, or integrating a library like `@pmndrs/ik`.
- **Performance** — IK solvers run each frame; lightweight rigs (e.g., Minecraft-style) are manageable.
- **Integration** — Would layer on top of or replace procedural look-at and body turn. Animation clips would still drive base motion; IK would override or blend specific limbs.

### Motion Matching

Match character pose to a motion database in real time. Produces very smooth transitions but requires a curated motion set and more compute.

### Animation Retargeting / Root Motion Stripping

- Use Blender/In Placer or manual edits to remove root motion from Mixamo clips.
- Keep clips as in-place; drive position purely in code (as we do now).
- Reduces double-movement and snap-back but does not fix sliding or turn→walk transitions by itself.

### Physics-Based Movement

- Use a physics engine (e.g., Rapier) for character movement.
- Animations drive visuals; physics drives position.
- More realistic but heavier and more complex to tune.

---

## Preparing Animations for the Webapp

### Requirements

1. **Same skeleton** — All animation FBXs must target the same rig as the base model (e.g., RunningboyRig).
2. **Frame rate** — All FBX clips in this project are 30 fps. Use 30 fps when exporting or editing animations so frame counts (e.g. 16 frames ≈ 0.53 s, 57 frames ≈ 1.9 s) are consistent.
3. **In-place for walks** — Walking clips should have no root translation. Use Mixamo “In Place” or Blender (see below).
4. **Naming** — Filename/key in `animations/index.json` (e.g. `walking`, `left-turn`, `right-turn`, `acknowledging`). Keys are matched by `resolveAnimationByName`.

### Recommended Clip Properties

| Property      | Recommendation | Notes                                                                 |
|---------------|----------------|----------------------------------------------------------------------|
| **Length**    | 0.5–3 s for emotes; 1–2 s for loops | Short emotes feel snappy; long clips can stall sequences.            |
| **Frames**    | 30 fps | All FBX clips in this project are 30 fps. 57 frames ≈ 1.9 s; 47 frames ≈ 1.57 s. |
| **Looping**   | Emotes: once; idle/walk: loop | `setLoop(THREE.LoopOnce, 0)` for one-shots; `LoopRepeat` for cycles. |
| **Start/end** | Matching poses for loops | Idle/walk should loop seamlessly (same pose at frame 0 and last).    |
| **Root motion** | None for walk/run | Strip in Blender if Mixamo “In Place” is not available.              |

### What Works Well

- **Idle variants** — Bored, shrugging, yawn, happy-idle, bashful (short, one-shot).
- **Gestures** — Waving, acknowledging, excited, clapping, laughing.
- **Turns** — Left-turn, right-turn as standalone clips; used before walks.
- **Walks** — In-place walk; position is driven by `walkTo` lerp.

### What Causes Trouble

- Root motion in walk/run (double movement, snap-back).
- Very long clips (slow sequences).
- Clips that animate root position on non-walk actions (can shift the model unexpectedly).

---

## Exporting from Mixamo

### General

1. Upload your rig (or use Mixamo character) and apply animations.
2. Download as **FBX for Unity** or **FBX** (both work with Three.js).
3. **In Place** — If available, use “In Place” for walk/run. Not all clips offer it.
4. **Skin** — Include skin (or use “Without Skin”) if you only need the motion; we apply our own skin texture.

### Export Settings (Typical)

- **Format:** FBX
- **Frames per second:** 30 (or 24 if you prefer)
- **Keyframe Reduction:** Optional; can reduce file size; test that motion still looks correct.

### After Download

- Ensure bone names match (e.g. `mixamorigHips`, `mixamorigHead`). Custom rigs may use different names; head look-at and In Placer assume specific patterns.
- If the clip has root motion, process it in Blender (see below).

---

## Editing Animations in Blender

*(Combined from SEQUENCES-WALKING-RETROSPECTIVE and practical use.)*

### Making Walk/Run In-Place (In Placer Addon)

**In Placer** is a free Blender addon that removes forward/lateral root motion.

**Workflow:**

1. Import the walking FBX into Blender.
2. Select **only the armature** (not the mesh). Switch to **Object Mode**.
3. Root bone must be named `mixamorig:Hips` (or `mixamorig:Hips` with colon). If not, rename it temporarily.
4. Run “**Make it in place!**” from the In Placer panel (Properties → Armature Data or Sidebar).
5. Export a new FBX and use it as your walking clip.

**If In Placer fails:**
- Confirm object mode, only armature selected.
- Check root bone name.
- Try “One Direction Only” if one axis still moves.
- Ensure the action is active (Dope Sheet / NLA).

### Manual Root Motion Removal

1. Import FBX, select armature, switch to **Pose Mode**.
2. Select the root/hip bone.
3. Open **Graph Editor**, show **Location** f-curves.
4. Set X, Y, Z keyframes to 0 (or delete the f-curves).
5. Export using the workflow below.

### FBX Export from Blender

**Avoid “Selected Objects” for rigs** — It can omit nodes and break the hierarchy.

1. **File → Export → FBX**
2. **Include:** Uncheck “Selected Objects” or ensure armature + mesh are both selected and correctly parented.
3. **Object Types:** Enable Armature and Mesh; disable Camera, Light if not needed.
4. **Bake Animation:** “All Actions” if exporting multiple, or the single action you need.
5. **Scale:** 1.0 (or match scene units).
6. **Path Mode:** Auto or Relative.

**If using Selected Objects:** Select both armature and mesh; ensure mesh has Armature modifier and Armature Deform parenting.

### Identifying the Root Bone (Non-Mixamo Rigs)

- **Outliner:** Root has no parent; top of the bone hierarchy.
- **Edit Mode:** Enable “Bone Names” overlay; root is usually the hip.
- **Graph Editor:** Root typically has Location f-curves; limbs mostly have Rotation.

---

## Best Practices: Length, Frames, Looping

### Animation Length

| Use Case       | Suggested Duration | Notes                                      |
|----------------|--------------------|--------------------------------------------|
| **Idle loop**  | 2–4 s              | Should loop seamlessly                      |
| **Micro-emote**| 1–2 s              | Yawn, shrug, bored, etc.                    |
| **Greeting**   | 1–1.5 s            | Acknowledging, wave, excited               |
| **Turn**       | 0.5–1 s            | Per 90° turn                               |
| **Walk cycle** | 1–1.5 s            | One full stride cycle                      |
| **Happy/talking** | 2–4 s           | Can loop if desired                        |

### Frame Rate

- **24 fps** — Cinematic; smaller files.
- **30 fps** — Common for Mixamo; matches many exports.
- Consistency across clips avoids timing surprises when blending or sequencing.

### Looping

- **Loops** — First and last keyframes should match for smooth cycles.
- **One-shots** — Use `setLoop(THREE.LoopOnce, 0)` and `clampWhenFinished = true` for emotes.
- **Sequence timing** — `playAnimationForDuration` uses `setTimeout`; ensure durations in sequence JSON match clip length when you want precise timing.

### Improving Transitions

- **Blend at boundaries** — Export clips so the end pose is neutral or similar to the start of the next clip.
- **Similar bone poses** — Transitions between clips with similar arm/leg positions cross-fade more smoothly.
- **Consistent fps** — Keeps cross-fade timing predictable.

---

## Debug: Facing Snap Logs

To log when the model's facing (rotation.y) changes abruptly:

1. Add `?log=position:debug` to the URL (e.g. `http://localhost:5173/?log=position:debug`).
2. Open the browser console.
3. Logs appear when facing changes by more than ~3° in one assignment.

**Format:** `[time] [position] [debug] facing | source=… prevYawDeg=… newYawDeg=… deltaDeg=… dirPrev=… dirNew=… state=… walking=… inWalkTo=… busy=…`

**Fields:**
- **time** — Seconds since page load
- **source** — Where the change originated
- **dir** — Direction facing (+Z, -X, -Z, +X, or intermediates)
- **state** — Character AI state machine state (idle, wandering, noticing, approaching, interacting)
- **walking** — Animation manager has active walk
- **inWalkTo** — In walkTo (turn or walk phase)
- **busy** — Sequence is playing

**Sources:**
- `turnToFace (per-turn)` — after each turn animation in playTurnToFace
- `turnToFace (final)` — at end of turn phase
- `walkTo tick` — during walk (when direction to target changes)
- `updateBodyTurn` — procedural body turn toward camera (characterAI)

Throttled via shared logger (position:debug). Relay to server with `?logRelay=1` when using `npm run dev:log`.

---

## Summary

| Topic                | Key Takeaway                                                                 |
|----------------------|------------------------------------------------------------------------------|
| **Movement**         | Container lerp for position; in-place walk; procedural facing.               |
| **State machine**    | Idle, wander, notice, approach, interact. Separate timers for wander vs. “user returned.” |
| **Glitches**         | Turn→walk and sliding remain; no IK or motion sync yet.                      |
| **Alternatives**     | IK for foot placement and look-at; motion matching; root-motion stripping.   |
| **Mixamo**           | Prefer “In Place” for walk/run; ensure same skeleton.                        |
| **Blender**          | In Placer or manual root removal; export armature + mesh; avoid Selected Objects pitfalls. |
| **Clip design**      | 0.5–3 s for emotes; 1–2 s for loops; match start/end for cycles; consistent fps. |
