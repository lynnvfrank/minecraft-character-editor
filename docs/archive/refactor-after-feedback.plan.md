# Refactor After Feedback — Remaining Extractions

Plan for extracting remaining logic from `main.ts` following the feedback-driven refactor session (20 Mar 2026). `main.ts` is currently ~1745 lines; these extractions target further modularization with clear separation of concerns per [TAXONOMY.md](../concepts/TAXONOMY.md).

---

## Completed Extractions (Session 1)

| Module | Contents | Notes |
|--------|----------|-------|
| `config/urlParams.ts` | `getUrlSearchParams`, `parseUrlParamsConfig`, `TURN_STRATEGIES`, `parseTurnStrategy` | URL query parsing |
| `controllers/characterTypes.ts` | `CharacterState`, `CharacterConfig`, `buildCharacterConfig()` | Character config types and builder |
| `controllers/creatorPose.ts` | `createCreatorPoseController(deps)` | Creator pose and camera logic |
| `lib/easing.ts` | `easeOutCubic()` | Easing helper |
| `docs/concepts/CHARACTERS.md` | Updated to reference `characterTypes.ts` | Doc alignment |

---

## Remaining Extractions (Deferred — High Coupling)

These were deferred due to cross-module dependencies and coupling. They are listed in **recommended implementation order** to minimize risk and circular dependencies.

---

### 1. `controllers/viewerShell.ts`

**Purpose:** Route buttons and layout chrome.

| Function | Role |
|----------|------|
| `updateRouteButtonsState()` | Enable/disable Edit / Home buttons based on route |
| `setupCreatorTransitionButton()` | Wire creator "Edit" button to transition handler |
| `setupViewerTransitionButton()` | Wire viewer "Home" button to transition handler |
| `resumeHomeMode()` | Hash + mode-machine sync when returning to viewer |
| `ensureViewerFullWidthLayout()` | Full-width layout when in viewer/preview |

**Dependencies:** `creatorTransitionHandler` (expects these as deps), `getRoute`, `getEditMode`, mode machine.

**Why first:** Small surface area; already passed as deps into `creatorTransitionHandler`. Low risk.

**Estimate:** ~80 lines.

---

### 2. `controllers/character.ts`

**Purpose:** Character loading, skin switching, and animation actions.

| Function | Role |
|----------|------|
| `loadCharacter(config, skins)` | Load FBX, apply skin, setup mixer and actions |
| `fadeToAction(char, action, duration)` | Crossfade between animations |
| `getAction(char, key)` | Resolve action by key from character |
| `switchSkin(charId, skinPath)` | Update character texture from path |
| Related UI setup | Skin/animation dropdown handlers, `highlightActiveSkin` |

**Dependencies:** `sceneContext`, `CharacterConfig`, `applySkinToModel`, `animationManager`, `getCharacter`, creator API.

**Why second:** Core domain logic; many callers. Extracting early clarifies `main.ts` orchestration vs character lifecycle.

**Estimate:** ~200 lines.

---

### 3. `controllers/creatorIntegration.ts`

**Purpose:** Creator ↔ viewer glue: 3D placement, preview texture, dirty subscription.

| Function | Role |
|----------|------|
| `updateCreator3DViewPlacement()` | Move `#app` between main area and 3D slot based on edit mode |
| `updateCreatorPreviewTexture()` | Build texture from creator canvas and apply to model |
| `setupCreatorPreviewDirtySubscription()` | Subscribe to `CREATOR_EVENTS` and mark preview dirty / apply pose |

**Dependencies:** `getRoute`, `getEditMode`, `sceneContext`, `getCreatorSkinCanvas`, creator API, `creatorPoseController`, `buildVisibilityTexture`, `applySkinToModel`.

**Why third:** Builds on character and creator pose. Integrates creator with viewer placement and preview.

**Estimate:** ~90 lines.

---

### 4. `viewer/captureThumbnail.ts` (implementation)

**Purpose:** 3D thumbnail capture for creator wardrobe/preview.

| Export | Role |
|--------|------|
| `captureCreator3DThumbnail(size?)` | Render character with current creator skin to data URL |
| `captureCreator3DPartThumbnail(part, size?)` | Per-part thumbnail using preset camera/visibility |
| `linearToSrgb(c)` | Linear → sRGB for display (render target pixels) |

**Note:** `viewer/capture3DThumbnail.ts` already exists as a **registry**. This extraction moves the **implementation** out of `main.ts` and wires it via `registerCapture3DThumbnail` / `registerCapture3DPartThumbnail`.

**Dependencies:** `sceneContext`, `getCharacter`, `getCreatorSkinCanvas`, `getCreatorWorkSize`, `getPreviewPreset`, `buildLayerMaskedCanvas`, `buildLayerVisibleState`, creator layer state.

**Why fourth:** Self-contained rendering logic. Avoiding circular deps may require passing deps (e.g. `getCharacter`, `getCreatorSkinCanvas`) as arguments or via a factory.

**Estimate:** ~140 lines.

---

### 5. `controllers/previewSync.ts`

**Purpose:** Preview route → texture sync, camera debug panel.

| Concept | Role |
|---------|------|
| `syncPreviewRouteToTexture()` | Apply preview preset texture from route to character |
| `applyPreviewTextureFromCanvas()` | Apply masked canvas to model with layer visibility |
| `buildVisibilityTexture()` | Build texture from canvas + layer visibility |
| `buildLayerMaskedCanvas()` | Mask canvas by visible layers |
| `buildLayerVisibleState()` | Map preset visible layers to layer state |
| Preview camera debug | `updatePreviewCameraDebugPanel` integration |

**Dependencies:** `previewRouteController`, `sceneContext`, `getCreatorSkinCanvas`, creator layer state, `applySkinToModel`, `applyCreatorLayerVisibility`.

**Why fifth:** Significant coupling with preview route, creator canvas, and scene. Best done after creator integration is extracted.

**Estimate:** ~250 lines (includes helpers currently in main).

---

### 6. `controllers/animationLoop.ts`

**Purpose:** Main render loop and per-route update logic.

| Logic | Role |
|-------|------|
| `animate()` | `requestAnimationFrame` loop |
| Creator route | Set `creatorPreviewDirty`, call `updateCreatorPreviewTexture` |
| Preview route | Call `updatePreviewCameraDebugPanel` |
| Viewer route | Reset layer visibility to all visible |
| Common | Mixer update, `animationManager.tick`, `characterAI.update`, controls, render |

**Dependencies:** Route, creator integration, preview sync, scene, characters, `animationManager`, `characterAI`, `getCreatorTransitionInFlight`.

**Why last:** Central orchestration; depends on almost all other extractions. Extracting this last keeps the loop as the single place that wires everything together.

**Estimate:** ~60 lines (loop body); deps injected via factory or closure.

---

## Dependency Graph

```
viewerShell ──────────────────────────────────────────────────┐
                                                              │
character ────────────────────────────────────────────────────┤
                                                              │
creatorIntegration ◄── creatorPose, character                  ├──► animationLoop
                                                              │
captureThumbnail ◄── sceneContext, character, creator canvas   │
                                                              │
previewSync ◄── previewRoute, creatorIntegration, scene ───────┘
```

---

## Suggested Order

1. **viewerShell** — smallest, already interfaced
2. **character** — core domain
3. **creatorIntegration** — creator ↔ viewer glue
4. **captureThumbnail** — self-contained, may need factory pattern
5. **previewSync** — preview texture/camera logic
6. **animationLoop** — last, as orchestration hub

---

## Build Checkpoint

After each extraction:

```bash
npm run build
```

Optional smoke test: `npm run dev` → viewer, creator (wardrobe/2d/3d), preview, skin change, animation play, Edit/Home buttons, thumbnail capture (wardrobe).

---

## References

- [TAXONOMY.md](../concepts/TAXONOMY.md) — Layer definitions
- [FEEDBACK-20Mar2026.md](../FEEDBACK-20Mar2026.md) — Usability feedback that drove refactor focus
- [MODES.md](../concepts/MODES.md) — Route and edit mode vocabulary
