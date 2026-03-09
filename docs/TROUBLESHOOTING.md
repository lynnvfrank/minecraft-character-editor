# Troubleshooting Guide

Quick links and instructions for debugging the Minecraft 3D viewer.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [LOGGING-ARCHITECTURE.md](./LOGGING-ARCHITECTURE.md) | Full logging spec, config options, systems, levels |
| [DEBUG-TOOLS-IMPLEMENTATION-SPEC.md](./DEBUG-TOOLS-IMPLEMENTATION-SPEC.md) | Test mode, pause/step, debug overlay |
| [ANIMATION-AND-MOVEMENT-GUIDE.md](./ANIMATION-AND-MOVEMENT-GUIDE.md) | Animation system, walkTo, sequences |
| [ANIMATION-GLOSSARY.md](./ANIMATION-GLOSSARY.md) | Model, bones, container, lerp, crossfade — for writing clear issue descriptions |
| [BLENDER-ANIMATION-TRANSITIONS.md](./BLENDER-ANIMATION-TRANSITIONS.md) | Merging/combining FBX animations, verifying last/first frame match |
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
| `?log=position:debug` | Facing changes (rotation.y snaps) at debug level |
| `?log=animation,stateMachine` | Multiple systems at default (info) |
| `?log=*:trace` | All systems at trace (verbose, throttled) |
| `?logRelay=1` | Send logs to server console (requires server with LOG_RELAY) |
| `?chat=1` or `?chat=on` | Show chat panel (hidden by default) |
| `?controls=1` or `?controls=on` | Show control panel (hidden by default) |
| `?movementcontrols=1` | **Movement controls mode** — Isolated debug page: no characterAI/wanderer, manual turn/walk controls, Pause/Resume/Step Frame |
| `?turn=lerp` | **Turn strategy** — Lerp model.rotation.y over 0.15s at turn start (default) |
| `?turn=snap` | **Turn strategy** — Instant 90° snap of model.rotation.y at turn start; clip animates the rest |
| `?turn=reset` | **Turn strategy** — Same as lerp; also reset BonesCharacter to identity when turn→walk crossfade completes |

**Examples:**

```
http://localhost:5173/?log=animation:debug
http://localhost:5173/?log=animation,stateMachine,messaging&logRelay=1
http://localhost:5173/?log=*:trace&logRelay=1
http://localhost:5173/?movementcontrols=1&controls=1&chat=1
```

**Movement controls mode (`?movementcontrols=1`):** Runs the character and animation manager in isolation—no characterAI, no wanderer, no sequence/chat UI. Shows Debug Test Controls: Turn left/right, Walk to waypoint/origin, Pause, Resume, Step Frame, and Turn strategy (Lerp / Snap / Reset) buttons. Use Step Frame when paused to advance one animation frame at a time for debugging turn/walk behavior. Add `?controls=1&chat=1` to show the control and chat panels alongside. See [DEBUG-TOOLS-IMPLEMENTATION-SPEC.md](./DEBUG-TOOLS-IMPLEMENTATION-SPEC.md).

**Turn strategy (`?turn=`):** Default is `lerp`. Affects how the turn animation starts and how BonesCharacter is handled after turn→walk. Use `lerp` for gradual model.rotation.y change; `snap` to test instant 90° pre-offset; `reset` to clear BonesCharacter after turn (may help with residual rotation buildup). In movement controls mode, the Turn strategy buttons switch without changing the URL.

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
| `npm run dev:log:info` | All systems at info | All systems at info, relayed to server |
| `npm run dev:log:debug` | All systems at debug | All systems at debug, relayed to server |
| `npm run dev:log:trace` | All systems at trace | All systems at trace (throttled), relayed to server |
| `npm run dev:debug` | Same as dev:log:debug | — |
| `npm run dev:trace` | Same as dev:log:trace | — |

**Usage:**

1. Run `npm run dev:log` (or `dev:debug` / `dev:trace`)
2. The terminal prints a ready-to-use URL with the same logging parameters. Open it in your browser (or Cursor Simple Browser — see below).
3. Logs appear in both the **browser DevTools console** and the **terminal** where npm runs

**Opening in Cursor Simple Browser:** Cmd+Shift+P → "Simple Browser: Show" → paste the URL from the terminal. (Clicking the terminal link opens the default system browser.)

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
| `position` | Facing changes (rotation.y snaps), walk tick (throttled) |
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

### Turn snapping (90° jump before turn animation)

If the character snaps 90° before the turn starts:

1. **Check turn strategy** — In logs, look for `Turn start` with `strategy: "snap"`. If present, switch to `lerp` or `reset` via the Turn strategy buttons (movement controls mode) or `?turn=lerp`. Default is lerp.
2. **Check `startLerpDurationSec`** — Should be ~1.17s for 180° turns (model lerps over full clip), 0.15 for smaller turns. If it shows `n/a (snap)`, strategy is snap.
3. **Check `Turn start lerp` trace** — Enable `?log=animation:trace`. You should see lerp progress (`t`, `modelYawDeg`). If you never see these, the lerp isn't running.
4. **Facing change logs** — Enable `?log=position:debug` to see `logFacingChange` when `model.rotation.y` changes. Check `source` to see what's writing rotation (e.g. `updateBodyTurn` would indicate characterAI overwriting during walk—it should skip when `isInWalkToPhase`).

### Step frame logs (movement controls mode)

When paused and you click **Step Frame**, logs emit per enabled system:

| System | Level | Step frame data |
|--------|-------|-----------------|
| **animation** | debug | action, actionTime, clipDuration, turnProgress, walkT, turnStartT, turnLerpRemaining |
| **position** | debug | modelYawDeg, bonesCharYawDeg, visualYawDeg, containerPos |
| **stateMachine** | debug | isInWalkToPhase, isWalking, isBusy |
| **renderer** | debug | delta, deltaMs |

Enable with `?log=animation:debug,position:debug,stateMachine:debug,renderer:debug` (or `?log=*:debug`).
