# Character Creation Screen Specification

A specification for building a character creation screen that lets users draw on a Minecraft-style character, choose partial layers (arms, legs, jacket, pants, hats, heads, etc.), randomize combinations, and save/download skins — with integration into the local webapp instead of relying on right-click-to-save.

---

## Table of Contents

1. [Context and Goals](#context-and-goals)
2. [Existing Skin Editor Assumptions](#existing-skin-editor-assumptions)
3. [Character Creation Features](#character-creation-features)
4. [Layer System](#layer-system)
5. [Randomization](#randomization)
6. [Save and Download Integration](#save-and-download-integration)
7. [Technical Architecture](#technical-architecture)
8. [Implementation Phases](#implementation-phases)
9. [Integration with 3D Model Viewer](#integration-with-3d-model-viewer)
10. [Toggleable Template Layer (Model-to-2D Translation)](#toggleable-template-layer-model-to-2d-translation)
11. [Tools: Undo, Paint, Fill, Select, Delete, Color Picker](#tools-undo-paint-fill-select-delete-color-picker)
12. [Existing Libraries and Tools](#existing-libraries-and-tools)

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

- **Canvas** — 64×64 pixel grid (or zoomed view for usability).
- **Tools:** Brush, eraser, fill, color picker.
- **Brush size:** 1–4 px typical.
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

### 3. Presets / Templates

- **Pre-made layer graphics** — E.g., "Jacket 1", "Jacket 2", "Pants A", "Hat styles".
- User selects a preset for a layer; it replaces that layer's pixels.
- Presets stored as 64×64 PNGs with only the relevant region filled (rest transparent).

### 4. Color Palette

- **Recent colors** — Last N used colors.
- **Preset palettes** — Skin tones, common Minecraft colors, custom.
- **Hex input** — For exact colors.

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

## Technical Architecture

### Component Structure

```
/creator (route or page)
├── Canvas (64×64, zoomed for usability)
├── Layer selector (checkboxes/tabs)
├── Toolbar (brush, eraser, fill, color picker)
├── Preset panel (per layer)
├── Randomize button
├── Preview (3D or 2D flattened view of character)
├── Download button
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

### Phase 5: Polish

- 3D preview (optional) — Use same model as viewer; update texture in real time.
- Undo/redo.
- Export to legacy 64×32 if needed.

---

## Integration with 3D Model Viewer

The character creator should merge with the app that currently displays the 3D model viewer (character's home), so users can switch between editing and viewing their character in the same session.

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

A **toggleable template overlay** helps users understand how the 2D skin texture maps to the 3D model. When enabled, it shows region boundaries, labels, or a reference diagram overlaid on the canvas.

### Reference Images

- **`docs/minecraft-skin-layout-detailed.png`** — Annotated skin layout with face labels (TOP HEAD, FACE HEAD, etc.).
- **`docs/minecraft-skin-64x64-detailed.png`** — 64×64 grid layout diagram.

### Behavior

- **Toggle** — Checkbox or button: "Show template" / "Hide template".
- **Overlay** — Render the reference image as a semi-transparent layer above the canvas (e.g., `opacity: 0.3`) or draw region outlines programmatically.
- **Non-destructive** — Template is visual only; it does not affect the canvas pixels. User draws underneath or with template visible as a guide.
- **Region labels** — Optional: draw text labels (head, hat, body, etc.) at region centers using the bounds from [minecraft-skin-layout-specification.md](./minecraft-skin-layout-specification.md).

### Implementation

- **Asset location** — Copy `docs/minecraft-skin-layout-detailed.png` and `docs/minecraft-skin-64x64-detailed.png` to `public/` (e.g., `public/skin-template.png`) so they are served. The `docs/` folder is not typically served by Vite.
- Load reference image: `new Image(); img.src = '/skin-template.png'`.
- Draw on a separate canvas layer or as a CSS `background-image` with `mix-blend-mode` for non-destructive overlay.
- Or: use the region bounds table to draw rectangles + labels; no image dependency.

---

## Tools: Undo, Paint, Fill, Select, Delete, Color Picker

### Robust Undo

- **Command pattern** — Store operations (brush stroke, fill, delete, paste) as reversible commands. Undo = execute inverse; redo = re-execute.
- **Point-based history** (recommended) — For brush strokes: record `[{x,y,color}, ...]` per stroke. Undo = redraw canvas from initial state up to previous stroke. More memory-efficient than full canvas snapshots.
- **Snapshot fallback** — For complex ops (paste, fill large area), store a before/after `ImageData` or canvas PNG. Use sparingly to avoid memory bloat.
- **History limit** — Cap at N steps (e.g., 50–100). Drop oldest when full.
- **Coalescing** — Merge consecutive brush moves into a single stroke for undo (one undo = entire stroke, not per pixel).

### Paint Brush

- **Size** — 1–4 px typical for 64×64; configurable.
- **Shape** — Round (circle) or square. Use `ctx.arc` or `ctx.fillRect`.
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
| Drawing | Canvas, brush, eraser, fill, color picker, select region, delete |
| Layers | Head, hat, body, jacket, arms, sleeves, legs, pants — select to edit |
| Presets | Per-layer template images |
| Randomize | One-click random combination of presets |
| Download | Explicit button → PNG file |
| Save to webapp | POST to local API → save to `public/skins/custom/`, update index, viewer can use |
| Integration | Same app, `/creator` route; shared skin layout, "Edit" / "Home" navigation |
| Template overlay | Toggleable reference (`docs/minecraft-skin-layout-detailed.png`) for model-to-2D translation |
| Undo | Command stack; point-based history for brush; snapshot for fill/paste |
| Color picker | Eyedropper + swatch maintainer; optional Coloris for full picker |

**Bridge from existing skin editor:** If an editor exists, add the layer UI, preset system, randomization, and save/API integration. Replace right-click save with Download + Save buttons. If building from scratch, follow the phases above and use `minecraft-skin-layout-specification.md` for region bounds.

**State management and scene transitions:** See [Creator–Viewer State Management](./CREATOR-VIEWER-STATE-MANAGEMENT.md) for preserving skin state, switching between creator and viewer, and transition behavior.
