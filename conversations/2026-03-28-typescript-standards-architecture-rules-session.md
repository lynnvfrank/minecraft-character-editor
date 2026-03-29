# TypeScript standards, architecture patterns, and Cursor rules

**Saved:** 2026-03-28  
**Scope:** Review of `src/` conventions; creator mode buttons; configuration consolidation; GoF-style patterns; consolidated Cursor rule file.

---

## 1. Coding standards in `src/` (bullet survey)

**Request:** Identify TypeScript coding standards visible in the project that could be codified as rules, with short explanations and pointers to files/lines.

**Summary of themes:**

- **Compiler:** `tsconfig.json` — `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- **Layout:** Folders by role (`domain/`, `state/`, `controllers/`, `services/`, `events/`, `creator/`, `viewer/`, `skin/`, `config/`, `lib/`, etc.); see `docs/concepts/TAXONOMY.md`.
- **Barrels:** Explicit named exports; `export type { … }` separate from values (`src/creator/index.ts`, `src/controllers/index.ts`, `src/skin/index.ts`).
- **Imports:** `import type` / inline `type` in import lists (`src/main.ts`); `import * as THREE from 'three'`.
- **State:** In-process slices (`src/state/creatorSlices.ts`, `src/lib/subscribable.ts`) vs document bus (`src/events/appEvents.ts`); payload types in `creatorSlicePayloads.ts`.
- **Events:** `APP_EVENTS` as `const` + derived union; `CREATOR_EVENTS` aliases.
- **Creator UI:** Context interfaces in `src/creator/api.ts`; `EDIT_MODE_*` + `EditMode`; type guards `isDrawingTool`, `isToggleType`.
- **Controllers/services:** `create…Controller(deps)` / `create…Manager`, named `…Deps`, `dispose`/`destroy`.
- **Docs:** File-level docblocks linking to `docs/…`.
- **Tests:** Colocated `*.test.ts` with `node:test` / `node:assert/strict`.
- **Vite:** `src/vite-env.d.ts`; `import.meta.env` for flags.
- **Naming note:** Mostly `camelCase.ts`; exceptions like `CameraControls.ts` — worth one explicit rule.

---

## 2. Creator mode buttons (Wardrobe / 3D / 2D) and MVC-style guidance

**Request:** Whether “add a mode button → it automatically participates in events” is still true; ideas to codify: dynamic vs hard-coded; MVC over tight coupling; other patterns.

**Answer (condensed):**

- **Still partly true:** Clicks are wired with `modePanel.querySelectorAll('.creator-tools-panel-mode-btn')` and `data-mode` → `ctx.setEditMode`. Active state uses `document.querySelectorAll` for the same class. Tab order reads modes from the DOM in `src/creator/shortcuts.ts` (`getOrderedEditModes`), with `FALLBACK_EDIT_MODES` if DOM missing.
- **Not automatic:** The three buttons are still hand-built in `buildEditorToolsPanel` (`src/creator/editorToolsPanel.ts`). A new `EditMode` value needs types, routing, `appModeMachine`, and `setEditMode` behavior — not DOM-only.
- **Gap:** Rulers/Template toggles use `data-toggle` but handler logic is hard-coded `if (rulers) … else …` — weaker than the mode-button pattern.
- **Other patterns to codify:** Two channels (slices vs `appEvents`); payload subscribables; XState for route/mode; factory controllers + `dispose`; shortcuts as data (`shortcuts.ts`); domain constants in `skin/`; type guards for unions.

---

## 3. Consolidating configuration

**Request:** Codify ideas — (a) constants grouped per concern in one file, (b) object/array models with types, (c) sensible defaults.

**Answer (condensed):**

- Three layers work together: **where** constants live (by subsystem), **typed model** (`XConfig`, `readonly X[]`), **defaults** at boundaries (parse `||`/`??`, default params, module default object).
- Examples: `src/config/creatorWardrobeMotion.ts`, `src/config/scene.config.ts`, `MODE_PANEL_CONFIGS` / `WARDROBE_PART_PANEL_CONFIGS`, `SKIN_PREPROCESS_CONFIG`, `parseUrlParamsConfig`, `preprocessSkinTexture(…, config = SKIN_PREPROCESS_CONFIG)`.
- **Don’t** merge unrelated groups into one mega-file.
- **`public/*.json`:** data without recompile; add TS types / validation when shape matters.
- **Derived config:** e.g. `PRIMARY_REGIONS` from `SKIN_LAYER_BOUNDS` — don’t duplicate geometry.

---

## 4. Chain of Responsibility, State, Strategy

**Request:** Codify only if the codebase does it.

**Answer (condensed):**

- **Strategy — yes:** `TurnStrategy` (`snap` | `lerp` | `reset`) + `getTurnStrategy` in `src/animation/manager.ts`; URL selection via `src/config/urlParams.ts`.
- **State — yes:** XState `appModeMachine` in `src/controllers/modes/appModeMachine.ts`.
- **Chain of Responsibility — weaker / by analogy:** Ordered `MappingRule[]`, first match wins + heuristic fallback in `src/skin/meshPartMapping.ts`; XState guarded transition lists. Not classic linked handlers.

---

## 5. Cursor rule file (agent implementation)

**Request:** Rewrite all accumulated rules so Cursor’s model can follow them.

**Done:** Added **`.cursor/rules/typescript-architecture-conventions.mdc`** with `alwaysApply: true` and dense imperative sections covering: compiler, layout (no unrelated merge), barrels, imports, Three.js, two-channel table + `MODELS-AND-SUBSCRIBERS.md`, payloads/subscribables, `appEvents` naming, `appModeMachine`, factories/`dispose`, `creator/api` contexts and type guards, shortcuts as data, single source of truth for skin layout + derived config, `public` JSON + TS types, docs headers, tests, Vite/env, file naming. Strategy/State/CoR subsection was intentionally omitted from the rule file to match only the three pasted rule blocks; routing still references the state machine.

---

## 6. This export

**Request:** Write this conversation to the `conversations/` directory.

**File:** `conversations/2026-03-28-typescript-standards-architecture-rules-session.md` (this file).

---

## Archive log

- **2026-03-28** — Session summarized and saved to this file.
