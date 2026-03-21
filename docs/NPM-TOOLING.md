# npm Tooling Guide

This guide documents what npm is currently responsible for in this project, and how to run common workflows safely.

## Overview

In `minecraft-3d-viewer`, npm scripts orchestrate:

- web development and production builds (Vite)
- generated asset manifests/previews
- logging and debug profiles
- Electron desktop launch and packaging

Scripts are defined in `package.json`.

## Prerequisites

- Node.js 20+
- npm
- dependencies installed with `npm install`

## Core Workflows

### 1) Web development

```bash
npm run dev
```

Runs asset generation, then starts the Vite dev server.

### 2) Web build and preview

```bash
npm run build
npm run preview
```

`build` regenerates assets first, then builds the app into `dist/`.

### 3) Local API/server run

```bash
npm run start
```

Runs `server/index.js`.

### 4) Electron launch and packaging

```bash
npm run electron:dev
npm run electron
npm run pack
npm run dist
```

All of these set `VITE_SOCKET_ENABLED=true`, run a fresh web build, and then launch/package Electron.

## Script Reference

### Development scripts

| Script | Command intent | Typical use |
| --- | --- | --- |
| `dev:server` | Start Vite only | Rarely used directly; `dev` is preferred |
| `dev` | Generate assets + run Vite | Default daily development |
| `dev:log` | Dev with log relay and common systems | General debugging |
| `dev:log:info` | Dev with relay and all systems at info | Broad system visibility |
| `dev:log:debug` | Dev with relay and all systems at debug | Deep troubleshooting |
| `dev:log:trace` | Dev with relay and all systems at trace | High-verbosity diagnostics |
| `dev:debug` | Alias for `dev:log:debug` | Convenience |
| `dev:trace` | Alias for `dev:log:trace` | Convenience |

### Build/runtime scripts

| Script | Command intent | Typical use |
| --- | --- | --- |
| `build` | Generate assets + Vite production build | Release build prep |
| `preview` | Serve built `dist/` through Vite preview | Validate production bundle |
| `start` | Start Node server (`server/index.js`) | API/local server run |

### Asset pipeline scripts

| Script | Command intent | Typical use |
| --- | --- | --- |
| `wardrobe:generate` | Generate skin manifest, parts, and previews | Refresh wardrobe metadata/images |
| `wardrobe:clean` | Clear wardrobe previews | Reset generated previews |
| `animations:generate` | Generate animations manifest | Refresh animation index |
| `animations:clean` | Clear animation manifest | Reset animation index |
| `assets:generate` | Run all generation scripts | Full asset refresh |
| `assets:clean` | Clean wardrobe + animation generated artifacts | Cleanup pass |

### Electron scripts

| Script | Command intent | Typical use |
| --- | --- | --- |
| `electron` | Build web app + launch Electron | Production-style desktop run |
| `electron:dev` | Build web app + launch Electron | Local desktop testing |
| `pack` | Build web app + electron-builder unpacked output | Smoke-test desktop artifact |
| `dist` | Build web app + electron-builder distributables | Installer/release artifacts |

## Logging Profile Behavior

The logging scripts rely on environment variables:

- `LOG_RELAY=1` enables server relay endpoint usage
- `LOG_LEVEL` controls minimum level
- `LOG_SYSTEMS` controls enabled systems (use `*` for all)
- `VITE_LOG_RELAY=true` enables client relay default

Use `docs/TROUBLESHOOTING.md` for URL param patterns (`?log=...`, `?logRelay=1`) and known debugging workflows.

## Recommended Usage Patterns

### Daily local development

1. `npm install` (once or when dependencies change)
2. `npm run dev`
3. Open viewer (`#/`) or creator (`#/creator`)

### Troubleshooting runtime behavior

1. `npm run dev:log` (or `dev:log:debug`)
2. Add URL params from `docs/TROUBLESHOOTING.md`
3. Inspect both browser console and terminal output

### Preparing desktop artifacts

1. `npm run electron:dev` for a quick smoke test
2. `npm run pack` for unpacked app verification
3. `npm run dist` for distributables

## Special Considerations

1. **Asset generation is integrated**
   - `dev`, `build`, and Electron scripts already regenerate assets.
   - Manual edits to generated manifests may be overwritten.

2. **Electron install can fail on first install**
   - If needed: `rm -rf node_modules/electron/dist && node node_modules/electron/install.js`

3. **Cross-platform environment variables are handled**
   - Scripts use `cross-env`, so variable syntax remains consistent across macOS/Windows/Linux.

4. **Packaging outputs go to `release/`**
   - Artifact types depend on OS and electron-builder config.

## Related Docs

- `docs/ELECTRON-PACKAGING.md`
- `docs/TROUBLESHOOTING.md`
- `docs/LOGGING-ARCHITECTURE.md`
- `docs/LOGGING-IMPLEMENTATION.md`
- `README.md`
