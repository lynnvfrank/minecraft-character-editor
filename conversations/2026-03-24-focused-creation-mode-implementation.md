# Conversation: Focused Creation Mode implementation

**Saved:** 2026-03-24  
**Topic:** Implementing the plan in `docs/plans/focused_creation_mode_41f28800.plan.md` in phases, with builds between phases.

## Request

- Implement the plan in phases.
- Test between each phase by building the codebase (`npm run build`).
- Pause on ambiguous decisions.

## Ambiguous decision (resolved)

**Deep link** `#/creator/3d` or `#/creator/2d`: `setEditMode` runs with initial `previousMode === 'wardrobe'`, which would incorrectly trigger “wardrobe → 3D” focused solo.

**Resolution:** Extended `CreatorEditModePayload` with `fromUserModeNavigation: true` only for mode bar / Tab / `setEditMode3D` calls. Route bootstrap from `main.ts` `applyRoute` leaves it false so direct entry keeps all layers visible and an expanded layers panel.

## What was implemented (agent session)

### State & API

- `focusedCreationEnabled`, `layersPanelFocusedListExpanded` on `CreatorState`
- `creatorFocusedCreationSlice` (`notify({ enabled })`)
- `get/setFocusedCreationEnabled`, localStorage `creator:focusedCreation`
- `get/setLayersPanelFocusedListExpanded`

### Wardrobe → layers

- `getMemberLayerKeysForWardrobeLayer` in `wardrobePartsPanel.ts`
- `applyFocusedSoloForWardrobeLayer` on `LayerVisibilityApi`

### Controller & wiring

- `src/controllers/focusedCreationController.ts` — `creatorWardrobeFocusSlice`, `creatorModeSlice`, `creatorFocusedCreationSlice`
- Bootstrapped from `main.ts`; exported from `controllers/index.ts`
- First creator entry in **Wardrobe** with Focused ON: `getPreviewPreset('fullOutfit')` + FOV snap in `applyRoute`

### UI

- Focused / Free in `CameraControls.ts` (deps from `initCreator`)
- Layers panel: minimize visible, “Show all layers”, compact row filter, sync on layer/mode/focused slices
- Blocky 2D: `rebuildBlockyGrid` — union bounding box of visible layer/part rects when Focused + 2D + not full visibility; extra slice subscriptions

### Docs

- `docs/concepts/MODELS-AND-SUBSCRIBERS.md` — Focused Creation publishers/subscribers

### Caveats noted in session

- Blocky “square packing” of disjoint regions not done; **axis-aligned union** can include empty middle.
- Rulers may not align with a smaller focused grid until ruler layout is updated.

---

## Follow-up edits by maintainer (after this log)

The following were applied in the working tree and are **not** fully replayed above; they refine wardrobe behavior and UX:

- **`focusedCreationController.ts`**: Wardrobe keeps character fully visible when Focused ON (`applyFocusedSoloForWardrobeLayer('fullOutfit')` for camera path); uses **`getWardrobeHoverPreviewLayer`** for preset/camera while hovering tree rows; Focused OFF may apply solo from hover/selection per branch; `onModeChange` guards; extra `runWardrobeFocus` when entering `wardrobe` mode.
- **`main.ts` / `creator.ts`**: Wire `getWardrobeHoverPreviewLayer`; `setEditMode` clears hover when leaving wardrobe via `setWardrobeHoverPreviewLayer(null)`.
- **`wardrobe.ts`**: Exposes hover preview API (imported from wardrobe module in `creator.ts`).
- **`wardrobePartsPanel.ts`**: Hover sets preview layer; `mouseleave` clears; tree label/order tweaks (torso/jacket/bottom); dual-library focus helper for Space key; imports from `wardrobeLibraryPanels` + `wardrobe`.

For raw Cursor agent JSONL transcripts, copy from:

`~/.cursor/projects/Users-lynnfrank-src-minecraft-3d-viewer/agent-transcripts/`

(See `conversations/README.md`.)
