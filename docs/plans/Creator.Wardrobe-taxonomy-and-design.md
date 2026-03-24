# Creator.Wardrobe

The goal is to create a consistent taxonomy of the parts of the character model. Combine part of the character model into groups to enable more displayable layers that allow better viewing and modifying.

## Taxonomy

The parts of the model have been identified with names used on the text labels up this point. As the application grows there is a need to have more consistent taxonomy to describe body parts and collections of body parts.

These are the body parts that are important to recognize now. In the future more parts may be added to this taxonomy, with their own boundaries defined to enable specific customizations (For example: eyes)

The body parts are expressed with the taxonomy name, `body.all` and the user facing name (Full Outfit). When the body part represents other body parts those are listed after the colon.

- body.hat (Hat) -> currently Hat
- body.head (Head) -> currently Head
- body.vest (Vest) -> currently Jacket
- body.chest (Chest) -> currently Body
- body.sleeves (Sleeves) -> currently Sleeves
- body.arms (Arms) -> currently Arms
- body.pants (Pants) -> currently Pants
- body.legs (Legs) -> currently Legs
- body.torso (Torso): body.chest, body.arms
- body.jacket (Jacket): body.vest, body.sleeves
- body.bottom (Lower Body): body.pants, body.legs
- body.center (Upper Body): body.jacket, body.chest, body.sleeves, body.arms
- body.top (Head): body.hat, body.head
- body.all (Full Outfit): body.top, body.center, body.bottom

There are other parts already defined with folders

## Reference Update

This document [docs/minecraft-skin-layout-specification.md](docs/minecraft-skin-layout-specification.md) needs these new parts added to it and to the taxonomy. Define the new parts. Express their bounds. Reference the other parts in that file but express the bounds for these boundaries all the same.

## Wardrobe Update

These new parts need to be generated. Read this
[scripts/generate-wardrobe-parts.ts](scripts/generate-wardrobe-parts.ts) add the camera configuration information. When picking the camera configuration choose one of them. Prioritize picking the:

- body.head when it has a body.head, body.helmet, body.torso, body.top
- body.chest when it has a body.chest, body.jacket, body.arms, body.sleeves, body.vest, body.center, body.torso
- body.legs when it has body.legs, body.pants, body.bottom

## Mode: Creator.Wardrobe

In the layer panel, display the layers in this hierarchical structure.

- body.all
  - body.top
    - body.head
    - body.hat
  - body.center
    - body.jacket
      - body.vest
      - body.sleeves
    - body.torso
      - body.chest
      - body.arms
  - body.bottom
    - body.pants
    - body.legs

- Display each with a placeholder image "src/creator/mode.placeholder.svg
- Display next to the image the label text
- Use indenting to indicate the hierarchy
- Each layer is expandable and collapsible
- Layers default to collapsed
- Expanded layers remain expanded until the user collapses them

When the body.all layer is selected:

- the right side panel displays the the body.all panel (currently called Full Outfit panel)
- body.all expands and the body.top, body.center, and body.bottom layers are displayed

When the body.top layer is selected:

- Add the body.hat panel (currently called Head panel) to the top-right panel group and display that panel with an animation
- Add the body.helmet panel (currently called Hat panel) to the bottom-right panel group and display that panel with an animation
- The upper-right and lower-right panel groups should split 100% of the right side with a small gap in-between them
- When moving from displaying the body.head layer to body.top layer
  - the body.head panel shrinks in size to 50%
  - the body.hat panel is added to the lower-right panel group with the size 50% and appears with an animation
  - there is a small gap in-between them
- When moving from displaying the body.hat layer to body.top layer
  - the body.hat panel shrinks in size to 50%
  - the body.head panel is added to the upper-right panel group with the size 50% and appears with an animation
  - there is a small gap in-between them

When the body.head layer is selected:

- Add the body.head panel (currently called Head panel) to the top-right panel group and display that panel with an animation
- When moving from displaying the body.top layer to body.head layer
  - the body.hat panel group leaves the screen with an animation
  - the body.head panel group grows in size to take up 100% of the right-side

When the body.hat layer is selected:

- Add the body.hat panel (currently called Hat panel) to the top-right panel group and display that panel with an animation
- When moving from displaying the body.top layer to body.hat layer
  - the body.head panel group leaves the screen with an animation
  - the body.hat panel group grows in size to take up 100% of the right-side

When the body.center is selected:

- Add the body.torso panel to the top-right panel group and display that panel with an animation
- Add the body.body panel to the bottom-right panel group and display that panel with an animation
- The upper-right and lower-right panel groups should split 100% of the right side with a small gap in-between them
- When moving from displaying the body.head layer to body.top layer
  - the body.head panel shrinks in size to 50%
  - the body.hat panel is added to the lower-right panel group with the size 50% and appears with an animation
  - there is a small gap in-between them
- When moving from displaying the body.hat layer to body.top layer
  - the body.hat panel shrinks in size to 50%
  - the body.head panel is added to the upper-right panel group with the size 50% and appears with an animation
  - there is a small gap in-between them
