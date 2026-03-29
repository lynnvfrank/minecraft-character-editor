# Models and subscribers (creator state)

**Audience:** humans and agents working in this repo.

Creator **editor state** (layers, canvas, mode, color, swatches, hover info, skin load, lock feedback, wardrobe focus, 2D paint mask, focused creation toggle) uses **in-process subscribers** in [`src/state/creatorSlices.ts`](../../src/state/creatorSlices.ts), built on [`src/lib/subscribable.ts`](../../src/lib/subscribable.ts).

The **document `CustomEvent` bus** ([`src/events/appEvents.ts`](../../src/events/appEvents.ts)) is reserved for **cross-boundary commands**, not for syncing two DOM panels to the same state.

---

## Two channels

| Channel | Use for | API |
|--------|---------|-----|
| **Slices** | Creator UI staying in sync with shared state; `main` marking the 3D preview dirty | `creator*Slice.subscribe` / `creator*Slice.notify` (payload slices use `notify(detail)`) |
| **Document bus** | Creator **camera** commands (DOM → Three.js rig); **character** skin/animation commands (UI, socket, tools → `characterEvents`) | `publish` / `subscribe` on `document` |

---

## Adding a new bucket

1. Hold data in [`CreatorState`](../../src/state/creatorState.ts) or a small module, as today.
2. Add a `createSubscribable()` or `createPayloadSubscribable<T>()` export in `creatorSlices.ts` (or a dedicated slice module if it grows).
3. After every successful mutation, call **`notify()`** (or **`notify(payload)`**).
4. In DOM builders, **`subscribe`** and guard with `document.body.dataset.route === 'creator'` when the UI only applies in creator.
5. For Three.js, prefer **one** subscriber that sets a **dirty flag** or applies pose—do not subscribe inside the render loop.

---

## Focused Creation (subscribers and publishers)

**Publishers (`notify`):**

- **`creatorWardrobeFocusSlice`** — [`wardrobeApi.setWardrobeSelectedLayer`](../../src/creator/wardrobe.ts) after updating selection.
- **`creatorModeSlice`** — [`setEditMode`](../../src/creator.ts) with payload including `fromUserModeNavigation` when the mode change comes from the mode bar or Tab (not from route bootstrap).
- **`creatorFocusedCreationSlice`** — [`setFocusedCreationEnabled`](../../src/creator.ts) / [`setLayersPanelFocusedListExpanded`](../../src/creator.ts) after state updates.
- **`creatorLayerSlice`** — layer visibility / lock / part mutations in [`layerVisibility.ts`](../../src/creator/layerVisibility.ts), including [`applyFocusedSoloForWardrobeLayer`](../../src/creator/layerVisibility.ts).

**Subscribers:**

- **`focusedCreationController`** ([`focusedCreationController.ts`](../../src/controllers/focusedCreationController.ts)) — wardrobe selection → preview preset camera + solo; Wardrobe → 3D/2D (user navigation only) → solo + layers panel list mode; focused toggle → refresh wardrobe camera when in Wardrobe.
- **Layers panel** ([`skinLayersPanel.ts`](../../src/creator/skinLayersPanel.ts)) — compact vs expanded row filter; checkbox sync on `creatorLayerSlice`, `creatorModeSlice`, `creatorFocusedCreationSlice`.
- **Blocky 2D grid** ([`blockyEditor.ts`](../../src/creator/blockyEditor.ts)) — rebuild focused union-bbox layout on `creatorLayerSlice`, `creator2dPaintSlice`, `creatorModeSlice`, `creatorFocusedCreationSlice`.

**`creator2dPaintSlice`** still covers selected-layer paint mask; painting rules align with visible regions when Focused layout is active.

---

## Wardrobe metadata source

Use [`src/creator/wardrobeLayers.ts`](../../src/creator/wardrobeLayers.ts) as the single source of truth for wardrobe layer metadata and relationships:

- `WardrobeLayerKey` / `WardrobePartKey` types
- `WARDROBE_LAYER_TREE`, `WARDROBE_LAYERS`, `WARDROBE_PART_KEYS`
- `getMemberLayerKeysForWardrobeLayer` (wardrobe row -> atomic layer set)
- dual-library pairing helpers (`isWardrobeDualLibrarySplitLayer`, `areWardrobeLayersSameDualLibraryPair`)

When adding or renaming wardrobe rows, update `wardrobeLayers.ts` first, then UI labels/panels as needed.

---

## Play / home mode (future)

Use the same **`subscribable`** helper for runtime state (poses, minigame flags). Keep **commands** that cross process boundaries on the bus or a dedicated IPC layer.

---

## Tests

Run `npm test` — includes [`src/lib/subscribable.test.ts`](../../src/lib/subscribable.test.ts).
