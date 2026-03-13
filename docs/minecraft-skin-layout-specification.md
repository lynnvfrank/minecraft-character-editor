# Minecraft Skin Layout — Positional Specification

**Purpose:** Reference document for troubleshooting skin texture mapping issues and for translating skins between different layout formats (e.g., 64×64 ↔ 64×32, or custom formats).

**Canvas:** 64×64 pixels (modern skins). Origin (0,0) is top-left.
**Legacy:** Crop to 64×32 for pre-1.8 skins (upper half only).

---

## Legend

| Abbreviation | Meaning |
|--------------|---------|
| **R** | Right |
| **L** | Left |
| **L** (2nd letter) | Leg |
| **A** | Arm |
| **P** | Pants (outer layer of legs) |
| **S** | Sleeves (outer layer of arms) |
| **BT** | Bottom (as in TOP BT = top and bottom views) |

---

## Dead Zones / Non-Skin Zones (Reference Diagrams)

Reference diagrams (e.g., `minecraft-skin-layout-detailed.png`) often include **dead zones** — areas with black backgrounds and white text that contain meta-information, not actual skin texture data. These zones appear in layout guides for understanding and should be ignored when extracting or creating skin textures.

| Zone | Bounds (X, Y, W, H) | Purpose |
|------|---------------------|---------|
| **Top-left corner** | X: 0–7, Y: 0–7 (8×8) | Cropping instructions: how to extract the usable skin (crop to 64×64 for standard skins, or 64×32 for pre-1.8). |
| **Top-middle** | X: 24–39, Y: 0–7 (16×8) | Source/provenance: link to forum post or guide describing how skins work across Minecraft versions. |
| **Right-side legend** | X: 56–63, Y: 16–47 (8×32) | Abbreviation key: explains 1st letter (R/L = Right/Left), 2nd letter (L/A/P/S = Leg/Arm/Pants/Sleeves), BT = Bottom, plus disclaimer that the diagram is for comparison only, not a template. |

**Important:** Actual Minecraft skin PNG files (64×64) contain only texture data in the regions described in sections 1–12. Dead zones exist only in reference diagrams. When using a diagram as a guide, crop out or ignore these zones before creating or editing a skin.

**Implementation:** The character creator excludes dead zones from the template overlay and from the hover info panel (`—` is shown when the cursor is over a dead zone). See `SKIN_DEAD_ZONES` and `isInDeadZone()` in `src/skinLayout.ts`.

---

## 1. Head (Primary Layer)

**Region:** Upper-left quadrant
**Bounds:** X: 0–32, Y: 0–16
**Face size:** 8×8 pixels each

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP HEAD | 8 | 0 | 8 | 8 |
| BOTTOM HEAD | 16 | 0 | 8 | 8 |
| RIGHT HEAD | 0 | 8 | 8 | 8 |
| FACE HEAD (Front) | 8 | 8 | 8 | 8 |
| LEFT HEAD | 16 | 8 | 8 | 8 |
| BACK HEAD | 24 | 8 | 8 | 8 |

---

## 2. Hat (Outer Layer for Head)

**Region:** Upper-right quadrant
**Bounds:** X: 32–64, Y: 0–16
**Face size:** 8×8 pixels each

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP HAT | 40 | 0 | 8 | 8 |
| BOTTOM HAT | 48 | 0 | 8 | 8 |
| HAT RIGHT | 32 | 8 | 8 | 8 |
| FRONT HAT | 40 | 8 | 8 | 8 |
| HAT LEFT | 48 | 8 | 8 | 8 |
| HAT BACK | 56 | 8 | 8 | 8 |

---

## 3. Body (Primary Layer)

**Region:** Central area
**Bounds:** X: 16–32, Y: 16–32
**Top/Bottom:** 8×4 pixels | **Sides:** 4×12 (right/left) or 8×12 (front/back)

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP BODY | 20 | 16 | 8 | 4 |
| BOTTOM BODY | 28 | 16 | 8 | 4 |
| RIGHT BODY | 16 | 20 | 4 | 12 |
| FRONT BODY | 20 | 20 | 8 | 12 |
| LEFT BODY | 28 | 20 | 4 | 12 |
| BACK BODY | 32 | 20 | 8 | 12 |

---

## 4. Jacket (Outer Layer for Body)

**Region:** Below primary body
**Bounds:** X: 16–32, Y: 32–48
**Dimensions:** Same as Body

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP JACKET | 20 | 32 | 8 | 4 |
| BOTTOM JACKET | 28 | 32 | 8 | 4 |
| RIGHT JACKET | 16 | 36 | 4 | 12 |
| FRONT JACKET | 20 | 36 | 8 | 12 |
| LEFT JACKET | 28 | 36 | 4 | 12 |
| BACK JACKET | 32 | 36 | 8 | 12 |

---

## 5. Right Leg (RL) — Primary Layer

**Region:** Lower-left
**Bounds:** X: 0–16, Y: 16–32
**Top/Bottom:** 4×4 each | **Sides:** 4×12 each

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP RL | 4 | 16 | 4 | 4 |
| BOTTOM RL | 8 | 16 | 4 | 4 |
| RIGHT RL | 0 | 20 | 4 | 12 |
| FRONT RL | 4 | 20 | 4 | 12 |
| LEFT RL | 8 | 20 | 4 | 12 |
| BACK RL | 12 | 20 | 4 | 12 |

---

## 6. Right Pants (RP) — Outer Layer for Right Leg

**Region:** Below Right Leg
**Bounds:** X: 0–16, Y: 32–48
**Dimensions:** Same as Right Leg

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP RP | 4 | 32 | 4 | 4 |
| BOTTOM RP | 8 | 32 | 4 | 4 |
| RIGHT RP | 0 | 36 | 4 | 12 |
| FRONT RP | 4 | 36 | 4 | 12 |
| LEFT RP | 8 | 36 | 4 | 12 |
| BACK RP | 12 | 36 | 4 | 12 |

---

## 7. Left Leg (LL) — Primary Layer

**Region:** Lower-middle
**Bounds:** X: 16–32, Y: 48–64
**Dimensions:** Same as Right Leg

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP LL | 20 | 48 | 4 | 4 |
| BOTTOM LL | 24 | 48 | 4 | 4 |
| RIGHT LL | 16 | 52 | 4 | 12 |
| FRONT LL | 20 | 52 | 4 | 12 |
| LEFT LL | 24 | 52 | 4 | 12 |
| BACK LL | 28 | 52 | 4 | 12 |

---

## 8. Left Pants (LP) — Outer Layer for Left Leg

**Region:** Below Right Pants / same column as Left Leg
**Bounds:** X: 0–16, Y: 48–64
**Dimensions:** Same as Right Pants

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP LP | 4 | 48 | 4 | 4 |
| BOTTOM LP | 8 | 48 | 4 | 4 |
| RIGHT LP | 0 | 52 | 4 | 12 |
| FRONT LP | 4 | 52 | 4 | 12 |
| LEFT LP | 8 | 52 | 4 | 12 |
| BACK LP | 12 | 52 | 4 | 12 |

---

## 9. Right Arm (RA) — Primary Layer

**Region:** Right of body
**Bounds:** X: 40–56, Y: 16–32
**Dimensions:** Same as Right Leg (4×4 top/bottom, 4×12 sides)

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP RA | 44 | 16 | 4 | 4 |
| BOTTOM RA | 48 | 16 | 4 | 4 |
| RIGHT RA | 40 | 20 | 4 | 12 |
| FRONT RA | 44 | 20 | 4 | 12 |
| LEFT RA | 48 | 20 | 4 | 12 |
| BACK RA | 52 | 20 | 4 | 12 |

---

## 10. Right Sleeves (RS) — Outer Layer for Right Arm

**Region:** Below Right Arm
**Bounds:** X: 40–56, Y: 32–48
**Dimensions:** Same as Right Arm

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP RS | 44 | 32 | 4 | 4 |
| BOTTOM RS | 48 | 32 | 4 | 4 |
| RIGHT RS | 40 | 36 | 4 | 12 |
| FRONT RS | 44 | 36 | 4 | 12 |
| LEFT RS | 48 | 36 | 4 | 12 |
| BACK RS | 52 | 36 | 4 | 12 |

---

## 11. Left Arm (LA) — Primary Layer

**Region:** Lower-right, right of Left Leg
**Bounds:** X: 32–48, Y: 48–64
**Dimensions:** Same as Right Arm

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP LA | 36 | 48 | 4 | 4 |
| BOTTOM LA | 40 | 48 | 4 | 4 |
| RIGHT LA | 32 | 52 | 4 | 12 |
| FRONT LA | 36 | 52 | 4 | 12 |
| LEFT LA | 40 | 52 | 4 | 12 |
| BACK LA | 44 | 52 | 4 | 12 |

---

## 12. Left Sleeves (LS) — Outer Layer for Left Arm

**Region:** Far lower-right
**Bounds:** X: 48–64, Y: 48–64
**Dimensions:** Same as Left Arm

| Face | X | Y | Width | Height |
|------|---|---|-------|--------|
| TOP LS | 52 | 48 | 4 | 4 |
| BOTTOM LS | 56 | 48 | 4 | 4 |
| RIGHT LS | 48 | 52 | 4 | 12 |
| FRONT LS | 52 | 52 | 4 | 12 |
| LEFT LS | 56 | 52 | 4 | 12 |
| BACK LS | 60 | 52 | 4 | 12 |

---

## Transparency Rules

Skins may contain transparent pixels. For consistent rendering, apply different rules by layer:

| Layer | Parts | Transparency |
|-------|-------|--------------|
| **Primary** | Head, Body, Right Leg, Left Leg, Right Arm, Left Arm | Transparent pixels are replaced with a solid color (e.g. black). No transparency. |
| **Overlay** | Hat, Jacket, Right Pants, Left Pants, Right Sleeves, Left Sleeves | Transparency is allowed and preserved. |

**Primary regions** (transparency → solid fill): Head (0–32, 0–16), Body (16–32, 16–32), Right Leg (0–16, 16–32), Left Leg (16–32, 48–64), Right Arm (40–56, 16–32), Left Arm (32–48, 48–64).

**Overlay regions** (transparency allowed): Hat (32–64, 0–16), Jacket (16–32, 32–48), Right Pants (0–16, 32–48), Left Pants (0–16, 48–64), Right Sleeves (40–56, 32–48), Left Sleeves (48–64, 48–64).

---

## Troubleshooting Checklist

When skin material is not laying on the model correctly:

1. **Canvas size** — Confirm the texture is exactly 64×64 (or 64×32 for legacy). Upscaling/downscaling can shift UV coordinates.
2. **Origin** — Ensure your UV coordinates treat (0,0) as top-left and (1,1) as bottom-right, or convert as needed.
3. **Face orientation** — Verify the 3D model’s UV mapping matches this layout (front, back, left, right, top, bottom).
4. **Layer overlap** — Secondary layers (Hat, Jacket, Pants, Sleeves) sit on top of primary layers; check render order and alpha.
5. **Slim vs Classic arms** — Some models use 3px-wide arms vs 4px; arm regions (RA, RS, LA, LS) may need adjustment.
6. **BACK BODY / BACK JACKET** — These start at X=32, overlapping the left edge of the right half; confirm no clipping.

---

## Translation Notes

For converting between formats:

- **64×32 → 64×64:** Use the top half (Y: 0–32). The bottom half (Y: 32–64) contains only secondary layers; primary layers duplicate or are absent in 64×32.
- **64×64 → 64×32:** Crop to Y: 0–32. You lose secondary layers (Hat, Jacket, Pants, Sleeves).
- **Custom UV sets:** Map each region by its pixel bounds. Normalize to 0–1 by dividing X by 64 and Y by 64 (flip Y if needed for your coordinate system).
- **Region boundaries:** Use the tables above to copy regions; pixel-perfect bounds avoid bleeding and seams.

---

## Quick Reference: Region Bounds (X, Y, W, H)

| Part | X | Y | W | H |
|------|---|---|---|---|
| Head | 0 | 0 | 32 | 16 |
| Hat | 32 | 0 | 32 | 16 |
| Body | 16 | 16 | 24 | 16 |
| Jacket | 16 | 32 | 24 | 16 |
| Right Leg | 0 | 16 | 16 | 16 |
| Right Pants | 0 | 32 | 16 | 16 |
| Left Leg | 16 | 48 | 16 | 16 |
| Left Pants | 0 | 48 | 16 | 16 |
| Right Arm | 40 | 16 | 16 | 16 |
| Right Sleeves | 40 | 32 | 16 | 16 |
| Left Arm | 32 | 48 | 16 | 16 |
| Left Sleeves | 48 | 48 | 16 | 16 |

---

## RunningboyRig Model (This Project)

The viewer uses `RunningboyRig.fbx`, a Minecraft-style character model from Mixamo. The model's overlay layer geometry does **not** follow the Minecraft convention of offsetting overlays slightly outward from the base.

### Actual Mesh Structure

The model has only **3 meshes**, not 12:

| Mesh name    | Role                                   | UVs (U, V)         |
|--------------|----------------------------------------|--------------------|
| `Character`  | Base: head, body, arms, legs combined  | U [0, 0.875], V [0, 1] |
| `Steve_Hat`  | Hat overlay                            | U [0.5, 1], V [0.75, 1] |
| `2nd_Layer`  | Combined overlay: jacket, sleeves, pants | U [0, 1], V [0, 0.5] |

There are no separate meshes for jacket, sleeves, or pants. The `2nd_Layer` mesh uses different UV regions to sample the jacket, sleeves, and pants areas from the skin texture.

### Current Behavior

| Part | Offset in model? | Result |
|------|------------------|--------|
| Hat (`Steve_Hat`) | Yes | Renders correctly, slightly above the head |
| Jacket, sleeves, pants (`2nd_Layer`) | No | Same geometry as base — overlays coplanar with body/arms/legs, poor visibility |

### Minecraft Overlay Convention

Per Minecraft's skin specification:

- **Hat**: 0.5 pixels larger than base head per dimension (~6% scale)
- **Body, arms, legs overlays**: 0.25 pixels larger per dimension (~2.5–6% scale)

### Work Required to Fix in the Model

To properly fix this, the FBX must be edited in a 3D tool (Blender, Maya, 3ds Max):

1. **Inspect the hat mesh (`Steve_Hat`)** — Note how it is positioned/scaled relative to the head (it already has the correct offset).
2. **Apply similar treatment to `2nd_Layer`:**
   - The `2nd_Layer` mesh contains jacket, sleeves, and pants as one combined mesh. Scale it slightly larger (e.g. ~1.02–1.06 on each axis) so it sits just outside the base `Character` geometry.
   - Use "shrinkwrap" or "solidify" along normals for vertex-level displacement, or a simple uniform scale from the mesh pivot — whichever matches the hat's construction.
3. **Keep UV mapping** — Ensure `2nd_Layer` still uses UVs U [0, 1], V [0, 0.5] to sample the correct skin regions.
4. **Rigging** — The `2nd_Layer` mesh must remain skinned to the same bones as `Character`.

### Runtime Workaround

The code includes an optional **overlay scale** step that scales the `2nd_Layer` mesh by a small factor (e.g. 1.03) at render time. This can be toggled on/off. The `Steve_Hat` mesh is never scaled or reset — it already has correct offset from the model. This workaround is a stopgap; fixing the model geometry is the proper solution.

---

## Implementation Reference

This section documents how the skin rendering is implemented in code. Use it when returning to the project or when Cursor needs context.

### File Locations

| File | Purpose |
|------|---------|
| `src/main.ts` | Scene setup, model loading, skin application, config |
| `src/skinPreprocess.ts` | Texture preprocessing (primary-region transparency → solid fill) |

### Skin Load Flow

1. **Load** — `THREE.TextureLoader` loads the skin PNG.
2. **Preprocess** — `preprocessSkinTexture()` (from `skinPreprocess.ts`) replaces transparent pixels with a solid color in primary regions only. Overlay regions keep transparency.
3. **Apply** — `applySkinToModel()` assigns texture to all meshes, sets render order, applies overlay scale workaround, configures material (alpha mode, etc.).

Both `loadCharacter` (initial load) and `switchSkin` (skin change) use this flow.

### Config Options (main.ts)

| Constant | Location | Purpose |
|----------|----------|---------|
| `USE_DEBUG_TEXTURE` | main.ts ~L58 | If true, use a debug grid texture instead of the skin |
| `OVERLAY_SCALE.enabled` | main.ts ~L65 | Toggle overlay scale workaround for `2nd_Layer` |
| `OVERLAY_SCALE.factor` | main.ts ~L66 | Scale factor (e.g. 1.03) for `2nd_Layer` when enabled |
| `LOG_MODEL_INFO` | main.ts | When true, log mesh names and UV bounds on model load; default false |
| `buildCharacterConfig` | main.ts | Sets `texturePreset: 'clamped-flip'`, `alphaMode: 'transparent'` |

### Config Options (skinPreprocess.ts)

| Export | Purpose |
|--------|---------|
| `SKIN_PREPROCESS_CONFIG.enabled` | Set false to skip preprocessing (pass texture through) |
| `SKIN_PREPROCESS_CONFIG.replacementColor` | Hex (0x000000) or CSS string for transparent pixels in primary regions |
| `SKIN_PREPROCESS_CONFIG.alphaThreshold` | Pixels with alpha below this (0–255) are replaced; default 127 |

### Mesh Name Detection

`_getMinecraftPartFromMeshName(meshName)` maps mesh names to body parts using substring matching (lowercase, alphanumeric only):

- `hat` → hat
- `jacket` or `body`+`layer` → jacket
- `sleeve`+`r/l` → sleeveR / sleeveL
- `pant`+`r/l` → pantsR / pantsL
- `head` (no hat/layer) → head
- `body` (no layer) → body
- `arm` (no sleeve) + left/right → armL / armR
- `leg` (no pant) + left/right → legL / legR

**Runningboy mapping:**
- `Character` → null (no match)
- `Steve_Hat` → `hat`
- `2nd_Layer` → null (no match)

`2nd_Layer` is detected separately: `meshName.toLowerCase().includes('2nd') && meshName.toLowerCase().includes('layer')`.

### Render Logic in applySkinToModel

1. **Render order** — Overlay meshes get `renderOrder = 1`, base get `0`. Overlay = `_getMinecraftPartFromMeshName` returns hat/jacket/sleeveR/sleeveL/pantsR/pantsL **or** `is2ndLayer` is true.
2. **Overlay scale** — Only when `OVERLAY_SCALE.enabled` and `is2ndLayer`: `mesh.scale.setScalar(OVERLAY_SCALE.factor)`. Other meshes (including `Steve_Hat`) are never scaled.
3. **Material** — Same texture and alpha mode applied to all meshes. `alphaMode: 'transparent'` sets `transparent: true`, `alphaTest: 0.1`, `depthWrite: true`, `side: DoubleSide`.

### MINECRAFT_SKIN_UVS Table

`main.ts` defines `MINECRAFT_SKIN_UVS` — normalized 0–1 UVs for 12 body parts (head, hat, body, jacket, armR, armL, sleeveR, sleeveL, legR, legL, pantsR, pantsL). This table is for models with separate meshes per part. **Runningboy uses a different layout** (3 meshes: Character, Steve_Hat, 2nd_Layer) and does not use this table for UV assignment; the FBX supplies UVs.

### Debugging

- **`logMeshNames(model, label)`** — Logs all mesh names on load. Check console for `[Runningboy] Mesh names: [...]`.
- **`logModelUVInfo(model, label)`** — Logs UV bounds per mesh. Use to verify texture sampling.

### Removing Features

- **Skin preprocessing:** Set `SKIN_PREPROCESS_CONFIG.enabled = false` in `skinPreprocess.ts`, or delete the file and remove the `preprocessSkinTexture()` call in `main.ts` (loadCharacter and switchSkin).
- **Overlay scale:** Set `OVERLAY_SCALE.enabled = false` in `main.ts`.

---

*Based on the standard Minecraft 64×64 skin layout. Diagram is for comparison; exact pixel boundaries may vary slightly by implementation.*
