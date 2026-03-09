# Animation Improvement Strategies

Strategies for Cursor (or any AI coding assistant) to help clean up and improve the current animation system. Covers external libraries, expanding functionality, and systematic approaches to address known glitches documented in [ANIMATION-AND-MOVEMENT-GUIDE.md](./ANIMATION-AND-MOVEMENT-GUIDE.md).

---

## Table of Contents

1. [Current Pain Points](#current-pain-points)
2. [External Libraries to Consider](#external-libraries-to-consider)
3. [Code-Level Strategies](#code-level-strategies)
4. [Expanding Current Functionality](#expanding-current-functionality)
5. [Implementation Priorities](#implementation-priorities)

---

## Current Pain Points

From the codebase and docs:

| Issue | Location | Description |
|-------|----------|-------------|
| Turn → walk not smooth | `animationManager.ts` `playTurnToFace` → `walkTo` | Abrupt cut from turn animation to walk; no blend |
| Sliding | `animationManager.ts` `tick` (lerp) vs. walk clip | Stride timing doesn't match movement speed; feet slide |
| Turn angle assumptions | `playTurnToFace` | Assumes ~90° per turn clip; may not match actual FBX |
| Head/body conflicts | `characterAI.ts` `updateLookAt`, `shouldSkipHeadLook` | Procedural look-at can fight with animated emotes |
| No foot placement | N/A | No IK; feet don't conform to ground or movement rate |
| Stop behavior sync | `animationManager.ts` `stop` | Interrupting walk may leave animation state slightly out of sync |

---

## External Libraries to Consider

### 1. Inverse Kinematics (IK)

**Problem solved:** Foot placement, look-at, reach.

**Options:**

- **@pmndrs/ik** — Three.js ecosystem; CCD/FABRIK-style solvers. May require `@react-three/fiber` or can be used standalone.
- **Custom CCD/FABRIK** — Implement a simple 2-bone or 3-bone solver for head look-at and optionally feet. No external dep.
- **ik.ts** (standalone) — Search for lightweight IK solvers that work with raw Three.js `Bone` objects.

**Integration points:**

- `characterAI.ts` — Replace or augment `updateLookAt` with IK-driven head/neck.
- `animationManager.ts` tick — Add foot IK during walk; constrain feet to ground plane and sync with stride phase.

**Considerations:** Performance (per-frame solves), bone naming (Mixamo vs. custom), and blend weight between animation and IK override.

---

### 2. Animation Blending / State Machine

**Problem solved:** Smoother turn→walk and emote transitions.

**Options:**

- **THREE.AnimationMixer** (already in use) — `crossFadeTo` is used; explore `setLoop` and clip weighting for overlap.
- **Custom blend state machine** — Define explicit "turn blend out" + "walk blend in" overlap window instead of sequential play.
- **Animation layers** — Use `AnimationMixer` with multiple clips on different bones (e.g., lower body walk, upper body emote) — more complex, powerful.

**Strategy:** Before adding a library, extend the current `fadeToAction` / `playTurnToFace` flow to support an overlap period where turn is fading out while walk is fading in.

---

### 3. Motion Sync (Stride-to-Speed)

**Problem solved:** Sliding — match step cycle to movement speed.

**Options:**

- **Procedural stride timing** — Compute walk clip duration per stride from the FBX clip, then scale `durationSec` in `walkTo` so `distance / speed` equals `N * strideDuration` for integer N.
- **Root motion extraction** — Parse the walk clip for stride events (e.g., foot-down) and sync lerp to those events. Requires reading animation tracks.
- **Time scale on action** — `action.setEffectiveTimeScale(speedFactor)` so the walk clip plays faster/slower to match movement. Tune `speedFactor = distance / (speed * strideDuration)`.

**Integration:** `animationManager.ts` `walkTo` — after computing `durationSec`, optionally adjust walk action time scale so one stride = one "step" of movement.

---

### 4. Tween Libraries (Movement Polish)

**Problem solved:** More natural easing on position and rotation.

**Options:**

- **GSAP** — Robust, widely used. Good for camera, UI, and optionally character position/rotation.
- **@tweenjs/tween.js** — Lighter. Note: SEQUENCES-WALKING-RETROSPECTIVE reports issues with TWEEN for character movement (delta/timing). If used, ensure a single time source (e.g., pass `clock.getDelta()` from main loop).
- **Custom easing** — Replace `lerpVectors` linear blend with `t => t * t * (3 - 2 * t)` (smoothstep) or similar. No new dependency.

**Recommendation:** Start with custom easing (e.g., smoothstep) in the lerp; only add GSAP if broader tween needs arise.

---

### 5. Physics (Optional, Heavier)

**Problem solved:** Realistic collisions, slopes, foot placement.

**Options:**

- **Rapier** (via `@dimforge/rapier`) — Physics engine. Use for character capsule, ground, and obstacles.
- **Cannon-es** — Alternative JS physics.

**Consideration:** Significant scope increase. Animation would drive visuals; physics would drive position. Only pursue if the product direction requires terrain, slopes, or obstacles.

---

## Code-Level Strategies

### 1. Turn → Walk Overlap

**Current:** `playTurnToFace` awaits turn completion, then `walkTo` starts walk. Hard cut.

**Change:**

- Start fading in walk action **before** turn completes (e.g., 0.2s before).
- Use `crossFadeTo` with overlap: `currentAction.crossFadeTo(walkAction, 0.3, false)` while turn is still playing.
- May need to expose `playTurnToFace` to accept an "early start" callback or return a promise that resolves slightly early.

**Files:** `animationManager.ts` — `playTurnToFace`, `walkTo`.

---

### 2. Walk Stride Sync

**Current:** `durationSec = distance / speed`; walk clip plays at 1x. No link between step cycle and distance.

**Change:**

- Measure walk clip duration per stride (e.g., from `clip.duration` or by detecting loop point).
- Option A: Adjust `durationSec` so `durationSec = N * strideDuration` for some integer N.
- Option B: Use `setEffectiveTimeScale` on walk action so `action.timeScale = (distance / durationSec) / nominalStrideSpeed`.

**Files:** `animationManager.ts` — `walkTo`, `tick`. May need to pass stride metadata from clip or config.

---

### 3. Smooth Procedural Turn (Already Partially Done)

**Current:** For angles > 90°, `playTurnToFace` uses procedural steps (12 steps over 0.45s). For ≤90°, uses turn animation.

**Improvement:**

- Consider using procedural turn for all angles, with optional turn animation overlay on upper body only (animation layers). Reduces dependency on turn clip duration.
- Or: Make turn clip duration configurable (from `animations/index.json` or clip metadata) so code doesn't assume 0.8s.

---

### 4. Head Look During Emotes

**Current:** `shouldSkipHeadLook` skips procedural look during micro-emotes to avoid conflicts.

**Improvement:**

- Add a "head look weight" per emote in config — some emotes (e.g., waving) can blend in partial look-at; others (yawn) keep it disabled.
- Or: Use additive blending for head bone so animation and procedural look combine rather than override.

---

### 5. Sequence Generation and Cancellation

**Current:** `sequenceGeneration` increments on `stop` and `playSequence`; in-flight promises check `gen !== sequenceGeneration` and bail.

**Improvement:**

- Ensure `stop` also fades back to idle cleanly (already does). Consider adding a "cancel fade" duration so the character doesn't snap to idle.
- Log or expose sequence state for debugging (see [LOGGING-ARCHITECTURE.md](./LOGGING-ARCHITECTURE.md)).

---

## Expanding Current Functionality

### 1. Animation Metadata in index.json

Extend `animations/index.json` (or a separate metadata file) with:

- `strideDuration` — For walk/run clips, seconds per stride.
- `isInPlace` — Boolean; if false, warn or reject.
- `turnDuration` — Override default 0.8s for turn clips.
- `blendHint` — e.g., `"neutral"`, `"walkStart"` for transition matching.

### 2. Animation Layers

Support lower-body (walk) + upper-body (emote) simultaneously:

- Create separate mixers or use `AnimationMixer.clipAction` with different `blendMode` or masks (if Three.js supports).
- Research `THREE.AnimationClipCreator` and mixer blending modes.
- Use case: Character waves while walking.

### 3. Custom Events in Clips

FBX/glTF can contain events (e.g., "foot_down"). Three.js `AnimationMixer` has `clipAction.clip.events` or similar.

- Use events to trigger sound, particles, or sync with stride.
- Enables more accurate stride-to-speed sync.

### 4. Blend Trees (Advanced)

A blend tree blends multiple clips by parameters (e.g., speed, direction). More complex; consider only if the product needs directional movement (strafe, backpedal) with smooth blending.

---

## Implementation Priorities

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Turn→walk overlap blend | Low | High — fixes visible pop |
| 2 | Stride sync (time scale or duration) | Medium | High — reduces sliding |
| 3 | Custom easing (smoothstep) for position | Low | Medium |
| 4 | Animation metadata (strideDuration, etc.) | Low | Enables 2 |
| 5 | IK for head look (optional) | Medium–High | Medium — more natural look |
| 6 | Foot IK | High | Medium — polish |
| 7 | Physics / terrain | High | Only if needed for product |

---

## Cursor-Friendly Implementation Notes

When implementing these strategies:

- **animationManager.ts** — Central for walk, turn, tick. Changes here affect `characterAI` and `main`.
- **characterAI.ts** — Owns procedural look-at and body turn. IK would integrate here.
- **main.ts** — `fadeToAction`, `getAction`, mixer update. Ensure single source of delta.
- **sequences/index.json** — Add metadata if extending; keep backward compatible.
- **animations/index.json** — Add optional `strideDuration`, `turnDuration` keys per animation.

For external libraries, add to `package.json` and document in README. Prefer minimal dependencies; custom solutions (e.g., smoothstep lerp) over heavy frameworks when sufficient.
