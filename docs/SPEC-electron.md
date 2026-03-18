# Electron Migration Spec: Minecraft 3D Character Viewer

You are an expert Electron + Node.js developer migrating a Minecraft-style character viewer and editor to a desktop app.

---

## Full Project Overview & Goals

This app is a **Minecraft 3D character viewer and character creator**. It renders a character in 3D (Three.js), with interchangeable skins and Mixamo animations. The character reacts to events from a server API.

### Current Web App (pre-migration)

- **Viewer mode:** 3D character with skin selector, animation buttons, composite sequences (e.g. walkTo + animation). Character has idle/wandering AI.
- **Creator mode:** Full skin editor — 2D blocky pixel grid, 3D paint-on-model, layers panel, color picker, undo/redo. Uses the same Three.js scene for live preview.
- **Event API:** The server receives `POST /api/skin?name=…` and `POST /api/animation?name=…`, broadcasts via SSE (`/api/events`). Optionally Socket.IO for real-time skin/animation events.
- **External control:** Scripts (`scripts/set-skin.js`, `scripts/set-animation.js`), other apps, or future integrations send events that the character reacts to.

### Goals of Electron Migration

- Run the app as a desktop application (macOS, Windows).
- Run the existing Express + Socket.IO server inside Electron’s main process, so external tools can still send skin/animation events.
- Provide a friendly system-tray GUI to control the server, view logs/status, and optionally onboard users.
- Keep the same frontend (Vite build) — load it in a `BrowserWindow` instead of the browser.

**What this app is not (unlike the original spec):**

- No SpellTable, Chrome extension, OBS overlay, or Redis/BullMQ. The current API is simple HTTP + SSE (and optionally Socket.IO).
- No Scryfall API or card fetching.
- No playmat calibration or mouse-proxy mode — those are removed or deferred as future enhancements if needed (e.g. OBS overlay with character reacting to stream events).

---

## Key Constraints & Decisions

- **Server runs in Electron main process:** Express + optional Socket.IO. Same `server/api.js` and `server/index.js` patterns.
- **Renderer:** Existing Vite-built app loaded in a `BrowserWindow` (or separate windows for viewer vs creator, if desired). Hash routing: `#/` = viewer, `#/creator` = creator.
- **Secure IPC:** `contextBridge` + preload for GUI ↔ main (server controls, logs, status). No `nodeIntegration`.
- **Static assets:** Serve built app from `dist/`; public assets (models, skins, animations) included in app resources.
- **Logging:** Use `electron-log` or Winston; pipe logs to the status window via IPC.
- **No Redis/BullMQ in v1:** Keep the current simple event model (API → broadcast to connected clients).

---

## User Experience Flow

1. **First launch**
   - Optional onboarding: explain that the app runs a local server so scripts/apps can control the character.
   - Start server automatically.
   - Open main window to the viewer (`#/`) or creator (`#/creator`).

2. **Normal use**
   - App starts; window shows the character viewer (or creator).
   - System tray icon: green = running, red = error.
   - Tray click → focus/show main window.
   - Main window: viewer/creator UI + optional status bar (server URL, last event).
   - Collapsible status/log panel for debugging.

3. **During use**
   - User interacts with character via skin/animation controls, fake chat (if enabled), or sequences.
   - External tools send `POST /api/skin` or `POST /api/animation` (or Socket.IO) → character updates.
   - Creator: edit skin, download PNG.

---

## This App’s Event Model

### API Endpoints (`server/api.js`)

| Endpoint           | Method | Purpose                                             |
|--------------------|--------|-----------------------------------------------------|
| `/api/skin`        | POST   | Switch skin by name (query: `?name=…`)              |
| `/api/animation`   | POST   | Play animation by key (query: `?name=…`)            |
| `/api/events`      | GET    | SSE stream of skin/animation events to clients      |
| `/api/log`         | POST   | Log relay (dev) — forwards client logs to server    |

### Socket.IO (optional)

- Server can also use Socket.IO to broadcast `skin` and `animation` events.
- Client (`socketManager.ts`) connects when `VITE_SOCKET_ENABLED=true`; otherwise uses API + SSE or local fake mode.

### Character Reactions

- **Skin:** Applies new 64×64 PNG texture to the model.
- **Animation:** Cross-fades to the requested Mixamo animation (bored, crying, waving, etc.).
- **Sequence:** Composite steps (animation, walkTo, pause) driven by `animationManager`.

---

## Architecture & Libraries

- **Electron** (latest stable): main process hosts server + tray; renderer shows the existing Vite app.
- **electron-builder:** Package as installer (NSIS on Windows, DMG/pkg on macOS). Icon, shortcuts.
- **Server stack:**
  - Express (existing `server/api.js`, `server/index.js`).
  - Optional: Socket.IO for real-time events (client already supports it).
  - No Redis/BullMQ for v1.
- **Frontend:** Unchanged — Vite build, Three.js, TypeScript. Load `dist/index.html` in `BrowserWindow`.
- **Logging:** `electron-log` or Winston; pipe to renderer via IPC.
- **GUI for status (if separate):** Vanilla JS + existing `style.css`, or lightweight framework. Or embed status in the main viewer/creator window.

### Asset Layout

- `public/models/` — RunningboyRig.fbx
- `public/animations/` — Mixamo FBX files (auto-indexed via `scripts/generate-animations-manifest.js`)
- `public/wardrobe/skins/` — 64×64 PNG skins (auto-indexed via `scripts/generate-skins-manifest.js`)
- `public/sequences/` — `index.json` for composite sequences

These must be bundled in app resources and served correctly (e.g. from `app.get('/', ...)` or static middleware).

---

## Tasks to Implement (Step-by-Step)

1. **Electron skeleton**
   - `package.json` with Electron, electron-builder.
   - `electron/main.js`: create `BrowserWindow`, load `dist/index.html`, start server in main process.
   - `electron/preload.js`: secure IPC (e.g. `getStatus`, `onLog`, `startServer`, `stopServer`).
   - Integrate with existing Vite build; `npm run build` produces `dist/`.

2. **Server in main process**
   - Use `server/api.js` and `server/index.js` from the existing project.
   - Start/stop server from main; choose port (e.g. `5173` or configurable).
   - Ensure static files from `dist/` and `public/` (or equivalent) are served.

3. **System tray**
   - Icon, tooltip (e.g. "Character Viewer — Running" / "Error").
   - Context menu: Show, Quit. Click tray → show/focus window.

4. **Window behavior**
   - Default route: `#/` (viewer) or configurable. Hash links to `#/creator` work as in the web app.
   - Handle `file://` or custom protocol if needed for loading local assets.

5. **Secure IPC**
   - Expose: `getStatus`, `getLogs`, `onLog`, `onStatus`, `startServer`, `stopServer` (if server is toggleable).
   - Use `contextBridge`; no `nodeIntegration`.

6. **Status / log panel (optional)**
   - Collapsible section in main window or separate status window: server URL, last event, live logs.

7. **First-run / onboarding**
   - Use `electron-store` to detect first run.
   - Simple modal: "Server runs at http://localhost:5173 — use scripts or API to control the character."

8. **Error handling**
   - Friendly messages if port is in use, or static files are missing.

9. **Build & package**
   - `electron-builder` config: output formats (installer, portable), icon, ASAR.

10. **Creator + viewer parity**
    - Confirm both `#/` and `#/creator` work, skin download works, and external API still drives the character.

---

## Out of Scope (or Deferred)

- **Chrome extension:** Not part of this app. Future: extension on third-party sites could POST to localhost.
- **OBS overlay:** Not in v1. Future: OBS Browser Source could load the viewer URL.
- **Redis / BullMQ:** Not needed for current event model.
- **Mouse proxy / playmat calibration:** Not applicable to this app.
- **Scryfall / card APIs:** Not applicable.

---

## References

- Electron: Tray, `ipcMain` / `ipcRenderer`, `contextBridge`, `BrowserWindow`.
- `electron-with-server-example` (GitHub) — server-in-main pattern.
- Existing: `server/api.js`, `server/index.js`, `src/main.ts`, `src/socketManager.ts`, `docs/CHARACTER-CREATION-SCREEN-SPEC.md`.

---

## Implementation Order

1. Electron skeleton + load existing Vite build.
2. Server in main process + static serving.
3. Tray + window lifecycle.
4. IPC for status/logs.
5. Packaging with electron-builder.
6. Polish: onboarding, error handling, optional status UI.
