# Feedback — 20 Mar 2026

Usability session notes with Mazi (12) and Arlo. Ordered by usability impact, then enhancements, then broader concepts.

---

## Issues (bugs / confusing behavior)

- **Creator button not visible** — Mazi and Arlo did not see the creator button.
- **Save has odd animation** — Save flow still shows weird animation.
- **Toolbar / tool icons unclear** — Tool bar button icons are not clear; tool buttons need better affordance.
- **Undo/back placement** — Undo/back controls need better positioning.
- **Swatch history reshuffle** — Moving a previous swatch to the front reshuffles the history; instead, keep order and avoid adding a duplicate.
- **Hard to paint between legs** — Difficult to paint between the legs in frozen position.
- **Difficult to draw in 3D mode** — Legs and bottom side of head are especially hard to reach.

---

## Usability enhancements (high priority)

### Discoverability and feedback

- **Lock feedback** — When drawing on a locked layer, show feedback: flash the lock icon and wiggle the layer slightly.
- **Skin color sampling** — Sample skin color from the model when it’s opened, instead of starting from scratch.

### Camera and view

- **3D on-screen camera controls** — Add on-screen buttons to move/rotate the 3D camera (physical controls instead of only mouse).
- **Physical camera controls** — Allow moving the camera at an angle around the frozen character.
- **Wardrobe mode views** — (1) “Follow the outfit” — camera tracks selected part; (2) “Static zoomed out” — fixed view that never tracks.

### 2D view

- **Hidden layers** — When layers are hidden: collapse the view, show a note about hidden parts, or make them visible in some way.
- **2D camera focus** — When layers are hidden, focus the camera on the visible part.
- **3D camera to paint location** — Animate the 3D camera toward where paint is placed.

### Animation and modes

- **Character stops in 3D mode** — Character should stop animating in 3D edit mode.
- **Idle in wardrobe mode** — Use idle (non-dance) animation in wardrobe mode.
- **Animation states per mode** — Each mode should have appropriate animation states.

### Drawing tools

- **Mirror mode** — Add mirror mode when drawing (paint to both sides).
- **Color palette** — Make the color palette larger.
- **Color panel order** — Lead with skin color swatches, then highlight/shadow, then color wheel and swatch history.

### Character identity

- **Name the character** — Let users give the character a name.

---

## Enhancements (medium priority)

- **Progressive disclosure** — Unlock outfit pieces as users select different outfits; outerwear later; body parts first.
- **“Level up” moment** — Character stops dancing and new controls appear when the user is ready.
- **Group body parts and outerwear** — Separate body parts from outerwear in the UI.
- **Doll shape for layers** — Use a doll/mannequin shape for the layer panel.
- **Seed skins** — Seed initial skins to show body vs. outerwear contrast.

---

## Bigger concepts (lower priority)

- **Mannequin mode** — Shopping outer layers with blank face, solid color characters, possibly computed.
- **Runway mode** — Watch outfits go by, emote to react, earn outfits through participation.
- **Progressive unlock UX** — Lock some features behind operations, always with a bypass; unlock via engagement.
- **Mode as scene** — Modes can contain submodes; treat modes as scenes. Consider Babylon.js for richer scene/mode handling.

---

## Positive feedback

- Mazi said it was fun.
- Mazi understood the layers idea quickly.
- Locks made sense once explained; lock feedback would help before explanation.
- Skin color swatches are a strong starting point for the color panel.
