# Character Creator — Event Refactoring Plan

This document describes the conceptual objects and interactions of the character creator, identifies universal events to introduce, and provides a step-by-step todo list for refactoring. Use this when continuing the refactor in a new agent context.

---

## Table of Contents

1. [Conceptual Overview](#conceptual-overview)
2. [Current Architecture](#current-architecture)
3. [Universal Events to Introduce](#universal-events-to-introduce)
4. [Additional Concepts to Formalize](#additional-concepts-to-formalize)
5. [Refactoring Todo List](#refactoring-todo-list)
6. [Implementation Notes](#implementation-notes)
7. [Event Contracts](#event-contracts)

---

## Conceptual Overview

### Core Objects

| Object | Description | Current State |
|--------|-------------|---------------|
| **3D Viewer** | Three.js scene with character model, orbit controls, raycasting | In `main.ts`; renders model with skin texture |
| **2D Viewer** | Blocky 64×64 grid showing skin; clickable cells | In `creator.ts`; `buildBlockyGrid`, `renderBlockyGrid` |
| **Creator Mode** | Shell that brings in HTML panels and enables skin editing | `initCreator()` in `creator.ts` |
| **Tools Panel** | Left floating panel: 2D/3D toggle, Brush/Eraser/Fill/Eyedropper, Undo/Redo, Rulers, Template | `buildToolsPanel3D()` |
| **Right Panels** | Color picker, Swatches, Layers, Hover info | `buildColorPickerPanel`, `buildSwatchesPanel`, `buildLayersPanel3D`, `buildHoverInfoPanel` |
| **Skin Canvas** | Internal WORK_SIZE×WORK_SIZE canvas; source of truth for skin pixels | `getSkinCanvas()` |
| **Tool State** | Active tool (navigate, brush, eraser, fill, eyedropper) | `activeTool`; mutually exclusive |
| **Undo/Redo History** | Command stack for pixel changes and skin loads | `undoStack`, `redoStack` |
| **Layer State** | Per-layer visibility and lock (hat, head, jacket, body, sleeves, arms, pants, legs) | `layer3DVisible`, `layer3DLocked` |
| **Selected Layers** | Subset of layers that accept paint (visible + unlocked) | Implicit from `layer3DVisible` and `layer3DLocked`; `restrictToLayers` + `selectedLayers` |

### Data Flow Summary

- **2D view** and **3D view** both report mouse position over the skin.
- **2D view**: `clientToBlockyCell()` → working coords → `getPartDisplayNameAtCoords()`, `getLayerAtCoords()`.
- **3D view** (`main.ts`): raycast → UV → `uvToWorkingCoords()` → `getPartDisplayNameAtCoords()`.
- Both call `updateHoverInfo(part, skinX, skinY)` → `reportTexturePosition` publishes `creator-texture-position-change`; hover info and layers panel subscribe.
- **Current color**: `applyColorToUI()` publishes `creator-current-color-change`; toolbar, hex input, and color picker subscribe.
- **Swatch history**: `addToSwatch`/`setSwatchAt` publish `creator-swatch-history-change`; swatch grid subscribes.

### Key Interactions

1. **Skin selection** → Load skin into canvas → Render to 2D grid and 3D texture.
2. **Tool selection** → Changes cursor, click handling (brush/eraser/fill/eyedropper vs navigate).
3. **Color change** → Many UI elements must stay in sync; currently done imperatively.
4. **Hover over skin** → Info panel and layers panel must reflect part + (x,y); currently `updateHoverInfo` does both.
5. **Layer visibility/lock** → Affects 3D rendering and paint eligibility; `creator-layer3d-change` already exists.
6. **2D/3D mode toggle** → Swaps main stage layout; `creator-edit-mode-change` already exists.

---

## Current Architecture

### Event-Based Architecture (Post-Refactor)

All state changes publish events via `publish()` from `creatorEvents.ts`. Components subscribe via `subscribe()`. See [Event Contracts](#event-contracts) for the full table.

### Previous Problems (Resolved by Refactor)

1. ~~**Color**: `applyColorToUI` reached into many DOM elements~~ → Now publishes `creator-current-color-change`; subscribers update UI.
2. ~~**Swatches**: Shading swatches had no event~~ → Color picker subscribes to `creator-current-color-change`; swatch grid subscribes to `creator-swatch-history-change`.
3. ~~**Texture position**: `updateHoverInfo` directly manipulated panels~~ → Now publishes `creator-texture-position-change`; hover info and layers panel subscribe.
4. ~~**Inconsistency**~~ → All events use `publish()`/`subscribe()` from `creatorEvents.ts`.

---

## Universal Events to Introduce

### 1. `creator-current-color-change`

**Payload:** `{ color: string }` (hex, e.g. `#8b7355`)

**When to publish:** Whenever the current color changes:
- Color picker (SV/hue)
- Swatch click
- Hex input change
- Eyedropper sample
- Drop on current color swatch

**Subscribers:**
- Toolbar current color swatch
- Hex input
- Color picker (current swatch + SV/hue dots + shading swatches)
- Swatch grid (when adding to history; grid itself may not need to re-render on color change, but shading swatches do)

**Note:** Swatch history (add/remove/reorder) could be a separate event if we want to decouple "color changed" from "swatch list changed". For Phase 1, we can keep `addToSwatch` as part of the color change flow and have the swatch grid refresh on `creator-current-color-change` only when the new color was added to the list.

---

### 2. `creator-current-layer-change` (or `creator-texture-position-change`)

**Payload:** `{ part: string | null; layer: string | null; skinX: number; skinY: number }`

- `part`: Display name (e.g. "Right sleeve", "Head")
- `layer`: Layer key (e.g. "sleeves", "head")
- `skinX`, `skinY`: 64×64 texture coordinates (-1 when not over skin)

**When to publish:** When the pointer moves over the 2D grid or 3D view and the reported position/part changes.

**Subscribers:**
- Hover info panel (displays `PartName (skinX, skinY)` or `—`)
- Layers panel (highlights the row for `layer` when non-null)

**Publishers:**
- 2D blocky grid `handleBlockyPointer` (mousemove, mouseleave)
- 3D canvas `handlePointerMove` and `handle3DCanvasLeave` in main.ts

---

### 3. (Optional) `creator-swatch-history-change`

**Payload:** `{ swatches: string[] }`

**When to publish:** When the swatch list changes (add, remove, reorder, drag-drop).

**Subscribers:**
- Swatch grid (re-render)

This can be deferred if we keep the swatch grid refresh coupled to color change for now.

---

## Additional Concepts to Formalize

### Quick Event Handlers (Direct Wiring)

For simple, localized interactions, direct event handlers are fine:
- Tool button click → set active tool
- Undo button click → perform undo
- Layer visibility checkbox → set visibility
- Hex input change → set current color (then publish event)

### Interfaces to Consider

1. **Tool interface**
   - `activate()`, `deactivate()` — for future tools that need setup/teardown
   - Cursor style per tool
   - Click/drag behavior per tool (could be strategy pattern)

2. **Color state interface**
   - `getCurrentColor(): string`
   - `setCurrentColor(hex: string, options?: { addToSwatch?: boolean }): void`
   - `subscribe(fn: (color: string) => void): () => void`

3. **Texture position / layer interface**
   - `getCurrentPosition(): { part, layer, skinX, skinY }`
   - `setCurrentPosition(pos): void` — publishes event
   - `subscribe(fn): () => void`

4. **Event bus abstraction**
   - Central module: `creatorEvents.ts`
   - `publish(eventName, detail)`
   - `subscribe(eventName, handler): unsubscribe`
   - Wraps `document.dispatchEvent` / `document.addEventListener` for consistency, and allows swapping to a different bus later.

---

## Refactoring Todo List

Work through these **one at a time**; confirm before moving to the next step.

### Phase 1: Event Bus and Current Color ✅

| # | Task | Description |
|---|------|-------------|
| 1 | **Create `src/creatorEvents.ts`** | Define event names, payload types, `publish()`, `subscribe()`. Start with `creator-current-color-change`. |
| 2 | **Refactor `applyColorToUI` to publish** | Replace direct DOM updates with `publish('creator-current-color-change', { color })`. Keep a single place that updates `currentColor` and `addToSwatch` when appropriate. |
| 3 | **Subscribe: Toolbar + Hex input** | Toolbar and hex input listen for `creator-current-color-change` and update their DOM. Remove their updates from `applyColorToUI`. |
| 4 | **Subscribe: Color picker** | Color picker panel listens for `creator-current-color-change` and calls `syncColorPickerFromHex`. Remove that call from `applyColorToUI`. |
| 5 | **Subscribe: Swatch grid** | Swatch grid listens for `creator-current-color-change`; refresh the grid on every color change. |
| 6 | **Verify color flow** | Test: color picker, swatch click, hex input, eyedropper, drag-drop. All paths should publish the event and all UI should update. |

### Phase 2: Current Layer / Texture Position ✅

| # | Task | Description |
|---|------|-------------|
| 7 | **Add `creator-texture-position-change` to event bus** | Payload: `{ part, layer, skinX, skinY }`. |
| 8 | **Create `reportTexturePosition(part, skinX, skinY)`** | Central function that derives layer from part, publishes the event. `updateHoverInfo` is now a thin wrapper. |
| 9 | **Subscribe: Hover info panel** | Listen for `creator-texture-position-change`; update text to `PartName (skinX, skinY)` or `—`. |
| 10 | **Subscribe: Layers panel** | Listen for `creator-texture-position-change`; highlight the row for `layer` when non-null, clear others. |
| 11 | **Wire 2D and 3D views** | 2D and 3D continue calling `updateHoverInfo`, which calls `reportTexturePosition`. No main.ts changes. |
| 12 | **Remove `updateHoverInfo` direct DOM** | Done. `updateHoverInfo` now delegates to `reportTexturePosition`; subscribers handle all DOM. |

### Phase 3: Cleanup and Extensibility ✅

| # | Task | Description |
|---|------|-------------|
| 13 | **Migrate existing events to creatorEvents** | Use `publish()`/`subscribe()` and `CREATOR_EVENTS` in creator.ts and main.ts. |
| 14 | **Document event contracts** | Added [Event Contracts](#event-contracts) section listing all events, payloads, and subscribers. |
| 15 | **Swatch history event** | Added `creator-swatch-history-change`; swatch grid subscribes instead of `creator-current-color-change`. |

---

## Implementation Notes

### Event Bus Shape (creatorEvents.ts)

```typescript
// Event names
export const CREATOR_EVENTS = {
  CURRENT_COLOR_CHANGE: 'creator-current-color-change',
  TEXTURE_POSITION_CHANGE: 'creator-texture-position-change',
  EDIT_MODE_CHANGE: 'creator-edit-mode-change',
  TOOLS_CHANGE: 'creator-tools-3d-change',
  LAYER3D_CHANGE: 'creator-layer3d-change',
} as const;

// Payload types
export type CreatorCurrentColorDetail = { color: string };
export type CreatorTexturePositionDetail = {
  part: string | null;
  layer: string | null;
  skinX: number;
  skinY: number;
};

export function publish(event: string, detail?: unknown): void;
export function subscribe(event: string, handler: (e: CustomEvent) => void): () => void;
```

### Backwards Compatibility

- `main.ts` imports `updateHoverInfo` from creator. During migration, `updateHoverInfo` can call `reportTexturePosition`, which publishes the event. Subscribers in creator.ts handle the panel updates. Once stable, we can export `reportTexturePosition` and have main.ts call it directly if desired.
- Existing `document.dispatchEvent` / `addEventListener` for `creator-edit-mode-change` etc. can remain until Phase 3, or we can route them through the event bus immediately.

---

## Event Contracts

All events use `publish()` and `subscribe()` from `src/creatorEvents.ts`. Event names live in `CREATOR_EVENTS`.

| Event | Payload | Publishers | Subscribers |
|-------|---------|------------|-------------|
| `creator-current-color-change` | `{ color: string }` | `applyColorToUI` | Toolbar (current swatch, hex input), color picker panel |
| `creator-texture-position-change` | `{ part, layer, skinX, skinY }` | `reportTexturePosition` (via `updateHoverInfo`) | Hover info panel, layers panel |
| `creator-swatch-history-change` | — | `addToSwatch`, `setSwatchAt` | Swatch grid |
| `creator-edit-mode-change` | `{ is3D: boolean }` | Tools panel (2D/3D button) | main.ts (OrbitControls, 3D placement), tools panel (view toggles) |
| `creator-tools-3d-change` | — | `setActiveTool` | main.ts (OrbitControls, cursor), tools panel (active state) |
| `creator-layer3d-change` | — | `setLayer3DVisible`, `setLayer3DLocked` | Layers panel (sync checkboxes); texture rebuild when layers read |

---

### Testing Checklist

After each phase:

- [ ] 2D mode: hover over grid, info panel and layers panel update
- [ ] 3D mode: hover over model, info panel and layers panel update
- [ ] Mouse leave: info shows "—", no layer highlighted
- [ ] Color picker: change color, toolbar/hex/swatches/shading update
- [ ] Swatch click: current color and all panels update
- [ ] Eyedropper: sample color, all panels update
- [ ] Undo/redo: still works
- [ ] Layer visibility/lock: still affects 3D and paint

---

## References

- [CHARACTER-CREATION-SCREEN-SPEC.md](./CHARACTER-CREATION-SCREEN-SPEC.md) — Full feature spec
- [src/creator.ts](../src/creator.ts) — Main creator logic
- [src/main.ts](../src/main.ts) — 3D viewer, raycasting, `updateHoverInfo` calls
