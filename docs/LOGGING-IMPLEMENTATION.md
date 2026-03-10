# Logging Architecture — Implementation Report

This document describes how the logging system specified in [LOGGING-ARCHITECTURE.md](./LOGGING-ARCHITECTURE.md) was implemented. It is intended for future agents and maintainers who need to understand the structure, extend it, or modify it.

---

## Overview

The logging system provides configurable, per-system, per-level output for troubleshooting the Minecraft 3D viewer. It supports dual output (browser console and server terminal) and is designed for low overhead when disabled.

---

## Implementation Structure

### 1. Core Module: `src/logger.ts`

The logger is a single module that:

- **Parses configuration** from URL params (`?log=...`), localStorage (`viewer-log-config`), and relay preference (`viewer-log-relay`)
- **Exports a singleton** `logger` with methods `error`, `warn`, `info`, `debug`, `trace`
- **Each method** accepts `(system, message, data?)` where `system` is a typed category (e.g. `animation`, `stateMachine`)
- **Checks** `isEnabled(system, level)` and optionally `shouldThrottle()` before emitting
- **Emits** to both the browser console (via `console.error/warn/log`) and, when relay is on, to `POST /api/log`

**Key design choices:**

- Config is built once at module load; `refreshConfig()` can be called after `localStorage.setItem` to re-read without reload
- Throttling uses a map keyed by `system:message`; trace/debug are throttled at 80ms per key; error/warn are never throttled
- Output format: `[elapsed s] [system] [level] message | key=value ...`
- Server relay uses `fetch` with `keepalive: true` and ignores failures (fire-and-forget)

### 2. Server-Side Relay: `server/api.js` + `server/vite-plugin-api.js`

**API handler (`server/api.js`):**

- `POST /api/log` receives JSON (single object or array of objects)
- Each entry: `{ time, system, level, message, data }`
- Server filters by `LOG_LEVEL` and `LOG_SYSTEMS` (env or `--log-level=`, `--log-systems=`)
- Error/warn are always printed regardless of `LOG_SYSTEMS`
- Prints to `console.error` / `console.warn` / `console.log`; response is 204 No Content

**Vite plugin (`server/vite-plugin-api.js`):**

- Registers middleware via `configureServer` to route `/api/*` through `handleApi`
- On server listen, calls `buildLogUrlParams()` and prints a ready-to-use URL with log params when relay is enabled

**Production:** `server/index.js` (Express) reuses the same `handleApi`; `/api/log` behavior is shared.

### 3. Configuration Flow

1. **URL** — `?log=animation:debug,stateMachine:info` or `?log=1` / `?log=on`
2. **localStorage** — `viewer-log-config` as JSON, `viewer-log-relay` as `"true"` / `"1"`
3. **Build-time** — `VITE_LOG_RELAY=true` enables relay by default
4. **Server** — `LOG_RELAY`, `LOG_LEVEL`, `LOG_SYSTEMS` (env or CLI); `buildLogUrlParams()` produces a URL with matching client params

Order: URL overrides, then localStorage overlay, then defaults (all systems at `error` unless `?log=1`).

### 4. Integration Points (Instrumented Systems)

| System        | Files | What is logged |
|---------------|-------|----------------|
| **animation** | `animationManager.ts`, `main.ts` | Sequence start/step/cancel, walk start/end, turn phases, fade to action, emote start |
| **stateMachine** | `animationManager.ts`, `main.ts` | Idle wanderer start/stop, user activity, timer check (no state transitions yet) |
| **messaging** | `main.ts`, `fakeChatUI.ts`, `socketManager.ts` | Skin change, animation command, user message, fake reply, socket connect/disconnect |
| **position** | `debugFacing.ts`, `animationManager.ts`, `main.ts` | Facing changes, walk tick (trace) |
| **renderer** | `main.ts` | Resize, step frame (optional) |
| **input** | `main.ts`, `fakeChatUI.ts` | Skin/animation/sequence button clicks, send click, Enter key, sequence auto-play |
| **general** | `main.ts` | App started, model loaded, actions loaded, FBX/model/skin load errors |

**Conditional logging:** Some calls use `logger.isEnabled(system, level)` before doing work (e.g. `debugFacing.ts` skips compute when `position:debug` is off; `main.ts` step-frame logs are gated).

---

## How to Incorporate the Logger

### Adding a New Log Call

```ts
import { logger } from './logger';

logger.info('animation', 'New event name', { key: value });
```

- Use the correct **system** from the typed set (`LogSystem`)
- Choose **level** per spec: `error` (failures), `warn` (recoverable), `info` (important), `debug` (flow), `trace` (high-frequency, throttled)
- **Data** is optional; keep it small; avoid logging full scene graphs

### Adding a New System

1. Extend `LogSystem` in `logger.ts` and add to `ALL_SYSTEMS`
2. Add default level in `buildConfig()` base object
3. Instrument the relevant modules with `logger.X(system, ...)` calls
4. Update [LOGGING-ARCHITECTURE.md](./LOGGING-ARCHITECTURE.md) and [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) if needed

### Expensive Work Before Logging

```ts
if (logger.isEnabled('position', 'trace')) {
  const worldPos = computeExpensiveWorldPosition();
  logger.trace('position', 'World pos', { x: worldPos.x, y: worldPos.y });
}
```

Use `isEnabled` so expensive work is skipped when the log would be dropped.

---

## How to Modify the Logger

### Change Throttle Interval

Edit `THROTTLE_MS` in `src/logger.ts` (currently 80ms).

### Change Output Format

Modify `emit()` in `logger.ts`: the `line` string and `payload` object. Both browser and relay use the same data; you could add separate formatters if needed.

### Add a New Configuration Source

Extend `buildConfig()` in `logger.ts`: read from another URL param, `sessionStorage`, or a debug UI, then merge into `base`.

### Disable Relay in Production

Relay is controlled by client config (`?logRelay=1`, localStorage, `VITE_LOG_RELAY`). The server still handles `/api/log`; you can gate the server route with `process.env.NODE_ENV === 'development'` or remove the route in production builds if desired.

---

## Future Enhancements

- **State machine transitions** — Add `logger.info('stateMachine', 'State transition', { from, to })` in `characterAI.ts` when `transitionTo...` runs. Spec mentions this; implementation does not yet log transitions.
- **Batching** — Instead of one POST per log, buffer logs and send every N ms to reduce request volume at trace level.
- **In-app overlay** — Optional floating panel (e.g. bottom-left) showing last N lines; toggle with hotkey (e.g. `L`).
- **File output** — Server option (`LOG_FILE=./logs/dev.log`) to append logs to a file for post-session analysis.
- **Remote persistence** — POST to an external endpoint or optional “Download log” from an in-memory buffer.
- **Rate limiting** — Server-side cap on requests per second from a single client to avoid DoS from a runaway trace loop.
- **Debug UI** — Small panel with checkboxes per system and level dropdown, writing to `viewer-log-config` and calling `refreshConfig()`.
- **`sendBeacon` fallback** — Use `navigator.sendBeacon` instead of `fetch` for unload scenarios; current `keepalive: true` is often sufficient.

---

## Limitations

1. **No state transition logs** — `characterAI` state transitions (idle → wandering, noticing → approaching, etc.) are not yet logged.
2. **Single throttle key** — Throttling uses `system:message`; two different trace calls with the same message share the throttle window.
3. **Config is global** — One config for the whole app; no per-component or per-route overrides.
4. **Relay is fire-and-forget** — No retries or confirmation; logs can be lost if the server is down or the request fails.
5. **No structured query** — Logs are plain text; no built-in JSON query or filtering in the client.
6. **Server relay only in dev stack** — Production Express server has the endpoint; a static build served without the API has no relay target.
7. **`isEnabled` level semantics** — `LEVEL_NUMS[level] <= LEVEL_NUMS[minLevel]` means “log if message level ≤ configured min level” (e.g. info is logged when min is info). Verify this matches your expectation for “minimum level to show.”

---

## Alternative Approaches

### Structured Logging Library (e.g. pino, winston)

**Pros:** Rich formatters, transports, log rotation, child loggers.  
**Cons:** Heavier, Node-oriented; browser use requires adapters. Overkill for this project’s scope.

### Console Wrapper Only

**Pros:** Simpler, no server relay.  
**Cons:** Loses per-system/level control, URL/localStorage config, and server-side visibility—the main troubleshooting benefits.

### Event-Based Logger

**Pros:** Decouple emission from transport; multiple listeners (console, relay, overlay, file).  
**Cons:** More complexity; current direct emit is sufficient for current needs. Consider if adding overlay or multiple destinations.

### Build-Time Stripping

**Pros:** Remove log calls in production to reduce bundle size.  
**Cons:** Requires a transform; current approach relies on `isEnabled` to avoid work and keeps calls small. Could be added later if bundle size matters.

### Server as Log Aggregator

**Pros:** Central log store, search, dashboards.  
**Cons:** Needs persistence, auth, and ops; not justified for a dev-focused viewer.

---

## Quick Reference for Agents

| Task | Where to Look |
|------|----------------|
| Add a log call | `logger.info('system', 'message', { data })` — ensure `system` is in `LogSystem` |
| Add a new system | `src/logger.ts` — extend `LogSystem`, `ALL_SYSTEMS`, and `buildConfig` base |
| Change throttle | `src/logger.ts` — `THROTTLE_MS` and `shouldThrottle` |
| Server filter behavior | `server/api.js` — `getLogRelayConfig`, `LOG_LEVEL`, `LOG_SYSTEMS` |
| npm scripts for log modes | `package.json` — `dev:log`, `dev:log:info`, etc. |
| User-facing docs | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| Full spec | [LOGGING-ARCHITECTURE.md](./LOGGING-ARCHITECTURE.md) |
