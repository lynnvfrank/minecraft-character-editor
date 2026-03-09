# Troubleshooting Guide

Quick links and instructions for debugging the Minecraft 3D viewer.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [LOGGING-ARCHITECTURE.md](./LOGGING-ARCHITECTURE.md) | Full logging spec, config options, systems, levels |
| [ANIMATION-AND-MOVEMENT-GUIDE.md](./ANIMATION-AND-MOVEMENT-GUIDE.md) | Animation system, walkTo, sequences |
| [CHARACTER-CREATION-SCREEN-SPEC.md](./CHARACTER-CREATION-SCREEN-SPEC.md) | Character setup and skin/animations |
| [ANIMATION-CREATION-GUIDE-FOR-BEGINNERS.md](./ANIMATION-CREATION-GUIDE-FOR-BEGINNERS.md) | Creating new animations |
| [ANIMATION-IMPROVEMENT-STRATEGIES.md](./ANIMATION-IMPROVEMENT-STRATEGIES.md) | Improving animation quality |

---

## Logging & Debug Modes

### URL Parameters (Browser)

Add these to your app URL (e.g. `http://localhost:5173/?log=animation:debug`):

| Param | Effect |
|-------|--------|
| `?log=1` or `?log=on` | Enable common systems (animation, stateMachine, messaging) at info |
| `?log=animation:debug` | Animation system at debug level |
| `?log=animation,stateMachine` | Multiple systems at default (info) |
| `?log=*:trace` | All systems at trace (verbose, throttled) |
| `?logRelay=1` | Send logs to server console (requires server with LOG_RELAY) |

**Examples:**

```
http://localhost:5173/?log=animation:debug
http://localhost:5173/?log=animation,stateMachine,messaging&logRelay=1
http://localhost:5173/?log=*:trace&logRelay=1
```

### localStorage (Persist Across Reloads)

```javascript
// In browser console:
localStorage.setItem('viewer-log-config', '{"animation":"debug","stateMachine":"info","messaging":"info"}');
localStorage.setItem('viewer-log-relay', 'true');
location.reload();
```

### npm Scripts (Troubleshooting Modes)

| Command | Description | Log output |
|---------|-------------|------------|
| `npm run dev` | Normal dev mode | Minimal (errors only) |
| `npm run dev:log` | Log relay + common systems | Browser + server console (animation, stateMachine, messaging at info) |
| `npm run dev:debug` | Full debug mode | All systems at debug, relayed to server |
| `npm run dev:trace` | Full trace mode | All systems at trace (throttled), relayed to server |

**Usage:**

1. Run `npm run dev:log` (or `dev:debug` / `dev:trace`)
2. Open `http://localhost:5173/` (or `http://localhost:5173/?logRelay=1` if not using dev:log)
3. Logs appear in both the **browser DevTools console** and the **terminal** where npm runs

---

## Server-Side Log Relay

When `LOG_RELAY=1` (or `npm run dev:log`), the server accepts `POST /api/log` and prints filtered logs to stdout.

| Env var | Purpose | Example |
|---------|---------|---------|
| `LOG_RELAY` | Enable log endpoint | `LOG_RELAY=1` |
| `LOG_LEVEL` | Min level to print | `info`, `debug`, `trace` |
| `LOG_SYSTEMS` | Systems to print (`*` = all) | `animation,stateMachine` |

**Manual run:**

```bash
LOG_RELAY=1 LOG_LEVEL=debug LOG_SYSTEMS=* npm run dev
```

---

## Log Systems Reference

| System | What it logs |
|--------|--------------|
| `animation` | Sequence start/step, walk start/end, fade to action, idle wanderer |
| `stateMachine` | Idle wanderer start/stop, user activity, timer checks |
| `messaging` | Socket connect/disconnect, skin change, animation command, user message |
| `position` | Walk tick (throttled) |
| `renderer` | Resize |
| `input` | Button clicks, explicit activity |
| `general` | App start, model load, actions loaded, errors |

---

## Common Issues

- **No logs in terminal** → Ensure `npm run dev:log` (or `dev:debug` / `dev:trace`) and `?logRelay=1` in URL, or `localStorage.setItem('viewer-log-relay', 'true')`
- **Too much output** → Use `?log=animation:info` to limit systems/levels
- **Animation not playing** → Check `?log=animation,stateMachine,messaging:trace` for sequence steps and fade events
- **Character not moving** → Check `?log=animation:info` for walk start/end
- **Socket not connecting** → Check `?log=messaging:info` for connect/disconnect events
