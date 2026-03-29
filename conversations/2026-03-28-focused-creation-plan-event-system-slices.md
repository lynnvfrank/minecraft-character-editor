# Focused creation plan — event system re-evaluation & plan doc update

**Saved:** 2026-03-28  
**Scope:** Cursor thread: re-evaluate `docs/plans/focused_creation_mode_41f28800.plan.md` after creator **slice** refactor; update the plan accordingly.

**Related:** [`docs/plans/focused_creation_mode_41f28800.plan.md`](../docs/plans/focused_creation_mode_41f28800.plan.md), [`docs/concepts/MODELS-AND-SUBSCRIBERS.md`](../docs/concepts/MODELS-AND-SUBSCRIBERS.md), [`docs/concepts/EVENT-SYSTEM.md`](../docs/concepts/EVENT-SYSTEM.md).

---

## 1. Analysis (pre-refactor plan vs current architecture)

### Policy

- **Document bus** (`src/events/appEvents.ts`): cross-boundary **commands** only — creator **camera** DOM → Three.js, **character** skin/animation. `CREATOR_EVENTS` on `main` is camera aliases, not editor fan-out.
- **Creator editor state**: **in-process slices** in `src/state/creatorSlices.ts` — `notify` / `subscribe`; see `docs/concepts/MODELS-AND-SUBSCRIBERS.md`.

### Replacements for old plan wording

| Plan / legacy | Current mechanism |
|---------------|-------------------|
| `LAYER3D_CHANGE` (bus) | `creatorLayerSlice.notify()` after mutations; `skinLayersPanel`, `blockyEditor`, etc. subscribe |
| `EDIT_MODE_CHANGE` (bus) | `creatorModeSlice.notify({ mode, previousMode })` from `setEditMode` in `creator.ts`; payload: `CreatorEditModePayload` |
| `WARDROBE_LAYER_CHANGE` / publish on `setSelectedLayer` | Already: `setWardrobeSelectedLayer` in `src/creator/wardrobe.ts` calls `creatorWardrobeFocusSlice.notify()` |
| New `app:creator:wardrobe-layer-change`, `focused-creation-change` | **Avoid** — conflicts with “no new `app:creator:*` for DOM-to-DOM sync” |

### Focused toggle (when implemented)

- Prefer **`creatorFocusedCreationSlice`** (`createPayloadSubscribable<{ enabled: boolean }>` or `createSubscribable`) + `setFocusedCreationEnabled` calling `notify`, not `publish` on the document bus.

### Controller pattern

- **`focusedCreationController`**: subscribe to **`creatorWardrobeFocusSlice`**, **`creatorModeSlice`**, **`creatorFocusedCreationSlice`** — not bus editor events.
- **`creatorCameraController`**: correctly stays on bus (`CREATOR_EVENTS.*`) for camera commands.

### Code references (as of refactor)

- Slices: `src/state/creatorSlices.ts` (`creatorLayerSlice`, `creatorModeSlice`, `creatorWardrobeFocusSlice`, `creator2dPaintSlice`, …)
- Wardrobe notify: `src/creator/wardrobe.ts` after `wardrobeSelectedLayer = layer`
- Mode notify: `src/creator.ts` — `creatorModeSlice.notify({ mode, previousMode })`
- Layer notify: `src/creator/layerVisibility.ts` — `creatorLayerSlice.notify()`

---

## 2. Plan document changes applied

File: `docs/plans/focused_creation_mode_41f28800.plan.md`

- **Overview (YAML)**: Mention slice-based sync + `MODELS-AND-SUBSCRIBERS.md`.
- **Summary**: Blocky editor ties to `creatorLayerSlice` / `creator2dPaintSlice`.
- **Branch / gaps / implementation pass**: Bus → slices; checkbox sync via `creatorLayerSlice`; port WIP branch off legacy publish/subscribe.
- **Layers panel**: Replace `LAYER3D_CHANGE` with `creatorLayerSlice`; implementation “Events” → “Slices.”
- **Architecture**: Policy blurb + mermaid with **Creator slices** subgraph (not “Event Bus” for wardrobe/mode/focused).
- **§1**: Renamed to **State sync: slices vs document bus**; lists what exists on `main` and what this feature adds.
- **§2**: `creatorFocusedCreationSlice`; toggle uses `notify`, not document `publish`.
- **§3**: Wardrobe — no extra `publish` in `creator.ts`; document `creatorWardrobeFocusSlice`; controller subscribes.
- **§4**: `creatorLayerSlice.notify()` instead of `LAYER3D_CHANGE`.
- **§5**: Controller subscriptions = slice list + contrast with `creatorCameraController`.
- **§9**: Document in **MODELS-AND-SUBSCRIBERS.md**; **EVENT-SYSTEM.md** — no new `app:creator:*` for this feature.
- **File summary table**: Remove `appEvents` row for these concerns; add `creatorSlices` + models doc.
- **Edge cases / open-decisions index**: Guards and index use slice names.

---

## 3. Follow-up

When implementing, keep **one notification path** per concern (slice `notify` only; no duplicate document events for the same editor state).
