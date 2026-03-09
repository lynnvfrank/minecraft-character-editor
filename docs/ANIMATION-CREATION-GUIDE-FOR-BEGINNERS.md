# Animation Creation Guide for Blender & Blockbench Beginners

A practical guide for creators new to Blender and Blockbench who want to contribute more fluid, high-quality animations to the Minecraft 3D viewer. Builds on the existing [Animation & Movement Guide](./ANIMATION-AND-MOVEMENT-GUIDE.md).

---

## Table of Contents

1. [Understanding What This Viewer Needs](#understanding-what-this-viewer-needs)
2. [Blender: Essential Workflows for Beginners](#blender-essential-workflows-for-beginners)
3. [Blockbench: Minecraft-Specific Tips](#blockbench-minecraft-specific-tips)
4. [Strategies for More Fluid Motion](#strategies-for-more-fluid-motion)
5. [Common Pitfalls and Fixes](#common-pitfalls-and-fixes)
6. [Quick Reference: Checklist Before Export](#quick-reference-checklist-before-export)

---

## Understanding What This Viewer Needs

### Architecture Recap

- **Position** — Code moves a container; the model stays at (0,0,0) inside. Animations drive limbs, not world position.
- **In-place clips** — Walking/run must have **no root motion**. Mixamo's "In Place" or Blender's In Placer addon fixes this.
- **Same skeleton** — All clips must target the same rig as the base model (RunningboyRig).

### What "Fluid" Means Here

- **Smooth loops** — First and last keyframes match; no visible pop when repeating.
- **Natural easing** — Avoid linear interpolation; use ease-in/ease-out on transitions.
- **Appropriate timing** — Emotes: 1–2s; turns: 0.5–1s; walk cycle: 1–1.5s.
- **Compatible end poses** — When one clip cross-fades to another, similar arm/leg positions blend better.

---

## Blender: Essential Workflows for Beginners

### 1. Graph Editor and Easing

The **Graph Editor** (Window → Toggling System → Animation → Graph Editor) shows how values change over time. Linear keyframes (straight lines) often look robotic.

- **Select keyframes** → Right-click → Interpolation → **Bezier** (default) or **Ease In/Out**.
- **Bezier handles** — Drag the handles to shape the curve. Softer curves = smoother motion.
- **Rule of thumb:** Movement should ease in at the start and ease out at the end; avoid sudden starts/stops.

### 2. NLA Editor for Blending

The **Non-Linear Animation** editor lets you stack and blend strips.

- **Actions** — Create reusable clips (e.g., "Wave", "Turn Head").
- **Strips** — Drag actions onto the NLA; adjust blend in/out for cross-fades.
- **Use case:** Build a "wave start" → "wave hold" → "wave end" sequence with smooth blends between strips.

### 3. Pose Library

Store and recall poses for consistency.

- **Pose Mode** → **Pose Library** (Properties → Object Data → Pose Library).
- Save "neutral idle", "walk contact", "walk passing" poses. Use them as start/end frames for loops.
- Ensures walk cycles and emotes share the same baseline pose for smoother transitions.

### 4. In Placer Addon (Critical for Walks)

See [ANIMATION-AND-MOVEMENT-GUIDE.md](./ANIMATION-AND-MOVEMENT-GUIDE.md) for full In Placer workflow. Key points:

1. **Object Mode** — Not Pose or Edit.
2. **Only armature selected** — Deselect mesh and everything else.
3. **Root bone name** — Must be `mixamorig:Hips` (or equivalent). Rename temporarily if needed.

### 5. Useful Shortcuts

| Shortcut | Action |
|----------|--------|
| Tab | Toggle Edit Mode / Object Mode |
| G | Grab (move) |
| R | Rotate |
| I | Insert keyframe |
| Alt+G, Alt+R, Alt+S | Clear location/rotation/scale |
| K | Knife tool (for mesh edits) |

### 6. Recording Motion from Reference

- Import a reference video (Image as Plane) and scrub through it.
- Pose the character to match key moments.
- Insert keyframes (I) at those frames.
- Blender will interpolate between; tweak curves in Graph Editor for smoothness.

---

## Blockbench: Minecraft-Specific Tips

### 1. Blockbench vs. This Viewer

This viewer uses **RunningboyRig** (FBX from Mixamo), which is a Minecraft-style mesh but not a native Blockbench model. Blockbench is still useful for:

- **Skin UV layout** — Understanding where head, body, arms, legs map on the 64×64 texture.
- **Reference poses** — Blockbench's cube-based rig is similar in proportion; use for pose reference.
- **Animation timing** — Export animations and compare timing if you have a Blockbench-compatible rig.

### 2. Skin UV Awareness

When creating skins that will animate well:

- **Seams** — Arms and legs bend; avoid critical detail along inner elbow/knee seams.
- **Stretch zones** — Shoulders and hips stretch during movement; keep textures simple there.
- See [minecraft-skin-layout-specification.md](./minecraft-skin-layout-specification.md) for exact UV regions.

### 3. Blockbench Animation Export

If you create a Blockbench project with the same bone names as RunningboyRig:

- Export as **FBX** or **glTF**.
- Ensure **in-place** for walk cycles (no root translation).
- Cross-check bone names with the existing model (e.g., `mixamorigHead`, `mixamorigHips`).

---

## Strategies for More Fluid Motion

### 1. Overlap and Follow-Through

- **Overlap** — Don't move everything at once. E.g., in a wave: shoulder starts, then elbow, then hand. Slight delay between joints feels natural.
- **Follow-through** — When motion stops, let secondary parts (hair, sleeves) continue briefly.

### 2. Anticipation

- Before a big motion (e.g., bow), add a small opposite motion (slight lean back before bowing forward).
- 2–4 frames of anticipation improve perceived weight and intent.

### 3. Arcs

- Limbs move in arcs, not straight lines. In Graph Editor, ensure rotation curves are curved, not linear.
- Head turns: ease in, ease out; avoid snapping.

### 4. Secondary Motion

- Breathing: subtle chest/shoulder movement during idle.
- Blinks, subtle head drift — small variations that make loops feel alive.

### 5. Consistent Frame Rate

- Use **24 fps** or **30 fps** consistently across all clips.
- Match the viewer's expected playback (sequences and `playAnimationForDuration` assume consistent timing).

### 6. Transition Poses

- Design clip endings to match the start of the next likely clip.
- Idle → Walk: end idle with weight slightly shifted; walk starts with that foot forward.
- See ANIMATION-AND-MOVEMENT-GUIDE.md "Improving Transitions" for details.

---

## Common Pitfalls and Fixes

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| Character slides instead of walking | Root motion in walk clip | Use In Placer or manually remove root Location f-curves |
| Pop/snap when loop restarts | First and last keyframes don't match | Copy first pose to last frame (or use Pose Library) |
| Limbs stretch oddly | Keyframes too far apart or bad interpolation | Add intermediate keyframes; check Graph Editor curves |
| Turn looks robotic | Linear interpolation | Use Bezier or Ease In/Out; smooth the curve |
| Clip doesn't load | Wrong skeleton or bone names | Ensure FBX targets same rig; check bone names in Outliner |
| Double movement / snap-back | Root motion + code movement | Strip root motion; use in-place clips only |
| Export omits bones | "Selected Objects" with incomplete selection | Uncheck Selected Objects or select armature + mesh together |

---

## Quick Reference: Checklist Before Export

- [ ] Same skeleton as base model (RunningboyRig)
- [ ] Walk/run: no root motion (In Placer or manual strip)
- [ ] Loops: first frame = last frame pose
- [ ] Emotes: appropriate length (1–2s typical)
- [ ] Bezier or ease interpolation on keyframes
- [ ] Consistent frame rate (24 or 30 fps)
- [ ] FBX export: Armature + Mesh; avoid Selected Objects pitfalls
- [ ] Clip named for `animations/index.json` key (e.g., `walking`, `left-turn`)

---

## Further Reading

- [ANIMATION-AND-MOVEMENT-GUIDE.md](./ANIMATION-AND-MOVEMENT-GUIDE.md) — Technical architecture, Mixamo, Blender export
- [SEQUENCES-WALKING-RETROSPECTIVE.md](./SEQUENCES-WALKING-RETROSPECTIVE.md) — Root motion issues and fixes
- [minecraft-skin-layout-specification.md](./minecraft-skin-layout-specification.md) — Skin UV regions and overlay layers
