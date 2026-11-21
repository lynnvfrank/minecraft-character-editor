# Skin features: hair, eyes, skin and outfit as separate pieces

## The goal

Let someone pick **hair**, **eyes**, **skin tone** and **outfit** separately, each from any skin, instead of the
Wardrobe's body-part layers (head, hat, torso, jacket, arms, sleeves, legs, pants).

The layers model swaps whole regions of the texture. That works for "this head on that body", but not for "her hair,
his eyes, my skin, that outfit". Hair runs down the back and over the shoulders, a jacket covers some of the arm, and
eyes sit at different heights on each face. Skins are drawn by artists in endless ways, and nothing in a skin file
says which pixel is what.

## The approach: a feature map per skin

Each skin gets a **feature map**: one tag per pixel of the 64×64 texture, saying whether the pixel is

| Tag | Covers |
| --- | --- |
| Skin | Bare skin. Shown in the wearer's tone when looks are mixed. |
| Hair | Hair wherever it falls: the head and hat layer, and long hair down the back, torso, arms or legs. |
| Eyes | Eyes, brows, lashes, mouth and other face details on the front of the head. |
| Outfit | The whole costume: clothes, shoes, hats, flowers, bows and anything else worn. |
| (untagged) | Transparent or unused texels. |

Tags can go on any texel. Hair in particular isn't confined to the head: in many skins it runs down the torso and even
the legs, and it's drawn in every style imaginable. Detection only finds the common cases (head, shoulders, upper
back), so the tool is built for people to paint what they see. A person's eye is the reliable source of what each
pixel is; the guess is only a head start.

Maps are **metadata beside the skin**, never baked into it. A map starts as an automatic guess from the styler's
detectors, and a person corrects it by painting tags in the 2D and 3D editors. Once a skin is tagged, everything that
needs to know "what is hair here" reads the tags instead of guessing.

## Phase 1: tags and the tagging tool (built)

- **`src/styler/featureMap.ts`** is pure and tested (`featureMap.test.ts`).
  - The tag model, plus the skin layout tables: used texels, overlay texels and the face.
  - `autoTagFeatures` makes the first guess from the existing detectors: hair, body hair, skin, and face pixels that
    are neither hair nor skin. Every other painted texel becomes outfit.
  - Run-length encoding keeps a map to about 1 KB, for storage and export.
  - `composeFeatures` builds one skin from up to four sources. Its rules are listed under "Mixing rules" below.
- **`src/creator/featureTagsStore.ts`** keeps tags in localStorage.
  - Tags are keyed by a hash of the skin's pixels, so they follow the picture rather than its file name.
  - The store also exports and imports all tags as one JSON file.
- **Feature tags panel** (`src/creator/featureTagsPanel.ts`, top of the right column in 2D and 3D):
  - Brushes for Hair, Eyes, Skin, Outfit and Untag, in Pixel or Fill-similar mode.
  - Picking a brush tints the skin by tag; painting on the model or the grid changes tags. Each stroke saves.
  - The real skin is put back when you press Done or Esc, switch mode, pick a color tool, press Ctrl+Z / Ctrl+Y /
    Ctrl+S, or click elsewhere.
  - When a tagged skin is lightly repainted (under 400 pixels changed), its tags carry over to the new picture.
  - Re-guess drops your edits for the skin. Export and Import share tag work.
- **Tagging library skins** (`src/creator/tagSession.ts`): "Tag this skin" in Me, or "Tag library skins" in the
  Feature tags panel, opens a session in the 2D/3D editor:
  - Your character (its canvas, skin and undo history) is set aside, and the raw library skin shows as it really is,
    with no Me and no outfit.
  - A bar along the top steps through the library: previous / next / next untagged. It also has **Original** to hide
    the tag colors, and **Back to my character**, which puts your character back exactly as it was.
  - Switching to Me or the Wardrobe, or leaving Design, also ends the session and restores the character first.

### Mixing rules (`composeFeatures`)

The outfit skin is the base. The other features are laid onto it in this order:

1. **Eyes** win on the front of the head.
2. **Hair** comes next.
3. **Outfit** follows.
4. The rest of the inner layer becomes **skin**:
   - It uses the skin source's own pixel where that pixel is tagged skin, which keeps its shading.
   - Elsewhere it uses the source's median tone, shaded like the pixel it replaces.
5. Leftover overlay texels are cleared, so unchosen hair or outfit doesn't linger.

## Phase 2: Me, then the Wardrobe (built)

Design starts in **Me**, where a person designs themself. The **Wardrobe** then dresses that Me in outfits.

- **Me tab** (`src/creator/mePanel.ts`, the first mode of Design):
  - Rows for **Hair**, **Eyes** and **Skin**. Each is a **style** (any skin in the library, or "Outfit's own") plus an
    optional **color**.
  - Selecting a row shows that feature's **style catalog** on the right: every skin with just that feature cut out of
    it by its tags (`drawCutout`). Hair shows on a faint head and shoulders, eyes on a plain face, and skin with its
    own shading. Skins with none of a feature are left out.
  - Hover a style to preview it, click to keep it. The shared color picker colors the selected feature, and × goes
    back to the style's own colors.
  - **Arms** (Auto / Slim / Classic) live in Me too. Slim or Classic converts every outfit's and style's arm textures
    to that shape (`src/skin/armConvert.ts`), so any outfit fits. Auto leaves each outfit as it is.
  - "Tag this skin" opens the selected style's skin in 3D with that feature's tag brush, to fix how it's cut out.
- **Dressing** (`src/styler/meLook.ts` `dressMe`, `src/creator/me.ts` `applyMe`) is the Wardrobe's final pass:
  - The outfit's own hair, face and skin are replaced by Me's styles.
  - Each feature is then recolored on exactly its own pixels. Skin keeps its shading, and hair keeps its highlights.
    Eyes change only their colored iris pixels, not the whites, lashes or mouth.
  - Me stays on through every outfit and part picked in the Wardrobe, and in the Me tab it shows on the current outfit.
- Styles are read the same way the editor loads skins, so tags painted in 2D/3D are found by pixel hash. Untagged
  skins use the automatic guess, which is cached. Me is remembered in localStorage.
- Later, **outfits may override Me** through outfit metadata. For example, a helmet hides the hair, and a costume can
  say "hair goes inside". Today hair is always drawn over the outfit.
- Still to do: mark hand-tagged skins in the catalogs, and remove duplicate styles. Many skins share the same base.

## Phase 3: ship tags for the built-in wardrobe

- Tag the wardrobe skins (currently 112) with the tool, export them, and commit the file as
  `public/wardrobe/feature-tags.json`.
- Load it as default tags. Your own tags override it.
- Use a script to report which wardrobe skins have no shipped tags.

## Phase 4: quality

- Brush sizes, plus a "mirror left/right" option, since most faces and outfits are symmetric.
- **Eye placement:** move eyes to the target face's eye row. `makeFaceTemplate` already finds an eye anchor.
- **Stacking choices:** hair over a hat or a hat over hair, and long hair over or under a jacket.
- Tag-aware hover previews, and an "untagged pixels" highlight to find gaps quickly.

## Phase 5: split the outfit

An outfit is more than clothing. It also carries flowers, bows and other costume pieces, and its clothes come apart
too: a two-piece swimsuit has a top and a bottom. Outfit could gain sub-tags, so pieces of different outfits can be
mixed the way hair and eyes are now:

- **Top**, **bottom**, **shoes**, **headwear** (hats, flowers, bows) and **accessories** (glasses, jewellery, belts).
- Untagged outfit pixels stay plain "outfit", so existing tags keep working. The stored letter for outfit stays `c`,
  and each sub-tag gets a new letter.
- The Pieces panel then gains Top / Bottom / Shoes / Headwear rows. Each takes only that sub-tag from its source and
  leaves the rest of the outfit alone.
