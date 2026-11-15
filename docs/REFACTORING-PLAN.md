# Refactoring plan

The ideas are already in the code: a layer taxonomy (`docs/concepts/TAXONOMY.md`), a document event bus
(`src/events/appEvents.ts`), observable creator slices (`src/state/`), a mode machine
(`src/controllers/modes/appModeMachine.ts`) and an animation manager. What's missing is that the
**entry files never moved onto them**. Most logic still lives in a few large files that hold module-level
`let` state and call each other directly.

| File | Lines | Problem |
|---|---|---|
| `src/main.ts` | ~1400 (was 1579) | Bootstrap, routing, preview route, creator 3D preview, arm model, frame loop, all as top-level `let`s |
| `src/creator/blockyEditor.ts` | 1326 | Canvas painting, input, rendering in one module |
| `src/creator.ts` | 999 | ~40 exported getters/setters: a facade over `creatorState` that bypasses the slices |
| `src/animation/manager.ts` | 854 | Clip loading, sequencing, turning, idle logic together |
| `src/creator/wardrobe.ts` | 694 | Wardrobe data + UI |

## Target shape

Keep the existing taxonomy. Add one rule per layer about *who may depend on whom*:

```
domain, lib, skin        ← pure, no DOM, no three.js scene (unit-testable)
state                    ← slices; depends only on the above
services                 ← I/O
viewer, animation        ← three.js; read state, never import creator/
creator, ui              ← DOM panels; read/write state, send commands via events
controllers              ← wire everything; the only layer that knows all others
main.ts                  ← ~100 lines: build an AppContext, start controllers
```

Three communication paths, each with one job:

1. **State slices** for "what is true now" (color, mode, layer visibility, arm model, selected skin).
   Anything that's a `let` in `main.ts` or a getter/setter pair in `creator.ts` belongs here.
2. **Event bus** for one-shot commands across boundaries (camera nudge, play animation, change skin).
3. **Direct calls** only inside one feature folder.

## Phases

Each phase is one PR that leaves the app working. Verify with typecheck, tests, and loading both `/` and
`/#/creator` in a browser.

### Phase 1: empty `main.ts` into feature modules (started)

Move each `// ---` section of `main.ts` into a module that owns its state through a factory:

- [x] Skin texture composition → `src/viewer/skinCompositor.ts` (`createSkinCompositor`). Done in this branch.
- [ ] Preview route sync, camera preset and capture API → `src/controllers/previewRouteRuntime.ts`
- [ ] Arm model setting/detection (`armModelSetting`, `detectedArmModel`, `armModelSlice`) → a state slice
      in `src/state/armModel.ts` plus `src/controllers/armModel.ts`
- [ ] Creator 3D preview texture and dirty flag → `src/controllers/creatorPreview.ts`
- [ ] `createOnFrameUpdate` (~225 lines) → merge into `controllers/animationLoop.ts`
- [ ] `applyRoute` + transition buttons → `controllers/router.ts` driven by the mode machine

Introduce one `AppContext` object (scene, characters, animation manager, state) that `main()` builds and
passes to each controller, replacing the late-bound `let getCharacter = ...` / `let fadeToAction = ...`
placeholders.

### Phase 2: one creator state API

- Replace the getter/setter exports in `src/creator.ts` with slices in `src/state/creatorSlices.ts`
  (layer visibility, locks, focused creation, active tool, edit mode). Callers subscribe instead of polling.
- Leave `creator.ts` as `initCreator()` + panel wiring; rename to `src/creator/index.ts` once the facade is gone.
- Add a test per slice (like `lib/subscribable.test.ts`).

### Phase 3: split the big feature modules

- `blockyEditor.ts` → `canvasRenderer.ts`, `pointerInput.ts`, `paintOps.ts` (pure, tested on `ImageData`).
- `animation/manager.ts` → `clipLibrary.ts` (loading), `sequencer.ts` (steps, testable without three.js),
  `turning.ts` (turn strategies), with `manager.ts` composing them.
- `wardrobe.ts` → data/selection model in `state/`, panel in `creator/wardrobe/`.

### Phase 4: a common panel interface

The creator panels (`skinLayersPanel`, `editorToolsPanel`, `wardrobe*Panel`, `colorPicker`, `swatches`, ...)
each have their own setup signature. Give them one:

```ts
interface Panel {
  mount(root: HTMLElement, ctx: CreatorContext): void;
  unmount(): void; // unsubscribe slices and events
}
```

`modePanels.ts` then shows/hides panels per mode from a table instead of custom code, which is the
"unified editor interface" the mode concepts were heading toward. Group files under
`src/creator/panels/`, `src/creator/tools/`, `src/creator/wardrobe/`.

### Phase 5: typed event bus and docs

- Generate the `CREATOR_EVENTS` aliases and payload types from one map so `publish`/`subscribe` are
  type-checked per event.
- Update `TAXONOMY.md` with the dependency rules above and add a lint check (e.g. `eslint-plugin-boundaries`
  or a small `node:test` that scans imports) so `viewer/` can't import `creator/`.

## Order and risk

Phase 1 is low risk (moves code, no behavior change) and makes every later phase easier, so do it first.
Phases 2 and 4 change how panels talk to each other; do them one panel at a time.
