# Electron Packaging Guide

This guide explains how to package the Electron version of `minecraft-3d-viewer` so you can share it with testers or publish desktop builds.

## Overview

This project uses:

- `electron` for the desktop runtime
- `electron-builder` for packaging
- `vite` to build the frontend into `dist/`

Configured output currently goes to `release/`.

## Prerequisites

- Node.js 20+
- npm
- project dependencies installed with `npm install`

Before packaging, make sure the app runs locally:

```bash
npm run electron:dev
```

## Important Scripts

```bash
npm run electron
npm run electron:dev
npm run pack
npm run dist
```

What they do:

- `npm run electron` builds the app and launches Electron
- `npm run electron:dev` runs a fast local Electron build for development
- `npm run pack` builds an unpacked Electron app into `release/`
- `npm run dist` builds distributable artifacts with `electron-builder`

## Current Packaging Config

The `package.json` Electron build config currently includes:

- `appId`: `com.minecraft-3d-viewer.app`
- `productName`: `3D Character Viewer`
- output directory: `release/`
- macOS targets: `dmg`, `zip`
- Windows targets: `nsis`, `portable`
- Linux target: `AppImage`

Included files:

- `dist/**`
- `electron/**`
- `server/**`
- `package.json`

## Local Packaging Workflow

### 1. Install dependencies

```bash
npm install
```

### 2. Build the frontend

This already happens inside the packaging scripts, but it can be useful to test explicitly:

```bash
npm run build
```

### 3. Create an unpacked desktop app

```bash
npm run pack
```

This is useful for smoke testing without generating installers.

Expected output:

- `release/` with an unpacked app bundle for your current platform

### 4. Create distributable artifacts

```bash
npm run dist
```

Expected outputs depend on your OS:

- macOS: `.dmg`, `.zip`
- Windows: `.exe` installer, portable build
- Linux: `.AppImage`

## Platform Notes

### macOS

- Build on macOS for the best results
- unsigned apps may show a Gatekeeper warning when opened on another machine
- for public distribution, you will eventually want Apple code signing and notarization

### Windows

- build on Windows for the most reliable Windows installers
- unsigned `.exe` files may trigger SmartScreen warnings
- for public distribution, use a signing certificate

### Linux

- `AppImage` is the configured output
- test on the target distribution before sharing broadly

## Sharing Builds Privately

For internal testing or quick sharing:

1. Run `npm run dist`
2. Zip the generated artifact if needed
3. Share the file from `release/`
4. Include a short note with:
   - supported OS
   - install/open instructions
   - whether the app is unsigned

For very early testing, `npm run pack` is often enough.

## Publishing Checklist

Before publishing publicly, verify:

1. `npm run electron:dev` launches successfully
2. viewer route works
3. creator route works
4. tray icon works
5. embedded server starts and serves the app
6. external API calls still work:
   - `POST /api/skin`
   - `POST /api/animation`
7. generated manifests are up to date
8. packaging output is created in `release/`

## Suggested Next Improvements

Before broad distribution, consider adding:

- proper app icons for macOS, Windows, and Linux
- code signing
- notarization on macOS
- a versioning and release workflow
- CI packaging for tagged releases
- a changelog or release notes template

## Troubleshooting

### Electron failed to install correctly

Try:

```bash
rm -rf node_modules/electron/dist
node node_modules/electron/install.js
```

### Packaging fails after frontend changes

Rebuild the frontend first:

```bash
npm run build
```

Then retry:

```bash
npm run pack
```

### Build works locally but shared app is blocked

That is usually a signing/notarization issue, not a packaging issue.

## Related Files

- `package.json`
- `electron/main.js`
- `electron/preload.js`
- `electron/server.js`
- `docs/SPEC-electron.md`
