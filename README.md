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

## Run The Web App

Start the Vite development server:

```bash
npm run dev
```

Open the URL shown in the terminal, usually `http://localhost:5173`.

Useful routes:

- Viewer: `http://localhost:5173/`
- Creator: `http://localhost:5173/#/creator`

Useful dev commands:

- `npm run dev:log` - run Vite with client log relay enabled
- `npm run dev:log:debug` - verbose logging
- `npm run preview` - preview the production Vite build locally

## Build The Web App

Create the production build:

```bash
npm run build
```

That command also refreshes generated asset manifests before building:

- `public/skins/index.json`
- `public/animations/index.json`

Preview the built site:

```bash
npm run preview
```

## Run The Electron App

For local Electron development:

```bash
npm run electron:dev
```

For a production-style Electron launch:

```bash
npm run electron
```

What these do:

- build the Vite app into `dist/`
- enable `VITE_SOCKET_ENABLED=true`
- start Electron with `electron/main.js`

The Electron app starts an embedded local server and loads the app in a `BrowserWindow`.

Notes:

- The local server defaults to port `5173`
- if `5173` is busy, the Electron shell can fall back to `5174`
- the tray/menu shell lives in `electron/`

## Common Scripts

```bash
npm run generate-skins
npm run generate-animations
npm run generate-skin-previews
npm run set-skin <skin-name>
npm run set-animation <animation-key>
```

Examples:

```bash
npm run set-skin RunningboyRig
npm run set-animation bored
```

## Project Structure

```text
minecraft-3d-viewer/
├── electron/                     # Electron main process, preload, tray assets
├── server/                       # API handlers and web/Electron server helpers
├── src/                          # Viewer, creator, animation, and UI code
├── public/
│   ├── models/                   # FBX rigs
│   ├── animations/               # FBX animation clips + generated manifest
│   ├── skins/                    # Skin PNGs + generated manifest
│   └── sequences/                # Composite animation sequences
├── scripts/                      # Manifest generation and helper scripts
└── docs/                         # Specs and supporting documentation
```

## Packaging Electron Builds

To create distributable desktop builds:

```bash
npm run pack
npm run dist
```

- `npm run pack` creates an unpacked app in `release/`
- `npm run dist` creates installable artifacts using `electron-builder`

See `docs/ELECTRON-PACKAGING.md` for the full packaging and publishing guide.

## Related Docs

- `docs/CHARACTER-CREATION-SCREEN-SPEC.md`
- `docs/SPEC-electron.md`
- `docs/ELECTRON-PACKAGING.md`
- `docs/minecraft-skin-layout-specification.md`
