# Source Restructuring Guide

This document proposes how to restructure `src/` so the codebase is more clearly defined and aligns with conventions common in TypeScript/Vite applications (feature folders, barrel exports, split-by-responsibility).

## Current State

- **main.ts** (~1595 lines): Entry point, character lifecycle, model load, skin/anim wiring, API events, route handling. Does too much.
- **creator.ts** (~1480 lines): Creator init, canvas, brush/undo, layers, wardrobe, mode panels, events. Also a large single file.
- **viewer/** (~4 files): Already a clean module with `index.ts` barrel; scene, skinApplication, controls, previewPresets.
- **creator/** (~18 files): UI panels and tools; has `index.ts` barrel and `api.ts` for context types.
- **Flat root**: Many single-purpose modules (skinLayout, skinPreprocess, skinCoordinates, animationManager, socketManager, logger, meshPartMapping, trapezoidBounds, etc.) live at `src/*.ts` with no grouping.

## Goals

1. **Single place for skin layout and coordinates** — already improved with `skinLayout.ts`; group with related skin code.
2. **Clear dependency flow** — core/skin → viewer → creator → app.
3. **Smaller, focused modules** — split `main.ts` and `creator.ts` by responsibility.
4. **Predictable locations** — “where does X go?” has a simple answer.
5. **Barrel exports** — each feature folder exposes a single public API via `index.ts`.

---

## Proposed Directory Layout

```
src/
├── main.ts                 # Thin entry: imports app, mounts, starts
├── style.css
│
├── app/                     # Application bootstrap and wiring (NEW – split from main.ts)
│   ├── index.ts
│   ├── bootstrap.ts        # Route, DOM mount, high-level init
│   ├── character.ts        # Character state, model load, skin/anim apply (from main)
│   └── routes.ts           # Route handlers (creator vs viewer), panel show/hide
│
├── core/                    # Domain-agnostic or shared “kernel” (NEW)
│   ├── index.ts
│   ├── logger.ts           # moved from src/logger.ts
│   └── events.ts           # optional: generic pub/sub if creatorEvents stays creator-specific
│
├── skin/                    # Skin layout, coordinates, preprocessing (NEW – group skin source of truth)
│   ├── index.ts
│   ├── layout.ts           # was skinLayout.ts – bounds, layer keys, part names
│   ├── coordinates.ts      # was skinCoordinates.ts – SKIN_SIZE, working coords, conversions
│   ├── preprocess.ts       # was skinPreprocess.ts – transparency handling
│   └── meshPartMapping.ts  # was src/meshPartMapping.ts – mesh name → part
│
├── viewer/                  # 3D scene, skin application, controls (existing, keep)
│   ├── index.ts
│   ├── scene.ts
│   ├── skinApplication.ts
│   ├── controls.ts
│   └── previewPresets.ts
│
├── animation/               # Animation and movement (NEW – group animation logic)
│   ├── index.ts
│   ├── manager.ts          # was animationManager.ts
│   ├── trapezoidBounds.ts  # was src/trapezoidBounds.ts
│   └── types.ts            # SequenceStep, TurnStrategy, CharacterStateLike if needed
│
├── creator/                 # Character creator UI and logic (existing, slim down creator.ts)
│   ├── index.ts            # re-export panels + api types
│   ├── api.ts              # context types, EditMode, DrawingTool (unchanged)
│   ├── state.ts            # was creatorState.ts
│   ├── init.ts             # NEW: initCreator, canvas setup, one-time wiring (from creator.ts)
│   ├── canvas.ts           # NEW: getCreatorSkinCanvas, loadSkinFromPath, export, populate (from creator.ts)
│   ├── modes.ts            # NEW: edit mode, panel visibility, layer state normalize/restore (from creator.ts)
│   ├── wardrobe.ts         # NEW: wardrobe selection, composite, base skin (from creator.ts)
│   ├── blockyEditor.ts
│   ├── brush.ts
│   ├── undo.ts
│   ├── skinIO.ts
│   ├── colorPicker.ts
│   ├── toolbar.ts
│   ├── swatches.ts
│   ├── skinLayersPanel.ts
│   ├── editorToolsPanel.ts
│   ├── texturePositionPanel.ts
│   ├── wardrobePartsPanel.ts
│   ├── wardrobeLibraryPanels.ts
│   ├── dom.ts
│   ├── container.ts
│   ├── toolIcons.ts
│   └── creatorEvents.ts    # optional: move to creator/events.ts
│
├── ui/                      # Shared or top-level UI not owned by creator (NEW – optional)
│   ├── index.ts
│   ├── previewCameraPanel.ts  # was src/previewCameraPanel.ts
│   ├── fakeChatUI.ts         # was src/fakeChatUI.ts
│   └── electronStatus.ts     # was src/electronStatus.ts
│
├── services/                # Optional: network, sockets, AI (NEW)
│   ├── index.ts
│   ├── socketManager.ts    # was src/socketManager.ts
│   └── characterAI.ts      # was src/characterAI.ts
│
├── types/                   # Shared types (existing)
│   ├── color.ts
│   ├── catalog.ts
│   └── previewConfig.ts
│
├── config/                  # Static config (existing – e.g. preview configs)
│   └── preview/
│
├── debug/                   # Dev-only or diagnostic (NEW – optional)
│   ├── debugFacing.ts      # was src/debugFacing.ts
│   └── setupTestControls.ts # was src/setupTestControls.ts
└── ...
```

## Convention Summary

| Convention | Application |
|------------|-------------|
| **Feature folders** | `skin/`, `viewer/`, `animation/`, `creator/`, `app/` each own a slice of the product. |
| **Barrel `index.ts`** | Each feature folder exports its public API from `index.ts`; avoid deep imports from outside. |
| **Single responsibility** | `main.ts` only boots the app; `app/` holds bootstrap and character/routes; `creator/` is split into init, canvas, modes, wardrobe. |
| **Core vs feature** | `core/` for shared infra (logger); `skin/` for skin source of truth; `viewer/` and `creator/` depend on `skin/`, not the other way around. |
| **Colocation** | Animation types and trapezoid bounds live in `animation/`; skin layout and mesh mapping in `skin/`. |
| **Naming** | Prefer short, clear file names: `layout.ts`, `preprocess.ts`, `manager.ts`; keep names like `skinLayout.ts` only if the folder is already `skin/`. |

## Migration Order (Low Risk First)

1. **Create `skin/` and move** ✅ *Done*  
   - `skinLayout.ts` → `skin/layout.ts`  
   - `skinCoordinates.ts` → `skin/coordinates.ts`  
   - `skinPreprocess.ts` → `skin/preprocess.ts`  
   - `meshPartMapping.ts` → `skin/meshPartMapping.ts`  
   Add `skin/index.ts` re-exporting the public API. Update all imports (creator, viewer, main, scripts, skin/preprocess importing from skin/layout). Run tests and build.

2. **Create `animation/` and move** ✅ *Done*  
   - `animationManager.ts` → `animation/manager.ts`  
   - `trapezoidBounds.ts` → `animation/trapezoidBounds.ts`  
   Add `animation/index.ts`. Update `main.ts`, `characterAI.ts`, `setupTestControls.ts`, `fakeChatUI.ts`.

3. **Create `app/` and split `main.ts`**  
   - Extract route handling and “what to show when” into `app/routes.ts`.  
   - Extract character creation, model load, skin/anim application into `app/character.ts`.  
   - Keep a minimal `main.ts`: import `./app`, call `bootstrap()` or equivalent.  
   - Move any remaining one-off helpers from `main.ts` into `app/bootstrap.ts` or the appropriate app module.

4. **Split `creator.ts` into creator submodules**  
   - `creator/init.ts`: `initCreator`, one-time panel and event wiring.  
   - `creator/canvas.ts`: canvas getters, load/export, populate.  
   - `creator/modes.ts`: edit mode, panel visibility, layer state save/restore.  
   - `creator/wardrobe.ts`: wardrobe part selection, composite logic, base skin.  
   - Keep `creator.ts` as a thin barrel that re-exports from these modules, or remove it and have `main`/`app` import from `creator/` directly.

5. **Optional: `core/`, `ui/`, `services/`, `debug/`**  
   - Move logger, preview panel, fakeChatUI, electronStatus, socketManager, characterAI, debugFacing, setupTestControls as above.  
   - Add barrels and fix imports.

## Import Paths After Restructure

- **From app or main**: `import { ... } from './skin'`, `from './viewer'`, `from './animation'`, `from './creator'`.
- **Creator code**: `import { SKIN_LAYER_BOUNDS, LAYER_KEYS } from '../skin'` (or `@/skin` if path alias is added).
- **Viewer code**: `import { ... } from '../skin'` for layout/coordinates if needed; viewer’s `skinApplication` may stay the main consumer of skin data.
- **Scripts**: `scripts/generate-wardrobe-parts.ts` imports from `../src/skin` (or `../src/skin/layout` if you don’t barrel-export everything).

## Path Aliases (Optional)

In `vite.config` and `tsconfig`, add e.g. `@/` → `src/` so imports become `import { LAYER_KEYS } from '@/skin'`. Reduces `../` and keeps imports stable when files move inside a folder.

## What Stays Where

- **`types/`** — Shared types only; no business logic.
- **`config/`** — JSON and static config; code that reads it can live in the feature that uses it (e.g. viewer for preview config).
- **`viewer/`** — No structural change; it already follows the intended pattern. It may import from `skin/` for layout/coordinates if needed.
- **`creator/`** — All creator-specific UI and logic; `creator.ts` is reduced to orchestration or removed in favor of `creator/init` + `creator/canvas` + `creator/modes` + `creator/wardrobe`.

This layout gives a single place for skin layout and coordinates (`skin/`), a clear place for app startup and character logic (`app/`), and smaller, focused modules inside `creator/` and elsewhere, matching conventions used in many TypeScript projects.
