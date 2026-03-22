# Agent README

This document is a practical orientation guide for future agents working on `minecraft-3d-viewer`.

## Project Scope

The project is a Minecraft-style character app with two core experiences:

- **Viewer mode:** render a 3D character, apply skins, play animations, and run simple animation sequences.
- **Creator mode:** edit 64x64 Minecraft skins in 2D and 3D, then export results.

The repository also includes:

- a local API for skin/animation events
- optional Socket.IO messaging
- an Electron shell for desktop packaging/distribution

## Primary Execution Paths

### 1) Web development path

- Run `npm run dev`
- Vite serves the app (typically `http://localhost:5173`)
- Use `#/` for viewer and `#/creator` for creator

### 2) Production web path

- Run `npm run build`
- Run `npm run preview` (or `npm run start` for server mode)

### 3) Electron desktop path

- Run `npm run electron:dev` for local desktop testing
- Run `npm run electron` for production-style launch
- Run `npm run pack` / `npm run dist` for packaged outputs

## Commands You Will Use Most

### Daily development

- `npm run dev`
- `npm run dev:log`
- `npm run dev:log:debug`
- `npm run dev:log:trace`

### Asset generation and cleanup

- `npm run assets:generate`
- `npm run assets:clean`
- `npm run wardrobe:generate`
- `npm run wardrobe:clean`
- `npm run animations:generate`
- `npm run animations:clean`

## Platform Baseline

Use these as baseline assumptions unless the user tells you otherwise:

- Node.js 20+
- npm
- zsh shell
- Common local dev target: macOS on Apple Silicon (M1 class)

The app is intended to work on macOS, Windows, and Linux, but packaging is most reliable when built on the target OS.

## Important Special Considerations

1. **Generated assets are part of the workflow**
   - `dev`, `build`, and Electron scripts regenerate asset manifests.
   - If assets look stale, run `npm run assets:generate`.

2. **Routing is hash-based for creator mode**
   - Creator route is `#/creator` (not `/creator`).

3. **Socket behavior is build/run-mode dependent**
   - Electron scripts set `VITE_SOCKET_ENABLED=true`.

4. **Skin constraints matter**
   - Skin format is 64x64 PNG with Minecraft layout assumptions.
   - See `docs/minecraft-skin-layout-specification.md` for UV and region references.

5. **Docs are split by status**
   - Active specs are under `docs/specs/`.
   - Historical material is under `docs/archive/`.

6. **Known platform quirk**
   - Mac Retina cursor ghosting in creator paint mode is a known issue (see `docs/TROUBLESHOOTING.md`).

7. **External skin/animation control**
   - POST `/api/skin` and `/api/animation` (or socket) drive the character in home mode. Events flow through the app event system; see `docs/concepts/EVENT-SYSTEM.md`.

## High-Value Files

- `src/main.ts` - app orchestration, model load, skin/animation behavior
- `src/creator.ts` - character creator implementation
- `src/viewer/` - scene setup, controls, skin application
- `src/skinPreprocess.ts` - texture preprocessing
- `server/api.js` - API endpoints (`/api/skin`, `/api/animation`, `/api/events`, `/api/log`)
- `docs/TROUBLESHOOTING.md` - debug flags and known issues

## Suggested Agent Workflow

1. Read `README.md`.
2. Read the most relevant spec in `docs/plans/`.
3. Confirm script behavior in `package.json`.
4. Run the smallest command that validates your change (`dev`, `build`, or targeted script).
5. If debugging runtime behavior, use `npm run dev:log` and URL log params from `docs/TROUBLESHOOTING.md`.

## Related Docs

- `docs/concepts/CHARACTERS.md` - Character data model, config, event payloads
- `docs/concepts/CONFIGURATION.md` - Configurable options, merge order
- `docs/concepts/EVENT-SYSTEM.md` - App events, skin/animation handlers
- `docs/concepts/SCENE-CONTEXT.md` - Scene ownership, adding characters
- `docs/NPM-TOOLING.md`
- `docs/ELECTRON-PACKAGING.md`
- `docs/TROUBLESHOOTING.md`
- `docs/LOGGING-ARCHITECTURE.md`
- `docs/LOGGING-IMPLEMENTATION.md`
