# Minecraft 3D Character Viewer

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

`npm run dev` also refreshes generated asset manifests first.

Open the URL shown in the terminal, usually `http://localhost:5173`.

Useful routes:

- Viewer: `http://localhost:5173/`
- Creator: `http://localhost:5173/#/creator`

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
minecraft-3d-viewer/
├── electron/                     # Electron main process, preload, tray assets
├── server/                       # API handlers and web/Electron server helpers
├── src/                          # Viewer, creator, animation, and UI code
├── public/
│   ├── models/                   # FBX rigs
│   ├── animations/               # FBX clips + generated manifest
│   ├── wardrobe/skins/           # Skin PNGs + generated manifests/previews
│   └── sequences/                # Composite animation sequences
├── scripts/                      # Manifest generation and helper scripts
└── docs/                         # Specs and supporting documentation
```

## Documentation Map

- `docs/specs/CHARACTER-CREATION-SCREEN-SPEC.md` - full creator UX and behavior spec
- `docs/specs/CREATOR-VIEWER-STATE-MANAGEMENT.md` - state boundaries between creator/viewer
- `docs/specs/MINECRAFT-SKIN-ARTIST-AND-AGENT-SPEC.md` - skin art process, constraints, and QA
- `docs/specs/SPEC-electron.md` - Electron migration and architecture intent
- `docs/minecraft-skin-layout-specification.md` - canonical skin layout and UV reference
- `docs/LOGGING-ARCHITECTURE.md` and `docs/LOGGING-IMPLEMENTATION.md` - logging design + implementation
- `docs/TROUBLESHOOTING.md` - debugging workflows and known issues
- `docs/ELECTRON-PACKAGING.md` - packaging and distribution workflow
- `docs/archive/` - historical docs retained for context

## For Future Agents

If you are an agent working in this repository, start with:

- `docs/AGENT-README.md` for scope, execution flow, command usage, platform baseline, and constraints
