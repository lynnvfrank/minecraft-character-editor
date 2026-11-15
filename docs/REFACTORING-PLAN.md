# Refactoring plan

The ideas are already in the code: a layer taxonomy (`docs/concepts/TAXONOMY.md`), a document event bus
(`src/events/appEvents.ts`), observable creator slices (`src/state/`), a mode machine
(`src/controllers/modes/appModeMachine.ts`) and an animation manager. What's missing is that the
**entry files never moved onto them**. Most logic still lives in a few large files that hold module-level
`let` state and call each other directly.

| File | Lines | Problem |
|---|---|---|
| `src/main.ts` | ~830 (was 1579) | Bootstrap, routing, preview route, creator 3D preview, arm model, frame loop, all as top-level `let`s |
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

### Phase 1: empty `main.ts` into feature modules (done)

Move each `// ---` section of `main.ts` into a module that owns its state through a factory:

- [x] Skin texture composition → `src/viewer/skinCompositor.ts`; the pixel masking is a pure
      `maskHiddenLayerRegions` with tests.
- [x] Preview camera presets + debug panel → `src/controllers/previewCamera.ts` (tests for preset matching
      and signatures). `previewRoute.ts` URL parsing now has tests too.
- [x] Preview route skin sync and `window.__previewCapture` → `src/controllers/previewRouteRuntime.ts`
      (`pickPreviewBaseSkin` tested).
- [x] Arm model setting/detection → `src/state/armModelState.ts` (tested); `main.ts` subscribes to swap the rig.
- [x] Creator 3D preview texture, dirty flag and per-route frame work → `src/controllers/creatorPreview.ts`
      (`createRouteDirtyTracker` tested). The frame hook turned out to be ~25 lines, so it stays a callback
      into `animationLoop.ts` rather than being merged.
- [x] `applyRoute` → `src/controllers/router.ts` (`presetPoseAt`, `shouldReloadCreatorSkin` tested);
      Design/Home buttons → `src/ui/routeButtons.ts` (+ pure `routeButtonState.ts`, tested).

Result: `main.ts` 1579 → ~1040 lines, tests 43 → 80.

**Carried into Phase 2:** `main.ts` still declares controllers as late-bound `let`s (`getCharacter`,
`fadeToAction`, `creatorPoseController`, ...) because `main()` builds them after module evaluation. Replace
these with one `AppContext` (scene, characters, animation manager, state) that `main()` builds and passes
to each controller. The remaining big blocks are the 3D thumbnail capture exports (~200 lines →
`viewer/capture3DThumbnail.ts`) and `main()` itself.

### Phase 2: AppContext and a tested creator state (done)

- [x] `src/controllers/appContext.ts`: typed service registry (`provide` / `get` / `tryGet`, tested).
      `main()` provides scene, characters, animation, creatorPose, viewerUI, transitions and characterAI.
      The duplicate `controllerRefs` object and 13 reassigned `let` placeholders are gone.
- [x] 3D thumbnail capture → `src/viewer/thumbnailCapture.ts`. The full-outfit and per-part captures
      shared ~80% of their code; they now share one render path. The readPixels → ImageData flip and
      sRGB conversion is pure and tested (`captureHelpers.ts`).
- [x] Layer visibility split into `creator/layerVisibility.ts` (state only) and `layerVisibilityDom.ts`
      (checkbox sync, drag-to-toggle). 16 characterization tests were written against the old code first.

Result: `main.ts` ~1040 → ~830 lines, tests 80 → 104.

**Changed from the original plan:** the getters/setters in `creator.ts` already write `CreatorState` and
notify the matching slice (`setFocusedCreationEnabled` → `creatorFocusedCreationSlice`, layer setters →
`creatorLayerSlice`, ...), so replacing them wholesale would be churn. The real gap was that the logic behind
them had no tests and was mixed with DOM code. Remaining work of that kind, for later:

- `setEditMode` in `creator.ts` mixes the mode change with wardrobe side effects and URL sync; pull the
  pure transition rules (save/restore layers, which panels to show) into a tested function.
- `colorActions` / swatches: same treatment as layer visibility.

### Phase 3: pull the pure rules out of the big feature modules (done)

Each module kept its DOM / three.js code; the rules it applies moved to a pure, tested module beside it.

- [x] `animation/manager.ts` → `animation/wander.ts`: angle wrap/lerp, smoothstep, waypoint placement
      in the camera trapezoid, and wander-target choice (13 tests).
- [x] `creator/blockyEditor.ts` → `creator/paintMask.ts`: visible regions, focused 2D crop, layer under a
      skin pixel, selection/lock painting rules, template labels (12 tests).
- [x] `creator/wardrobe.ts` → `creator/wardrobeSelection.ts`: default selections, per-part composite step,
      paint order, mutually exclusive composite clears (11 tests).

Result: tests 104 → 139. Line counts moved less than in Phases 1–2 (blockyEditor 1326 → ~1220,
manager 854 → ~800, wardrobe 694 → ~580): what's left in them is DOM/WebGL code that only a browser can test.

**Not done, worth doing next:** split `blockyEditor.ts` further into grid building, rulers/template
rendering and pointer input (it still mixes all three); and `animation/manager.ts`'s walk/turn phase
machine (`tick`, `playAnimationForDuration`), which needs a fake clock and mixer to test.

### Phase 4: a common panel contract (done)

Most of this already existed: `MODE_PANEL_CONFIGS` in `modePanels.ts` is the mode → panel table, and
`creator/lifecycle.ts` has a `DisposableScope` that is torn down on each creator visit. What was missing
was using them consistently.

- [x] `planModePanelTransition` (pure, 7 tests) decides which panels hide, show, stay or stay hidden on a
      mode switch; `modePanels.ts` only applies the plan to the DOM.
- [x] `creator/panels.ts`: `CreatorPanel { name, mount(scope) }` and `mountPanels` (3 tests).
      `buildCreatorPanels` is a list; panels get the scope passed in instead of importing the
      `creatorScope` singleton. A panel that throws is now logged and skipped instead of stopping the
      rest of the creator from building.

Result: tests 139 → 149.

**Left as is, on purpose:** `wardrobePartsPanel.ts` and `blockyEditor.ts` keep their own unbind
variables. The wardrobe keyboard shortcuts must stop when you *leave* the creator
(`unregisterCreatorShortcuts`), while the scope is only disposed when you *re-enter*; moving them onto
the scope would leave the shortcuts active on the home screen. Fixing that properly means disposing the
scope on exit too, which is a behaviour change worth its own PR.

### Phase 5: typed event bus and import rules (done)

- [x] `AppEventMap` in `events/appEvents.ts` gives every bus event its payload type. `publish` and
      `subscribe` are checked against it, and typecheck fails if `APP_EVENTS` and the map disagree
      (4 tests, including `@ts-expect-error` checks that wrong payloads don't compile).
- [x] `src/architecture.test.ts` enforces which `src/` folders may import which (rules in
      `docs/concepts/TAXONOMY.md`). Existing violations fixed: the camera toolbar moved from `viewer/` to
      `creator/cameraControlsPanel.ts`; `DrawingTool` → `domain/`; `WardrobeLayerKey` → `skin/`;
      `PreviewPartKey` → `viewer/previewPresets.ts`; thumbnail capture takes a structural character type.
      One documented exception remains (`viewer/controls.ts` → creator paint API).

Result: tests 149 → 155.

## Where things ended up

| | Start | End |
|---|---|---|
| `main.ts` | 1579 lines | ~830 lines |
| Tests | 43 | 155 |
| New test files | — | 18 |
| New source modules (split out of larger files) | — | 16 |

Follow-ups noted in the phases above, roughly in order of value:

1. Inject the creator paint API into `viewer/controls.ts` and drop the last boundary exception.
2. Dispose the creator scope on exit (not just re-entry) so the wardrobe shortcuts and blocky editor can
   use it like every other panel.
3. Split `blockyEditor.ts` into grid building, rulers/template rendering and pointer input.
4. Test the animation manager's walk/turn phase machine with a fake clock.
5. `setEditMode` and colour/swatch logic: same treatment as layer visibility.

## Testing as we go

Every extraction should leave a pure core with a `*.test.ts` beside it (`node:test`, run by `npm test`).
Tests run in Node without a DOM, so:

- Put pixel/math/state logic in functions that take plain data (`Uint8ClampedArray`, `{x,y,z}`, strings).
- Import specific modules (`../viewer/previewPresets`), not barrels (`../viewer`, `../ui`): the barrels pull
  in `.svg` imports and three.js scene code that Node can't load.
- Keep DOM/three.js glue thin and cover it with the browser check instead.

## Order and risk

Phase 1 is low risk (moves code, no behavior change) and makes every later phase easier, so do it first.
Phases 2 and 4 change how panels talk to each other; do them one panel at a time.
