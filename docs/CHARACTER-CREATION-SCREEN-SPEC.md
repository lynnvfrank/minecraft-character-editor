# Character Creation Screen Specification

A specification for building a character creation screen that lets users draw on a Minecraft-style character, choose partial layers (arms, legs, jacket, pants, hats, heads, etc.), randomize combinations, and save/download skins — with integration into the local webapp instead of relying on right-click-to-save.

---

## Table of Contents

1. [Context and Goals](#context-and-goals)
2. [Existing Skin Editor Assumptions](#existing-skin-editor-assumptions)
3. [Character Creation Features](#character-creation-features)
4. [Paint on 3D Model](#paint-on-3d-model)
5. [Layer System](#layer-system)
6. [Randomization](#randomization)
7. [Save and Download Integration](#save-and-download-integration)
8. [Rulers and Grid](#rulers-and-grid)
9. [Technical Architecture](#technical-architecture)
10. [Implementation Phases](#implementation-phases)
11. [Integration with 3D Model Viewer](#integration-with-3d-model-viewer)
12. [Toggleable Template Layer (Model-to-2D Translation)](#toggleable-template-layer-model-to-2d-translation)
13. [Tools: Undo, Paint, Fill, Select, Delete, Color Picker](#tools-undo-paint-fill-select-delete-color-picker)
14. [Existing Libraries and Tools](#existing-libraries-and-tools)

---

## Context and Goals

### Current State (Typical Skin Editors)

- Standalone HTML page with canvas for drawing on a 64×64 skin texture.
- User must **right-click → Save Image** to export.
- No integration with the viewer; saved file must be manually placed and selected.

### Desired State

- **Character creation screen** — Game-like creator with:
  - Drawing/painting on the character
  - **Partial layer selection** — Toggle or choose layers (arms, legs, jacket, pants, hat, head)
  - **Randomization** — One-click random combination of layers/colors
  - **Download** — Explicit "Download" button
  - **Save to webapp** — Save directly into the running viewer (e.g., add to skin list, apply immediately)

### Reference

- [minecraft-skin-layout-specification.md](./minecraft-skin-layout-specification.md) — 64×64 layout, region bounds for head, hat, body, jacket, arms, legs, pants, sleeves.

---

## Existing Skin Editor Assumptions

If a skin editor exists on main (or another branch):

- Likely provides: canvas, color picker, brush, eraser, layer visibility.
- Output: 64×64 PNG.
- Limitation: right-click save only.

**What to preserve:** Canvas drawing logic, skin layout constants, color handling.

**What to add:** Layer selection UI, randomization, download button, webapp integration.

If no skin editor exists, the spec below describes building one from scratch with these features.

---

## Character Creation Features

### 1. Drawing / Painting

- **Canvas** — 64×64 pixel grid (or zoomed view for usability). Higher-resolution working canvas (e.g., 128×128) with downscale export for pixel-perfect 64×64 output.
- **Display quality** — Use `image-rendering: pixelated` and `imageSmoothingEnabled = false` for blocky, non-blurry pixel art. Account for device pixel ratio where needed.
- **Rulers** — Toggleable rulers in **separate strips** above and to the left of the canvas (not overlaying the image). Coordinate system: (0, 0) at upper-left, (64, 64) at lower-right.
- **Grid lines** — Toggleable grid overlay. Default: every 4 pixels (vertical and horizontal). Extensible settings (spacing, color, line width).
- **Tools:** Brush, eraser, fill, color picker.
- **Brush** — Square block brush (not round). Sizes: 1, 2, 4, 8 pixels. A click fills the entire square.
- **Brush cursor** — Custom box-outline cursor that matches the brush size. Sizes correctly with canvas scale and `devicePixelRatio` so the cursor visually matches the drawn area.
- **Layer awareness:** Drawing affects only the selected layer(s). See [Layer System](#layer-system).

### 2. Layer Selection (Partial Layers)

Users can **focus on** or **toggle visibility** of body parts. This supports:

- **Edit one part at a time** — Select "arms" to only draw on arm regions; other regions dimmed or locked.
- **Choose which parts to customize** — E.g., "I want to change only the jacket"; hide others for clarity.
- **Template / preset layers** — Start from a base skin and replace specific layers with templates.

### Layer Categories (Minecraft 64×64)

| Layer | Region (from spec) | Purpose |
|-------|--------------------|---------|
| **Head** | X:0–32, Y:0–16 | Face, hair base |
| **Hat** | X:32–64, Y:0–16 | Helmet, hair overlay, accessories |
| **Body** | X:16–32, Y:16–32 | Torso |
| **Jacket** | X:16–32, Y:32–48 | Jacket + sleeves overlay |
| **Arms** | X:40–56, Y:16–32 (right), X:32–48, Y:48–64 (left) | Arms primary |
| **Sleeves** | X:40–56, Y:32–48 (right), X:48–64, Y:48–64 (left) | Sleeve overlays |
| **Legs** | X:0–16, Y:16–32 (right), X:16–32, Y:48–64 (left) | Legs primary |
| **Pants** | X:0–16, Y:32–48 (right), X:0–16, Y:48–64 (left) | Pants overlays |

**UI for layers:**

- **Checkboxes or tabs** — "Head", "Hat", "Body", "Jacket", "Arms", "Sleeves", "Legs", "Pants".
- **Multi-select** — Allow editing multiple layers at once (e.g., arms + sleeves).
- **Dim/lock** — When a layer is not selected, show it dimmed or read-only in the canvas.

### 3. Skin Gallery

- **Gallery in creator** — Fetches `/skins/index.json` and displays skin thumbnails. Clicking a thumbnail loads that skin into the 2D editor.
- **Load as undoable** — Loading a skin pushes a `load` command onto the undo stack (before/after `ImageData`). Undo/redo works for skin loads (Ctrl+Z / Ctrl+Shift+Z).
- **64×64 and 64×32** — Handles both formats: 64×64 draws full image; 64×32 draws upper half, leaves jacket/sleeves/pants regions transparent.

### 4. Presets / Templates

- **Pre-made layer graphics** — E.g., "Jacket 1", "Jacket 2", "Pants A", "Hat styles".
- User selects a preset for a layer; it replaces that layer's pixels.
- Presets stored as 64×64 PNGs with only the relevant region filled (rest transparent).

### 5. Color Palette

- **Recent colors** — Last N used colors.
- **Preset palettes** — Skin tones, common Minecraft colors, custom.
- **Hex input** — For exact colors.
- **Swatch palette extractor** — When a skin (or selected layer regions) is loaded, extract all unique colors from that image and add them to the swatch. Supports:
  - **Full skin load** — Loading a skin image (e.g., from file or preset) adds all colors used in the 64×64 texture to the swatch.
  - **Partial extraction** — When loading a preset into a layer, or when a subset of layers is selected, extract colors only from the relevant region(s) and add to the swatch.
  - **Deduplication** — Merge with existing swatch; avoid duplicates. Optionally sort by frequency (most-used colors first) or by hue.

---

## Paint on 3D Model

In addition to the 2D canvas, users can **paint directly on the 3D character model**. This provides spatial context: users see exactly where strokes land on the body (face, arms, legs, etc.) and can rotate the model to reach occluded areas.

### Behavior

- **3D preview** — A live 3D view of the character using the same model as the viewer. Texture updates in real time as the user edits.
- **Paint mode** — When painting on 3D, mouse click/drag performs raycasting: screen position → 3D ray → mesh intersection → UV coordinates → 64×64 pixel position. The same brush, eraser, and color picker apply; edits write to the shared skin texture.
- **Layer awareness** — Layer selection (head, arms, jacket, etc.) restricts which regions accept paint. Clicks on non-selected regions are ignored or trigger "select this layer" feedback.
- **Orbit/rotate** — Camera controls (orbit, zoom) let the user rotate the character to paint all sides. Pan/zoom should not conflict with paint gestures (e.g., distinguish click-drag for paint vs. orbit).

### Technical Approach

- **Raycasting** — Use Three.js `Raycaster` with `Mesh.raycast()` to find the intersected face. Read face UVs from geometry to map hit point → (u, v) → pixel (x, y) on the 64×64 texture. Flip V if the texture uses top-left origin.
- **UV → pixel** — `pixelX = Math.floor(u * 64)`, `pixelY = Math.floor((1 - v) * 64)` (adjust for coordinate system).
- **Shared texture** — The 3D model's texture is the same `CanvasTexture` or `DataTexture` as the 2D editor. Editing in either view updates the other.
- **Fill on 3D** — Flood fill from the clicked UV/pixel; same algorithm as 2D but seed from raycast result.
- **Eyedropper on 3D** — Sample the pixel at the raycast hit; add to color swatch.

### UI

- **Edit mode toggle** — "2D" vs. "3D" buttons in the toolbar. Default: **3D mode** (paint on 3D model).
- **Layout by mode:**
  - **Edit 3D:** Large 3D view fills the right panel; 2D canvas is hidden. Left-drag paints; right-drag orbits.
  - **Edit 2D:** Large 2D canvas fills the right panel; 3D preview moves to creator panel (after toolbar, 256px height). 2D canvas scales to fill available space.
- **Undo/redo** — Same command stack; 3D paint strokes are recorded the same way as 2D (pixel coordinates + color).
- **Sync** — 2D canvas and 3D texture always reflect the same skin state. No separate "apply" step.

### Implementation Notes

- **Mesh structure** — The model may use merged geometry (e.g., single Character mesh) or per-part meshes (head, body, arm, etc.). UV mapping must be known and consistent with `minecraft-skin-layout-specification`. If the FBX supplies UVs, use them; otherwise the UV table from `main.ts` applies.
- **Performance** — Real-time texture updates (e.g., `texture.needsUpdate = true` on each stroke) are typically fine for 64×64. Coalesce rapid brush moves if needed.
- **Depth buffer** — Ensure the 3D character is rendered and raycastable; avoid UI or overlay elements blocking rays.
- **Mouse buttons in Edit 3D** — Disable OrbitControls LEFT for rotate; use LEFT for paint, RIGHT for orbit. In Edit 2D, LEFT restores orbit for the small preview.
- **OrbitControls and DOM movement** — When the 3D view is moved in the DOM (e.g., between main area and preview slot on mode switch), OrbitControls event handling can break. **Recreate OrbitControls** (dispose + new instance) when switching back to 3D mode.
- **Camera reset for 2D preview** — When switching to Edit 2D, re-center and zoom out the camera (e.g., position `(0, 1.5, 4)`, target `(0, 1, 0)`) so the full character fits in the small preview.

---

## Randomization

### "Randomize" Button

- **Full random** — Pick random preset for each layer (from available presets) and combine.
- **Partial random** — Randomize only selected layers (e.g., only hat and jacket).
- **Color shift** — Optionally randomize hue/saturation of the result for variety.

### Randomization Sources

- **Preset pool** — Each layer has a list of presets (images or procedural patterns).
- **Procedural** — Generate random colors/patterns per region (simple: random solid colors; complex: noise, stripes).
- **Weighted** — Some presets more common than others.

### Result

- Combined into a single 64×64 skin.
- User can further edit, then save or download.

---

## Save and Download Integration

### Download Button

- **Explicit "Download" button** — No right-click required.
- **Filename** — Auto-generated (e.g., `skin-{timestamp}.png`) or user-provided.
- **Format** — PNG, 64×64.
- **Implementation:** `canvas.toDataURL('image/png')` → create `<a download="...">` and click programmatically.

### Save to Webapp (Local)

**Goal:** Save the created skin so the running viewer can use it immediately.

**Options:**

1. **LocalStorage / IndexedDB**
   - Store PNG as base64 or Blob in IndexedDB.
   - Viewer reads from a "custom skins" list on load.
   - **Limitation:** Size limits; no persistence across devices.

2. **File System Access API** (if available)
   - Let user pick a folder (e.g., `public/skins/`) and save the file there.
   - Requires user gesture and support (Chrome).

3. **Local Backend / Dev Server**
   - Character creator runs in the same app or a sibling route (e.g., `/creator`).
   - "Save" POSTs the PNG to a local API (e.g., `POST /api/skin/save`).
   - Server writes to `public/skins/custom/` and updates `skins/index.json`.
   - Viewer reloads skin list or receives socket event to refresh.
   - **Best for local dev:** Vite dev server + simple Express/Fastify route.

4. **Same-Origin Same-App**
   - Creator and viewer are on the same origin (e.g., `localhost:5173`).
   - Creator exposes a way to pass the skin data (e.g., `postMessage` to parent, or shared state).
   - "Apply to viewer" — Viewer receives the PNG, adds to its skin list, applies to character.
   - No file system write; skin lives in memory until page reload.

### Recommended Approach for Local Development

- **Download** — Always provide; works everywhere.
- **Save to webapp** — Implement via local API:
  - Add `POST /api/skin/save` that accepts multipart/form-data or base64 PNG.
  - Server saves to `public/skins/custom/{id}.png`.
  - Server appends to `public/skins/index.json` (or merges with existing).
  - Viewer: either reload page, or socket/API to "refresh skins" and then `switchSkin` to the new one.

### Creator as Separate Route vs. Separate Page

- **Same app, different route** — e.g., `/` = viewer, `/creator` = character creator. Shared code (skin layout, API client).
- **Separate HTML page** — Creator is `creator.html`; communicates with viewer via `postMessage` or shared backend. More isolation but more setup.

---

## Rulers and Grid

### Rulers

- **Toggle** — Button to show/hide rulers.
- **Coordinate system** — (0, 0) at upper-left, (64, 64) at lower-right, matching the 64×64 skin layout.
- **Placement** — Horizontal ruler in a strip **above** the canvas; vertical ruler in a strip **to the left** of the canvas. Rulers do not overlay the image. Layout collapses when rulers are off (canvas fills the area). Canvas area scales to fit; no scrolling.

### Grid Lines

- **Toggle** — Button to show/hide grid lines.
- **Default spacing** — Every 4 pixels (vertical and horizontal). Lines at 0, 4, 8, 12, …, 64 in skin space.
- **Extensible settings** — Grid configuration (spacing, color, line weight) should be structured so additional options can be added later (e.g., grid spacing X/Y, major vs minor lines).

### UI

- **Toggle buttons** — "Rulers" and "Grid" in the toolbar (or near the canvas) to enable/disable each overlay.
- **Non-destructive** — Rulers and grid are visual guides only; they do not affect exported pixels.

---

## Technical Architecture

### Component Structure

```
/creator (route or page)
├── Creator panel (left)
│   ├── Skin gallery (load from index; thumbnails; load into editor; undoable)
│   ├── Toolbar (Edit 2D/3D toggle, tools, brush size, color, View: Rulers/Grid/Template)
│   ├── 3D preview slot (Edit 2D only; 256px; after toolbar; camera re-centered)
│   └── Actions (Download)
├── Creator view wrapper (right; main view area)
│   ├── Canvas area (Edit 2D: large, scales to fill; Edit 3D: hidden)
│   │   ├── Rulers (toggle; top + left strips)
│   │   ├── Grid overlay (toggle; every 4 px)
│   │   └── Display canvas + template overlay
│   └── 3D view (Edit 3D: large, fills area; Edit 2D: moved to preview slot)
├── Layer selector (checkboxes/tabs)
├── Preset panel (per layer)
├── Randomize button
└── Save to webapp button
```

### Data Flow

- **Skin state** — Single `ImageData` or offscreen canvas (64×64). All edits write here.
- **Layer mask** — When editing "arms only", only pixels in arm regions are writable.
- **Presets** — Loaded as images; `drawImage` into the appropriate region of the skin canvas.
- **Export** — `canvas.toDataURL('image/png')` or `toBlob()`.

### File Locations (Suggested)

| File | Purpose |
|------|---------|
| `public/creator/` or `src/creator/` | Creator UI and logic |
| `public/skins/custom/` | Saved custom skins (gitignored or committed) |
| `public/skins/index.json` | Manifest; updated when saving |
| `scripts/save-skin-api.js` or Vite/Express route | `POST /api/skin/save` |

### Skin Layout Constants

- Reuse or import from `minecraft-skin-layout-specification.md` / existing `MINECRAFT_SKIN_UVS` or equivalent.
- Map UV regions to pixel bounds: e.g., head = (0,0)-(32,16) in 64×64.
- Use for layer masks and preset blitting.

---

## Implementation Phases

### Phase 1: Basic Creator

- Canvas, brush, eraser, color picker.
- Full skin editing (all layers at once).
- Download button.
- Optional: 2D preview (flattened skin layout).

### Phase 2: Layer Selection

- Layer checkboxes/tabs.
- Restrict drawing to selected layer regions (mask).
- Dim non-selected regions.

### Phase 3: Presets and Randomization

- Preset images per layer (or procedural).
- "Apply preset" per layer.
- "Randomize" button — combine random presets.

### Phase 4: Save to Webapp

- Backend route `POST /api/skin/save`.
- Save to `public/skins/custom/`.
- Update `skins/index.json`.
- Creator "Save" button calls API.
- Viewer: refresh skin list, optionally switch to new skin.

### Phase 5: Paint on 3D Model

- 3D preview: a character model wearing the skin is visible while editing; texture updates in real time.
- Edit 2D / Edit 3D mode toggle.
- Raycasting: screen click → UV → pixel; brush, eraser, fill, eyedropper on 3D.
- Layer-aware paint on 3D (restrict to selected layers).
- Shared texture so 2D and 3D edits stay in sync.

### Phase 6: Polish

- Undo/redo.
- Export to legacy 64×32 if needed.

---

## Integration with 3D Model Viewer

The character creator should merge with the app that currently displays the 3D model viewer (character's home), so users can switch between editing and viewing their character in the same session.

### Live 3D Preview While Editing

While the user edits the skin (in either 2D canvas or paint-on-3D mode), a **3D model wearing the current skin** is visible at all times. The character wears the skin texture as it is being edited; updates apply to the model in real time. This preview uses the same character model as the viewer and shares the texture with the editor.

- **Layout by edit mode:**
  - **Edit 3D (default):** Creator panel (left) has toolbar, gallery, actions. Large 3D view fills the right panel. 2D canvas is hidden.
  - **Edit 2D:** Creator panel has toolbar, gallery, small 3D preview (256px, after toolbar), actions. Large 2D canvas fills the right panel and scales to fill available space.
- **DOM placement** — The 3D view container is moved between the main area and the creator-panel preview slot when switching modes. Call `onWindowResize()` after the move so the renderer resizes; recreate OrbitControls when switching back to 3D.
- **Initial skin** — On scene load, a random skin is selected. When entering creator, the 2D editor is populated with that skin so 2D and 3D stay in sync.

### Integration Approach

- **Same app, different route** — e.g., `/` or `/home` = 3D viewer, `/creator` = character editor. Single HTML entry, shared code.
- **Shared code** — Skin layout constants (`MINECRAFT_SKIN_UVS` or equivalent from `main.ts`), skin loading, `applySkinToModel` logic. Both use the same 64×64 format and preprocessing.
- **Shared state** — Current skin path; when user saves from creator, the viewer can apply the new skin immediately. See [Creator–Viewer State Management](./CREATOR-VIEWER-STATE-MANAGEMENT.md) for preserving draft state, switching, and scene transitions.
- **Entry points** — "Edit character" button in viewer → navigate to `/creator`. "View character" / "Home" in creator → navigate to `/` or `/home`.

### Effort Estimate

| Task | Effort | Notes |
|------|--------|-------|
| Add routing (Vite + simple router or hash-based) | Low | No React; use `history.pushState` + route handler or `<a href="#/creator">` |
| Extract skin layout constants to shared module | Low | Move from `main.ts` to `src/skinLayout.ts` or similar |
| Creator route/page with canvas | Medium | New HTML structure, CSS, creator entry script |
| Shared skin list + apply flow | Low | Creator saves; viewer listens for refresh or reads from shared store |
| "Edit" / "Home" navigation UI | Low | Buttons that switch route |

### Router Options (No Framework)

- **Hash-based** — `location.hash` = `#/creator` or `#/`. Listen for `hashchange`. Zero dependencies.
- **History API** — `history.pushState`, `popstate`. Requires server to serve `index.html` for `/creator` (Vite dev server can be configured).
- **Tiny router** — e.g., `navigo`, `page.js` if a minimal library is acceptable.

---

## Toggleable Template Layer (Model-to-2D Translation)

A **toggleable template overlay** helps users understand how the 2D skin texture maps to the 3D model. When enabled, it shows region boundaries or a reference diagram overlaid on the canvas.

### Reference Images (Optional)

- **`docs/minecraft-skin-layout-detailed.png`** — Annotated skin layout with face labels (TOP HEAD, FACE HEAD, etc.).
- **`docs/minecraft-skin-64x64-detailed.png`** — 64×64 grid layout diagram.
- **Implementation alternative** — Draw region outlines programmatically from `SKIN_LAYER_BOUNDS` (no image needed).

### Behavior

- **Toggle** — "Template" button in the View section (alongside Rulers, Grid). Shows region outlines over the 2D canvas.
- **Overlay** — Render the reference image as a semi-transparent layer (e.g., `opacity: 0.3`) or draw region rectangles from the layer bounds (semi-transparent fill + stroke).
- **Non-destructive** — Template is visual only; it does not affect the canvas pixels.
- **Region labels** — Optional: draw text labels (head, hat, body, etc.) at region centers.

### Implementation

- **Programmatic outlines** — Use `SKIN_LAYER_BOUNDS` from `skinLayout.ts` to draw rectangles on the overlay canvas. Scale from 64×64 skin space to display size. Semi-transparent cyan stroke/fill works well.
- **Reference image** — If available: copy layout images to `public/skin-template.png`, load with `new Image()`, draw with reduced opacity on the overlay layer.

---

## Tools: Undo, Paint, Fill, Select, Delete, Color Picker

### Robust Undo

- **Command pattern** — Store operations (brush stroke, fill, load skin, delete, paste) as reversible commands. Undo = execute inverse; redo = re-execute.
- **Point-based history** — For brush strokes: record `[{x,y,color}, ...]` per stroke. Undo = redraw canvas from initial state up to previous stroke. More memory-efficient than full canvas snapshots.
- **Load command** — For skin loads: store `{ type: 'load', beforeData, afterData }` (Uint8ClampedArray snapshots). Undo restores beforeData; redo restores afterData.
- **Snapshot fallback** — For complex ops (paste, fill large area), store a before/after `ImageData` or canvas PNG. Use sparingly to avoid memory bloat.
- **History limit** — Cap at N steps (e.g., 50–100). Drop oldest when full.
- **Coalescing** — Merge consecutive brush moves into a single stroke for undo (one undo = entire stroke, not per pixel).

### Paint Brush

- **Size** — 1, 2, 4, 8 px (square block brush). **Default: 2 px.**
- **Shape** — Square block. A click fills the entire brush-size square centered at the click. Use `ctx.fillRect` for pixel-perfect blocks.
- **Anti-aliasing** — `ctx.imageSmoothingEnabled = false` for pixel-perfect (Minecraft style).
- **Layer mask** — Only draw on selected layer regions; ignore clicks outside.

### Fill

- **Flood fill** — Seed at click; fill connected pixels matching target color. Use iterative (stack-based) algorithm to avoid recursion overflow.
- **Tolerance** — Optional delta for anti-aliased edges (e.g., fill pixels within ±5 of target RGB).
- **Layer-aware** — Restrict fill to selected layer region(s); do not bleed into other layers.

### Select Region

- **Marquee** — Click-drag rectangle. Store `{x, y, w, h}`.
- **Region preset** — "Select head", "Select arms" etc. — use layer bounds from spec.
- **Visual feedback** — Dashed rectangle or highlight overlay.

### Delete

- **Delete selection** — Clear pixels in selected region to transparent (or base color). Respect layer mask.
- **Clear layer** — "Clear head", "Clear arms" — reset that layer's region to transparent/base.

### Color Picker

- **Eyedropper** — Click on canvas to sample pixel color. Use `ctx.getImageData(x, y, 1, 1).data`.
- **Swatch maintainer** — Store last N used colors (e.g., 8–16). Display as clickable swatches. Add to swatch when user picks or applies a color.
- **Swatch palette extractor** — When loading a skin or applying a preset to a layer, scan the image data for unique colors and add them to the swatch. Full skin load extracts from entire 64×64; partial load (e.g., preset into selected layer) extracts only from affected region(s). Deduplicate against existing swatch; optionally sort by frequency or hue.
- **Palette presets** — Skin tones, common Minecraft colors. Load from config or image.
- **Hex input** — Text field for exact `#RRGGBB` entry.

---

## Existing Libraries and Tools

### Canvas / Drawing

| Library | Purpose | Fit |
|---------|---------|-----|
| **Fabric.js** | Canvas library with objects, brushes, filters | Full-featured; may be heavyweight for 64×64 pixel editor. Good for brushes, I/O. |
| **Konva** | 2D canvas framework, React/Vue/Svelte support | Good if using React. Object-oriented; may abstract away raw pixel access. |
| **Raw Canvas API** | `CanvasRenderingContext2D`, `ImageData` | Lightweight; full control. Sufficient for 64×64 pixel editing. **Recommended** for minimal deps. |

### Undo / Redo

| Library | Purpose | Fit |
|---------|---------|-----|
| **undo-canvas** | Adds undo/redo to `CanvasRenderingContext2D` | Direct canvas integration. |
| **canvas-history.js** | Binds undo/redo to canvas 2D context | Similar; check maintenance. |
| **Reddo.js** | Framework-agnostic history (commands) | Lightweight; use with custom commands (brush, fill, delete). |
| **Custom command stack** | Implement command pattern in-house | ~50–100 LOC; full control. **Recommended** for predictable behavior. |

### Color Picker / Swatch

| Library | Purpose | Fit |
|---------|---------|-----|
| **Coloris** | Vanilla JS color picker, accessible | Full picker (HSL, hex). Good for "choose color" dialog. |
| **Swatchy.js** | Swatch picker, predefined palette | Good for quick palette selection. |
| **Vanilla Color Picker** | Minimal color picker | Lightweight. |
| **Custom** | Canvas eyedropper + swatch div | Simple; `getImageData` + stored hex array. **Recommended** for 64×64 editor. |

### Fill Algorithm

- **No library** — Flood fill is ~30–50 LOC. Stack-based iterative; use `getImageData`/`putImageData`. See William Malone's "Paint Bucket Tool" article, or Stack Overflow "flood fill canvas javascript".

### Select / Marquee

- **No library** — Click-drag rectangle is straightforward with `mousedown`/`mousemove`/`mouseup`. Store bounds; use for delete or copy.

### Summary Recommendation

- **Canvas:** Raw `CanvasRenderingContext2D` + `ImageData` for pixel control.
- **Undo:** Custom command stack or Reddo.js.
- **Color:** Custom eyedropper + swatch; optionally Coloris for full picker.
- **Fill:** Custom flood fill (stack-based).
- **Fabric.js/Konva:** Consider only if you need higher-level features (layers, transforms, exports) and are okay with added weight.

---

## Summary

| Feature | Description |
|---------|-------------|
| Drawing | Canvas (128→64), square block brush (1/2/4/8 px, default 2 px), eraser, fill, color picker, pixelated rendering |
| Paint on 3D | Raycast to UV → pixel; paint directly on 3D model; Edit 2D/3D toggle (default: 3D); shared texture; left-drag paint, right-drag orbit |
| Edit mode layout | 3D mode: large 3D view, 2D canvas hidden. 2D mode: large 2D canvas (scales to fill), 3D preview in creator panel after toolbar |
| Live 3D preview | Moves between main area and preview slot by mode; camera reset when entering 2D preview; OrbitControls recreated when returning to 3D |
| Layers | Head, hat, body, jacket, arms, sleeves, legs, pants — select to edit |
| Presets | Per-layer template images |
| Randomize | One-click random combination of presets |
| Download | Explicit button → PNG file |
| Save to webapp | POST to local API → save to `public/skins/custom/`, update index, viewer can use |
| Integration | Same app, `/creator` route; shared skin layout, "Edit" / "Home" navigation |
| Template overlay | Toggle button in View section; draw region outlines from SKIN_LAYER_BOUNDS or reference image; non-destructive |
| Skin gallery | Load skins from index; click to load into editor; undoable |
| Rulers | Toggle; top/left strips outside image; (0,0)–(64,64); layout collapses when off |
| Grid | Toggle; every 4 px; extensible spacing/settings |
| Brush cursor | Box outline matching brush size; scales with canvas and devicePixelRatio |
| Default skin | Random skin on load; 2D/3D sync when switching routes |
| Undo | Command stack; point-based for brush; snapshot for fill; load command for skin loads |
| Color picker | Eyedropper + swatch maintainer; optional Coloris for full picker |
| Swatch palette extractor | Extract unique colors from loaded skin/regions; add to swatch (full or per-layer) |

**Bridge from existing skin editor:** If an editor exists, add the layer UI, preset system, randomization, and save/API integration. Replace right-click save with Download + Save buttons. If building from scratch, follow the phases above and use `minecraft-skin-layout-specification.md` for region bounds.

**State management and scene transitions:** See [Creator–Viewer State Management](./CREATOR-VIEWER-STATE-MANAGEMENT.md) for preserving skin state, switching between creator and viewer, and transition behavior.
