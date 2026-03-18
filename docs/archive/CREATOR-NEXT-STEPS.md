# Creator & Codebase — Next Steps for Cleanup

This document outlines recommended next steps for cleaning up the codebase after the creator refactoring (innerHTML removal, panel extraction, naming improvements). Use it to plan future work.

---

## What’s Done

- **Creator panels** extracted to `src/creator/`: toolbar, color picker, swatches, skin layers, editor tools, texture position.
- **innerHTML removed** in favor of DOM APIs; swatch grid uses incremental updates.
- **Naming refactor**: Context types (`ColorToolbarContext`, etc.), clearer method names (`applyColor`, `isLayersPanelCollapsed`), `getCreatorPanelsContainer()`.
- **Data model work** (per CREATOR-DATA-MODEL-ANALYSIS): layer keys, catalog types, mesh mapping, color type, coordinate module.

**Reference docs:** `CREATOR-INNERHTML-REFACTORING.md`, `CREATOR-DATA-MODEL-ANALYSIS.md`, `CREATOR-EVENT-REFACTORING-PLAN.md`.

---

## Next Steps (Prioritized)

### 1. Reduce `creator.ts` size ✓ (done)

`creator.ts` was reduced by extracting:

| Module | Contents |
|--------|----------|
| `creator/brush.ts` | `brushAt`, `drawLine`, `floodFill`, brush cursor helpers (`makeBrushCursorSVG`, `getBrushCursorStyleFor3D`, `getBrushCursorStyle2D`) |
| `creator/undo.ts` | Undo/redo stack, `performUndo`, `performRedo`, `updateUndoRedoButtons`, `applyPixelChanges` |
| `creator/skinIO.ts` | `captureCanvasImageData`, `putImageDataFromRGBA`, `loadSkinToCanvas`, `exportTo64x64DataURL` |
| `creator/blockyEditor.ts` | Blocky grid, rulers, template overlay, `renderToDisplay`, `buildBlockyGrid`, `buildRulers`, `setupBlockyGridEvents`, `fitCanvasAreaScale` |

---

### 2. Reduce `main.ts` size ✓ (done)

`main.ts` was reduced by extracting to `src/viewer/`:

| Module | Contents |
|--------|----------|
| `viewer/scene.ts` | Scene setup, camera, lights, ground, renderer, `applyShadowToModel`, `logModelUVInfo`, `logMeshNames`, `createDebugTexture` |
| `viewer/skinApplication.ts` | `applySkinToModel`, `applyCreatorLayerVisibility`, `configureTexture`, `MINECRAFT_SKIN_UVS`, `OVERLAY_SCALE` |
| `viewer/controls.ts` | Orbit controls, pointer handlers for creator 3D paint, `setupCreator3DPaint`, `updateOrbitControlsForEditMode`, `recreateOrbitControls`, `resetCameraFor2DPreview` |

---

### 3. Consolidate creator state ✓ (done)

Creator state is consolidated in `src/creator/creatorState.ts`:

- `CreatorState` interface holds all creator state (`currentColor`, `swatchColors`, `activeTool`, `editMode3D`, layer visibility/lock, undo/redo stacks, etc.).
- `createCreatorState()` returns the initial state object.
- `creator.ts` creates a single state instance and passes slices via context objects to panel builders (e.g. `layerVisibility: state.layer3DVisible`).

---

### 4. Archive completed refactoring docs ✓ (done)

- **CREATOR-INNERHTML-REFACTORING.md** — Mark as complete; move to `docs/archive/` or add a “Completed” header.
- **CREATOR-EVENT-REFACTORING-PLAN.md** — If events are fully migrated, mark complete.
- **CREATOR-DATA-MODEL-ANALYSIS.md** — Update the checklist; many items are done (layer keys, catalog types, mesh mapping, color type, coordinates).

---

### 5. Add unit tests

No tests are present. Targets:

- `types/color.ts` — `normalizeHex`, `isValidHex`, `hexToRgb`, `rgbToHex`, `hexToHsva`, `hsvaToHex`
- `skinCoordinates.ts` — `uvToWorkingCoords`, `workingToSkin`, `skinToWorking`
- `skinLayout.ts` — `partToLayer`, `isInDeadZone`
- `meshPartMapping.ts` — `getMinecraftPartFromMeshName`

Use Vitest (already in the stack via Vite) or another test runner.

---

### 6. Type safety ✓ (done)

- ~~Review `as` casts (e.g. `(btn as HTMLElement).dataset.tool`) and replace with guards or narrower types where practical.~~ Done: `querySelectorAll<HTMLButtonElement>`, `isDrawingTool`, `isToggleType`, `isLayerKey`, `instanceof` guards.
- ~~Ensure `DrawingTool` is used consistently~~ — `DrawingTool` is the canonical type; `isDrawingTool` guard added for dataset parsing.

---

### 7. CSS and class names ✓ (done)

- Creator uses `creator-*` classes. Consider a short audit for consistency and dead rules.
- If adopting CSS modules or a naming scheme, document it in a style guide.

---

## Suggested Order

1. **Archive/update docs** — Quick and clarifies what’s done.
2. ~~**creator.ts extraction**~~ — Done; see `creator/brush.ts`, `creator/undo.ts`, `creator/skinIO.ts`, `creator/blockyEditor.ts`.
3. **Unit tests** — Start with pure utilities (color, coordinates, layout).
4. ~~**main.ts extraction**~~ — Done; see `viewer/scene.ts`, `viewer/skinApplication.ts`, `viewer/controls.ts`.
5. ~~**State consolidation**~~ — Done; see `creatorState.ts`.
6. **Type safety and CSS** — Ongoing cleanup.

---

## Out of Scope (for now)

- Migrating to React/Vue/Svelte
- New features (e.g. layer groups, brushes)
- Build/bundle optimization (code splitting, etc.)

---

## References

| Doc | Purpose |
|-----|---------|
| `CREATOR-DATA-MODEL-ANALYSIS.md` | Data models, layer/part, coordinates |
| `CREATOR-INNERHTML-REFACTORING.md` | Completed innerHTML refactor plan |
| `CREATOR-EVENT-REFACTORING-PLAN.md` | Event bus migration |
| `CHARACTER-CREATION-SCREEN-SPEC.md` | Creator behavior spec |
| `docs/minecraft-skin-layout-specification.md` | Skin layout and UVs |
| `PLAN-GUIDE.md` | How to write plans in this project |
