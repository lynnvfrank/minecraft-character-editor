# Creator.Wardrobe: hover preview on body parts tree

**Saved:** 2026-03-26

## User request

In **Creator.Wardrobe**, when hovering over a body part in the wardrobe parts tree:

- That body part should be reflected on the character model.
- Moving hover to another part updates the preview to the new part.
- When not hovering a body part, the model returns to the **currently selected** part (user wrote “head” but intent was the active wardrobe row).
- Clicking a part remains **selection** only; that behavior must not change.

## Implementation summary

### State and API

- **`src/creator/wardrobe.ts`**
  - Module-level `wardrobeHoverPreviewLayer` with `getWardrobeHoverPreviewLayer()` and `setWardrobeHoverPreviewLayer(layer | null)`.
  - `setWardrobeHoverPreviewLayer` calls `creatorWardrobeFocusSlice.notify()` when the value changes.
  - `setWardrobeSelectedLayer` clears hover (`wardrobeHoverPreviewLayer = null`) before updating selection so click/keyboard selection stays authoritative.

### Focused creation controller

- **`src/controllers/focusedCreationController.ts`**
  - New dep: `getWardrobeHoverPreviewLayer`.
  - `runWardrobeFocus` uses `previewLayer = hover ?? selected`:
    - **Focused creation on:** `applyFocusedSoloForWardrobeLayer('fullOutfit')` then camera/FOV from `previewLayer` preset (same as before for selection, but preview follows hover).
    - **Focused creation off:** `applyFocusedSoloForWardrobeLayer(previewLayer)` so mesh visibility follows hover or selected row.

### UI wiring

- **`src/creator/wardrobePartsPanel.ts`**
  - `mouseenter` on each `.creator-wardrobe-parts-btn` calls `setWardrobeHoverPreviewLayer(node.key)` when `editMode === 'wardrobe'`.
  - `mouseleave` on `#creator-wardrobe-parts-panel` clears hover.

### Mode / exports

- **`src/creator.ts`** — `setWardrobeHoverPreviewLayer(null)` when leaving wardrobe (`setEditMode` where `mode !== 'wardrobe'`); re-exports `getWardrobeHoverPreviewLayer`.
- **`src/main.ts`** — passes `getWardrobeHoverPreviewLayer` into `createFocusedCreationController`.

## Follow-up note

With **focused creation off**, wardrobe previously kept the model fully visible (`fullOutfit`); after this change, solo visibility follows hovered or selected row. If product wants full body whenever focused creation is off, adjust `runWardrobeFocus` accordingly.

## This file

User asked to **save this conversation** in the `conversations` directory; this markdown is the archived summary. Raw Cursor agent transcripts (if desired) live under the Cursor project’s `agent-transcripts` path per `conversations/README.md`.
