# Feedback — 20 Mar 2026

Usability session notes with Mazi (12) and Arlo (8). Ordered by usability impact, then enhancements, then broader concepts.

---

## Issues (bugs / confusing behavior)

- **✅ Creator button not visible** — Mazi and Arlo did not see the creator button.
- **✅ Save has odd animation** — Save flow still shows weird animation.
- **✅ Toolbar / tool icons unclear** — Tool bar button icons are not clear; tool buttons need better affordance.
- **✅ Undo/back placement** — Undo/back controls need better positioning.
- **✅ Swatch history reshuffle** — Moving a previous swatch to the front reshuffles the history; instead, keep order and avoid adding a duplicate.
- **✅ Hard to paint between legs** — Difficult to paint between the legs in frozen position.
- **✅ Difficult to draw in 3D mode** — Between Legs
- **✅ Difficult to draw in 3D mode** — Bottom of the Legs, hands, and head are hard to reach and there is no go lighting to show it.

---

## Usability enhancements (high priority)

### Creator Discoverability and feedback

- **✅** **Lock feedback** — When drawing on a locked layer, show feedback: flash the lock icon and wiggle the layer slightly.
- **✅ Skin color sampling** — Sample skin color from the model when it’s opened, instead of starting from scratch.
- **✅** Creator.Wardrobe - when selecting "No Head" or any no option it does not actually mean none. It goes back to what was on the skin. Sometimes users want to remove the hat and have it deleted. Need to add No hat and current hat, then the possible choices

### Creator Drawing tools

- **✅ Starting draw color** - set to one from the skin if one has not been chosen by the user
- **Mirror mode** — Add mirror mode when drawing (paint to both sides).
- **✅ Color palette** — Make the color palette larger.

### Creator Camera and view

- **✅** **3D on-screen camera controls** — Add on-screen buttons to move/rotate the 3D camera (physical controls instead of only mouse).
- **✅** **Physical camera controls** — Allow moving the camera at an angle around the frozen character.

### Character identity

- ⬜️ **Name the character** — Let users give the character a name.

---

## Enhancements (medium priority)

- ⬜️ **Creator.2D Skin swatches** - updates more often than at the start
- ⬜️ **Progressive disclosure** — Unlock outfit pieces as users select different outfits; outerwear later; body parts first.
- ⬜️ **“Level up” moment** — Character starts dancing and new controls appear progressively
- ⬜️  **Group body parts and outerwear** — Separate body parts from outerwear in the UI.
- ⬜️  **Doll shape for layers** — Use a doll/mannequin shape for the outerwear panel phots (models with a color that constrasts the choice: white to black or the traditional pick color that games have used).
- ⬜️  Undo/Redo visual history. The panel for undo/redo "creator-undo-redo-panel" could have a draw to pop out that lets you see the skin at various stages. It could also show each of the operations
  - brush [color] (x,y)
  - erase (x,y)
  - fill [color] (x,y)
- ⬜️  **Color panel order** — progressive disclosure: Lead with skin color swatches, then highlight/shadow, then color wheel and swatch history.
- ⬜️ **Wardrobe mode views** — (1) “Follow the outfit” — camera tracks selected part; (2) “Static zoomed out” — fixed view that never tracks.

### Creator.2D view

- ⬜️ **Hidden layers** — When layers are hidden: collapse the view, show a note about hidden parts, or make them visible in some way.
- ⬜️ **2D camera focus** — When layers are hidden, focus the camera on the visible part.
- ⬜️ **3D camera to paint location** — Animate the 3D camera toward where paint is placed.

---

## Bigger concepts (lower priority)

- ⬜️  **Seed skins** — Seed initial skins to show body vs. outerwear contrast.
- ⬜️  **Mannequin mode** — Shopping outer layers with blank face, solid color characters, possibly computed.
- ⬜️  **Runway mode** — Watch outfits go by, emote to react, earn outfits through participation.
- ⬜️  **Progressive unlock UX** — Lock some features behind operations, always with a bypass; unlock via engagement.\

---

## Positive feedback

- Mazi said it was fun.
- Mazi understood the layers idea quickly.
- Locks made sense once explained; lock feedback would help before explanation.
- Skin color swatches are a strong starting point for the color panel.
