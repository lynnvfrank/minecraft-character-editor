# Focused mode auto-disable on camera mouse move

**Saved:** 2026-03-27  
**Scope:** Disable focused creation mode immediately when the user moves the camera with mouse input.

---

## Request

Focused mode is enabled by default and can be toggled by button, but should be turned off as soon as camera movement begins from mouse interactions.

---

## Implemented change

**File:** `src/main.ts`

- Added `setFocusedCreationEnabled` import from `src/creator.ts`.
- Added `bindFocusedModeAutoDisableOnMouseCameraMove()`:
  - Tracks latest input source on the render canvas (`pointerdown`, `mousedown`, `wheel`, `touchstart`).
  - Subscribes to OrbitControls `start` event and disables focused mode only when:
    - latest input is mouse,
    - route is `creator`,
    - edit mode is `wardrobe` or `3d`,
    - focused mode is currently on.
- Ensured binding runs:
  - after scene initialization,
  - after controls recreation in `updateCreator3DViewPlacement()`.
- Uses a `WeakSet` to avoid rebinding duplicate `start` handlers for the same controls instance.

---

## Result

- Focused mode still defaults to enabled.
- Manual focused/free toggle still works.
- Mouse-driven camera movement now immediately exits focused mode.

---

## Archive log

- **2026-03-27** — Conversation saved to this file.
