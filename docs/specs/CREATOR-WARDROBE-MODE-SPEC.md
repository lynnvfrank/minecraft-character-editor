# Creator — Wardrobe Mode Specification

## Overview

**Wardrobe mode** is a Creator sub-mode for trying on full outfits or individual outfit parts (body parts) while continuously previewing changes on the 3D character.

- **Entry behavior**: when the player enters Wardrobe mode, a left-side panel animates in from the left.
- **Primary UI**: left panel contains a `wardrobe.layer` panel (vertical list of buttons).
  - **Naming note**: some notes may refer to this as `wardrobe.layout`; treat `wardrobe.layout` as an alias for `wardrobe.layer` (same concept: the current wardrobe category selection).
- **Secondary UI**: right panel changes contents based on the currently selected `wardrobe.layer`.
- **State model**:
  - Selecting a **full outfit** replaces the entire current skin.
  - Selecting a **body part** captures a base skin state, then applies only that part from a selected part-skin on top of the captured base (not on top of previously applied parts), so the player is “trying on” variants.

This spec is intended to guide implementation in the Creator + Viewer while staying consistent with the project’s event-driven state patterns described in `docs/CREATOR-VIEWER-STATE-MANAGEMENT.md`.

---

## Terminology

- **Full outfit**: a complete 64×64 Minecraft skin PNG.
- **Body parts** (Wardrobe parts): `Hat`, `Head`, `Jacket`, `Body`, `Sleeves`, `Arms`, `Pants`, `Legs`.
  - These are wardrobe-level concepts; some correspond to Minecraft “primary” regions (Head, Body, Legs) and some correspond to Minecraft “overlay” regions (Hat, Jacket, Pants).
- **Base skin**: the captured “starting point” skin used when trying on a body part.
- **Part skin**: a skin asset that contains meaningful pixels only for a specific body part; pixels outside that part’s bounds are ignored.
- **Wardrobe layers**: a stack-like representation of which part selections are currently active on top of the base skin.

---

## UI Layout and Transitions

### Left panel: `wardrobe.layer`

Animates in from the left on Wardrobe entry. Contains vertically-stacked buttons:

- Full outfit
- Hat
- Head
- Jacket
- Body
- Sleeves
- Arms
- Pants
- Legs

### Right panel: `wardrobe.library` (Outfits)

The right panel’s contents depend on the selected left-panel item:

- **If `Full outfit` selected**: show the **Outfits** panel — a gallery/list of full skins.
- **If a body part selected (Hat/Head/Jacket/Body/Sleeves/Arms/Pants/Legs)**: show a **part-specific panel** for that body part (Hats, Heads, Jackets, Bodies, Sleeves, Arms, Pants, Legs).
  - The right-hand panels reuse the same physical location in the upper-right of the screen.
  - In the current design, switching between wardrobe layers swaps the visible panel immediately rather than animating the thumbnail items on every layer change. This avoids visible flicker in the `skin-preview` items while navigating the left wardrobe list.
  - Each part panel mirrors the Outfits panel keyboard behavior (grid arrow navigation within the panel and `Space` to return focus to wardrobe layers).

### 3D preview

The 3D character preview updates immediately as selection changes:

- Full outfit selection updates the entire skin.
- Body part selection updates only that part, resolved against the captured base skin and any active wardrobe layers.

---

## Shortcut Keys (Lifecycle + Navigation)

Wardrobe mode provides shortcut keys for quick navigation. These shortcuts are **loaded when Wardrobe mode is enabled** and **unloaded as soon as another mode is enabled**, so they do not conflict with other Creator modes.

### Lifecycle requirements

- **On Wardrobe enable**
  - Register Wardrobe-only `keydown` handlers (or equivalent input bindings).
  - Handlers should publish the same events as the UI (e.g. `wardrobe.layerChanged`, `wardrobe.partSelected`, `wardrobe.fullOutfitSelected`) rather than mutating UI directly.
- **On Wardrobe disable**
  - Unregister all Wardrobe-only handlers.
  - No Wardrobe keybinding should remain active after the mode switch.

### Shortcut behavior requirements

- **Focus-safe**: if the user is typing in an input field (text box, search, etc.), shortcuts should not trigger.
- **No-repeat safety**: for navigation keys, repeated keydown events (key held) should either be ignored or behave predictably (implementation-defined).

### Current implemented bindings

| Action | Keys | Resulting event |
|---|---|---|
| Select layer (by index) | `1`..`9` | `wardrobe.layerChanged` |
| Previous/next layer | `ArrowUp` / `ArrowDown` | `wardrobe.layerChanged` |
| Move focus from `wardrobe.layer` to active right panel | `Space` | focus handoff only |
| Navigate within Outfits / part grid | `ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown` | `wardrobe.partSelected` / `wardrobe.fullOutfitSelected` (depending on current layer) |
| Return focus from Outfits / part grid to `wardrobe.layer` | `Space` | focus handoff only |

**Layer index mapping**

1. Full outfit
2. Hat
3. Head
4. Jacket
5. Body
6. Sleeves
7. Arms
8. Pants
9. Legs

**Additional implemented keyboard details**

- While focus is on `wardrobe.layer`:
  - `ArrowUp` / `ArrowDown` changes the selected wardrobe layer.
  - `Space` moves focus into the currently visible Outfits / parts panel.
  - `ArrowRight` does not move focus into the right panel in the current design.
- While focus is on the Outfits / parts grid:
  - Arrow keys navigate only within the grid.
  - If there is no item in the requested direction, selection does not change.
  - `ArrowLeft` at the left edge does not move focus back to `wardrobe.layer`; it takes no action.
  - `Space` returns focus to the active button in `wardrobe.layer`.
- Wardrobe layer shortcuts are guarded so they do not fire while focus is inside an Outfits / parts panel.

---

## Event-Driven Communication

Wardrobe UI should be implemented as decoupled panels that communicate via events:

- `wardrobe.layer` **publishes** the currently selected layer (Full outfit / specific body part).
- `wardrobe.library` **subscribes** to layer changes and updates its content.
- Selecting an item in `wardrobe.library` **publishes** a selection event.
- A wardrobe state manager (or shared store) **subscribes** to selection events and applies skin updates.
- The 3D preview **subscribes** to resolved skin updates (or subscribes to wardrobe state changes and recomputes the resolved skin).

### Required events (names are illustrative)

| Event | Payload | Publisher | Subscribers |
|------|---------|-----------|-------------|
| `wardrobe.layerChanged` | `{ layer: 'fullOutfit' \| 'hat' \| 'head' \| 'jacket' \| 'body' \| 'sleeves' \| 'arms' \| 'pants' \| 'legs' }` | `wardrobe.layer` | `wardrobe.library`, wardrobe state manager |
| `wardrobe.fullOutfitSelected` | `{ skinId, skinUrl }` | `wardrobe.library` | wardrobe state manager |
| `wardrobe.partSelected` | `{ part: 'hat' \| 'head' \| 'jacket' \| 'body' \| 'sleeves' \| 'arms' \| 'pants' \| 'legs', skinId, skinUrl }` | `wardrobe.library` | wardrobe state manager |
| `wardrobe.baseCaptured` | `{ baseSkinId?, baseSkinUrl? }` | wardrobe state manager | debug UI, analytics (optional) |
| `wardrobe.layersChanged` | `{ layers: WardrobeLayersState }` | wardrobe state manager | 3D preview, UI chips/badges (optional) |
| `wardrobe.resolvedSkinChanged` | `{ resolvedSkinUrl \| resolvedSkinImageData \| resolvedSkinTexture }` | wardrobe state manager (or resolver) | 3D preview |

**Notes**

- The project can implement events using an in-memory store + `subscribe(cb)` pattern (see `docs/CREATOR-VIEWER-STATE-MANAGEMENT.md` “Shared Store (Singleton)”).
- The wardrobe state manager should be the single source of truth for which layers are active and what the base is.

---

## Behavioral Requirements

### Entering Wardrobe mode

- Left panel animates in from the left.
- Current implemented default:
  - selected layer = `Full outfit`
  - focus = `Full outfit` button
  - visible right panel = `Outfits`
- The creator route persists the active creator submode in the URL:
  - `#/creator/wardrobe`
  - `#/creator/3d`
  - `#/creator/2d`
- Reloading the page while on `#/creator/wardrobe` restores Wardrobe mode rather than falling back to Creator 3D mode.

### Selecting `Full outfit`

When the player selects a full outfit:

- The current skin changes to that skin (entire 64×64 applied).
- The wardrobe state manager should update:
  - **base skin** to this full outfit (so subsequent part try-ons use it as base), and
  - clear or re-resolve wardrobe layers depending on desired UX.

Recommended default:

- Set **base skin = selected full outfit**
- Clear all active part layers (player is now wearing a whole new outfit).
- In the current implementation, selecting a full outfit also becomes the source of truth for future part try-ons in that Wardrobe session.

### Selecting a body part (try-on workflow)

When the player selects a body part (Hat/Head/Jacket/Body/Sleeves/Arms/Pants/Legs):

- The first time a part is selected in the current Wardrobe session:
  - Capture the **base skin** (snapshot of the current skin before applying that part).
  - Publish `wardrobe.baseCaptured`.

**Important implemented safeguard**

- Do **not** capture the wardrobe base from an empty creator canvas.
- If Wardrobe mode is entered before the creator canvas has been populated with a full skin, the system should wait until a real skin has been loaded before treating it as the wardrobe base.
- This prevents the bug where selecting a part such as `Hat` causes only the isolated part to appear on the model because the stored base was empty/transparent.

When the player selects a part skin for the currently selected part:

- Apply only that part’s pixels to the **captured base skin** (plus any other active wardrobe layers), not over the currently-applied part.
- The 3D preview updates to show the result.

When the player selects another skin for the **same** body part:

- Recompute the resolved skin by applying the newly selected part to the **captured base** (and other layers), ensuring the part try-on does not accumulate artifacts from previously tried items.

This produces the “trying on variants” experience.

---

## Wardrobe Layers (Stack/Resolution Model)

### Goal

Support adding/removing/replacing wardrobe layers so that:

- The original base skin is preserved.
- Each selected part can be toggled/replaced without destructive edits.
- The 3D character shows the resolved result of base + layers.

### Suggested state shape

`WardrobeLayersState` (conceptual):

- `base`: full skin reference (URL/id) or ImageData snapshot
- `layers`:
  - `hat?: partSkinRef`
  - `head?: partSkinRef`
  - `jacket?: partSkinRef`
  - `body?: partSkinRef`
  - `sleeves?: partSkinRef`
  - `arms?: partSkinRef`
  - `pants?: partSkinRef`
  - `legs?: partSkinRef`

### Resolution order

The resolved skin is produced by:

1. Start with `base` skin (full 64×64).
2. For each active layer, apply only the pixels within that part’s bounds.
3. Publish `wardrobe.resolvedSkinChanged` for the viewer to apply.

**Important constraint**: For a given part, applying a new selection replaces the previous selection for that part and is always applied against the same base (plus other parts), never composited over the previously resolved result.

---

## Part Bounds (What Pixels Count)

Part skins must only affect pixels inside the relevant region bounds. Pixels outside must be ignored.

Use the authoritative bounds from `docs/minecraft-skin-layout-specification.md`.

### Region bounds (X, Y, W, H)

| Wardrobe part | Minecraft regions affected | Bounds |
|---|---|---|
| **Head** | Head (primary) | X: 0, Y: 0, W: 32, H: 16 |
| **Hat** | Hat (overlay) | X: 32, Y: 0, W: 32, H: 16 |
| **Body** | Body (primary) | X: 16, Y: 16, W: 24, H: 16 |
| **Jacket** | Jacket (overlay) | X: 16, Y: 32, W: 24, H: 16 |
| **Legs** | Right Leg + Left Leg (primary) | RL: X: 0, Y: 16, W: 16, H: 16; LL: X: 16, Y: 48, W: 16, H: 16 |
| **Pants** | Right Pants + Left Pants (overlay) | RP: X: 0, Y: 32, W: 16, H: 16; LP: X: 0, Y: 48, W: 16, H: 16 |

**Notes**

- “Legs” and “Pants” each map to two distinct regions (right + left).
- If later expanded to arms/sleeves, use the same doc for RA/LA + RS/LS.
- Transparency rules differ for primary vs overlay regions; see “Transparency Rules” in `docs/minecraft-skin-layout-specification.md`.

---

## Wardrobe Asset Library Requirements

### Full outfits library (Outfits panel)

- Contains full 64×64 skins.
- Selecting one sets the current skin to that outfit (and updates base skin).

### Part library (Hat/Head/Jacket/Body/Sleeves/Arms/Pants/Legs)

Each part library contains “part skins” that are either:

- **pre-generated** (stored as assets in part-specific folders), or
- **generated on demand** by cropping/masking regions from full outfits.

For part skins:

- Only pixels inside the relevant bounds should be considered.
- Pixels outside the bounds must be ignored during application (even if the PNG contains them).

Each part panel (Hats, Heads, Jackets, Bodies, Sleeves, Arms, Pants, Legs) must:

- Present the list of available part skins for that body part, based on its `index.json` (see **Approach 1**).
- Include a **`None` option** at the top of the list:
  - When `None` is selected, the corresponding wardrobe layer entry (e.g., `hat`) is cleared from `WardrobeLayersState.layers`.
  - The resolved skin reverts that part back to the **captured base skin** (as if no hat/jacket/etc. had been chosen).
- The current implementation renders these part items once and then updates active-state classes during navigation/selection, rather than rebuilding the item DOM on every selection. This avoids visible thumbnail flicker in the right-hand parts panels.

---

## Generating Part Skins — Two Approaches

### Approach 1: Pre-generated part skins (build/dev-time)

**Idea**: Generate part-only skins once (in dev mode on startup, or via an npm task) and store them in part-specific directories with an `index.json` manifest for fast loading.

**Requirements**

- For each full outfit in the source library:
  - Create derived PNGs for each part: `hat`, `head`, `jacket`, `body`, `sleeves`, `arms`, `pants`, `legs`.
  - Each derived PNG should include meaningful pixels only in the region bounds for that part; other pixels should be transparent or a neutral value (implementation-defined).
- Output folder structure (example):
  - `public/wardrobe/parts/hat/*.png`
  - `public/wardrobe/parts/head/*.png`
  - `public/wardrobe/parts/jacket/*.png`
  - `public/wardrobe/parts/body/*.png`
  - `public/wardrobe/parts/sleeves/*.png`
  - `public/wardrobe/parts/arms/*.png`
  - `public/wardrobe/parts/pants/*.png`
  - `public/wardrobe/parts/legs/*.png`
- Each part folder has an `index.json` listing available items (id, url, optional metadata like display name, tags).
  - These manifests power the per-part panels (Hats, Heads, Jackets, Bodies, Sleeves, Arms, Pants, Legs). Each entry appears as one selectable item in the relevant panel.

**Pros**

- Fast runtime loading and selection.
- Deterministic content; no runtime image processing cost.

**Cons**

- Requires a generation step and asset management.

### Approach 2: Runtime generation from full outfits (crop/mask)

**Idea**: Part skins are produced on demand from full skins by applying the part bounds defined in `docs/minecraft-skin-layout-specification.md`.

**Requirements**

- Given a full skin and a part selection:
  - Extract or mask to only the target region(s).
  - Apply that part to the captured base during resolution.

**Pros**

- No additional asset pipeline.
- Always in sync with the full outfits library.

**Cons**

- Runtime image processing complexity and potential performance costs.
- Must be careful about alpha rules and pixel-perfect boundaries.

---

## Codebase Review Findings (Recommendation)

After reviewing the current code paths for skin display and pixel operations, **runtime cutting/masking inside the app is the best fit right now**, with the option to add pre-generation later if the wardrobe library grows large.

### What the codebase already supports well

- **Pixel-accurate region bounds are centralized**:
  - `src/skinLayout.ts` defines `SKIN_LAYER_BOUNDS` (including multi-rect parts like legs/pants/arms/sleeves).
- **Canvas + ImageData manipulation is already in active use**:
  - `src/skinPreprocess.ts` reads `ImageData`, iterates pixels, and writes back based on region membership (primary-layer transparency handling).
  - `src/creator/skinIO.ts` loads skins into a canvas and exports a 64×64 PNG via nearest-neighbor downscale.
  - Creator tooling already uses `getImageData` / `putImageData` heavily (undo/redo, brush, fill).
- **Viewer skin application expects a single resolved texture**:
  - `switchSkin()` loads a skin texture, runs `preprocessSkinTexture()`, then `applySkinToModel()`.
  - This matches the wardrobe requirement to compute a **single resolved 64×64** (base + layers) and then apply it like any other skin.

### Why runtime cutting is recommended

- **64×64 textures are tiny**: compositing a few bounded rectangles onto a canvas is extremely cheap relative to typical UI/3D work.
- **Less asset pipeline overhead**: no NPM task, no extra folders/manifests to keep in sync while the feature is evolving.
- **Matches the Wardrobe behavior requirement** (apply part onto captured base, non-cumulative): runtime composition naturally recomputes from base + selected layers each time.

### When pre-generation becomes worth it

Consider adding Approach 1 later if:

- the wardrobe library grows very large (hundreds/thousands of items),
- you need instant scrolling through many thumbnails without runtime thumbnail generation,
- you want to ship a fixed curated library with predictable caching/CDN behavior.

### Practical hybrid (recommended implementation direction)

- **At runtime**: resolve wardrobe result by compositing:
  1. draw the captured base skin to a 64×64 canvas
  2. for each active layer, draw only the pixels in the relevant `SKIN_LAYER_BOUNDS` rect(s) from the selected part source onto the base
  3. convert to `THREE.CanvasTexture` (or data URL) and feed into the existing `applySkinToModel()` path
- **Cache**:
  - cache loaded `HTMLImageElement` objects per source skin URL
  - optionally cache per-part derived canvases or thumbnails in memory for the current session

---

## Part Preview Images (Recommended Approach)

Wardrobe part thumbnails are more useful when the player can see the selected part **on the 3D character**, not just as a flat cropped skin texture. For parts like `hat`, `head`, `arms`, and `sleeves`, the default full-character preview framing is usually too wide to show the relevant area clearly.

### Recommendation

Use the same screenshot pipeline as full-skin previews, but add **part-specific preview presets** that control:

- which model layers are visible for the preview
- the camera position
- the camera target
- optional per-part FOV

This is the recommended approach because it produces previews that are:

- consistent across the library
- readable for small parts
- visually aligned with the in-app 3D character
- more robust than trying to crop the final image after capture

### Preview generation behavior

When generating a preview image for a wardrobe part:

1. Load the preview route so the character is idle and the UI is hidden.
2. Apply the part skin (or resolved part-composited skin) to the model.
3. Hide all layers that are not relevant to the current part preview.
4. Apply the camera preset for that part.
5. Capture the screenshot and store it as the preview for that wardrobe item.

### Part preview presets

The implementation should define a preset table keyed by wardrobe part, for example:

- `hat`: head close-up
- `head`: head close-up
- `jacket`: torso close-up
- `body`: torso close-up
- `sleeves`: upper torso + arms framing
- `arms`: upper torso + arms framing
- `pants`: hips + upper legs framing
- `legs`: lower torso + legs framing

Each preset should include:

- `visibleLayers`
- `cameraPosition`
- `cameraTarget`
- optional `fov`

### Why not crop the full-character preview afterward?

Post-cropping is not the recommended primary solution because:

- the part may still occupy too few pixels in the original render
- crop bounds become fragile if the camera, pose, or FOV changes
- small parts can still feel visually lost even after cropping

### Current implementation

The repo now implements this flow:

- Preview preset data lives in `src/config/preview/skins/preview.config.json` and `src/config/preview/parts/<part>/preview.config.json`, and `src/viewer/previewPresets.ts` loads those configs for runtime use.
- The preview route in `src/main.ts` accepts preview context query params such as:
  - `skin=/wardrobe/parts/hat/skin-anime1-hat.png`
  - `baseSkin=/wardrobe/skins/skin-base.png`
  - `part=hat`
  - `cameraPreset=hat`
- The preview route:
  - applies the preset camera position, target, and FOV
  - composites wardrobe part skins onto a base skin when needed
  - hides unrelated skin layers so the rendered thumbnail stays focused on the relevant geometry
- `npm run generate-previews` runs `scripts/generate-skin-previews.js`, which iterates both full skins and wardrobe part manifests and captures the previews through the preview route.
- Wardrobe part manifests now include a `preview` field so the wardrobe panels can use the generated 3D thumbnails.

### Preview mode tuning workflow

The app also supports a browser-only camera tuning mode for adjusting preview presets manually.

- Open:
  - `http://localhost:5173/?previewcontrols=1#/preview`
- This enables a lower-right preview camera panel with:
  - buttons for every preview preset
  - a live info panel showing camera `position`, camera `target`, and `fov`
- The preview-generation script hides this panel during screenshot capture, so it does not affect generated thumbnails.

### Tuning a preset

To tune a preset for a specific wardrobe part:

1. Start dev mode with `npm run dev`.
2. Open the preview route with `previewcontrols=1`.
3. If you want to test the exact wardrobe-part preview context used by the generator, open a URL like:
   - `http://localhost:5173/?previewcontrols=1&skin=/wardrobe/parts/arms/skin-anime5-arms.png&baseSkin=/wardrobe/skins/skin-base.png&part=arms&cameraPreset=arms#/preview`
4. Click the preset button you want to start from.
5. Orbit/pan/zoom until the framing looks correct.
6. Read the live values from the info panel.
7. Copy those values back into the matching `preview.config.json` file for the full outfit or wardrobe part you are tuning.
8. Regenerate previews with `npm run generate-previews` after the preset values are updated.
9. If you need to force regeneration:
   - clear full-skin previews with `npm run clear-previews-skins`
   - clear wardrobe part previews with `npm run clear-previews-parts`

If the camera is moved away from an exact preset position, the info panel reports the state as `Custom`. This is expected and makes it easier to tell when you are looking at manually tuned values rather than one of the stored presets.

### Suggested ownership in this repo

- **Preset definitions**: `src/config/preview/skins/preview.config.json` and `src/config/preview/parts/<part>/preview.config.json`
- **Preview route logic**: `src/main.ts`
- **Preview tuning panel**: `src/previewCameraPanel.ts`
- **Preview generation command**: `npm run generate-previews`
- **Part preview generation script**: `scripts/generate-skin-previews.js`
- **Preview clearing commands**: `npm run clear-previews-skins`, `npm run clear-previews-parts`
- **Manifest writing**: `scripts/generate-skin-previews.js` and `scripts/generate-wardrobe-parts.js`

---

## Implementation Notes (Current Codebase Hooks)

This section documents **where** to implement Wardrobe mode in this repo, focusing on events, shortcuts lifecycle, panel groups/layout, and where skins/bounds come from.

### Event system (existing “event classes”)

The project already has a simple document-level event bus:

- **File**: `src/creatorEvents.ts`
  - `CREATOR_EVENTS`: string constants (e.g. `EDIT_MODE_CHANGE`, `SKIN_LOAD_CHANGE`, `CANVAS_CHANGE`)
  - `publish(event, detail?)`: `document.dispatchEvent(new CustomEvent(...))`
  - `subscribe(event, handler)`: registers a listener and returns an unsubscribe function

Wardrobe should follow this pattern:

- **Creator-mode changes**: use `CREATOR_EVENTS.EDIT_MODE_CHANGE` (already emitted by `setEditMode()` in `src/creator.ts`).
- **Wardrobe-specific events**: add a `WARDROBE_EVENTS` constant (new file or colocated near wardrobe module) and use `publish/subscribe` the same way Creator does.
  - Keep Wardrobe events separate from `CREATOR_EVENTS` unless they are truly creator-global.

Related existing state + mapping helpers:

- **Skin region bounds**: `src/skinLayout.ts`
  - `SKIN_LAYER_BOUNDS` (layer → one or more rectangles)
  - `SKIN_PART_BOUNDS` (display-name parts like “Right leg” → rectangles)
  - `LAYER_KEYS`, `TEXTURE_LAYER_KEYS`
  - `partToLayer()` and `isLayerKey()`

### Registering/unregistering shortcut keys (lifecycle)

There is an established pattern for keyboard shortcut handlers:

- **Editor mode number shortcuts (already implemented)**:
  - **File**: `src/creator/editorToolsPanel.ts`
  - Registers a `document.addEventListener('keydown', handler)` and stores the handler in a module variable.
  - **Unregisters** via `unregisterEditorModeShortcuts()` (removes the event listener).
  - Includes important guardrails (route check, input-focus check, ignore ctrl/meta/alt).

- **Creator-level unregistration hook (already implemented)**:
  - **File**: `src/creator.ts`
  - `unregisterCreatorShortcuts()` calls `unregisterEditorModeShortcuts()`
  - This is invoked when leaving creator route (see `unregisterCreatorShortcuts()` usage in `src/main.ts` route switching).

Wardrobe shortcuts follow the same structure:

- **Implemented module**: `src/creator/wardrobePartsPanel.ts`
- **Implemented unregistration hook**: `unregisterWardrobeShortcuts()` is called from `unregisterCreatorShortcuts()` in `src/creator.ts`.
- Shortcut handling is guarded by:
  - current route = `creator`
  - current edit mode = `wardrobe`
  - focus is not inside an input field
  - focus is not inside a wardrobe library grid when handling left-panel shortcuts
- Use the same safety checks:
  - do nothing unless `document.body.dataset.route === 'creator'`
  - ignore if in `<input>`, `<textarea>`, or `contentEditable`
  - ignore if ctrl/meta/alt are pressed (unless intentionally supported)

### Current route + submode integration

- `src/main.ts` parses creator submodes from the hash route, including `#/creator/wardrobe`.
- `src/creator.ts` updates the current creator submode back into the URL when the mode changes.
- This allows Wardrobe mode to survive page refresh and direct navigation.

### Panel groups and layout (upper-left, right side, and Wardrobe needs)

**Upper-left panel group already exists**:

- **DOM**: `index.html` contains `#creator-upper-left-panels` (class `.creator-upper-left-panels`).
- **CSS**: `src/style.css` styles `.creator-upper-left-panels` and animates it sliding in from the left on creator route.
- **Mode panels**: `src/creator.ts` uses `MODE_PANEL_CONFIGS` to show/hide panels per edit mode. Notably:
  - `creator-wardrobe-parts-panel` is currently configured as **Wardrobe-only** (enter/exit from left).

This maps cleanly to the Wardrobe spec’s **left-side wardrobe panel**.

**Right-side panel grouping now exists for Wardrobe**:

- **DOM**:
  - `#creator-upper-right-panels-root` hosts the Wardrobe `Outfits` and part-specific library panels.
  - `#creator-wardrobe-outfits-panel` is the full-outfit gallery panel.
- **Wardrobe part panels**:
  - additional panels are created for Hats, Heads, Jackets, Bodies, Sleeves, Arms, Pants, and Legs.
- **Lower-right group**:
  - `#creator-right-panels-group` still serves the lower-right 2D/3D creator panels.

**Current Wardrobe right-side design**:

- the wardrobe **library panel** (full outfits list or part list), and
- optionally a wardrobe **details/filters** panel (search, tags, “remove layer”, etc.).

- The upper-right wardrobe library root is positioned in the top-right of the Creator layout.
- The visible library panel swaps based on the active `wardrobe.layer`.
- To reduce perceived flicker, the current implementation avoids re-animating thumbnail items during rapid layer-to-layer navigation.

### Skin locations, manifests, and existing mapping values

**Skins are served from the public folder**:

- **Full skins**: `public/wardrobe/skins/*.png`
- **Manifest**: `public/wardrobe/skins/index.json` (array of `SkinEntry`)
- **Optional previews**: `public/wardrobe/skins/previews/*-preview.png` (referenced by `SkinEntry.preview`)

**Manifest generation**:

- **Script**: `scripts/generate-skins-manifest.js` scans `public/wardrobe/skins/` and writes `public/wardrobe/skins/index.json`.

**Shared catalog type**:

- **File**: `src/types/catalog.ts`
  - `SkinEntry = { path, label, preview? }`

**Where skins are used in app code**:

- **Viewer route**: `src/main.ts`
  - Loads skins list and calls `switchSkin()` to apply selected skin.
- **Creator gallery**: `src/creator.ts`
  - `setupCreatorSkinGallery()` populates `#creator-skin-selector` from the `SkinEntry[]` list.
  - `loadSkinFromPath(path)` loads a skin into the creator working canvas.
- **Wardrobe base capture + compositing**: `src/creator.ts`
  - stores the current creator skin path
  - captures base image data only after a real skin has been loaded into the creator canvas
  - clears active wardrobe layers when a new full outfit is selected
  - resolves part selections by compositing each selected part over the captured base using `SKIN_LAYER_BOUNDS`
- **Wardrobe right-panel rendering**:
  - `src/creator/wardrobeLibraryPanels.ts` builds the part panels and keyboard navigation
  - active selection changes update classes in-place instead of rebuilding the thumbnail grid on every selection

**Skin boundary documentation + constants**:

- **Doc**: `docs/minecraft-skin-layout-specification.md` (authoritative pixel bounds + transparency rules)
- **Code**: `src/skinLayout.ts` (`SKIN_LAYER_BOUNDS`, `SKIN_PART_BOUNDS`)
- **Viewer UV table (reference)**: `src/viewer/skinApplication.ts` exports `MINECRAFT_SKIN_UVS` (mostly for models with per-part meshes; Runningboy primarily uses FBX UVs).

---

## Acceptance Criteria

- **Panel behavior**: Entering Wardrobe mode animates the left panel in from the left and shows the `wardrobe.layer` list.
- **Defaults**:
  - Entering Wardrobe mode selects `Full outfit`
  - focus starts on the `Full outfit` button
  - the right panel shows `Outfits`
- **Layer selection**: Selecting an item in `wardrobe.layer` updates the right panel content accordingly.
- **Keyboard behavior**:
  - `ArrowUp` / `ArrowDown` changes layers while focus is in `wardrobe.layer`
  - `Space` moves focus between `wardrobe.layer` and the active Outfits / part grid
  - grid arrow keys navigate only inside the currently focused right-hand grid
  - edge navigation in the grid does not change selection or shift focus
- **Route persistence**: Reloading `#/creator/wardrobe` returns to Wardrobe mode.
- **Event model**: Panels communicate via events; the library updates by subscribing to `wardrobe.layerChanged`.
- **Full outfit**: Selecting a full outfit replaces the entire skin on the 3D character.
- **Body part try-on**:
  - Base skin is captured when starting a try-on workflow, but never from an empty/unpopulated creator canvas.
  - Re-selecting different items for the same body part always resolves against the captured base (not cumulatively).
  - Only the pixels within the part bounds affect the resolved skin.
- **Layering**: System supports add/remove/replace of part layers and the 3D preview shows the resolved result.

---
