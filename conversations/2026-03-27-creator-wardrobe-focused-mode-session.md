# Creator.Wardrobe & focused creation — session archive

**Saved:** 2026-03-27  
**Scope:** Multi-topic Cursor session (camera presets, layout, taxonomy, composite bugfix, hover preview).

For **hover-only** detail, see also [`2026-03-26-wardrobe-body-part-hover-preview.md`](./2026-03-26-wardrobe-body-part-hover-preview.md).

---

## 1. Preview cameras (focused + thumbnails)

Aligned `src/config/preview/parts/*/preview.config.json` so groups share the same `cameraPosition` / `cameraTarget` / `fov` / `viewport` where appropriate:

- **Top group:** `top`, `head`, `hat` (hat `fov` matched to 30).
- **Center group:** `center`, `jacket`, `jacketGroup`, `torso`, `body`, `arms`, `sleeves` — arms/sleeves brought in line with center; jacket targets normalized to `y: 0.98`.
- **Bottom group:** `bottom`, `pants`, `legs` — pants `fov` aligned to 30.

---

## 2. Focused creation: wardrobe vs 3D/2D visibility

**Intent:** In **Creator.Wardrobe**, keep the **full character** visible (all layers). On transition to **Creator.3D / 2D** with focused mode on, apply **wardrobe row** as solo/focus visibility.

**Files:** `src/controllers/focusedCreationController.ts`

- `runWardrobeFocus`: always `applyFocusedSoloForWardrobeLayer('fullOutfit')` in wardrobe; camera/FOV follow selection only when focused is on.
- Wardrobe → 3D/2D: always apply `applyFocusedSoloForWardrobeLayer(layer)` when focused is on (not only `fromUserModeNavigation`).
- `creatorModeSlice`: when entering wardrobe, call `runWardrobeFocus` so camera/sync runs.
- `creatorFocusedCreationSlice`: wardrobe refresh without requiring focused on for full-body visibility.

---

## 3. Right rail: dual part libraries

**Intent:** Pairs of atomic parts share one stacked right column (equal height, grid, scrollbar gutter, tighter right padding).

**Panel ID sets** (`src/creator/wardrobeLibraryPanels.ts` — `WARDROBE_DUAL_LIBRARY_GROUPS`):

| Pair | Layers | Top panel | Bottom panel |
|------|--------|-----------|--------------|
| Head | `head`, `hat` | head | hat |
| Torso | `body`, `arms` | body | arms |
| Jacket | `jacket`, `sleeves` | jacket | sleeves |
| Bottom | `legs`, `pants` | legs | pants |

**`top`** composite uses **only** `creator-wardrobe-top-panel` (not the head+hat pair).

**Files:** `wardrobe.ts` (`showWardrobeLibraryPanel` set compare), `src/styles/creator/_panels.scss` (class `creator-upper-right-panels-root--wardrobe-dual-libraries`), `isWardrobeDualLibrarySplitLayer` exported from `creator/index.ts`.

**Focus shortcut:** `wardrobePartsPanel.ts` — `focusActiveWardrobeLibraryItem` picks top vs bottom row panel for each pair.

---

## 4. Library grid & scrollbar

- Head/hat (then all dual selectors): **4 columns** `grid-template-columns: repeat(4, 1fr)`, `scrollbar-gutter: stable`, keyboard `cols = 4` in `wardrobeLibraryPanels.ts`.

---

## 5. Wardrobe tree order & labels (`wardrobePartsPanel.ts`)

Under **center:**

1. **Torso** — **Chest** (`body`), **Arms** (`arms`)
2. **Jacket** — **Vest** (`jacket`), **Sleeves** (`sleeves`)

Under **bottom:** **Legs**, then **Pants**.

Preview / library titles for `jacketGroup` shortened to **Jacket** where applicable (`previewPresets.ts`, `wardrobeLibraryPanels.ts`).

---

## 6. Composite vs atomic composition bug (`wardrobe.ts`)

**Problem:** `resolveWardrobeComposite` iterates atomics then **composites**. A lingering `wardrobeSelections.top` / `center` / `torso` / `jacketGroup` / `bottom` / `all` path **overwrote** later atomic picks.

**Fix:** `clearCompositesSupersededByAtomicSelection(part)` at the start of `applyWardrobePartSelection` when `isLayerKey(part)`:

- `head` / `hat` → clear `top`, `all`
- `body` / `arms` / `jacket` / `sleeves` → clear `center`, `torso`, `jacketGroup`, `all`
- `legs` / `pants` → clear `bottom`, `all`

---

## 7. Hover preview (user follow-up in repo)

**Intent:** Hovering a wardrobe **tree row** previews camera/solo for that row **without** changing selection; leaving the panel clears hover; **click** still selects.

**Files (pattern):**

- **`wardrobe.ts`** — `wardrobeHoverPreviewLayer`, `get/setWardrobeHoverPreviewLayer`, `creatorWardrobeFocusSlice.notify()` on change; `setWardrobeSelectedLayer` clears hover.
- **`wardrobePartsPanel.ts`** — `mouseenter` on row → `setWardrobeHoverPreviewLayer(node.key)`; `mouseleave` on panel → `null`.
- **`focusedCreationController.ts`** — `getWardrobeHoverPreviewLayer` dep; `previewLayer = hover ?? selected` in `runWardrobeFocus`:
  - **Focused on:** `fullOutfit` solo + camera from `previewLayer`.
  - **Focused off:** `applyFocusedSoloForWardrobeLayer(previewLayer)` so visibility tracks hover/selection.
- **`creator.ts` / `main.ts`** — wire `getWardrobeHoverPreviewLayer` into the controller (per project wiring).

Exact line-level state should match the repo after your commits; the **2026-03-26** markdown dives deeper on hover behavior and follow-up product notes.

---

## Raw transcripts

Cursor agent JSONL transcripts may live under the Cursor project folder (see `conversations/README.md`). This markdown is the hand-written archive of the session topics and design intent.

---

## Archive log

- **2026-03-27** — Initial session summary written to this file.
- **2026-03-26** — User asked again to save the conversation in `conversations/`; this log entry records that request (no additional scope beyond the sections above).
