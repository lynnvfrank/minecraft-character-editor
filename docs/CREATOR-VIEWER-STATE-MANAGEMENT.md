# Creator–Viewer State Management

How to manage the character creator skin state, preserve it when switching between the creator and the 3D model viewer (character's home), and handle scene transitions. The player can return to the character editor at any time, swapping between editor and home in the same session.

---

## Table of Contents

1. [Overview](#overview)
2. [State to Preserve](#state-to-preserve)
3. [State Storage Strategies](#state-storage-strategies)
4. [Switching Between Creator and Viewer](#switching-between-creator-and-viewer)
5. [Scene Transitions](#scene-transitions)
6. [Tools for Transitions and State](#tools-for-transitions-and-state)
7. [Implementation Outline](#implementation-outline)

---

## Overview

### Flow

```
[Character's Home]  ←→  [Character Creator]
     (3D viewer)              (2D skin editor)
```

- **Character's Home** — 3D scene with character, animations, controls. The "main" viewport.
- **Character Creator** — 2D canvas for editing the 64×64 skin. Accessed via "Edit character" or similar.
- **Swap** — User can go Home → Creator → Home → Creator repeatedly. No page reload.

### Goals

1. **Preserve creator state** — Unsaved edits, undo history, current tool, color swatch, layer selection.
2. **Preserve viewer state** — Current skin, camera position, animation state, character position.
3. **Smooth transitions** — Avoid jarring cuts when switching.
4. **Apply edits** — When user saves in creator, viewer reflects the new skin.

---

## State to Preserve

### Creator State

| State | Storage | Persist Across Reload? |
|-------|---------|------------------------|
| Canvas pixels (ImageData) | Memory / IndexedDB | Optional (draft recovery) |
| Undo stack | Memory | No |
| Redo stack | Memory | No |
| Current tool (brush, fill, etc.) | Memory or sessionStorage | Optional |
| Brush size, color | Memory or sessionStorage | Optional |
| Color swatch (last N colors) | sessionStorage | Optional |
| Selected layer(s) | Memory | No |
| Template overlay on/off | sessionStorage | Optional |

**Critical:** Canvas pixels and undo stack must survive the **route change** (Creator → Home → Creator). They do not need to survive a full page reload unless you want "draft recovery."

### Viewer State

| State | Storage | Persist Across Reload? |
|-------|---------|------------------------|
| Current skin path | Memory, URL, or localStorage | Optional |
| Camera position/target | Memory | No |
| Character position | Memory (from animationManager) | No |
| Active animation | Memory | No |
| OrbitControls state | Memory | No |

**Critical:** Current skin path should be shared so that (a) creator can load it when opened, and (b) viewer applies the latest saved skin when returning.

### Shared State

| State | Purpose |
|-------|---------|
| **Current skin** | Path or URL of active skin. Creator loads it; viewer displays it. |
| **Dirty flag** | Creator has unsaved changes. Warn before navigating away if needed. |
| **Last saved skin** | For "Revert" or comparison. |

---

## State Storage Strategies

### 1. In-Memory (Route-Scoped)

- Keep creator state in module-level variables. When route = `/creator`, creator component mounts and reads/writes these.
- **Problem:** Navigating away unmounts the creator. Variables persist if the module stays loaded, but the DOM is torn down. Re-mounting creator must rehydrate from stored state.
- **Solution:** Store in a singleton or global store (see below). Creator reads on mount; writes on change or unmount.

### 2. Session Storage

- `sessionStorage.setItem('creator-draft', canvas.toDataURL('image/png'))` when leaving creator.
- On creator mount: `const draft = sessionStorage.getItem('creator-draft'); if (draft) loadImage(draft);`
- **Pros:** Survives route change and refresh (same tab). **Cons:** 5–10MB limit; base64 is large for 64×64 (small, so fine).

### 3. IndexedDB

- For larger state or multiple drafts. Overkill for single 64×64 skin unless you want multiple unsaved drafts.
- Use when: draft recovery across sessions, offline support.

### 4. URL / Query Params

- `?skin=/skins/custom/my-skin.png` — Viewer reads on load; creator can link to "view this skin."
- Limited size; good for current skin path only.

### 5. Shared Store (Singleton)

- `skinStore.currentSkin`, `skinStore.creatorDraft`, `skinStore.dirty`.
- Both creator and viewer import the store. Creator writes; viewer reads.
- No persistence by default; add sessionStorage/localStorage sync if desired.

### Recommended

- **Current skin:** Shared in-memory store + optional `localStorage` for "remember last skin."
- **Creator draft:** `sessionStorage` key `creator-draft` — save on leave, load on enter. Survives refresh.
- **Undo stack:** In-memory only. Cleared on creator unmount (acceptable) or optionally serialized to sessionStorage if small.

---

## Switching Between Creator and Viewer

### Navigation Model

- **Route-based** — `/` or `/home` = viewer; `/creator` = creator.
- **No route** — Toggle visibility of two full-screen panels. Both stay mounted; only one is visible. Simpler state (no unmount) but higher memory use.

### Option A: Route-Based (Mount/Unmount)

- User clicks "Edit character" → `location.hash = '#/creator'` or `history.pushState` → creator component mounts.
- User clicks "Home" or "View character" → route → viewer. Creator unmounts.
- **On creator mount:** Load draft from sessionStorage (if any) or current skin from store.
- **On creator unmount:** Save draft to sessionStorage; set dirty flag if unsaved.
- **On viewer mount:** If skin was updated (e.g., via store event or polling), call `switchSkin`.

### Option B: Toggle Panels (Both Mounted)

- Two divs: `#viewer-panel`, `#creator-panel`. One has `display: none` or `visibility: hidden`.
- **Pros:** No unmount; creator state (canvas, undo) stays in memory. **Cons:** Both Three.js and canvas active; more memory.
- **Recommended** if creator is lightweight and you want instant switch with no rehydration.

### Apply Edits Flow

1. User edits in creator.
2. User clicks "Save" or "Apply" → `canvas.toBlob` → POST to `/api/skin/save` or pass to store.
3. Server saves to `public/skins/custom/{id}.png`; updates manifest.
4. Store emits `skinUpdated` or viewer polls/refreshes skin list.
5. Viewer calls `switchSkin(newPath)` — character texture updates.
6. Optional: navigate to viewer automatically after save.

### "Edit" Without Saving

- User clicks "Edit" → creator opens with current skin loaded.
- User edits but clicks "Home" without saving.
- **Option 1:** Discard. Draft in sessionStorage for "recover draft?" on next creator open.
- **Option 2:** Auto-save draft to sessionStorage on leave. On next creator open, prompt "Resume draft?" if draft exists.

---

## Scene Transitions

When switching between creator and viewer, a transition can reduce the sense of abruptness.

### Transition Types

1. **Crossfade** — Viewer fades out; creator fades in (or vice versa).
2. **Slide** — Viewer slides left; creator slides in from right (or vice versa).
3. **Scale / zoom** — One view shrinks, the other grows.
4. **None** — Instant switch. Simplest; acceptable for dev.

### What to Animate

- **Full view** — The entire viewer or creator container (opacity, transform).
- **Shared element** — If a "character preview" exists in both, use shared element transition (complex).
- **Overlay** — Fade a full-screen overlay, then swap content underneath.

### Duration

- 200–400 ms typical. Enough to feel smooth; not so long that it feels slow.

---

## Tools for Transitions and State

### View Transitions API

- **`document.startViewTransition(callback)`** — Native browser API. Captures old state, runs callback (DOM update), animates to new state.
- **Use case:** Wrap route change in `startViewTransition`. Old view snaps, new view appears with default crossfade.
- **Browser support:** Chrome 111+; Safari 18+; Firefox behind flag. Provide fallback: `if (!document.startViewTransition) callback(); else document.startViewTransition(callback);`
- **Fit:** Excellent for SPA route changes. Minimal code. No extra deps.
- **Reference:** [MDN View Transitions](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API), [web.dev View transitions for SPAs](https://web.dev/learn/css/view-transitions-spas).

### GSAP

- **Purpose:** Animation library. `gsap.to()`, `gsap.from()`, timelines.
- **Use case:** Custom transitions — slide, scale, stagger. More control than View Transitions API.
- **Fit:** Good if you want precise, choreographed transitions. Adds dependency.
- **Not in project** — Would need `npm install gsap`.

### Tween.js (Already in Project)

- **`@tweenjs/tween.js`** — Already in `package.json`.
- **Use case:** Animate numeric values (opacity, x, y). `new TWEEN.Tween({ opacity: 1 }).to({ opacity: 0 }, 300).onUpdate(...)`.
- **Fit:** Lightweight. Can drive opacity/transform for simple crossfade or slide. **Recommended** — no new dep.
- **Note:** SEQUENCES-WALKING-RETROSPECTIVE mentions TWEEN had issues for character movement (timing). For UI transitions (DOM opacity), it should work fine.

### Framer Motion

- **Purpose:** React animation library.
- **Fit:** Only if you adopt React. Project is currently vanilla TS.
- **Skip** unless migrating to React.

### Fabric.js / Konva

- **Purpose:** Canvas libraries (from CHARACTER-CREATION-SCREEN-SPEC).
- **For state/transitions?** No. They are for canvas drawing, not scene or route transitions.
- **Conclusion:** Use for creator canvas if needed; use View Transitions API or Tween.js for creator↔viewer transitions.

### Summary: Tool Recommendation

| Need | Tool | Notes |
|------|------|-------|
| Route transition | **View Transitions API** | Native; fallback for unsupported browsers. |
| Custom transition | **Tween.js** | Already in project; animate opacity/transform. |
| State persistence | **sessionStorage** | Draft recovery; current skin path. |
| Shared state | **Singleton / module** | `skinStore` or similar. |

---

## Implementation Outline

### 1. Shared Skin Store

- Create `src/skinStore.ts` (or similar):
  - `currentSkin: string`
  - `creatorDraft: string | null` (base64 or blob URL)
  - `dirty: boolean`
  - `subscribe(cb)` for viewers that need to react.
- Creator: on mount, load `currentSkin` or `creatorDraft`; on unmount/save, update store.
- Viewer: subscribe; on `currentSkin` change, call `switchSkin`.

### 2. Routing

- Hash-based: `#/`, `#/creator`. Listen `hashchange`. Or History API + Vite config for SPA fallback.
- Route handler: Show/hide viewer or creator container; or mount/unmount components.

### 3. Creator Unmount Hook

- Before unmount (or `hashchange` away): `sessionStorage.setItem('creator-draft', canvas.toDataURL('image/png'))` if dirty.
- Optional: `sessionStorage.setItem('creator-swatch', JSON.stringify(swatchColors))`.

### 4. Creator Mount Hook

- Check `sessionStorage.getItem('creator-draft')`. If present, offer "Resume draft?" or auto-load.
- Else load `skinStore.currentSkin` (or default).

### 5. Transition Wrapper

- On route change: `if (document.startViewTransition) document.startViewTransition(() => { showCreator(); }); else showCreator();`
- Or use Tween.js: tween overlay opacity 0→1, swap content, tween 1→0.

### 6. "Edit" and "Home" Buttons

- Viewer: "Edit character" → set route to creator.
- Creator: "Home" / "View character" → set route to viewer. Optionally "Save & view" → save, then route.

### 7. Apply on Save

- Creator "Save" → POST to API; on success, set `skinStore.currentSkin = newPath`; optionally navigate to viewer.
- Viewer (if mounted) reacts to store update and calls `switchSkin`.

---

## Summary

| Topic | Recommendation |
|-------|----------------|
| **State preservation** | sessionStorage for draft; in-memory store for current skin, undo stack |
| **Switching** | Route-based (`#/creator`) or toggle panels |
| **Transitions** | View Transitions API (primary) or Tween.js (already in project) |
| **Tools** | Tween.js for custom UI transitions; Fabric/Konva for canvas only, not transitions |
| **Apply edits** | Save → update store → viewer calls `switchSkin` |

**Player returns anytime:** Route or toggle allows repeated switching. Draft in sessionStorage supports "resume" if they left without saving.
