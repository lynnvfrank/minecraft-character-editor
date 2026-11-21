# Skin features: hair, eyes, skin and clothing as separate pieces

## The goal

Let someone pick **hair**, **eyes**, **skin tone** and **clothing** separately, each from any skin, instead of the
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
| Hair | Hair on the head (inner layer and hat layer), and long hair on the body. |
| Eyes | Eyes, brows, lashes, mouth and other face details on the front of the head. |
| Clothing | Clothes, shoes, hats and accessories. |
| (untagged) | Transparent or unused texels. |

Maps are **metadata beside the skin**, never baked into it. A map starts as an automatic guess from the Make it me
detectors, and a person corrects it by painting tags in the 2D and 3D editors. Once a skin is tagged, everything that
needs to know "what is hair here" reads the tags instead of guessing.

## Phase 1: tags and the tagging tool (built)

- **`src/styler/featureMap.ts`** is pure and tested (`featureMap.test.ts`).
  - The tag model, plus the skin layout tables: used texels, overlay texels and the face.
  - `autoTagFeatures` makes the first guess from the existing detectors: hair, body hair, skin, and face pixels that
    are neither hair nor skin. Every other painted texel becomes clothing.
  - Run-length encoding keeps a map to about 1 KB, for storage and export.
  - `composeFeatures` builds one skin from up to four sources. Its rules are listed under "Mixing rules" below.
- **`src/creator/featureTagsStore.ts`** keeps tags in localStorage.
  - Tags are keyed by a hash of the skin's pixels, so they follow the picture rather than its file name.
  - The store also exports and imports all tags as one JSON file.
- **Feature tags panel** (`src/creator/featureTagsPanel.ts`, top of the right column in 2D and 3D):
  - Brushes for Hair, Eyes, Skin, Clothing and Untag, in Pixel or Fill-similar mode.
  - Picking a brush tints the skin by tag; painting on the model or the grid changes tags. Each stroke saves.
  - The real skin is put back when you press Done or Esc, switch mode, pick a color tool, press Ctrl+Z / Ctrl+Y /
    Ctrl+S, or click elsewhere.
  - When a tagged skin is lightly repainted (under 400 pixels changed), its tags carry over to the new picture.
  - Re-guess drops your edits for the skin. Export and Import share tag work.
- **Make it me uses the tags.** `styleSkin` takes `tags` (`skinStyler.ts`). For a tagged skin, recoloring hair, skin
  and outfit uses exactly the tagged pixels instead of detection.

### Mixing rules (`composeFeatures`)

The clothing skin is the base. The other features are laid onto it in this order:

1. **Eyes** win on the front of the head.
2. **Hair** comes next.
3. **Clothing** follows.
4. The rest of the inner layer becomes **skin**:
   - It uses the skin source's own pixel where that pixel is tagged skin, which keeps its shading.
   - Elsewhere it uses the source's median tone, shaded like the pixel it replaces.
5. Leftover overlay texels are cleared, so unchosen hair or clothing doesn't linger.

## Phase 2: mix and match in the Wardrobe

- A **Pieces** view with four pickers (Hair, Eyes, Skin, Clothing). Each picker lists skins and shows that one feature
  cut out on a thumbnail.
- Picking one recomposes the character with `composeFeatures`, which is a single 64×64 pass and fast enough to run on
  every hover.
- Each picker only lists skins that are tagged, or that have good enough guesses (see Phase 3). An "untagged" badge
  sends the person to the tag tool.
- Lock my look then becomes "keep these pieces": hair, eyes and skin stay put while you browse outfits.

## Phase 3: ship tags for the built-in wardrobe

- Tag the wardrobe skins (currently 112) with the tool, export them, and commit the file as
  `public/wardrobe/feature-tags.json`.
- Load it as default tags. Your own tags override it.
- Use a script to report which wardrobe skins have no shipped tags.

## Phase 4: quality

- Brush sizes, plus a "mirror left/right" option, since most faces and outfits are symmetric.
- **Eye placement:** move eyes to the target face's eye row. `makeFaceTemplate` already finds an eye anchor.
- **Arm width:** slim and classic arms use different texel columns. Map tags between the two shapes when sources
  differ.
- **Stacking choices:** hair over a hat or a hat over hair, and long hair over or under a jacket.
- Maybe split clothing into **clothes** and **accessories** (hats, glasses, bows) so they can be mixed separately.
- Tag-aware hover previews, and an "untagged pixels" highlight to find gaps quickly.
