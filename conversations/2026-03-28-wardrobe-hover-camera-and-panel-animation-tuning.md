# Wardrobe hover camera and panel animation tuning

**Saved:** 2026-03-28  
**Scope:** Creator.Wardrobe hover behavior, camera responsiveness, and right-rail selector panel transition coordination.

---

## Request trail

- Fix stale hover when fast pointer exits layer tree (camera should return to selected layer).
- Review/clean modified files for unused imports, dead code, and comment correctness.
- Animate selector panels out instead of instant hide.
- Reduce stutter/race conditions when rapidly hovering/clicking between body-part layers.
- Make timing and motion feel configurable/tunable.
- Add asymmetric hover intent behavior.

---

## Key implementation outcomes

### 1) Hover reliability and source handoff

**Files:** `src/creator/wardrobeHoverPreview.ts`, `src/creator/wardrobePartsPanel.ts`

- Switched layer tree events to pointer semantics (`pointerenter`/`pointerleave`).
- Added document-level pointer sync (`elementFromPoint`) to clear stale layer-panel hover when pointer is no longer over the wardrobe tree.
- Preserved handoff behavior when pointer moves to selector strips/outfits selector.

### 2) Code hygiene and representation cleanup

**Files:** `src/creator/wardrobePartsPanel.ts`, `src/creator/wardrobeLibraryPanels.ts`, `src/creator/wardrobe.ts`, `src/creator/wardrobeDom.ts`

- Removed unused constants/imports (`LAYER_DISPLAY_LABELS`, `WARDROBE_COMPOSITE_LABELS`, unused skin import in wardrobe API).
- Consolidated dual-library pair representation (`WardrobeDualLibraryGroup`, shared helpers, exported bottom-row keys).
- Corrected outdated/inaccurate comments.
- Added shared selector constant:
  - `WARDROBE_LIBRARY_SELECTOR_CLOSEST = '.creator-wardrobe-library-selector, #creator-skin-selector'`

### 3) Panel transition behavior

**Files:** `src/creator/wardrobe.ts`, `src/styles/creator/_animations.scss`, `src/creator/modePanels.ts`

- `hideAllWardrobeLibraryPanels()` now animates out (right) and hides after transition delay.
- Unified/show-hide behavior paths to avoid duplicate logic.
- Tuned animation timing/easing and aligned JS timeout with CSS duration for mode panel transitions.

### 4) Stutter/race fixes

**Files:** `src/creator/wardrobe.ts`, `src/controllers/focusedCreationController.ts`, `src/controllers/creatorPose.ts`

- Invalidated stale panel transition callbacks using generation token strategy.
- Prevented duplicate out-animation restarts by skipping `animateModePanelOut` when panel is already in `creator-mode-anim-out-right`.
- Reduced camera churn from hover by decoupling high-frequency hover from selection slice fan-out.
- Added hover camera scheduling logic and restore-path coordination with deferred panel reveal.

### 5) Configurable motion controls

**File:** `src/config/creatorWardrobeMotion.ts`

Added/centralized tunables for:

- Camera travel speed and min/max duration clamps
- Hover intent threshold for non-selected layer rows
- Library panel transition duration alignment
- Deferred panel reveal lead-time relative to estimated camera tween end

---

## Current UX policy (as of this save)

- Asymmetric intent:
  - Non-selected layer-tree hover uses threshold delay before camera focus.
  - Selected layer / same dual-pair hover and clear/restore paths are immediate or prioritized.
- Deferred panel reveal can start before camera reaches its final point so both complete near the same time.

---

## Notes

- This thread included iterative tuning of constants in `creatorWardrobeMotion.ts` for feel.
- Additional related work landed in `src/main.ts` for focused-mode auto-disable on mouse camera movement.

---

## Archive log

- **2026-03-28** — Conversation saved to this file.
