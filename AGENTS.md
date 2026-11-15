# AGENTS.md

Orientation for coding agents (and humans) working in this repo.

## What this is

A Minecraft-style character app built with Three.js, TypeScript and Vite:

- **Viewer** (`#/`): 3D character with skins, animations and sequences.
- **Creator** (`#/creator`): edit 64x64 Minecraft skins in 2D and 3D (Wardrobe, 3D, 2D modes), then export.
- A local HTTP/Socket.IO API (`server/`) that drives the character from scripts.
- An Electron shell (`electron/`) for desktop builds.

## Run, test, check

```bash
npm install           # Node 20+; also downloads Electron
npm run dev           # regenerate assets, then Vite on http://localhost:5173
npm run typecheck     # tsc --noEmit
npm test              # node:test over src/**/*.test.ts
npm run build         # typecheck + assets + vite build
```

- The **first** `npm run dev` is slow (several minutes): `assets:generate` renders ~1,600 wardrobe preview
  thumbnails in headless Chrome, and every run repacks the FBX clips into `public/animations/animations.glb`.
  The README section "What `npm run dev` generates" covers each step. If assets haven't changed,
  `npm run dev:server` starts Vite alone.
- About 110 test skins are bundled in `public/wardrobe/skins/`; nobody needs to bring their own.
- Creator routing is hash-based: `http://localhost:5173/#/creator`, not `/creator`.
- Debug logging: `npm run dev:log` (or `:info`, `:debug`, `:trace`) plus URL log params in `docs/TROUBLESHOOTING.md`.

Before finishing a change: `npm run typecheck`, `npm test`, and load the affected screen in the browser.

## Where things live

| Path | What |
| --- | --- |
| `src/main.ts` | App entry: routing, character lifecycle, skin/animation wiring |
| `src/creator.ts`, `src/creator/` | Creator screen: panels, brush, undo, wardrobe, mode panels |
| `src/viewer/` | Scene, camera controls, skin application |
| `src/state/` | Creator state and slices (observable models) |
| `src/events/` | App event bus |
| `src/skin/` | Skin layout, UVs, preprocessing |
| `src/animation/` | Animation manager and sequences |
| `server/api.js` | `/api/skin`, `/api/animation`, `/api/events`, `/api/log` |
| `scripts/` | Asset generators (skins manifest, wardrobe parts, previews, animation GLB) |
| `assets-src/` | Source assets that are not shipped (FBX animation clips) |
| `public/` | Shipped assets: models, packed animations, wardrobe skins, sequences |

## Generated files

`npm run assets:generate` writes manifests, previews and `public/animations/animations.glb`.
Don't hand-edit generated output; change the source in `assets-src/` or `public/wardrobe/skins/` and regenerate.

## Conventions and gotchas

- Skins are 64x64 PNGs in the Minecraft layout. UV and region reference: `docs/SKIN-LAYOUT.md`.
- Electron scripts set `VITE_SOCKET_ENABLED=true`; plain `npm run dev` does not use sockets.
- Bundled skins and Mixamo animations have licensing limits: read `docs/ATTRIBUTION-ASSESSMENT.md`
  before adding or shipping assets.

## Docs

- `docs/concepts/` — how the code works: modes, event system, models/subscribers, scene context, characters, configuration, taxonomy.
- `docs/SKIN-LAYOUT.md`, `docs/MINECRAFT-SKIN-ARTIST-GUIDE.md` — skin format and how to draw skins.
- `docs/NPM-TOOLING.md` — every npm script.
- `docs/TROUBLESHOOTING.md`, `docs/LOGGING-ARCHITECTURE.md` — debugging and logs.
- `docs/ELECTRON-PACKAGING.md` — desktop builds.
