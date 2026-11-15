# AGENTS.md

The app is **Blockygotchi**: a Three.js + TypeScript + Vite character viewer and skin editor for blocky characters.
"Minecraft Character Editor" is only the repo/package name.

## Commands

```bash
npm install
npm run dev          # assets:generate, then Vite at http://localhost:5173 (first run: several minutes)
npm run dev:server   # Vite only; use when assets haven't changed
npm run typecheck
npm test             # node:test, src/**/*.test.ts
npm run build
```

## Before you say a change works

1. `npm run typecheck` and `npm test` pass.
2. Load the screen you changed in a browser and check the console. Typecheck doesn't catch rendering bugs.
   - Viewer: `http://localhost:5173/`
   - Creator: `http://localhost:5173/#/creator`. Routing is hash-based; `/creator` without the `#` won't open the creator.
3. If the scene is empty, check that `assets:generate` finished before you blame the code.

## Things that will trip you up

- **Generated files.** `assets:generate` writes the skins manifest, `public/animations/animations.glb`,
  wardrobe part crops and preview thumbnails. Don't hand-edit them; change the source
  (`public/wardrobe/skins/*.png`, `assets-src/animations/*.fbx`) and regenerate. The README table covers each step.
- **Skin geometry has one source of truth:** `src/skin/` (layout, UV bounds). The wardrobe generator imports it,
  so a bounds change affects both the app and the generated parts. Reference: `docs/SKIN-LAYOUT.md`.
- **Slim (Alex) arms model.** `public/models/RunningboyRigSlim.fbx` is built from `RunningboyRig.fbx` by
  `scripts/blender_build_runningboy_slim.py` (Blender 3.6, `--background --python`). Regenerate it; don't edit it by hand.
- **Creator state** goes through observable slices in `src/state/`. Subscribe to them; don't poke the DOM from
  other panels. See `docs/concepts/MODELS-AND-SUBSCRIBERS.md` and `docs/concepts/EVENT-SYSTEM.md`.
- **Logging** is opt-in per system via URL, e.g. `?log=animation:debug`. The dev server prints the full list on start.
- **Naming and licensing.** Never put "Minecraft" in user-facing names (trademark). The bundled skins and Mixamo
  clips are for testing only. Read `docs/ATTRIBUTION-ASSESSMENT.md` before adding or shipping assets.
- **Electron** (`npm run electron:dev`) starts, but shutdown is unreliable: the embedded Express/Socket.IO server
  isn't fully torn down, and its default port (5173) collides with the Vite dev server. Don't assume Electron
  behaviour matches the web build.

## Docs

`docs/concepts/` explains how the code is put together (modes, events, state, scene).
The other files in `docs/` cover single topics; their names say which.
