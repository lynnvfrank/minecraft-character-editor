# Character Creator — Data Model Analysis

This document identifies data models and representations that cause code duplication, inconsistent interpretations, and limit extensibility. Use this when planning refactors to improve reliability and maintainability.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Layer / Part Naming and Identity](#layer--part-naming-and-identity)
3. [Skin Region Bounds](#skin-region-bounds)
4. [Coordinate Systems](#coordinate-systems)
5. [Catalog Types (Skin, Animation)](#catalog-types-skin-animation)
6. [Mesh-to-Skin Mapping](#mesh-to-skin-mapping)
7. [Color Representation](#color-representation)
8. [Priority Recommendations](#priority-recommendations)

---

## Executive Summary

| Area | Problem | Impact | Effort |
|------|---------|--------|--------|
| Layer keys | Defined 3× with different orders | Drift risk, subtle bugs | Low |
| Part ↔ Layer mapping | Hardcoded in creator; UV keys different in main | Adding parts/layers requires 3+ edits | Medium |
| Region bounds | 3 separate definitions (skinLayout, skinPreprocess, main UVs) | Potential mismatch in preprocessing vs. editor | Medium |
| SkinEntry / AnimationEntry | Duplicated types in main.ts and creator.ts | API changes require sync | Low |
| Mesh name → part | Hardcoded heuristics in main.ts | Model changes break mapping | High |
| Coordinate space | working / norm / skin / UV scattered | Conversion errors, confusion | Medium |

---

## 1. Layer / Part Naming and Identity

### Current State

**Layer keys** (logical grouping for visibility, lock, UI) are defined in multiple places:

| Location | Constant | Value |
|----------|----------|-------|
| `creator.ts` | `LAYER_KEYS` | `['hat', 'head', 'jacket', 'body', 'sleeves', 'arms', 'pants', 'legs']` |
| `main.ts` | `CREATOR_LAYER_KEYS` | Same set |
| `main.ts` | `TEXTURE_LAYER_KEYS` | `['head', 'hat', 'body', 'jacket', 'sleeves', 'arms', 'legs', 'pants']` — **different order** |

**Part display names** (for hover: "Right leg", "Left sleeve") vs **layer keys** ("legs", "sleeves") are related via a hardcoded map in `creator.ts`:

```ts
// creator.ts — partToLayer()
const m: Record<string, string> = {
  Head: 'head', Hat: 'hat', Body: 'body', Jacket: 'jacket',
  'Right leg': 'legs', 'Left leg': 'legs', 'Right pants': 'pants', 'Left pants': 'pants',
  'Right arm': 'arms', 'Left arm': 'arms', 'Right sleeve': 'sleeves', 'Left sleeve': 'sleeves',
};
```

**main.ts** uses a different vocabulary for UV / mesh mapping: `armR`, `armL`, `legR`, `legL`, `sleeveR`, `sleeveL`, `pantsR`, `pantsL` (no `head`/`hat`/`body`/`jacket` in that form; those use the same names).

### Problems

1. **Order dependency**: `TEXTURE_LAYER_KEYS` order may matter for render order; if so, it should be explicit and documented.
2. **Single source of truth**: Adding a layer (e.g. cape) requires updating `LAYER_KEYS`, `CREATOR_LAYER_KEYS`, `TEXTURE_LAYER_KEYS`, `partToLayer`, `SKIN_LAYER_BOUNDS`, `LAYER_GROUPS`, and possibly `MINECRAFT_SKIN_UVS`.
3. **Part identity**: "Right arm" (display) vs `arms` (layer) vs `armR` (UV key) are three representations of related concepts with no shared model.

### Recommendation

Introduce a **canonical layer/part model** in e.g. `src/skinModels.ts`:

```ts
export type LayerKey = 'hat' | 'head' | 'jacket' | 'body' | 'sleeves' | 'arms' | 'pants' | 'legs';
export const LAYER_KEYS: readonly LayerKey[] = [/* single definition */];

export type PartDisplayName = string;  // 'Right arm', 'Left sleeve', etc.
export const PART_TO_LAYER: Record<PartDisplayName, LayerKey> = { /* from SKIN_PART_BOUNDS */ };

export type UVPartKey = 'head' | 'hat' | 'body' | 'jacket' | 'armR' | 'armL' | 'sleeveR' | 'sleeveL' | 'legR' | 'legL' | 'pantsR' | 'pantsL';
export const LAYER_TO_UV_PARTS: Partial<Record<LayerKey, UVPartKey[]>> = { /* layer → uv parts */ };
```

- Export `LAYER_KEYS` and use it everywhere.
- Derive `partToLayer` from `SKIN_PART_BOUNDS` and a small mapping table.
- Use `LAYER_TO_UV_PARTS` to bridge layer keys and UV part keys.

---

## 2. Skin Region Bounds

### Current State

Three separate definitions of "where things are on the skin":

| Source | Purpose | Format |
|--------|---------|--------|
| `skinLayout.ts` | `SKIN_LAYER_BOUNDS` | `Record<string, Bounds[]>` — layer → pixel rects |
| `skinLayout.ts` | `SKIN_PART_BOUNDS` | `{ part: string; bounds: Bounds[] }[]` — part → pixel rects |
| `skinPreprocess.ts` | `PRIMARY_REGIONS` | `[x, y, w, h][]` — primary-only, used for transparency replacement |
| `main.ts` | `MINECRAFT_SKIN_UVS` | UV coordinates (0–1) per mesh/part |

### Problems

1. **PRIMARY_REGIONS vs SKIN_LAYER_BOUNDS**: Body in `PRIMARY_REGIONS` is `[16, 16, 16, 16]`; in `SKIN_LAYER_BOUNDS` body is `{ x: 16, y: 16, w: 24, h: 16 }`. Different coverage.
2. **Incomplete primary set**: `PRIMARY_REGIONS` has 6 regions (head, body, legs, arms); no hat, jacket, sleeves, pants. That’s intentional (overlays keep transparency) but the relationship to `SKIN_LAYER_BOUNDS` is implicit.
3. **UV vs pixel**: `MINECRAFT_SKIN_UVS` is UV space; others are 64×64 pixel space. Conversions exist but the link between UV part keys and layer/part keys is ad hoc.

### Recommendation

1. Define **primary vs overlay** in the canonical model (e.g. `LayerKey` metadata).
2. Derive `PRIMARY_REGIONS` from `SKIN_LAYER_BOUNDS` for primary layers, or document why they diverge.
3. Centralize UV ↔ pixel conversion and ensure UV part keys map clearly to layer keys.

---

## 3. Coordinate Systems

### Current State

| Space | Size | Used For |
|-------|------|----------|
| **Norm / skin** | 0–63 (64×64) | Export, rulers, hover info (skinX, skinY) |
| **Working** | 0–127 (128×128) | Creator canvas, brush, flood fill |
| **Blocky cells** | 0–31 (32×32) | 2D grid cells |
| **UV** | 0–1 | Three.js texture sampling, raycast |

Conversions:

- `norm = floor(working / RESOLUTION_MULTIPLIER)` (2)
- `working = u * WORK_SIZE`, `v → (1-v) * WORK_SIZE`
- Blocky cell `(cx, cy)` → working `(cx * 2, cy * 2)`

### Problems

1. **Scattered constants**: `RESOLUTION_MULTIPLIER`, `WORK_SIZE`, `SKIN_SIZE` live in different modules; `getCreatorWorkSize()` is the only way main.ts gets `WORK_SIZE`.
2. **Ambiguous parameters**: Functions take "working" or "norm" coords without type distinction; bugs possible from wrong space.
3. **Scale factor duplication**: `workSize / 64` appears in main.ts; `RESOLUTION_MULTIPLIER` in creator.

### Recommendation

Introduce a **coordinate model**:

```ts
// src/skinCoordinates.ts
export const SKIN_SIZE = 64;
export const WORK_SIZE = 128;  // or SKIN_SIZE * RESOLUTION_MULTIPLIER
export const RESOLUTION_MULTIPLIER = WORK_SIZE / SKIN_SIZE;

export type SkinCoord = { x: number; y: number };  // 0–63
export type WorkingCoord = { x: number; y: number };  // 0–127

export function workingToSkin(w: WorkingCoord): SkinCoord;
export function skinToWorking(s: SkinCoord): WorkingCoord;
export function uvToWorking(u: number, v: number): WorkingCoord;
```

- Use branded types or names to avoid passing the wrong space.
- Centralize all conversion helpers here.

---

## 4. Catalog Types (Skin, Animation)

### Current State

```ts
// main.ts
type SkinEntry = { path: string; label: string; preview?: string };
type AnimationEntry = { path: string; key: string; label: string };

// creator.ts
type SkinEntry = { path: string; label: string; preview?: string };
```

`SkinEntry` is duplicated; `AnimationEntry` exists only in main.

### Problems

1. API response shapes (`/wardrobe/skins/index.json`, `/animations/index.json`) are not typed; structure can drift.
2. Creator and main both fetch/use skins; shared type would enforce consistency.

### Recommendation

- Define `SkinEntry` and `AnimationEntry` in a shared module, e.g. `src/types/catalog.ts`.
- Optionally add `as const` or Zod schemas for runtime validation of API responses.

---

## 5. Mesh-to-Skin Mapping

### Current State

`_getMinecraftPartFromMeshName(name: string)` in main.ts uses string heuristics:

```ts
if (n.includes('head') && !n.includes('hat') && !n.includes('layer')) return 'head';
if (n.includes('hat') || (n.includes('head') && (n.includes('layer'))) return 'hat';
// ... armR, armL, sleeveR, sleeveL, legR, legL, pantsR, pantsL
```

Mesh names come from the FBX (e.g. RunningboyRig). The mapping is rigid and brittle.

### Problems

1. **Model-specific**: Different rigs (different mesh names) would need new heuristics.
2. **No schema**: No explicit mapping file; changes require code edits.
3. **Order-dependent**: Rule order can change which mesh matches which part.

### Recommendation

1. **Explicit mapping**: Maintain a config (e.g. JSON/TS) of `meshNamePattern → UVPartKey` per model.
2. **Model config**: Each character config specifies which mapping to use.
3. **Fallback**: Keep heuristics as fallback for unknown models, with a warning.

---

## 6. Color Representation

### Current State

- Hex strings: `#8b7355`, normalized via `toLowerCase()`, validated with `/^#[0-9a-f]{6}$/`.
- RGB tuples for canvas: `hexToRgb()`, `rgbToHex()`.
- HSVA for picker: `hexToHsva()`, `hsvaToHex()`.
- Swatch history: `string[]` of hex.

### Problems

1. **Validation scattered**: Regex and normalization repeated in several places.
2. **Alpha**: Most paths ignore alpha; eyedropper has `EYEDROPPER_ALPHA_THRESHOLD`; no shared color model.
3. **Serialization**: No formal schema if colors need to be saved/loaded.

### Recommendation (Lower Priority)

- Introduce a `Color` value type with `hex`, `rgb`, `hsva` accessors and validation.
- Use it for `currentColor` and swatch storage to ensure consistent validation and conversion.

---

## 7. Priority Recommendations

### High impact, lower effort

1. **Unify layer keys** ✅ — `LAYER_KEYS` and `TEXTURE_LAYER_KEYS` in `skinLayout.ts`; creator and main import from there.
2. **Shared catalog types** ✅ — `SkinEntry`, `AnimationEntry` in `src/types/catalog.ts`; main and creator import.
3. **Document coordinate spaces** ✅ — "Coordinate Spaces Reference" section in this doc; comment in creator.ts and skinLayout.ts.

### High impact, medium effort

4. **Canonical layer/part model** ✅ — `PART_TO_LAYER`, `LAYER_TO_UV_PARTS`, `partToLayer` in skinLayout.ts; creator uses `partToLayer` from skinLayout.
5. **Consolidate region bounds** ✅ — `PRIMARY_REGIONS` derived from `SKIN_LAYER_BOUNDS` for primary layers (head, body, arms, legs) in skinPreprocess.ts.
6. **Coordinate module** ✅ — `skinCoordinates.ts` with `SKIN_SIZE`, `WORK_SIZE`, `RESOLUTION_MULTIPLIER`, `SkinCoord`, `WorkingCoord`, `workingToSkin`, `skinToWorking`, `uvToWorkingCoords`; creator and main use it.

### Extensibility / future

7. **Mesh mapping config** ✅ — `meshPartMapping.ts` with `getMinecraftPartFromMeshName(meshName, modelPath)`, `registerMeshPartMapping()`, heuristic fallback for unknown models.
8. **Color value type** ✅ — `types/color.ts` with `Color` class, `normalizeHex`, `isValidHex`, `hexToRgb`, `rgbToHex`, `hexToHsva`, `hsvaToHex`, `adjustHexBrightness`; creator uses it.

---

---

## Coordinate Spaces Reference

| Space | Size | Units | Used For |
|-------|------|-------|----------|
| **Norm / skin** | 64×64 | 0–63 | Export PNG, rulers (labels 0–64), hover info `skinX`/`skinY`, `SKIN_LAYER_BOUNDS` |
| **Working** | 128×128 | 0–127 | Creator canvas, brush, flood fill, `getImageData`/`putImageData`, UV→pixel in `uvToWorkingCoords` |
| **Blocky cells** | 32×32 | 0–31 | 2D grid cell indices `(cx, cy)`; each cell = 2×2 working pixels |
| **UV** | 0–1 | float | Three.js texture sampling, raycast hit UVs |

**Conversions:**
- `norm = floor(working / RESOLUTION_MULTIPLIER)` where `RESOLUTION_MULTIPLIER = 2`
- `workingX = floor(u * WORK_SIZE)`, `workingY = floor((1 - v) * WORK_SIZE)` (flipY)
- Blocky `(cx, cy)` → working `(cx * 2, cy * 2)`

**Constants:** `SKIN_SIZE`, `WORK_SIZE`, `RESOLUTION_MULTIPLIER` in `skinCoordinates.ts`. `skinLayout` re-exports `SKIN_SIZE`. `getCreatorWorkSize()` returns WORK_SIZE.

---

## References

- `src/skinLayout.ts` — `SKIN_LAYER_BOUNDS`, `SKIN_PART_BOUNDS`, `SKIN_DEAD_ZONES`, `LAYER_KEYS`, `TEXTURE_LAYER_KEYS`, `PART_TO_LAYER`, `LAYER_TO_UV_PARTS`, `partToLayer`
- `src/skinCoordinates.ts` — `SKIN_SIZE`, `WORK_SIZE`, `RESOLUTION_MULTIPLIER`, `uvToWorkingCoords`, `workingToSkin`, `skinToWorking`
- `src/skinPreprocess.ts` — `PRIMARY_REGIONS` derived from `SKIN_LAYER_BOUNDS`
- `src/main.ts` — `MINECRAFT_SKIN_UVS`; imports `getMinecraftPartFromMeshName` from meshPartMapping
- `src/meshPartMapping.ts` — `getMinecraftPartFromMeshName`, `registerMeshPartMapping`, `KNOWN_MODELS`
- `src/types/color.ts` — `Color`, `normalizeHex`, `isValidHex`, `hexToRgb`, `rgbToHex`, `hexToHsva`, `hsvaToHex`, `adjustHexBrightness`
- `src/creator.ts` — `LAYER_GROUPS`; imports from skinLayout, skinCoordinates
- `docs/minecraft-skin-layout-specification.md` — Authoritative layout reference
