# Creator innerHTML Refactoring Plan

> **Status: COMPLETED.** This refactoring has been fully implemented. The document is retained as historical reference.

This document describes how to refactor `src/creator.ts` to reduce and improve `innerHTML` usage. Another agent or developer can follow these instructions to complete the work.

**Workflow:** Implement each phase in order. Before proceeding to the next phase, pause and ask the user for approval. Use TODOs to track progress.

---

## Phase 1: Extract panel builders into separate modules

Create `src/creator/` directory and extract each panel builder into its own file. Keep `creator.ts` as the orchestrator that imports and calls these builders.

### Files to create

| File | Contents to extract | Exports |
|------|---------------------|---------|
| `src/creator/toolbar.ts` | `buildToolbar()` | `buildToolbar` |
| `src/creator/colorPicker.ts` | `buildColorPickerPanel()`, `syncColorPickerFromHex()` | `buildColorPickerPanel`, `syncColorPickerFromHex` |
| `src/creator/swatches.ts` | `buildSwatchesPanel()`, `refreshSwatchGrid()`, `setupSwatchDropTargets()` | `buildSwatchesPanel`, `refreshSwatchGrid` |
| `src/creator/layersPanel3d.ts` | `buildLayersPanel3D()` | `buildLayersPanel3D` |
| `src/creator/toolsPanel3d.ts` | `buildToolsPanel3D()` | `buildToolsPanel3D` |
| `src/creator/hoverInfo.ts` | `buildHoverInfoPanel()` | `buildHoverInfoPanel` |

### Requirements

- Each module imports only what it needs (from `creatorEvents`, `types/color`, `skinLayout`, etc.).
- Each module may need to accept callback/hook parameters for things that interact with creator state (e.g. `applyColorToUI`, `currentColor`, `activeTool`, `editMode3D`, etc.). Consider passing these as arguments or importing from a small shared state module.
- `creator.ts` imports from `./creator/toolbar`, `./creator/colorPicker`, etc., and calls `buildToolbar()`, `buildColorPickerPanel()`, etc. in `initCreator()`.
- After extraction, `creator.ts` should be noticeably smaller; panel logic lives in dedicated modules.
- Run `npm run build` to verify. Fix any circular dependency issues (e.g. by moving shared state or events into a neutral module).

### Dependency notes

- `syncColorPickerFromHex` is used by `buildColorPickerPanel` and possibly elsewhere; keep it in `colorPicker.ts`.
- `refreshSwatchGrid` is called on `SWATCH_HISTORY_CHANGE`; the swatches module subscribes to that event.
- Layers and tools panels read/write `layer3DVisible`, `layer3DLocked`, `editMode3D`, `activeTool`, `showRulers`, `showTemplate`, etc. These may need to be passed in or accessed via a shared module—avoid circular imports.

---

## Phase 2: Replace innerHTML with DOM APIs for simple panels

Convert the following to use `document.createElement` and `appendChild` instead of `innerHTML`:

### 2a. Toolbar

- **Current:** `toolbar.innerHTML = \`<div class="creator-toolbar-row">...\``
- **Target:** Create `div`, `span`, `input` via `createElement`, set `className`, `value`, `placeholder`, etc., append in order.

### 2b. Hover info panel

- **Current:** `panel.innerHTML = '<span class="creator-hover-info-text">—</span>'`
- **Target:** Create `span`, set `className` and `textContent`, append to panel.

### 2c. Swatches panel header

- **Current:** `panel.innerHTML = \`<div class="creator-swatches-header">...</div><div class="creator-swatch-grid">...</div>\``
- **Target:** Create both divs, set attributes, append. The swatch grid container stays empty; `refreshSwatchGrid` populates it.

### Verification

- Run `npm run build`. Manually test: toolbar, hover info, swatches panel. Behavior should be identical.

---

## Phase 3: Replace innerHTML for larger panels (color picker, layers, tools)

### 3a. Color picker panel

- **Current:** Large template literal with `baseGradient`, `h`, `s`, `v`, `currentColor`, `shadingSwatches` interpolated.
- **Target:** Use `createElement` for each node, or introduce a small `el(tag, attrs, ...children)` helper in `src/creator/dom.ts` to reduce verbosity. Set `style.background`, `style.left`, `dataset.hue`, etc. explicitly.

### 3b. Layers panel

- **Current:** Template literal with `LAYER_GROUPS.flatMap(...)` producing layer rows and separators.
- **Target:** Loop over `LAYER_GROUPS`, create row divs and labels via DOM APIs. Set `data-layer`, `checked` on inputs, etc.

### 3c. Tools panel

- **Current:** Large static template with buttons, dividers, data attributes.
- **Target:** Build structure via `createElement` or `el()` helper. No user data is interpolated; structure is static.

### Verification

- Build and test: color picker, layers visibility/lock, tools (2D/3D mode, brush/eraser/fill/eyedropper, rulers, template, undo/redo).

---

## Phase 4: Optimize swatch grid refresh

### Current behavior

- `refreshSwatchGrid` rebuilds all 25 cells via `innerHTML = slots.join('')`, then runs `querySelectorAll` and `addEventListener` on each swatch.

### Target behavior

- Build each swatch element once with DOM APIs. Store references or use a fragment.
- On refresh, only update `style.backgroundColor`, `dataset.color`, `title` for slots whose color changed. Add/remove classes for filled vs empty.
- Attach click and drag listeners once at creation time.
- Avoid full innerHTML replace and re-binding on every `SWATCH_HISTORY_CHANGE`.

### Implementation sketch

```ts
// In swatches.ts
function createSwatchElements(container: Element): void {
  // Create 25 slots once, append to container
  // Attach listeners once
}
function refreshSwatchGrid(container: Element): void {
  // Iterate slots, update only changed ones (compare with swatchColors[i])
}
```

- `createSwatchElements` is called when the swatches panel is built.
- `refreshSwatchGrid` only updates existing DOM; no innerHTML, no re-binding.

---

## Reference: Current innerHTML locations in creator.ts

| Line (approx) | Target | Phase |
|---------------|--------|-------|
| 470 | Swatch grid | 1 (extract), 4 (optimize) |
| 545 | Skin gallery clear | N/A (already uses createElement for content) |
| 627–628 | Ruler clear | N/A (already uses createElement) |
| 718 | Toolbar | 1, 2a |
| 752 | Blocky grid clear | N/A (already uses createElement) |
| 938 | Hover info | 1, 2b |
| 1009 | Color picker | 1, 3a |
| 1188 | Swatches panel | 1, 2c |
| 1213 | Layers panel | 1, 3b |
| 1355 | Tools panel | 1, 3c |

---

## Checklist for completion

- [x] Phase 1: All panel builders extracted to `src/creator/*.ts`; `creator.ts` imports and calls them; build passes. (Uses API objects to avoid circular imports.)
- [x] Phase 2: Toolbar, hover info, swatches header use DOM APIs instead of innerHTML.
- [x] Phase 3: Color picker, layers panel, tools panel use DOM APIs or `el()` helper.
- [x] Phase 4: Swatch grid uses incremental DOM updates, no full innerHTML refresh on history change.
- [x] `npm run build` succeeds; manual testing confirms all creator features work.
