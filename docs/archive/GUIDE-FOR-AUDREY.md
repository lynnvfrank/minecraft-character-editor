# Minecraft 3D Character Viewer — Guide for Audrey

This document is for developers using **Cursor** to work on the project. It supplements the main README with development workflow, Cursor-specific tips, and quick reference.

---

## Quick Start (Development)

```bash
# 1. Extract the archive and open the project folder in Cursor
cd minecraft-3d-viewer

# 2. Install dependencies
npm install

# 3. Start the dev server (auto-generates skins + animations manifest)
npm run dev
```

Open the URL shown (usually `http://localhost:5173`). Use the mouse to orbit, zoom, and pan the camera. Click skin thumbnails and animation buttons to switch.

---

## Project Overview

A web app that renders a Minecraft-style character in 3D with:

- **Skins** — 64×64 PNG textures following the standard Minecraft layout
- **Animations** — FBX files from Mixamo, compatible with the RunningboyRig model
- **Three.js** — 3D scene, shadows, orbit camera

### Key Technologies

| Component      | Tech                          |
|----------------|-------------------------------|
| 3D rendering   | Three.js                      |
| Language       | TypeScript                    |
| Build tool     | Vite                          |
| Dev server     | Vite (with API plugin)        |
| Prod server    | Express (`npm run start`)     |
| Model format   | FBX                           |
| Skin format    | 64×64 PNG                     |

---

## Files to Know (for Cursor / AI Context)

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point: scene setup, model loading, skin/anim logic, API events |
| `src/skinPreprocess.ts` | Preprocesses skin textures (transparent → solid in primary regions) |
| `src/style.css` | Layout and controls styling |
| `index.html` | Shell with `#three-canvas-container`, skin selector, anim buttons |
| `vite.config.ts` | Vite config; uses `server/vite-plugin-api.js` for `/api/*` in dev |
| `server/api.js` | API handlers: `/api/skin`, `/api/animation`, `/api/events` (SSE) |
| `server/index.js` | Production Express server (serves `dist/` + API) |
| `scripts/generate-skins-manifest.js` | Scans `public/wardrobe/skins/`, writes `public/wardrobe/skins/index.json` |
| `scripts/generate-animations-manifest.js` | Scans `public/animations/`, writes `public/animations/index.json` |
| `docs/minecraft-skin-layout-specification.md` | Skin layout reference (regions, UVs, troubleshooting) |
| `public/models/RunningboyRig.fbx` | Base character rig |
| `public/wardrobe/skins/` | Skin PNGs (auto-discovered) |
| `public/animations/` | Animation FBX files (auto-discovered) |

---

## NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Dev | `npm run dev` | Generate manifests, start Vite dev server |
| Build | `npm run build` | Generate manifests, build to `dist/` |
| Preview | `npm run preview` | Serve `dist/` with Vite (no API) |
| Start (prod) | `npm run start` | Serve `dist/` with Express (includes API) |
| Generate skins | `npm run generate-skins` | Rebuild `public/wardrobe/skins/index.json` |
| Generate animations | `npm run generate-animations` | Rebuild `public/animations/index.json` |
| Generate previews | `npm run generate-previews` | Puppeteer: capture 3D previews for skins and wardrobe parts |
| Clear skin previews | `npm run clear-previews-skins` | Delete generated full-skin preview PNGs and clear preview fields from `public/wardrobe/skins/index.json` |
| Clear wardrobe part previews | `npm run clear-previews-parts` | Delete generated wardrobe preview PNGs and clear preview fields from wardrobe part manifests |
| Set skin | `npm run set-skin -- skin-anime1` | POST skin change to running dev server |
| Set animation | `npm run set-animation -- happy` | POST animation change to running dev server |

---

## API & Remote Control

The app exposes REST + SSE endpoints so you can change skin/animation from the CLI or other tools.

### Endpoints

| Endpoint | Method | Query Param | Description |
|----------|--------|-------------|-------------|
| `/api/skin` | POST | `name` | Change skin by path (e.g. `/wardrobe/skins/skin-anime1.png`) or label |
| `/api/animation` | POST | `name` | Change animation by key (e.g. `happy`, `bored`) |
| `/api/events` | GET | — | Server-Sent Events stream (skin/animation updates) |

### CLI Examples

With the dev server running:

```bash
npm run set-skin -- skin-anime1
npm run set-animation -- happy
```

From another terminal or script:

```bash
curl -X POST "http://localhost:5173/api/skin?name=skin-anime2"
curl -X POST "http://localhost:5173/api/animation?name=bored"
```

Use `API_BASE` if the server runs elsewhere:

**macOS / Linux / Git Bash:**
```bash
API_BASE=http://localhost:3000 npm run set-skin -- skin-anime1
```

**Windows CMD:**
```cmd
set API_BASE=http://localhost:3000
npm run set-skin -- skin-anime1
```

**Windows PowerShell:**
```powershell
$env:API_BASE="http://localhost:3000"; npm run set-skin -- skin-anime1
```

### URL Parameters (camera)

Supported in the browser URL:

- `?fov=35` — camera field of view (default 45)
- `?cameraZ=3` — camera Z position (default 3)

Example: `http://localhost:5173?fov=35&cameraZ=4`

---

## Platform Notes (Windows vs macOS)

Most of the project works the same on both. Differences to watch for:

| Area | macOS | Windows |
|------|-------|---------|
| **Environment variables** | `VAR=value command` works in bash/zsh | Use CMD: `set VAR=value` then run command; or PowerShell: `$env:VAR="value"; command` |
| **Terminal** | Use Terminal, iTerm, or Cursor’s integrated terminal (usually bash/zsh) | Use CMD, PowerShell, or Git Bash. Git Bash behaves like Unix for `VAR=value` syntax |
| **curl** | Built-in | Built-in on Windows 10/11; older Windows may need to install or use `Invoke-WebRequest` in PowerShell |
| **Puppeteer** (`generate-previews`) | Usually works out of the box | First run may take longer to download Chromium; antivirus can block it—add an exception if needed |
| **Line endings** | LF | Git with `core.autocrlf=true` (default on Windows) converts on checkout; usually fine |
| **Paths in scripts** | `path.join()` is used throughout, so cross-platform |

All `npm run` commands (e.g. `npm run dev`, `npm run set-skin -- skin-anime1`) work the same on both platforms.

---

## Adding Content

### Adding a New Skin

1. Get or create a 64×64 PNG following the Minecraft skin layout (see `docs/minecraft-skin-layout-specification.md`).
2. Put it in `public/wardrobe/skins/`, e.g. `public/wardrobe/skins/skin-mycustom.png`.
3. Run `npm run dev` (or `npm run generate-skins`) so the manifest is updated.
4. The skin appears in the skin selector automatically.

### Adding a New Animation

1. Download an FBX from [Mixamo](https://www.mixamo.com) using the same rig (`public/models/RunningboyRig.fbx`).
2. Save as `AnimationName-RunningboyRig.fbx` in `public/animations/`.
3. Run `npm run dev` (or `npm run generate-animations`).
4. The animation appears in the animation bar automatically.

### Generating Skin Previews

Run:

```bash
npm run generate-previews
```

This starts the dev server, uses Puppeteer to load each skin and capture a screenshot, then writes preview paths into `public/wardrobe/skins/index.json`. Requires Puppeteer (already in devDependencies).

---

## Config Options (for Tweaking)

| Location | Constant | Purpose |
|----------|----------|---------|
| `src/main.ts` | `USE_DEBUG_TEXTURE` | If `true`, use a debug grid instead of skin |
| `src/main.ts` | `OVERLAY_SCALE.enabled` | Toggle overlay scale workaround for jacket/sleeves/pants |
| `src/main.ts` | `OVERLAY_SCALE.factor` | Scale factor for overlay mesh (e.g. 1.03) |
| `src/main.ts` | `LOG_MODEL_INFO` | If `true`, log mesh names and UV bounds on load |
| `src/skinPreprocess.ts` | `SKIN_PREPROCESS_CONFIG.enabled` | Disable preprocessing (pass texture through) |
| `src/skinPreprocess.ts` | `SKIN_PREPROCESS_CONFIG.replacementColor` | Color for transparent pixels in primary regions |
| `src/skinPreprocess.ts` | `SKIN_PREPROCESS_CONFIG.alphaThreshold` | Alpha below which pixel is considered transparent |

---

## Cursor-Specific Tips

### Giving Cursor Context

- Open `docs/minecraft-skin-layout-specification.md` when asking about skin layout or UV mapping.
- Mention `src/main.ts` and `src/skinPreprocess.ts` when changing skin/rendering behavior.
- For API or server behavior, point to `server/api.js` and `server/vite-plugin-api.js`.

### Common Tasks in Cursor

- **Change default skin/animation:** Look at `FALLBACK_SKINS` and `FALLBACK_ANIMATIONS` in `main.ts`, and the initial config in `buildCharacterConfig`.
- **Add a new control or UI element:** Edit `index.html` and `src/main.ts` (where `setupSkinPreviews` and `setupAnimationButtons` live).
- **Debug skin mapping:** Set `LOG_MODEL_INFO = true`, check `logMeshNames` and `logModelUVInfo` output in the console.
- **Adjust overlay visibility:** Tweak `OVERLAY_SCALE.factor` or disable `OVERLAY_SCALE.enabled`.
- **Turn off skin preprocessing:** Set `SKIN_PREPROCESS_CONFIG.enabled = false` in `skinPreprocess.ts`.

### Build Output

- `dist/` contains the built app. It’s ignored by git.
- `npm run build` outputs to `dist/`. For production, run `npm run start` to serve it with the API.

---

## Troubleshooting

| Problem | Things to Try |
|---------|----------------|
| Skin looks wrong | Ensure 64×64 PNG; check layout in `docs/minecraft-skin-layout-specification.md`; try toggling skin preprocessing |
| Animation doesn’t play | Use FBX Binary, same rig as RunningboyRig; ensure file is in `public/animations/` and manifest is regenerated |
| Model tiny/invisible | FBX scale is 0.01 in code; check `model.scale.setScalar(0.01)` in `main.ts` |
| New skin not showing | Run `npm run generate-skins`; confirm `public/wardrobe/skins/index.json` includes it |
| New animation not showing | Run `npm run generate-animations`; confirm `public/animations/index.json` includes it |
| API/SSE not working | In dev: Vite API plugin must be used (default). In prod: use `npm run start`, not `vite preview` |
| `set-skin` / `set-animation` fail | Ensure dev server is running; check port (default 5173); try `API_BASE=http://localhost:5173` |

---

## Architecture Snapshot (for AI)

- **Scene:** Three.js scene, OrbitControls, hemisphere + directional light, ground plane.
- **Character:** Loaded as FBX, scaled 0.01, skin applied to meshes via `applySkinToModel`.
- **Skin flow:** Load PNG → `preprocessSkinTexture` (primary regions: transparent → solid) → apply to model.
- **Animations:** `FBXLoader` loads clips; `AnimationMixer` + `AnimationAction`; cross-fade via `fadeToAction`.
- **Manifests:** `wardrobe/skins/index.json` and `animations/index.json` are generated by scripts; the app fetches them on startup.
- **API:** POST `/api/skin` and `/api/animation` broadcast via SSE; client subscribes to `/api/events` and updates the viewer in real time.

---

## Reference Docs

- **README.md** — Full project documentation
- **docs/minecraft-skin-layout-specification.md** — Skin layout, UVs, transparency rules, RunningboyRig mesh structure
- **docs/minecraft-skin-layout-detailed.png** — Annotated skin layout diagram (if present)
- **docs/minecraft-skin-64x64-detailed.png** — 64×64 grid layout (if present)
