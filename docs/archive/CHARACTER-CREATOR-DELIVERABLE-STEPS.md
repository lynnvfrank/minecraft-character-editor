# Character Creator — Deliverable Steps

A step-by-step implementation plan for the Character Creation Screen, broken into small, Cursor-friendly deliverables. **Excludes** server-side skin saving — only supports Download button (and right-click Save As on the canvas/preview image).

**Integration note:** When implementing, use data structures and module boundaries that align with [CREATOR-VIEWER-STATE-MANAGEMENT.md](./CREATOR-VIEWER-STATE-MANAGEMENT.md) so the character creator and viewer can integrate later without major refactors. The viewer transition itself is **not** implemented in these steps.

---

## Data Structure Guidelines (Future Integration)

To ease future creator↔viewer integration:

| Concept | Shape | Notes |
|--------|-------|-------|
| **Skin pixels** | `ImageData` or 64×64 `HTMLCanvasElement` | Same format the viewer expects (64×64 PNG). Use `canvas.toDataURL('image/png')` or `toBlob()` for export. |
| **Current skin** | `string` (path or data URL) | Matches what `switchSkin()` / viewer consumes. Creator can eventually read from a shared store. |
| **Layer region bounds** | Shared constants from `minecraft-skin-layout-specification` | Extract to `src/skinLayout.ts` (pixel bounds) so both creator and viewer import the same source of truth. |
| **Skin store** | Optional singleton | Define interface for `currentSkin`, `creatorDraft`, `dirty` — implement later; keep creator logic compatible (e.g., export functions that take/return skin data). |

---

## Step 1: Extract Skin Layout Constants

**Scope:** Shared module for pixel region bounds.

**Tasks:**
- Create `src/skinLayout.ts` with pixel bounds for each layer (Head, Hat, Body, Jacket, Arms, Sleeves, Legs, Pants) per [minecraft-skin-layout-specification.md](./minecraft-skin-layout-specification.md).
- Export something like `SKIN_LAYER_BOUNDS: Record<string, { x: number, y: number, w: number, h: number }[]>` for regions that may be disjoint (e.g., Arms = right + left).
- Optionally re-export or derive from existing `MINECRAFT_SKIN_UVS` in `main.ts` if useful.

**Deliverable:** `src/skinLayout.ts` with typed layer bounds. No UI changes.

---

## Step 2: Creator Route and Shell

**Scope:** Route + minimal creator page shell.

**Tasks:**
- Add hash-based routing (`#/creator`, `#/` or `#/home`) — listen for `hashchange`.
- Create creator HTML container (e.g., `#creator-panel`) with basic layout: toolbar area, canvas area, action buttons area.
- Show creator when route = `#/creator`, hide when not. Viewer stays on default route.
- No canvas drawing yet — placeholder or empty div where canvas will go.

**Deliverable:** Navigating to `#/creator` shows the creator shell. Can navigate back to viewer.

---

## Step 3: Canvas Setup and 64×64 Skin State

**Scope:** Canvas element, 64×64 backing store, zoomed display.

**Tasks:**
- Add 64×64 offscreen canvas (or `ImageData`) as the skin state.
- Add a display canvas (zoomed, e.g., 4× or 8×) that draws the skin.
- Initialize skin as blank (transparent) or load a default/placeholder.
- Use `src/skinLayout.ts` for reference (no layer UI yet).
- Use `ctx.imageSmoothingEnabled = false` for pixel-perfect rendering.

**Deliverable:** Creator shows a 64×64 skin canvas (zoomed). Edits not yet possible.

---

## Step 4: Basic Drawing — Brush and Color Picker

**Scope:** Brush tool, color selection, mouse drawing.

**Tasks:**
- Toolbar: brush tool (default), color swatch (current color).
- Color picker: eyedropper on canvas click + simple swatch (last 8–16 colors).
- Brush: 1–4 px size, round, draw on mouse down + move. Respect canvas bounds.
- Draw into the 64×64 backing store; redraw display canvas.
- Optional: hex input for exact color.

**Deliverable:** User can paint on the skin with a brush. Eyedropper and swatch work.

---

## Step 5: Eraser and Fill

**Scope:** Eraser and flood-fill tools.

**Tasks:**
- Eraser tool: same as brush but sets pixels to transparent.
- Fill tool: flood-fill at click. Stack-based iterative algorithm. Optional tolerance.
- Add tool buttons (Brush, Eraser, Fill); switch active tool.

**Deliverable:** Eraser and fill work. No layer masking yet (affects entire canvas).

---

## Step 6: Layer Selection and Layer-Aware Drawing

**Scope:** Layer checkboxes/tabs and drawing restricted to selected layers.

**Tasks:**
- UI: checkboxes or tabs for Head, Hat, Body, Jacket, Arms, Sleeves, Legs, Pants.
- Multi-select: allow more than one layer at a time.
- Layer mask: when drawing (brush, eraser, fill), only modify pixels inside selected layer regions (use `SKIN_LAYER_BOUNDS`).
- Visual: dim or lock non-selected regions (e.g., lower opacity overlay).

**Deliverable:** User selects layers; drawing only affects those regions. Non-selected regions dimmed.

---

## Step 7: Undo / Redo

**Scope:** Command-based undo/redo.

**Tasks:**
- Command stack: record brush strokes as point arrays `[{x,y,color},...]`, or snapshots for fill/delete.
- Undo: pop and revert. Redo: re-apply.
- Limit history (e.g., 50 steps). Coalesce brush moves into single stroke per undo.
- Toolbar: Undo / Redo buttons. Keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z) optional.

**Deliverable:** Undo and redo work for brush and fill.

---

## Step 8: Select Region and Delete

**Scope:** Marquee selection and delete.

**Tasks:**
- Marquee: click-drag rectangle. Store `{x, y, w, h}`. Optional: preset buttons ("Select head", "Select arms") using `SKIN_LAYER_BOUNDS`.
- Visual: dashed rectangle overlay.
- Delete: clear selected region to transparent. Respect layer mask if a layer is selected.
- Optional: "Clear layer" for selected layer(s).

**Deliverable:** User can select a region and delete pixels.

---

## Step 9: Download Button

**Scope:** Explicit Download button; no server save.

**Tasks:**
- "Download" button.
- On click: `canvas.toDataURL('image/png')` → create `<a download="skin-{timestamp}.png" href="...">` → programmatic click.
- Optional: right-click context menu on canvas with "Save image as..." (native browser behavior if canvas is focusable; otherwise ensure Download is prominent).

**Deliverable:** User clicks Download to save 64×64 PNG. Right-click save-as also works on the canvas element.

---

## Step 10: Toggleable Template Overlay

**Scope:** Reference overlay for model-to-2D mapping.

**Tasks:**
- Copy `docs/minecraft-skin-layout-detailed.png` or `docs/minecraft-skin-64x64-detailed.png` to `public/skin-template.png`.
- Toggle: "Show template" checkbox or button.
- When on: draw reference image as semi-transparent overlay (opacity ~0.3) above canvas, or draw region outlines from `SKIN_LAYER_BOUNDS`.
- Non-destructive: overlay only; does not affect pixel data.

**Deliverable:** User can show/hide a template overlay to understand skin layout.

---

## Step 11: Presets Per Layer

**Scope:** Apply preset images to layer regions.

**Tasks:**
- Define preset format: 64×64 PNG with relevant region filled (rest transparent).
- Preset panel: list presets per layer (e.g., "Jacket 1", "Jacket 2"). Start with a small set (or placeholders).
- "Apply preset": replace selected layer region(s) with preset pixels. Use `drawImage` into correct bounds.
- Store presets in `public/creator/presets/` or similar.
- **Swatch palette extractor:** When loading a skin or applying a preset, extract all unique colors from the affected pixels and add to the swatch (deduplicate, merge with existing). Full skin load → entire 64×64; preset apply → selected layer region(s) only.

**Deliverable:** User can apply presets to individual layers. Loaded/preset colors appear in swatch.

---

## Step 12: Randomize Button

**Scope:** One-click random combination of presets.

**Tasks:**
- "Randomize" button.
- For each layer with presets, pick a random preset and apply.
- Optional: "Randomize selected layers only".
- Optional: color shift (hue/saturation) for variety.

**Deliverable:** User clicks Randomize to generate a random skin from presets. Can edit further and download.

---

## Step 13: Paint on 3D Model

**Scope:** Paint directly on the 3D character; shared texture with 2D canvas.

**Tasks:**
- Add 3D preview: same character model as viewer, with skin texture that updates in real time.
- Edit mode toggle: "Edit 2D" (canvas receives input) vs "Edit 3D" (3D view receives input).
- Raycasting: on mouse click in 3D view, use Three.js `Raycaster` → mesh intersection → face UVs → pixel (x, y) on 64×64 texture. Handle coordinate flip for top-left origin.
- Apply brush/eraser at computed pixel; write to shared skin texture; call `texture.needsUpdate = true`.
- Eyedropper on 3D: sample pixel at raycast hit; add to swatch.
- Fill on 3D: seed flood-fill from raycast pixel.
- Layer mask: ignore clicks on regions outside selected layer(s), or provide feedback.
- Orbit/rotate camera so user can paint all sides; distinguish paint drag from orbit (e.g., orbit on right-drag, paint on left-drag).
- Undo/redo: 3D paint strokes use same command stack as 2D (record by pixel coordinates).

**Dependencies:** `skinLayout.ts`, 3D model/scene setup, shared texture between canvas and Three.js.

**Deliverable:** User can paint on the 3D character; edits sync to 2D canvas and vice versa.

---

## Step 14: Polish and Navigation (No Transitions Yet)

**Scope:** Basic polish; prepare for future integration.

**Tasks:**
- Viewer: add "Edit character" button → set route to `#/creator`.
- Creator: add "Home" / "View character" button → set route to `#/` or `#/home`.
- Optional: brush size UI, tooltips.
- Ensure creator uses `skinLayout.ts` and exports skin data in a format compatible with `switchSkin()` (path or data URL) so future integration is straightforward.

**Deliverable:** Edit/Home navigation. Creator ready for future shared state and transitions.

---

## Summary: Order and Dependencies

| Step | Depends On | Delivers |
|------|------------|----------|
| 1 | — | `skinLayout.ts` |
| 2 | — | Creator route + shell |
| 3 | 1 | Canvas + 64×64 skin state |
| 4 | 3 | Brush + color picker |
| 5 | 4 | Eraser + fill |
| 6 | 1, 3 | Layer selection + layer-aware drawing |
| 7 | 4, 5 | Undo/redo |
| 8 | 3, 6 | Select + delete |
| 9 | 3 | Download button |
| 10 | 1, 3 | Template overlay |
| 11 | 6 | Layer presets |
| 12 | 11 | Randomize |
| 13 | 3, 4–7 | Paint on 3D model |
| 14 | 2–13 | Edit/Home navigation, polish |

**Excluded (per scope):**
- Server save (`POST /api/skin/save`)
- Viewer state persistence / shared `skinStore`
- Scene transitions (View Transitions API, Tween.js)
