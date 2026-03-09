# Logging Architecture Specification

A comprehensive, configurable logging system for troubleshooting the Minecraft 3D viewer: character states, messages, actions, position, head direction, animation, state machine, and renderer behavior. Designed for different levels of detail and per-system enablement.

---

## Table of Contents

- [Troubleshooting Guide](./TROUBLESHOOTING.md) — Quick links and npm scripts for debug modes

1. [Goals](#goals)
2. [Log Categories and Systems](#log-categories-and-systems)
3. [Log Levels](#log-levels)
4. [Configuration](#configuration)
5. [What to Log (By System)](#what-to-log-by-system)
6. [Output Formats and Destinations](#output-formats-and-destinations)
7. [Integration Points](#integration-points)
8. [Implementation Outline](#implementation-outline)
9. [Server-Side Log Relay (Client → Server Console)](#server-side-log-relay-client--server-console)

---

## Goals

- **Configurable** — Enable/disable by system and by verbosity without code changes.
- **Troubleshooting-friendly** — Answer: "What state is the character in? What did they receive? What did they do? Where are they?"
- **Low overhead** — When disabled, minimal or zero cost. Throttling for high-frequency logs.
- **Extensible** — Easy to add new categories or systems.

---

## Log Categories and Systems

| System | Purpose | Example Logs |
|--------|---------|--------------|
| **animation** | Clip playback, cross-fades, sequence steps, walk phases | "Fade to walking", "Sequence step: walkTo [0,0,1.2]", "Turn phase complete" |
| **stateMachine** | Character AI state transitions, timers | "idle → wandering", "lastExplicitActivity 12.3s ago" |
| **messaging** | Incoming/outgoing messages, socket events | "Received: skin /skins/x.png", "User message: hello" |
| **position** | Character position, facing, head | "pos (0.5, 0, -1.2) facing 45° head yaw 0.1" |
| **renderer** | Frame rate, draw calls, camera | "FPS 60, drawCalls 42" (optional, verbose) |
| **input** | User activity, clicks, keypresses | "User activity (explicit)", "Sequence button: greet-walk-happy" |
| **general** | Bootstrap, load events, errors | "Model loaded", "Socket connected" |

---

## Log Levels

| Level | Numeric | When to Use | Example |
|-------|---------|-------------|---------|
| **error** | 0 | Failures, exceptions | "FBX load failed: path" |
| **warn** | 1 | Recoverable issues | "Animation 'foo' not found, using idle" |
| **info** | 2 | Important state changes | "State: noticing → approaching" |
| **debug** | 3 | Detailed flow | "playTurnToFace: angle 1.2 rad, using left-turn" |
| **trace** | 4 | Per-frame or high-frequency | "tick: t=0.42 pos lerp" |

**Behavior:**

- Set a minimum level per system. Only logs at or above that level are emitted.
- `trace` should be throttled (e.g., max 1 log per 100ms per category) to avoid console spam.
- `error` and `warn` typically bypass throttling.

---

## Configuration

### URL Parameters

- `?log=animation,stateMachine` — Enable animation and stateMachine systems at default level (info).
- `?log=animation:debug` — Animation at debug level.
- `?log=*:trace` — All systems at trace (with throttling).
- `?log=position:debug&log=animation:info` — Multiple; later overrides earlier for same system.

### Programmatic / localStorage

- `localStorage.setItem('viewer-log-config', '{"animation":"debug","stateMachine":"info"}')` — Persist across reloads.
- Optional UI: small debug panel with checkboxes per system and level dropdown.

### Default

- No `log` param and no localStorage → minimal logging (errors only, or match existing `debugFacing`-style opt-in).
- `?log=1` or `?log=on` → Enable common systems (animation, stateMachine, messaging) at info.

---

## What to Log (By System)

### Animation

| Event | Level | Data |
|-------|-------|------|
| Sequence started | info | sequence id, step count |
| Sequence step | info | step type, target/duration, index |
| Fade to action | debug | action name, duration |
| Turn phase start | debug | target yaw, turn clip name |
| Turn phase end | debug | final yaw |
| Walk start | info | start, end, duration |
| Walk tick (throttled) | trace | t, current position |
| Walk end | info | final position |
| Sequence cancelled | info | generation |
| Idle wanderer start/stop | info | — |

### State Machine

| Event | Level | Data |
|-------|-------|------|
| State transition | info | from → to |
| Timer check | trace | explicitIdleSec, idleSec |
| User activity | debug | explicit (bool), triggered noticing |
| Micro-emote | debug | emote name |
| Noticing flow | info | greeting emote |

### Messaging

| Event | Level | Data |
|-------|-------|------|
| Socket connect/disconnect | info | — |
| Skin change | info | path/name |
| Animation command | info | name |
| User message (chat) | info | text (truncated if long) |
| Fake reply | debug | text |

### Position

| Event | Level | Data |
|-------|-------|------|
| Position update (throttled) | trace | container.x, .y, .z |
| Facing change | debug | prev yaw, new yaw, source |
| Head look | trace | target quat, yaw/pitch |
| Camera target | trace | camera position, target (if needed) |

### Renderer

| Event | Level | Data |
|-------|-------|------|
| FPS (periodic) | trace | fps, frame time |
| Draw calls | trace | count |
| Resize | debug | width, height |

### Input

| Event | Level | Data |
|-------|-------|------|
| Explicit activity | debug | type (click, key, chat) |
| Non-explicit (mousemove) | trace | throttled |
| Button click | debug | button id, action |

---

## Output Formats and Destinations

### Dual Output: Browser Console and Server Console

Client-side logging can optionally write to **both** destinations:

1. **Browser console** — Developer Tools console in the browser (the default).
2. **Server console** — Logs relayed to the dev server process, appearing in the terminal where `npm run dev` runs (e.g., Cursor's integrated terminal).

This helps when troubleshooting with Cursor or other tools: errors and debug output from the webapp appear where you're already watching, without switching to the browser console. See [Server-Side Log Relay](#server-side-log-relay-client--server-console) for implementation.

### Console Format

- **Format:** `[time] [system] [level] message | key=value key2=value2`
- **Example:** `[12.34s] [stateMachine] [info] idle → wandering | explicitIdleSec=10.2`
- **Colors:** Optional; use `console.group`, `console.log` with CSS, or simple prefixes. Error=red, warn=yellow, info=default, debug=trace=dim.

### Optional: In-App Overlay

- Small semi-transparent panel (e.g., bottom-left) showing last N lines.
- Useful when console is not visible (e.g., embedded in another app).
- Toggle with hotkey (e.g., `L` or `Ctrl+Shift+L`).

### Optional: Remote / File

- POST to local endpoint for persistence.
- Or `console` replacement that buffers and offers "Download log" button.

---

## Integration Points

### Existing Code

| File | Integration |
|------|-------------|
| `debugFacing.ts` | Replace or wrap with logger; `logFacingChange` becomes `logger.debug('position', 'facing', { prevYaw, newYaw, source })` |
| `animationManager.ts` | Log at sequence/step/fade/walk boundaries |
| `characterAI.ts` | Log at state transitions, user activity, emote |
| `main.ts` | Log model load, skin apply, socket setup |
| `fakeChatUI.ts` | Log messages sent/received |
| `socketManager.ts` | Log connect, disconnect, events |

### Logger API (Conceptual)

```
logger.info('animation', 'sequence started', { id, steps })
logger.debug('stateMachine', 'state transition', { from: 'idle', to: 'wandering' })
logger.trace('position', 'tick', { t, x, z })
```

- First arg: system (category).
- Second arg: event/message.
- Third arg: optional data object (key-value for structured output).

- `logger.isEnabled(system, level)` — For conditional expensive work (e.g., only compute head world position when position:trace is on).

---

## Implementation Outline

### 1. Create `src/logger.ts`

- Parse `?log=...` and localStorage.
- Export `logger` with `error`, `warn`, `info`, `debug`, `trace` methods.
- Each method checks `isEnabled(system, level)` and optionally throttles.
- Throttle map per `(system, level)` with last emit time.

### 2. Wire Config

- On init, read URL + localStorage, build config map: `Record<System, Level>`.
- Default: empty or `{ general: 'error' }`.

### 3. Instrument Systems

- Add logger calls at the integration points above.
- Start with animation and stateMachine (highest value for troubleshooting).
- Keep `debugFacing` behavior available via `?debugFacing=1` until logger fully replaces it; then deprecate.

### 4. Throttling

- For `trace` and high-frequency `debug`: if same (system, event) within last 50–100ms, skip.
- Configurable throttle window per system if needed.

### 5. Structured Data

- Log data as object; formatter produces `key=value` or JSON for remote.
- Avoid logging large objects (e.g., full scene graph); log only relevant fields.

### 6. Server Relay (Optional)

- When `logRelay` is enabled, POST each log (or batched logs) to `POST /api/log`.
- Use `fetch` with `keepalive` or `sendBeacon` for fire-and-forget.
- Dev server: add log endpoint; read `LOG_RELAY`, `LOG_LEVEL`, `LOG_SYSTEMS` from env; filter and print to server console. See [Server-Side Log Relay](#server-side-log-relay-client--server-console).

---

## Example Session

With `?log=animation:debug,stateMachine:info,messaging:info,position:debug`:

```
[0.00s] [general] [info] App started
[1.23s] [animation] [info] Model loaded, actions: 24
[2.00s] [stateMachine] [info] idle → noticing | reason=userActivity
[2.01s] [animation] [debug] Fade to acknowledging | duration=0.3
[2.05s] [messaging] [info] User message | text="hey there"
[3.20s] [stateMachine] [info] noticing → approaching
[3.21s] [animation] [info] Walk start | target=(0,0,1.5) duration=1.2
[3.22s] [position] [debug] facing | prev=0° new=45° source=walkTo tick
[4.40s] [animation] [info] Walk end | pos=(0,0,1.5)
[4.41s] [stateMachine] [info] approaching → interacting
```

---

## Server-Side Log Relay (Client → Server Console)

Client-side logs can optionally be sent to the dev server, which forwards them to the terminal (server console). This lets Cursor and other tools see webapp errors and debug output in the same place as server logs, improving troubleshooting.

### Client Behavior

- When **server relay is enabled**, each log emission (after client-side filtering by system/level) is sent to a server endpoint in addition to (or instead of) the browser console.
- **Dual output:** By default, logs go to both browser console and server. Config can choose "browser only", "server only", or "both".
- **Batching (optional):** High-frequency logs can be batched and sent every N ms to reduce request volume.
- **Fire-and-forget:** Use `fetch` with `keepalive: true` or `navigator.sendBeacon` so logs are sent even if the page unloads. No need to await the response.

### Server Endpoint

- **Route:** `POST /api/log` (or `/log`, configurable)
- **Payload:** JSON body, e.g.:

  ```json
  {
    "time": 12.34,
    "system": "stateMachine",
    "level": "info",
    "message": "idle → wandering",
    "data": { "explicitIdleSec": 10.2 }
  }
  ```

- **Batch payload:** Array of such objects for batched requests.
- **Response:** 204 No Content or 200 OK. Server does not need to return data.

### Dev Server Configuration

The `npm run dev` process (Vite or whatever dev server is used) accepts **environment variables** or **runtime parameters** that control:

- Whether the log endpoint is enabled
- Which systems and levels to **display** on the server console (mirroring client config)
- Optional: persist logs to a file

| Env / Param | Purpose | Example |
|-------------|---------|---------|
| `LOG_RELAY=true` or `--log-relay` | Enable the `/api/log` endpoint | Receives client logs |
| `LOG_LEVEL=debug` or `--log-level=debug` | Minimum level to print to server console | error, warn, info, debug, trace |
| `LOG_SYSTEMS=animation,stateMachine` or `--log-systems=animation,stateMachine` | Comma-separated systems to print; `*` = all | Same semantics as client `?log=` |
| `LOG_FILE=./logs/dev.log` (optional) | Append logs to file | For post-session analysis |

**Examples:**

```bash
# Relay enabled; print info+ for animation and stateMachine only
LOG_RELAY=1 LOG_SYSTEMS=animation,stateMachine LOG_LEVEL=info npm run dev

# All systems at debug level
npm run dev -- --log-relay --log-systems='*' --log-level=debug

# Full verbosity to server console (useful when Cursor is focused on terminal)
LOG_RELAY=1 LOG_SYSTEMS='*' LOG_LEVEL=trace npm run dev
```

### Server-Side Filtering

The server applies the same level and system filters as the client:

- If client sends `{ system: "position", level: "trace" }` but server has `LOG_LEVEL=info`, the server **does not print** it.
- If server has `LOG_SYSTEMS=animation,stateMachine`, logs for `position` or `messaging` are **not printed** (but are still received; server just filters before console output).
- `error` and `warn` can optionally always print regardless of LOG_SYSTEMS (recommended).

### Client Config for Relay

- **URL:** `?logRelay=1` or `?log=...&logRelay=1` — Enable sending logs to server.
- **Env:** `VITE_LOG_RELAY=true` — At build time, enable relay by default (useful for dev).
- **localStorage:** `viewer-log-relay=true` — Persist relay preference.

When relay is enabled, the client sends every log that passes its own system/level filter. The server then applies its filter for what to print.

### Implementation Notes

- **Vite:** Add a small Express/middleware plugin or use Vite's `configureServer` to register the `POST /api/log` handler. Read env in that handler.
- **Standalone server:** If the app already has an Express/Fastify backend for dev, add the route there.
- **CORS:** Not needed for same-origin (dev server serves the app). If client and server differ (e.g., app on 5173, API on 3000), ensure CORS allows POST from the app origin.
- **Rate limiting:** Optional; cap requests per second from a single client to avoid DoS from a broken trace loop.

---

## Summary

| Aspect | Choice |
|--------|--------|
| Config | URL params + optional localStorage |
| Systems | animation, stateMachine, messaging, position, renderer, input, general |
| Levels | error, warn, info, debug, trace |
| Throttling | trace/debug high-frequency; 50–100ms per (system, event) |
| Output | browser console; optional overlay; **optional server relay** (dual output) |
| Server relay | `POST /api/log` endpoint; env/runtime params for dev server (`LOG_RELAY`, `LOG_LEVEL`, `LOG_SYSTEMS`) |
| Integration | Replace/extend debugFacing; add calls in animationManager, characterAI, main, fakeChatUI, socketManager |
