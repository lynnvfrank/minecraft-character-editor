# Creator.Wardrobe: full model in Wardrobe, focus visibility on 3D/2D

**Saved:** 2026-03-27  
**Topic:** Layer visibility timing — wardrobe selection vs. Creator.3D / Creator.2D (focused creation).

---

## User goal

- In **Creator.Wardrobe**, show the **entire character** (all model layers visible).
- **Wardrobe row selection** (e.g. `body.top`) should **not** immediately solo/hide mesh parts.
- When switching to **Creator.3D** or **Creator.2D** in **focus mode**, read the current `WardrobeLayerKey` and **then** update `layer3DVisible` / locks to match (same mapping as today’s `applyFocusedSoloForWardrobeLayer`).

---

## How the codebase behaved (analysis)

1. **`isCreatorEditMode`** (`src/creator.ts`) is only `2d` and `3d` — **not** `wardrobe`.

2. **3D → Wardrobe:** `setEditMode` calls `saveLayerStateAndNormalizeForNonEditMode()` (`src/creator/layerVisibility.ts`), which saves prior visibility and sets **all layers visible** (and clears part splits / unlocks).

3. **Immediate undo of “full body” in Wardrobe:** `creatorWardrobeFocusSlice` fires when `setWardrobeSelectedLayer` runs (`src/creator/wardrobe.ts`). `createFocusedCreationController` → `runWardrobeFocus()` (`src/controllers/focusedCreationController.ts`) calls **`applyFocusedSoloForWardrobeLayer(layer)`** while still in wardrobe, then applies camera preset / FOV. That is why clicking a wardrobe row **immediately** restricts the 3D model.

4. **Wardrobe → 3D/2D:** `onModeChange` already calls `applyFocusedSoloForWardrobeLayer(layer)` when `previousMode === 'wardrobe'` and `mode` is `3d` or `2d` (with `fromUserModeNavigation` for the visibility apply path in the version analyzed).

5. **Core mapping:** `applyFocusedSoloForWardrobeLayer` in `src/creator/layerVisibility.ts` — for `fullOutfit` / `all` shows everything; otherwise uses `getMemberLayerKeysForWardrobeLayer`, sets visibility to members only, locks non-members.

---

## Recommended implementation (summary)

- In **`runWardrobeFocus`**, **do not** call `applyFocusedSoloForWardrobeLayer` while `editMode === 'wardrobe'`. Keep camera + FOV from `getPreviewPreset` / `animateCameraToCreatorView`.
- **Keep** applying `applyFocusedSoloForWardrobeLayer` on **mode change** Wardrobe → 3D/2D so the first paint in edit mode matches wardrobe selection.
- Audit other entry paths into Wardrobe if anything can leave `layer3DVisible` in a partial state without going through `saveLayerStateAndNormalizeForNonEditMode`.

---

## Related files

| Area | Path |
|------|------|
| Focus controller | `src/controllers/focusedCreationController.ts` |
| Layer solo / visibility | `src/creator/layerVisibility.ts` |
| Mode + save/restore | `src/creator.ts` (`setEditMode`, `isCreatorEditMode`) |
| Wardrobe selection notify | `src/creator/wardrobe.ts` (`setWardrobeSelectedLayer`, `creatorWardrobeFocusSlice`) |
| Subscribers doc | `docs/concepts/MODELS-AND-SUBSCRIBERS.md` |
| Plan | `docs/plans/focused_creation_mode_41f28800.plan.md` |

---

## Session note

First round was **Ask mode** (read-only analysis). This file records that exchange. For a broader session that also covered **implemented** tweaks to the same feature area, see [`2026-03-27-creator-wardrobe-focused-mode-session.md`](./2026-03-27-creator-wardrobe-focused-mode-session.md).
