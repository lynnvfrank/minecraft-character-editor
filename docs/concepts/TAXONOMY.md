# Source Code Taxonomy

This document defines the canonical structure of the `src/` directory. Use it when adding new code or when agents need to locate logic by concern.

---

## Taxonomy Table

| Layer | Purpose | Contains |
|-------|---------|----------|
| **domain** | Types, constants, schemas | Catalog types, EditMode, skin bounds, preview types |
| **lib** | Pure functions, shared utilities | Logger, color, math, URL helpers |
| **config** | Static configuration | Defaults, feature flags, preview configs |
| **state** | Shared runtime state (optional) | Session catalogs, creator state, [creatorSlices](../../src/state/creatorSlices.ts) (in-process subscribe/notify) |
| **services** | External I/O and integrations | Socket manager, character AI, API wrappers |
| **controllers** | Flow and orchestration | Mode machine, routes, bootstrap |
| **ui** | Shared visual components | Panels, overlays, chrome |
| **viewer** | 3D rendering and controls | Scene, skin application, orbit controls |
| **creator** | Creator feature (including its UI) | Panels, canvas, tools, wardrobe |
| **animation** | Animation playback | Manager, trapezoid bounds |
| **skin** | Skin domain logic | Layout, coordinates, mesh mapping |
| **debug** | Dev-only | DebugFacing, setupTestControls |

---

## Layer Definitions

| Layer | Role |
|-------|------|
| **domain** | Types, constants, schemas. Single source of truth for data shapes and domain rules. |
| **lib** | Pure helpers and shared utilities. No feature logic, minimal side effects. |
| **config** | Static configuration. Defaults, feature flags, preset options. |
| **state** | Shared runtime state used across features; creator slice notifications ([MODELS-AND-SUBSCRIBERS.md](./MODELS-AND-SUBSCRIBERS.md)). |
| **services** | External I/O and integrations. Socket, AI, API. |
| **controllers** | Application flow. Bootstrap, routes, mode machine, character lifecycle. |
| **ui** | Shared visual components: panels, overlays, chrome (nav, electron status). |
| **viewer** | 3D scene, skin application, orbit controls. |
| **creator** | Creator feature and its UI: panels, canvas, tools, wardrobe. |
| **animation** | Animation manager and playback. |
| **skin** | Skin layout, coordinates, mesh mapping. |
| **debug** | Dev-only utilities. |

---

## Directory Layout

```
src/
├── main.ts
├── styles/           # SCSS partials (index.scss imports all)
│   ├── creator/      # layout, swatches, panels, layers, tools, canvas, etc.
│   └── _*.scss       # reset, routes, app-shell, viewer-controls
│
├── domain/           # types, constants, schemas
├── lib/              # logger, color, trapezoidBounds
├── config/           # defaults, feature flags, preview configs
├── state/            # shared runtime state
├── services/         # socket, AI, API
├── controllers/      # app, routes, character, modes
│
├── ui/               # shared visual components
├── viewer/           # 3D scene, controls, skin application
├── creator/          # creator feature + its panels
├── animation/        # manager, playback
├── skin/             # layout, coordinates, mesh mapping
└── debug/            # dev-only
```

---

## Dependency Rules

Enforced by `src/architecture.test.ts` (runs with `npm test`). A folder may import from anything
except the folders listed for it:

| Folder | Must not import |
|--------|-----------------|
| **domain**, **skin** | state, services, viewer, animation, ui, creator, controllers, events, debug |
| **lib** | everything else in `src/` (it is the bottom layer) |
| **state** | services, viewer, animation, ui, creator, controllers |
| **viewer** | creator, controllers, ui, services |
| **animation** | creator, controllers, ui, viewer, services |
| **services** | creator, controllers, ui, viewer |
| **creator**, **ui** | controllers |
| **controllers**, **config**, **events**, **debug**, `main.ts` | (unrestricted; controllers wire everything) |

`src/creator.ts` counts as part of **creator** (it is the creator's public API).

When a lower layer needs a type from a higher one, move the type down (e.g. `DrawingTool` lives in
`domain/tools.ts`, `WardrobeLayerKey` in `skin/`) or describe it by shape at the use site.

**Known exception:** `viewer/controls.ts` imports the creator paint API for 3D painting. It is listed in
`ALLOWED_EXCEPTIONS` with the fix (inject the paint functions through `setupCreator3DPaint`'s deps).
The test fails if an exception stops being needed, so the list can't go stale.

---

## Quick Reference for Agents

| Concern | Location |
|---------|----------|
| Skin layout, UVs | `src/skin/` |
| Domain types (catalog, preview) | `src/domain/` |
| Routing, modes | `src/controllers/` |
| Creator state | `src/state/creatorState.ts` |
| Network, AI | `src/services/` |
| Pure helpers (color, logger) | `src/lib/` |
| Shared UI (preview panel, chat) | `src/ui/` |
