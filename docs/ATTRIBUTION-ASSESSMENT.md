# Attribution & Licensing Assessment

_Assessed 2026-11-13 against branch `feat/schematic-props`. Not legal advice — a working inventory to decide what can ship._

Scope: everything bundled into or used to build the app **except player skins** (skins will not ship in the product and are tracked separately).

## Summary

| Area | Status | Risk for a public release |
|------|--------|---------------------------|
| npm libraries (runtime + build) | All permissive (MIT / BSD / ISC-style / Apache-2.0) | **Low** — just needs notices (done in the in-app About panel) |
| Electron / Chromium | MIT, plus Chromium's bundled third-party licenses | **Low** — electron-builder ships `LICENSES.chromium.html` |
| Mixamo animations (42 clips) | Adobe Mixamo terms | **Low–Medium** — packed into one GLB; raw FBX no longer shipped |
| Running Boy character rig (3 FBX) | Downloaded from a free model site (owner recalls a permissive / MIT-style license), auto-rigged on Mixamo | **Low–Medium** — record the source URL and license text |
| UI icons | Lucide (ISC); wardrobe icons original | **Low** |
| Schematic props | **Removed** (purchased schematics, not redistributable; also used Minecraft textures) | None — reverted |
| "Minecraft" name / skin format | Mojang trademark | **Medium** — needs the "not affiliated" disclaimer |

## 1. Software libraries

Licenses confirmed from installed `node_modules/*/package.json`.

### Shipped in the app (runtime)

| Package | Version | License | Used for |
|---------|---------|---------|----------|
| three | 0.165.0 | MIT | 3D rendering; also `FBXLoader`, `GLTFLoader`, `OrbitControls` from `three/examples` (same MIT license) |
| @tweenjs/tween.js | 25.0.0 | MIT | Camera / UI tweens |
| xstate | 5.30.0 | MIT | Character state machines |
| socket.io / socket.io-client | 4.8.3 | MIT | Local control channel |
| express | 4.22.1 | MIT | Local server (`server/`) |
| electron | 33.4.11 | MIT | Desktop shell (bundles Chromium, Node.js — their notices ship with the build) |
| electron-store | 10.1.0 | MIT | Desktop settings |

### Dev / tooling only (not shipped)

vite (MIT), sass (MIT), typescript (Apache-2.0), tsx (MIT), electron-builder (MIT), puppeteer (Apache-2.0), canvas (MIT), cross-env (MIT).


**Action:** none beyond the About panel listing. All are permissive; MIT/BSD require keeping the copyright notice, which the full license text in `node_modules` and the About panel cover.

## 2. Animations — Adobe Mixamo

- **What:** 42 FBX clips, sources now in `assets-src/animations/` (idle, walk, turns, emotes, sit/stand, etc.), downloaded "Without Skin" and retargeted to the Running Boy rig.
- **Terms:** Mixamo characters and animations are royalty-free for personal, commercial and non-profit projects (games, films, apps). You **may not** redistribute or sell the animation files themselves as standalone assets.
- **Was:** the build copied these as plain `.fbx` files anyone could pull out of the app folder.
- **Now:** `scripts/pack-animations.mjs` (run by `npm run assets:generate`) packs every clip into `public/animations/animations.glb` (~2.3 MB vs ~9 MB of FBX), with clips on a bare node set and no mesh. Only the GLB ships; `assets-src/` is outside `public/` and never reaches `dist`.
- **Actions:**
  1. Credit "Animations by Adobe Mixamo" in the About panel (done).
  2. Pack the clips into one GLB so they aren't drop-in reusable FBX assets (done).
  3. Requires an Adobe account in good standing for whoever downloaded them; keep a note of which account.

## 3. Character model — Running Boy rig

- **What:** `public/models/RunningboyRig.fbx`, `RunningboyRig-Zeroed.fbx`, `RunningboyRigSlim.fbx` (the slim one is a local modification).
- **Provenance:** Downloaded from a free model website. The owner recalls a permissive license (MIT-style, no copyleft), then uploaded it to Mixamo only to auto-rig it so Mixamo animations fit. Mixamo's auto-rig doesn't change who owns the mesh.
- **Remaining gap:** The source URL and the exact license text haven't been written down yet. The model also copies the Minecraft player proportions and UV layout, which is common practice.
- **Actions:**
  1. Record the download URL, author and license here and in the About panel (still shows "source to be confirmed").
  2. If the license asks for attribution (e.g. CC-BY), credit the author by name.

## 4. UI icons — Lucide (replaced SVG Repo)

- **Now:** the 19 creator/home icons in `src/creator/icons/mode.creator*.svg` and `mode.home.svg` are copied from **Lucide** (`lucide-static` 1.72.0, ISC license). The license text is in `src/creator/icons/LICENSE-lucide.txt`, and each SVG keeps its `@license` header. The unused `mode.placeholder.svg` was deleted.
- **Before (2026-11-13):** these were 20 SVG Repo downloads with mixed licenses. About 8 looked like CC BY sets (Solar Icons, CoreUI) and 12 couldn't be identified, so they were replaced rather than cleared one by one.
- **Wardrobe icons:** the 15 `mode.wardrobe.*` icons have no SVG Repo marking and are treated as original.
- **Mapping:** home→house, creator→palette, keep→bookmark-plus, save→download, visible→eye, hidden→eye-off, lock→lock, unlock→lock-open, navigate→hand, pencil→pencil, eraser→eraser, brush→paintbrush, fill→paint-bucket, dropper→pipette, undo→undo-2, redo→redo-2, wardrobe→shirt, 2D→grid-3x3, 3D→box.

## 5. Scene props — removed

The schematic props (commit 9741365) were removed. The schematics were purchased and aren't the owner's to distribute, and their textures came from the Minecraft client jar. **Note:** the commit was already pushed to `origin/feat/schematic-props`, so the GLBs stay in that branch's history. If the branch is squash-merged, they won't reach `main`; to scrub them fully, rewrite the branch history before it is merged.

## 6. Trademarks

- "Minecraft" is a Mojang Synergies AB / Microsoft trademark. The product name *Blockygotchi* is fine; avoid "Minecraft" in the product name or icon.
- **Action:** Include the standard disclaimer — "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft." (included in the About panel).

## 7. Skins (out of scope, noted for completeness)

Bundled skins are for testing only and must be removed or replaced with legally sourced / original skins before release.

## Release checklist

- [x] In-app About panel listing libraries, assets, and the Mojang disclaimer
- [ ] Record Running Boy rig source URL and license text
- [x] Look up SVG Repo icon licenses (8 likely CC BY, 12 unidentified)
- [x] Replace the SVG Repo icons with Lucide (ISC)
- [x] Remove schematic props
- [x] Pack the Mixamo clips into a single GLB
- [ ] Move script-only packages to `devDependencies`
- [ ] Remove test skins
