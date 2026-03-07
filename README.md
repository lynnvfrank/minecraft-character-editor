# Minecraft 3D Character Viewer

A web application that renders a Minecraft-style character in 3D with interchangeable skins and animations. Built with Three.js, TypeScript, and Vite.

---

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown in your terminal (typically `http://localhost:5173`). Click the animation buttons at the bottom to switch between animations. Use your mouse to orbit, zoom, and pan the camera.

To build for production:

```bash
npm run build
npm run preview
```

---

## Project Structure

```
minecraft-3d-viewer/
├── index.html                          # HTML shell with animation buttons
├── package.json                        # Dependencies: Three.js, Vite, TypeScript
├── tsconfig.json                       # TypeScript config (ES2020, strict)
├── vite.config.ts                      # Vite build config
├── src/
│   ├── main.ts                         # Application entry — scene, loading, animation
│   └── style.css                       # Layout and button styles
├── public/
│   ├── models/
│   │   └── RunningboyRig.fbx           # Base character rig
│   ├── animations/
│   │   ├── Bored-RunningboyRig.fbx     # Animation: Bored
│   │   ├── Crying-RunningboyRig.fbx    # Animation: Crying
│   │   └── ...                         # More FBX animations (auto-indexed)
│   └── skins/
│   │   ├── RunningboyRig.png           # Default skin
│       ├── skin-anime1.png             # Alternate skin: Anime style 1
│       ├── skin-anime2.png             # Alternate skin: Anime style 2
│       └── skin-anime3.png             # Alternate skin: Anime style 3
└── docs/
    ├── minecraft-skin-layout-specification.md  # Pixel-level skin region reference
    ├── minecraft-skin-layout-detailed.png      # Annotated skin layout diagram
    └── minecraft-skin-64x64-detailed.png       # 64×64 grid layout diagram
```

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| 3D Rendering | Three.js | ^0.165.0 |
| Language | TypeScript | ^5.6.0 |
| Build Tool | Vite | ^6.0.0 |
| Model Format | FBX (Autodesk) | — |
| Skin Format | PNG (64×64 pixels) | — |

---

## How the Code Works

### Scene Setup (`initScene`)

- Creates a Three.js scene with a dark background (`#050710`)
- Sets up a perspective camera at position (0, 1.5, 5) looking at (0, 1, 0)
- Enables WebGL rendering with antialiasing and PCF soft shadows
- Adds OrbitControls for mouse-driven camera movement
- Adds hemisphere light (ambient) and directional light (sun-like, with shadows)
- Adds a circular ground plane

### Character Loading (`loadCharacter`)

1. Loads the skin texture PNG via `THREE.TextureLoader`
2. Loads the base model FBX via `FBXLoader` — `RunningboyRig.fbx`
3. Scales the model to 0.01 (FBX exports at centimeter scale)
4. Applies the skin texture to all mesh materials with:
   - `NearestFilter` — preserves pixel-art crispness
   - `ClampToEdgeWrapping` with `flipY = true`
   - Transparent alpha mode for proper rendering of skin layers
5. Loads all 7 animation FBX files
6. Creates `AnimationAction` instances from each clip
7. Selects "bored" as the default idle animation

### Animation System

- Uses `THREE.AnimationMixer` for playback
- `fadeToAction()` cross-fades between animations over 0.5 seconds
- Each animation button in the UI triggers a fade to that animation
- The active button gets a highlight style

### Texture Configuration

The skin texture uses Minecraft's standard 64×64 pixel layout. The code includes a full UV mapping table (`MINECRAFT_SKIN_UVS`) that maps each body part to its pixel region on the texture. Key settings:

- **Nearest-neighbor filtering** — keeps the blocky pixel-art look sharp
- **Clamped wrapping** — prevents texture bleeding at edges
- **Flip Y** — converts between image coordinates (top-left origin) and OpenGL coordinates (bottom-left origin)

---

## The Model: RunningboyRig.fbx

The character model is a Minecraft-style humanoid rig in FBX format. It was created for use with Mixamo animations.

**Key properties:**
- Format: FBX (Autodesk interchange format)
- Scale: Exported at centimeter scale (code applies 0.01 multiplier)
- UV mapping: Configured for a standard 64×64 Minecraft skin texture
- Skeleton: Compatible with Mixamo's auto-rigger for animation retargeting

The model meshes are named by body part (head, body, arms, legs) with UV coordinates that map to the standard Minecraft skin layout regions.

---

## Skins

Skins are 64×64 pixel PNG images following the Minecraft skin format. The texture is divided into labeled regions for each body part.

### Skin Layout Overview

The 64×64 texture is divided into regions for 12 body parts across two layers:

**Primary layer (inner):**
- Head (8×8 per face) — top-left quadrant
- Body (8×12 front/back, 4×12 sides) — center
- Right Leg, Left Leg (4×12 per face)
- Right Arm, Left Arm (4×12 per face)

**Overlay layer (outer):**
- Hat — overlay on head
- Jacket — overlay on body
- Right Pants, Left Pants — overlay on legs
- Right Sleeves, Left Sleeves — overlay on arms

### Quick Reference: Region Bounds (X, Y, W, H)

| Part | X | Y | W | H |
|------|---|---|---|---|
| Head | 0 | 0 | 32 | 16 |
| Hat | 32 | 0 | 32 | 16 |
| Body | 16 | 16 | 16 | 16 |
| Jacket | 16 | 32 | 16 | 16 |
| Right Leg | 0 | 16 | 16 | 16 |
| Right Pants | 0 | 32 | 16 | 16 |
| Left Leg | 16 | 48 | 16 | 16 |
| Left Pants | 0 | 48 | 16 | 16 |
| Right Arm | 40 | 16 | 16 | 16 |
| Right Sleeves | 40 | 32 | 16 | 16 |
| Left Arm | 32 | 48 | 16 | 16 |
| Left Sleeves | 48 | 48 | 16 | 16 |

For the complete pixel-level specification with individual face coordinates, see `docs/minecraft-skin-layout-specification.md`.

### Included Skins

| File | Description |
|------|-------------|
| `RunningboyRig.png` | Default skin applied on load |
| `skin-anime1.png` | Alternate anime-style skin |
| `skin-anime2.png` | Alternate anime-style skin |
| `skin-anime3.png` | Alternate anime-style skin |

### Skin Layout Reference Images

Two annotated reference images are included in `docs/`:

- **`minecraft-skin-layout-detailed.png`** — Large annotated diagram showing all body part regions with labels for each face (front, back, left, right, top, bottom), color-coded by body part. Includes a legend for abbreviations (R=Right, L=Left, A=Arm, P=Pants, S=Sleeves, etc.).

- **`minecraft-skin-64x64-detailed.png`** — Compact 64×64 pixel grid showing the same layout at actual resolution.

---

## Animations

All animations are stored as separate FBX files containing only skeletal animation data (no mesh/skin). They were downloaded from [Mixamo](https://www.mixamo.com) using the `RunningboyRig.fbx` as the character rig.

### Included Animations

| File | Key | Description |
|------|-----|-------------|
| `Bored-RunningboyRig.fbx` | bored | Idle bored stance (default) |
| `Crying-RunningboyRig.fbx` | crying | Crying motion |
| `Laughing-RunningboyRig.fbx` | laughing | Laughing motion |
| `Shrugging-RunningboyRig.fbx` | shrugging | Shrug gesture |
| `Happy-RunningboyRig.fbx` | happy | Happy celebration |
| `NinjaIdle-RunningboyRig.fbx` | ninja-idle | Ninja idle stance |
| `BlowAKiss-RunningboyRig.fbx` | blow-a-kiss | Blow a kiss gesture |

### Naming Convention

Animation files follow the pattern: `AnimationName-RunningboyRig.fbx`

The `key` used in code is a lowercase, hyphenated version of the animation name (e.g., `BlowAKiss` → `blow-a-kiss`).

---

## Adding New Animations (via Mixamo)

[Mixamo](https://www.mixamo.com) is a free Adobe service that provides thousands of motion-captured animations.

### Steps

1. **Go to Mixamo:** Navigate to [https://www.mixamo.com](https://www.mixamo.com)
2. **Login / Create an account:** Use an Adobe ID (free)
3. **Upload your character rig:**
   - Click "Upload Character" in the top right
   - Upload `public/models/RunningboyRig.fbx`
   - Mixamo will auto-rig it and show a preview
4. **Search for animations:**
   - Use the search bar on the left to browse animations (e.g., "wave", "dance", "run")
   - Click an animation to preview it on your character
5. **Configure the animation:**
   - Use the sliders on the right panel to adjust:
     - **Overdrive** — speed/intensity of the motion
     - **Character Arm-Space** — how close arms are to the body
     - **Trim** — start/end frames
   - Preview until you're happy with the result
6. **Download the animation:**
   - Click "Download"
   - Set **Format** to `FBX Binary (.fbx)`
   - Set **Skin** to `Without Skin` (animation data only)
   - Click "Download"
7. **Add to the project:**
   - Rename the downloaded file to follow the naming convention: `AnimationName-RunningboyRig.fbx`
   - Move it to `public/animations/`
8. Animations are auto-indexed on startup. Run `npm run dev` or `npm run build` — the new animation appears in the animation buttons. No code changes are required.

---

## Auto-discovering Skins

Skins are auto-discovered from `public/skins/`. When you add a `.png` file:

1. Run `npm run dev` or `npm run build` — a pre-step runs `scripts/generate-skins-manifest.js`, which scans for `.png` files and writes `public/skins/index.json`
2. The new skin appears in the skin selector as a clickable preview thumbnail
3. No code changes are required

Run `npm run generate-skins` manually to regenerate the manifest without starting the dev server.

---

## Creating / Finding Skins (via NovaSkin)

[NovaSkin](https://minecraft.novaskin.me) is an online Minecraft skin editor and gallery.

### Steps

1. **Go to NovaSkin:** Navigate to [https://minecraft.novaskin.me](https://minecraft.novaskin.me)
2. **Login / Create an account:** Sign in with a Minecraft or Google account
3. **Search for a skin:**
   - Use the search/gallery to browse community-created skins
   - Filter by style, theme, or character
4. **Select a skin:**
   - Click on a skin to open it in the editor
   - Preview it on the 3D model in the editor
5. **Save the skin:**
   - Click the download/save button to export as a 64×64 PNG
   - The file must be exactly 64×64 pixels to work correctly
6. **Give it a name:**
   - Name the file (e.g., `skin-tiger.png`, `skin-fairy.png`)
7. **Download the skin:**
   - Once it has a name the download buttons appear.
7. **Add to the project:**
   - Move the PNG file to `public/skins/`
   - When the server starts up it indexes all the skins and adds them to a list of available skins

### Alternative Skin Sources

- [NameMC](https://namemc.com/minecraft-skins) — Browse and download player skins
- [Planet Minecraft](https://www.planetminecraft.com/skins/) — Large community skin gallery
- [Skindex](https://www.minecraftskins.com/) — Skin editor and gallery
- Any image editor — Create a 64×64 PNG following the layout in `docs/minecraft-skin-layout-specification.md`

---

## Troubleshooting

### Skin looks wrong on the model

1. **Check dimensions:** The texture must be exactly 64×64 pixels
2. **Check format:** Must be PNG with RGBA channels (alpha for transparency)
3. **UV orientation:** The code uses `flipY = true` — if a skin appears upside-down, the source may have been saved with a different origin convention
4. **Layer overlap:** Outer layers (hat, jacket, pants, sleeves) render on top of inner layers. Check that alpha/transparency is correct

### Animation doesn't play

1. **File format:** Must be FBX Binary format (not FBX ASCII or glTF)
2. **Rig compatibility:** The animation must target the same skeleton as `RunningboyRig.fbx`. Download from Mixamo with the same uploaded character
3. **Indexing:** Ensure the FBX file is in `public/animations/` and named `AnimationName-RunningboyRig.fbx`. Run `npm run generate-animations` to refresh the manifest.

### Model appears tiny or invisible

- The FBX model is exported at centimeter scale. The code applies `model.scale.setScalar(0.01)` to normalize to meters. If using a different model, adjust the scale factor accordingly

---

## License

The character rig and animations are sourced from Mixamo (Adobe). Skins are community-created or custom. Check individual asset licenses before redistribution.
