# Minecraft Character Editor

The app itself is named **Blockygotchi**: that's the name in the tab title, About panel and desktop build. The repo name only describes the project. "Minecraft" stays out of the product name because it is a trademark (see `docs/ATTRIBUTION-ASSESSMENT.md`).

Three.js-based Minecraft character viewer and skin editor with:

- a 3D viewer with skins, animations, and sequences
- a full character creator with 2D and 3D skin editing
- a local API for driving the character from scripts or other apps
- an Electron desktop shell for packaging and sharing

## Requirements

- Node.js 20+
- npm
- macOS, Windows, or Linux for local development

## Install

```bash
npm install
```

`npm install` also downloads the Electron runtime used by the desktop build.

If Electron fails to install correctly, retry with:

```bash
rm -rf node_modules/electron/dist
node node_modules/electron/install.js
```

## Run The App (Web)

Start the Vite development server:

```bash
npm run dev
```

`npm run dev` runs `npm run assets:generate` first, then starts Vite. The first run takes several minutes; later runs are much faster. See [What `npm run dev` generates](#what-npm-run-dev-generates).

Open the URL shown in the terminal, usually `http://localhost:5173`.

Useful routes:

- Viewer: `http://localhost:5173/`
- Creator: `http://localhost:5173/#/creator`

## What `npm run dev` generates

The repo ships source assets, and the app needs a few files derived from them. `assets:generate` builds those files in four steps:

| Step | Script | What it makes | Why | Cost |
| --- | --- | --- | --- | --- |
| 1 | `generate-skins-manifest.js` | `public/wardrobe/skins/index.json` | The app finds skins through this list, so dropping a PNG into `public/wardrobe/skins/` is enough to add one | Instant |
| 2 | `pack-animations.mjs` | `public/animations/animations.glb` + `index.json` | Packs the ~40 Mixamo FBX clips in `assets-src/animations/` into one GLB, so the app loads one file and doesn't ship the raw FBX clips (licensing: see `docs/ATTRIBUTION-ASSESSMENT.md`) | About a minute, **every run** (it doesn't check for changes yet) |
| 3 | `generate-wardrobe-parts.ts` | `public/wardrobe/parts/<part>/*.png` | Crops each outfit into parts (hat, top, pants, ...) for Wardrobe mixing | A few seconds |
| 4 | `generate-skin-previews.js` | `previews/` thumbnails for every skin and part | Starts a temporary Vite server and headless Chrome (Puppeteer), then renders each skin and part in 3D for the Wardrobe thumbnails | **Several minutes on the first run** (~1,600 images); later runs only render missing previews |

The skins manifest and the animation GLB are committed, so a fresh clone runs even before step 2 finishes. The parts and previews are gitignored. If nothing has changed, `npm run dev:server` starts Vite alone and skips all four steps.

### Skins

About 110 sample skins are bundled in `public/wardrobe/skins/`, so the app works right away. They are for testing only and must be replaced before any public release (see `docs/ATTRIBUTION-ASSESSMENT.md`). To add your own skin, put a 64x64 PNG in that folder and rerun `npm run dev`.

## Build And Preview (Web)

Create the production build:

```bash
npm run build
```

Preview the built site:

```bash
npm run preview
```

## Run The App (Electron)

For local Electron development:

```bash
npm run electron:dev
```

For a production-style Electron launch:

```bash
npm run electron
```

Both commands:

- regenerate asset manifests
- build the Vite app into `dist/`
- enable `VITE_SOCKET_ENABLED=true`
- start Electron with `electron/main.js`

To package desktop builds:

```bash
npm run pack
npm run dist
```

- `npm run pack` creates an unpacked app in `release/`
- `npm run dist` creates distributable artifacts using `electron-builder`

## Core npm Commands

```bash
# Development
npm run dev
npm run dev:log
npm run dev:log:info
npm run dev:log:debug
npm run dev:log:trace

# Build and run
npm run build
npm run preview
npm run start
npm run electron:dev
npm run electron

# Asset pipeline
npm run assets:generate
npm run assets:clean
npm run wardrobe:generate
npm run wardrobe:clean
npm run animations:generate
npm run animations:clean
```

See `docs/NPM-TOOLING.md` for a full script-by-script guide.

## Project Structure

```text
minecraft-character-editor/
├── src/                          # Viewer, creator, animation, and UI code
├── server/                       # Local API and web server
├── electron/                     # Electron main process, preload, tray assets
├── scripts/                      # Asset generators
├── assets-src/animations/        # Source Mixamo FBX clips (not shipped)
├── public/
│   ├── models/                   # FBX rig
│   ├── animations/               # Packed animations.glb + index.json (generated)
│   ├── wardrobe/skins/           # Skin PNGs + generated manifests/previews
│   └── sequences/                # Composite animation sequences
└── docs/                         # Reference documentation
```

## Documentation

- `docs/concepts/` - how the code works: modes, events, state models, scene, characters, configuration
- `docs/SKIN-LAYOUT.md` - canonical 64x64 skin layout and UV reference
- `docs/MINECRAFT-SKIN-ARTIST-GUIDE.md` - drawing skins: process, constraints, QA
- `docs/NPM-TOOLING.md` - every npm script
- `docs/TROUBLESHOOTING.md` and `docs/LOGGING-ARCHITECTURE.md` - debugging and logs
- `docs/ELECTRON-PACKAGING.md` - desktop packaging and distribution
- `docs/ATTRIBUTION-ASSESSMENT.md` - asset licensing; read before shipping

## For Agents

Start with `AGENTS.md` (Claude Code loads it through `CLAUDE.md`).
