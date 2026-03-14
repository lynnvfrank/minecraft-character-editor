# LLM World Viewport Specification

A specification for a small, bounded world in which the character lives, with speech bubbles, a locked camera, and this webapp acting as the viewport for an LLM (or other backend) that controls the character's behavior. The LLM has a personality; users (or other services) send messages to it, and the character responds visually and via speech.

---

## Table of Contents

1. [Overview](#overview)
2. [The World](#the-world)
3. [Character Constraints](#character-constraints)
4. [Speech Bubbles](#speech-bubbles)
5. [Messaging UI (iMessage-Style Overlay)](#messaging-ui-imessage-style-overlay)
6. [Camera](#camera)
7. [LLM as Controller: Interface Design](#llm-as-controller-interface-design)
8. [Message Flow](#message-flow)
9. [UI Layout Mockup](#ui-layout-mockup)

---

## Overview

**Goal:** Transform the current viewer into a "room" or "stage" where a character lives. The character is controlled by an LLM backend. The webapp is the **viewport** — it receives commands and messages from the LLM and renders the character's behavior, position, and speech.

**Key concepts:**

- **Fake world** — Can be a static image (e.g., room background) or simple geometry; not a full 3D environment.
- **Bounded movement** — Character walks only to allowed waypoints or within a box (their "room").
- **Locked camera** — Fixed or limited camera; user cannot orbit freely.
- **Speech bubbles** — Display character dialogue; optionally display incoming messages; tied to head; fade in/out.
- **Messaging overlay** — iMessage-style bubbles hovering left or right of the viewport; placement driven by character position; temporary display.

---

## The World

### Option A: Image Background

- A single image (e.g., PNG/JPG) used as the scene background.
- Options:
  - **Environment map** — As a skybox or equirectangular background.
  - **Plane/quad** — Image on a plane behind the character (perspective or orthographic).
  - **CSS background** — Renderer clear color or DOM overlay behind canvas.
- Character stands in front of the image. Ground can be a simple plane or inferred from the image.

### Option B: Simple 3D Room

- Box or room geometry: floor, walls, ceiling.
- Walls use simple materials or textures.
- Character constrained to floor bounds.

### Option C: Hybrid

- Image for "far" background (window, poster, sky); simple geometry for floor and near walls.

### Waypoints and Walkable Area

- Define a set of **allowed waypoints** (e.g., 5–10 points in XZ).
- Character can only `walkTo` one of these points.
- Optionally: **walkable polygon** — character position clamped to inside a 2D polygon (box, room outline).
- LLM or controller chooses which waypoint; invalid targets are clamped or rejected.

---

## Character Constraints

### Bounding Box (Room)

- **Min/max X, Z** — Character position clamped to `[minX, maxX]` and `[minZ, maxZ]`.
- When `walkTo(target)` is called, clamp `target` to the box (or to nearest waypoint inside box).
- If target is outside, walk to nearest valid point instead.

### Allowed Waypoints Only

- If using waypoints: `walkTo` only accepts targets that are in the waypoint list (or within epsilon).
- Reduces complexity; LLM picks from a small set ("go to window", "go to desk", "center").

### Rotation Bounds (Optional)

- Limit character facing to certain angles (e.g., always face "forward" toward camera or a fixed point).

---

## Speech Bubbles

### Behavior

- **Attach to head** — Bubble position is derived from head bone world position. Moves when head moves.
- **Same plane as head** — Billboard that faces camera, or is locked to a plane (e.g., vertical plane so it doesn't tilt with head pitch).
- **Display text** — Single or multi-line. Max width with wrap.
- **Fade in** — When new text appears: fade in (e.g., 0.2s) or scale up.
- **Fade out** — When text is cleared: fade out (e.g., 0.3s) or scale down. Optional: delay before fade (hold time).
- **Effects** — Optional: typewriter effect (reveal character by character), or simple appear/disappear.

### Content Sources

1. **Character speech** — Text the LLM wants the character to "say". Sent from backend to frontend.
2. **Incoming messages** — Messages sent TO the character (e.g., user chat). Can be shown in a different style (e.g., different color, "incoming" bubble).
3. **Status/thoughts** — Optional: internal state or "thinking" indicator (e.g., "..." while processing).

### Styling

- Background: rounded rectangle, semi-transparent or solid.
- Tail/pointer: small triangle pointing at head (optional).
- Font: readable; size scales with distance or fixed in screen space.
- Max characters per line; max lines; overflow truncation or scroll.

### Implementation Hints

- **THREE.CSS2DRenderer** or **CSS3DRenderer** — Render HTML element (div with bubble styling) in 3D space at head position.
- Or: **Screen-space overlay** — Project head position to screen, position a DOM element there. Update each frame.
- Z-order: bubble above character, below UI.

---

## Messaging UI (iMessage-Style Overlay)

Messages can appear **in front of the viewport** as an iMessage-style overlay — chat bubbles hovering on the left or right side of the screen, rather than attached to the character. This keeps the character visible while making dialogue prominent and readable.

### Layout and Placement

- **Overlay** — Messages render as DOM elements (or CSS-styled bubbles) over the 3D canvas, in front of the viewport.
- **Left or right side** — Messages hug either the left or right edge of the screen, leaving the center clear for the character and world.
- **iMessage aesthetic** — Rounded bubbles, distinct user vs. character styling (e.g., user = right-aligned, character = left-aligned, or vice versa). Compact, readable typography.

### Character Position Drives Message Side

| Character position | Message side |
|--------------------|--------------|
| **Left** of stage  | Messages on **right** side (opposite character) |
| **Right** of stage | Messages on **left** side (opposite character) |
| **Center**         | Either side; keep messages close in time **grouped on one side** |

**When character is center:**

- New messages append to the same side as recent messages, so related dialogue stays together.
- When that side fills up (e.g., max N bubbles or height), switch to the other side.
- Avoids splitting a conversation across both sides mid-thread.

### Message Flow and Timing

- **Append as they come** — New messages stack (top-to-bottom or bottom-to-top) on the active side.
- **Temporary display** — Messages stay visible for a short period (e.g., 5–15 seconds) then transition away (fade out, slide off).
- After transition, they can move to a scrollable history panel below, or disappear entirely.
- Keeps the overlay from cluttering the viewport over long conversations.

### Large Responses and Character Movement

- When the LLM sends a **large response** (e.g., long paragraph, multi-sentence) that needs more space to display:
  - **Character moves to a side** — The controller issues a `walk` command to move the character left or right.
  - This frees the opposite side for the message overlay.
  - E.g., large reply → character walks left → messages appear on right with full width.
- The controller (or LLM) can infer "large" from token count or line length and proactively move the character before sending the `speak` command.

### Styling and Behavior

- **Max width** — Bubbles cap at ~60–70% of half-screen width so they don't overlap the character.
- **Max height / scroll** — Long messages can scroll within a bubble, or expand with a "read more" pattern.
- **User vs. character** — User messages and character replies can use different colors or alignment (e.g., blue vs. gray, left vs. right) for clarity.
- **Animations** — Slide in from edge, fade in; slide out or fade out when dismissed.

### Relation to Speech Bubbles

- **Messaging overlay** — For sustained dialogue, Q&A, and longer exchanges. Positioned by character location; temporary; iMessage-style.
- **Speech bubbles** — For short, character-attached utterances (e.g., one-liners, reactions). Tied to head; good for "in-world" feel.
- Use one or both: overlay for main conversation; optional speech bubble for quick asides or when character is center and a brief line doesn't warrant moving.

---

## Camera

### Locked Camera Modes

1. **Fixed** — Camera position and target never change. Character always seen from one angle.
2. **Follow** — Camera follows character at fixed offset (e.g., behind and above). No user control.
3. **Limited orbit** — User can orbit within a restricted range (e.g., ±30° horizontal, fixed distance).
4. **Switchable** — A few fixed "slots" (e.g., front, side, close-up); user or LLM switches between them.

### Disable OrbitControls

- When locked, disable or heavily limit `OrbitControls`.
- Camera updates from script, not user input.

---

## LLM as Controller: Interface Design

### Roles

| Component | Role |
|----------|------|
| **LLM backend** | Receives messages, maintains conversation, decides actions (walk, emote, speak). Sends commands to the viewport. |
| **Webapp (viewport)** | Renders character, receives commands via WebSocket/API, displays speech bubbles, enforces bounds. |
| **User / External** | Sends messages to the LLM; may see the viewport (embedded or standalone). |

### Command Protocol (LLM → Viewport)

The LLM (or a middleware "controller" that wraps the LLM) sends structured commands to the webapp. Possible transport: WebSocket (extend existing socketManager) or HTTP SSE.

**Command types:**

| Command | Payload | Effect |
|---------|---------|--------|
| `speak` | `{ text, duration?, target?: "bubble" or "overlay" }` | Show in speech bubble or messaging overlay; optional auto-clear. `target: "overlay"` uses iMessage-style placement by character position. Large text can trigger character movement (see Messaging overlay) |
| `emote` / `animation` | `{ name: string }` | Play animation (existing) |
| `walk` | `{ target: [x,y,z] \| "waypoint-id", speed?: number }` | Walk to target (clamped to bounds) |
| `sequence` | `{ steps: [...] }` | Play sequence (existing) |
| `clear_speech` | — | Hide speech bubble |
| `idle` | — | Return to idle behavior |

**Example:**

```json
{ "type": "speak", "text": "Hey! Good to see you!" }
{ "type": "animation", "name": "waving" }
{ "type": "walk", "target": "center" }
```

### Event Protocol (Viewport → LLM)

The viewport may send events back to the LLM for context:

| Event | Payload | When |
|-------|---------|------|
| `message` | `{ text: string }` | User sent a chat message |
| `arrived` | `{ target }` | Character finished walking to target |
| `ready` | — | Scene loaded, character ready |
| `activity` | `{ type }` | User did something (click, etc.) |

### Personality and Message Handling

- The LLM has a system prompt defining personality (e.g., friendly, shy, enthusiastic).
- User messages go to the LLM. The LLM responds with:
  - Text to display in the speech bubble
  - Optional: animation/emote to play
  - Optional: movement (walk to a spot)
- The controller (middleware) translates LLM output into the command stream. This can be:
  - **Structured output** — LLM returns JSON with `speak`, `animation`, `walk` fields.
  - **Parsed from prose** — Middleware parses LLM text for intent (e.g., "waves" → emote waving).
  - **Tool use** — LLM calls tools like `speak(text)`, `play_animation(name)`.

---

## Message Flow

```
User types "Hello!"
    → Chat UI sends to LLM backend
    → LLM (with personality) processes
    → LLM returns: { speak: "Hi there! 👋", animation: "waving" }
    → Controller sends commands to viewport via WebSocket
    → Viewport: show speech bubble "Hi there! 👋", play waving animation
```

```
External service sends message (e.g., reminder, notification)
    → Service POSTs to LLM backend (or a relay)
    → LLM responds
    → Controller sends commands to viewport
    → Viewport: show speech bubble with response
```

### Displaying Incoming Messages

- **Option A:** Show user/external messages in a separate area (e.g., chat history panel) — current fake chat UI.
- **Option B:** Briefly show incoming message in a distinct speech bubble style (e.g., "User said: Hello") before character responds.
- **Option C:** Only show character's speech in bubbles; incoming messages stay in sidebar/chat.

---

## UI Layout Mockup

### Standalone Viewport (Full Screen)

**Character on left → messages on right:**

```
┌─────────────────────────────────────────────────────────────┐
│                    [ World / Room Background ]               │
│                                                             │
│ [Character]                              ┌─────────────────┐ │
│   (left)                                 │ Hey! Good to    │ │
│                                          │ see you! 👋     │ │
│                                          └─────────────────┘ │
│                                          ┌─────────────────┐ │
│                                          │ That's so cool! │ │
│                                          └─────────────────┘ │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [ Chat input ]                              [ Send ]        │
└─────────────────────────────────────────────────────────────┘
```

**Character on right → messages on left:**

```
┌─────────────────────────────────────────────────────────────┐
│                    [ World / Room Background ]               │
│                                                             │
│ ┌─────────────────┐                         [Character]     │
│ │ Hi there!       │                            (right)      │
│ └─────────────────┘                                         │
│ ┌─────────────────┐                                         │
│ │ Sure thing! 👍  │                                         │
│ └─────────────────┘                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [ Chat input ]                              [ Send ]        │
└─────────────────────────────────────────────────────────────┘
```

- **Top:** 3D canvas (world + character). iMessage-style bubbles overlay on the side opposite the character.
- **Bottom:** Chat strip — input, send.
- **Character center:** Messages use either side, grouped by recency; when one side fills, new messages go to the other. Large responses trigger character movement to free space.

### With LLM Control Panel (Dev/Debug)

```
┌────────────────────────────┬────────────────────────────────┐
│  Viewport                  │  Control Panel                  │
│  [World + Character +      │  LLM Status: connected          │
│   Speech bubble]           │  Last command: speak "Hi"        │
│                            │  [Manual: speak ] [walk ] [anim]│
│                            │  Log: ...                       │
├────────────────────────────┴────────────────────────────────┤
│  Chat: [ input... ] [ Send ]                                 │
└─────────────────────────────────────────────────────────────┘
```

- **Left:** Viewport.
- **Right:** Control panel for debugging — manual commands, log of commands received, LLM connection status.

### Embedded Viewport (e.g., in Chat App)

```
┌─────────────────────────────────────┐
│  [Character + speech bubble]        │  ← viewport only
│  (no chat if parent provides it)    │
└─────────────────────────────────────┘
```

- Viewport is an iframe or embedded component.
- Parent app handles chat; sends messages to viewport via postMessage or shared WebSocket.

---

## Summary

| Feature | Spec |
|---------|------|
| World | Image background or simple 3D room; waypoints or bounding box |
| Bounds | Clamp walk target to box or waypoint list |
| Camera | Locked (fixed, follow, or limited orbit) |
| Speech bubbles | Head-attached, camera-facing, fade in/out; show character speech and optionally incoming messages |
| **Messaging overlay** | iMessage-style bubbles on left/right; placement by character position (opposite side); center = either side, grouped; large responses → character moves to free space; temporary display |
| LLM interface | WebSocket (or SSE) command protocol: speak, animation, walk, sequence, clear_speech |
| Events to LLM | message, arrived, ready, activity |
| UI | Full viewport + messaging overlay + chat strip; optional control panel for dev |
