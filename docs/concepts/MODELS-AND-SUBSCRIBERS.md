# Models and subscribers (creator state)

**Audience:** humans and agents working in this repo.

Creator **editor state** (layers, canvas, mode, color, swatches, hover info, skin load, lock feedback, wardrobe focus, 2D paint mask) uses **in-process subscribers** in [`src/state/creatorSlices.ts`](../../src/state/creatorSlices.ts), built on [`src/lib/subscribable.ts`](../../src/lib/subscribable.ts).

The **document `CustomEvent` bus** ([`src/events/appEvents.ts`](../../src/events/appEvents.ts)) is reserved for **cross-boundary commands**, not for syncing two DOM panels to the same state.

---

## Two channels

| Channel | Use for | API |
|--------|---------|-----|
| **Slices** | Creator UI staying in sync with shared state; `main` marking the 3D preview dirty | `creator*Slice.subscribe` / `creator*Slice.notify` (payload slices use `notify(detail)`) |
| **Document bus** | Creator **camera** commands (DOM → Three.js rig); **character** skin/animation commands (UI, socket, tools → `characterEvents`) | `publish` / `subscribe` on `document` |

---

## Adding a new bucket

1. Hold data in [`CreatorState`](../../src/state/creatorState.ts) or a small module, as today.
2. Add a `createSubscribable()` or `createPayloadSubscribable<T>()` export in `creatorSlices.ts` (or a dedicated slice module if it grows).
3. After every successful mutation, call **`notify()`** (or **`notify(payload)`**).
4. In DOM builders, **`subscribe`** and guard with `document.body.dataset.route === 'creator'` when the UI only applies in creator.
5. For Three.js, prefer **one** subscriber that sets a **dirty flag** or applies pose—do not subscribe inside the render loop.

---

## Play / home mode (future)

Use the same **`subscribable`** helper for runtime state (poses, minigame flags). Keep **commands** that cross process boundaries on the bus or a dedicated IPC layer.

---

## Tests

Run `npm test` — includes [`src/lib/subscribable.test.ts`](../../src/lib/subscribable.test.ts).
