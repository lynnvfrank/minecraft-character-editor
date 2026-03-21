Create a new panel that appears on in all creator modes. It is displayed as the first panel in the upper-left panel group. It has three buttons:

- Save (conditionally enabled/disabled)
- Upload (disabled for now)
- Download

The Undo / Redo panel needs to be made into its own panel. In Creator.3D and Creator.2D mode it appears below the tools panel as it does now. For the Creator.Wardrobe mode it will now appear when the mode is selected.

When in Creator.Wardrobe mode and the user selects an option from Full Outfit, Hat, Head, Jacket, Body, Sleeves, Arms, Pants, and Legs it sends an event that the skin has been modified (dirty).

An skin modified event includes the operation that was performed. At the moment
