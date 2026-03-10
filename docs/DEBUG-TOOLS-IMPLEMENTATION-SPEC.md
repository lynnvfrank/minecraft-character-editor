# Debug Tools Implementation Spec

**Purpose:** This document describes three debugging tools for troubleshooting turn and walk animation behavior. It is intended for an agent in another context to implement these features.

**Background:** The character viewer has persistent issues with turn animations—overturning, snapping, and desync between the Mixamo turn clip (which animates `BonesCharacter`) and `model.rotation.y`. These tools isolate and inspect the behavior.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Files and Concepts](#key-files-and-concepts)
3. [Step 1: Isolated Test Page](#step-1-isolated-test-page)
4. [Step 2: Pause + Step Through](#step-2-pause--step-through)
5. [Step 3: On-Screen Debug Overlay](#step-3-on-screen-debug-overlay)
6. [URL / Route Design](#url--route-design)

---

## Overview

| Tool | Purpose | Complexity |
|------|---------|------------|
| **1. Isolated Test Page** | Run turn/walk without characterAI or wanderer; manual control | Medium |
| **2. Pause + Step** | Freeze animation, advance one frame or one sequence step | Medium |
| **3. Debug Overlay** | Real-time on-screen values (model.rotation.y, active action, etc.) | Low |

---

## Key Files and Concepts

### Entry Points

- **`index.html`** — Single HTML page; `#three-canvas-container` for the scene, `#controls-bar` for skin/anim/sequence selectors
- **`src/main.ts`** — Bootstraps scene, loads character, creates `animationManager` and `characterAI`, runs `animate()` loop

### Animation Flow

```
main() → initScene() → loadCharacter() → createAnimationManager() → createCharacterAI()
animate() loop:
  - clock.getDelta()
  - characters[].mixer.update(delta)
  - animationManager.tick(delta)   // walk lerp, turn lerp, etc.
  - characterAI.update(delta)     // state machine, head look, body turn
  - controls.update()
  - renderer.render()
```

### Critical Files

| File | Role |
|------|------|
| **`src/main.ts`** | Scene, camera, controls, character load, `animate()` loop, `fadeToAction`, `getAction` |
| **`src/animationManager.ts`** | `playSequence`, `walkTo`, `tick`, turn logic, wanderer, `activeWalk`, `activeTurn`, `turnLerpState` |
| **`src/characterAI.ts`** | State machine (idle/wandering/noticing/approaching), head look-at, body turn, `updateLookAt`, calls `animationManager.runOneWanderStep` |
| **`src/trapezoidBounds.ts`** | `getTrapezoidBounds`, `clampToTrapezoid`, `WALK_CYCLE_DISTANCE` |
| **`src/logger.ts`** | Logging; `?log=animation:info` etc. via URL params |
| **`public/sequences/index.json`** | Sequence definitions (walkTo, animation, pause steps) |

### Character Structure

- **`characters[id]`** — `container` (position), `model` (rotation.y), `mixer`, `actions`, `currentAction`, `idleAction`
- **Hierarchy:** `container` → `model` → (armature) `BonesCharacter` → skeleton bones. Turn clip animates `BonesCharacter.quaternion`; we set `model.rotation.y`.
- **Critical:** `BonesCharacter` is an Object3D in the model hierarchy, not in `skeleton.bones`. `getRootBoneYawDeg()` in animationManager samples skeleton bones (hip/spine); those stay 0 during turn. The turn rotation is on `BonesCharacter`, which is a parent of the skeleton.

### Turn / Walk Behavior (Current)

- **`playTurnToFace`** — Sets `model.rotation.y = targetFacing - 90°`, plays left-turn/right-turn clip. Assumes clip adds ±90° via `BonesCharacter`.
- **`turnLerpState`** — After turn, lerps `model.rotation.y` over 0.2s (walk crossfade) to avoid overturn.
- **`walkTo`** — Lerps `container.position`, updates `model.rotation.y` via `tick` to face destination.

Turn clip track names (from `clip.tracks`): `BonesCharacter.position`, `BonesCharacter.quaternion`, `Bone011.quaternion`, `Body.quaternion`, `Chest.quaternion` — confirms rotation is on `BonesCharacter`, not skeleton bones.

### Vite Setup

- **`vite.config.ts`** — Uses `apiPlugin`; no multi-page config. Add a second entry or use `?movementcontrols=1` for movement controls mode.

---

## Step 1: Isolated Test Page

### Goal

A page/mode where **only** the character, scene, and animation manager run. No:

- characterAI (no state machine, no head look, no body turn)
- Idle wanderer
- Sequence buttons / fake chat

Manual controls: Turn left/right, Walk to waypoint, Walk to origin.

### What to Create

1. **Entry point:** Either a new HTML page (e.g. `test.html`) or a query param `?movementcontrols=1` that branches in `main.ts`.
2. **Minimal bootstrap:** Same `initScene`, `loadCharacter`, `createAnimationManager`. Do **not** create `characterAI` or call `characterAI.update`.
3. **Test UI:** A panel with buttons:
   - "Turn left 90°"
   - "Turn right 90°"
   - "Walk to waypoint (0,0,1.2)" (or use trapezoid bounds for a valid target)
   - "Walk to origin"
   - Optional: inputs for custom target `[x, y, z]` and speed

### API Usage

```ts
// animationManager provides:
animationManager.playSequence(steps: SequenceStep[])
animationManager.walkTo(target: THREE.Vector3 | [number, number, number], speed?: number)
animationManager.stop()
animationManager.tick(delta: number)

// For isolated turn: playSequence with a single walkTo that triggers playTurnToFace
// Or expose a direct turn API if you add one to animationManager
```

Currently `playTurnToFace` is internal to `walkTo`. To test turn alone, you can:

- Call `walkTo(someTarget)` with a very short distance so turn dominates, or
- Add an optional `animationManager.turnTo(angleRad)` (or similar) that calls the turn logic without walking.

### Waypoint Selection

- Use `trapezoidBounds.getTrapezoidBounds(camera, 0, 0, WALK_CYCLE_DISTANCE)` and pick a point inside the trapezoid.
- Or use fixed targets like `[0, 0, 1.2]`, `[0.5, 0, 0.8]` for simplicity.

### Files to Touch

- `index.html` — Optional: add `test.html` with `#test-controls` container, or keep single page and hide/show based on `?movementcontrols=1`
- `src/main.ts` — Branch: if `?movementcontrols=1`, skip `createCharacterAI`, `setFacingLogContextProvider` (or provide no-op), `setupUserActivityListeners`, `createFakeChatUI`; instead call `setupTestControls(animationManager, getCharacter, ...)`
- New: `src/testPage.ts` or `src/setupTestControls.ts` — Creates test buttons, wires to `animationManager.playSequence` / `walkTo`

---

## Step 2: Pause + Step Through

### Goal

- **Pause** — Stop the `animate` loop (no further `requestAnimationFrame` until resume).
- **Step frame** — Advance one frame (one `clock.getDelta()`, one `mixer.update`, one `animationManager.tick`, one `characterAI.update`).
- **Step sequence** — Advance one sequence step (e.g. finish current step, run next).

### Implementation

#### Pause

- Add `let paused = false` (or similar) in `main.ts`.
- In `animate()`:
  ```ts
  function animate() {
    requestAnimationFrame(animate);
    if (paused) return;  // Do not update delta, mixer, tick, etc.
    const delta = clock.getDelta();
    // ...
  }
  ```
- Expose `setPaused(true/false)` or `togglePaused()` via a global or a debug module so the UI can control it.

#### Step Frame

- When paused, a "Step" button calls a function that:
  - Performs one update: `const delta = 1/60` (or `clock.getDelta()` if you want real delta)
  - Runs `characters[].mixer.update(delta)`, `animationManager.tick(delta)`, `characterAI.update(delta)`
  - Calls `renderer.render(scene, camera)`
- Does **not** call `requestAnimationFrame` again until user resumes.

#### Step Sequence

- The sequence runs inside `animationManager.runNextStep`, which is async and driven by `playSequence` → `runNextStep` → `walkTo` / `playAnimationForDuration` / `pause`.
- "Step sequence" could mean: "resolve the current step's promise immediately" or "skip to the next step."
- Options:
  1. Add `animationManager.stepToNext()` — cancels current step and runs the next (if any). Requires internal hooks.
  2. Simpler: "Step frame" is enough for frame-by-frame inspection; sequence stepping can be a later enhancement.

### Files to Touch

- `src/main.ts` — Add `paused`, `stepOneFrame()`; modify `animate()` to honor pause
- Test page UI — Add Pause, Resume, Step Frame (and optionally Step Sequence) buttons

---

## Step 3: On-Screen Debug Overlay

### Goal

Show live values on screen without opening the console:

- `model.rotation.y` (degrees)
- Active action name (from `char.currentAction`)
- `turnLerpState` (e.g. "lerping 0.1s left")
- Current sequence step index (if a sequence is playing)

### Implementation

1. **Overlay element:** Add a `<div id="debug-overlay">` in `index.html`, positioned fixed (e.g. top-left), small font, semi-transparent background, `pointer-events: none` so it doesn’t block clicks.
2. **Update loop:** In `animate()` (or a separate interval), if overlay is visible and debug mode is on:
   - Read `characters['runningboy']`, `animationManager` (if available)
   - Build a string or HTML with the values
   - Set `debug-overlay.textContent` or `innerHTML`
3. **Visibility:** Toggle via keyboard (e.g. `D`) or a checkbox. Use a query param like `?debug=1` to show by default in movement controls mode.

### Values to Display

| Value | Source |
|-------|--------|
| `modelYaw` | `char.model.rotation.y * 180 / Math.PI` |
| `currentAction` | Look up key from `char.actions` where `action === char.currentAction` |
| `isWalking` | `animationManager?.isWalking?.()` |
| `isInWalkToPhase` | `animationManager?.isInWalkToPhase?.()` |
| `turnLerp` | `animationManager` internal — may need `getDebugState()` returning `{ turnLerpRemaining: number }` or similar |

### Optional: Expose Debug State

Add to `animationManager`:

```ts
getDebugState(): {
  isWalking: boolean;
  isInWalkToPhase: boolean;
  turnLerpRemaining: number | null;
  queueLength: number;
}
```

Then the overlay can call `animationManager.getDebugState()` without reaching into internals.

### Files to Touch

- `index.html` — Add `#debug-overlay`
- `src/main.ts` — Update overlay each frame (or on interval) when debug mode on
- `src/animationManager.ts` — Optional: add `getDebugState()`
- `src/style.css` — Styles for `#debug-overlay`

---

## URL / Route Design

### Option A: Query Params (Single Page)

- `?movementcontrols=1` — Enable movement controls mode (no characterAI, show test controls)
- `?debug=1` — Show debug overlay
- `?log=animation:info` — Existing logging (see `LOGGING-ARCHITECTURE.md`)

### Option B: Separate Page

- `/` — Normal app
- `/test` — Test page (e.g. `test.html` with its own script entry)

Vite: add a second entry in `vite.config.ts` or use a simple client-side router.

---

## Related Docs

- **`docs/ANIMATION-AND-MOVEMENT-GUIDE.md`** — Turn, walk, facing
- **`docs/ANIMATION-IMPROVEMENT-STRATEGIES.md`** — Pain points, turn→walk smoothness
- **`docs/ANIMATION-SEQUENCES-WALKING-RETROSPECTIVE.md`** — Root motion, lerp, sliding
- **`docs/LOGGING-ARCHITECTURE.md`** — Log config, `?log=...`
- **`docs/TROUBLESHOOTING.md`** — Debug modes, npm scripts

---

## Implementation Order

1. **Isolated test page** — Highest value; confirms whether turn/walk logic is correct in isolation.
2. **Debug overlay** — Low effort; helps during manual testing.
3. **Pause + step** — Build on the test page; most useful when combined with overlay.
