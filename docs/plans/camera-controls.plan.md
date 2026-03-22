
Implement a compact Camera Controls for the Creator.Wardrobe and Creator.3D modes.

# Position and button layout

The toolbar should be positioned at the top center of the 3D preview area.
The toolbar should be a simple horizontal row of buttons with clear text labels (no icons-only; include short, readable text on each button).
Exact Layout (horizontal row, centered)
Buttons from left to right:

## Left 45°

Text label: "Left 45°"
On click: Rotate the camera yaw left by 45 degrees (smooth tween, same easing).

## Pitch Up

Text label: "Pitch Up"
On click: Adjust camera pitch upward by 30 degrees (smooth tween).

## Zoom In

Text label: "Zoom In"
On click: Move closer to the character, shorten the camera distance (smooth tween, incremental step).
There are three zoom levels. Zoomed in once. Standard position. Zoomed out once.

## Recenter

Text label: "Recenter"
On click: Tween the camera to the default front-facing view (positioned slightly above and in front of the character, looking directly at it). Use the existing tween easing (e.g. cubicOut or expoOut), 400ms duration.

## Zoom Out

Text label: "Zoom Out"
On click: Move farther from the character, increase camera distance (smooth tween, incremental step).
There are three zoom levels. Zoomed in once. Standard position. Zoomed out once.

## Pitch Down

Text label: "Pitch Down"
On click: Adjust camera pitch downward by 30 degrees (smooth tween).

## Right 45°
Text label: "Right 45°"
On click: Rotate the camera yaw right by 45 degrees (smooth tween).

# Animation

Use a noticeable snap animation (e.g. BackOut or ElasticOut), 350ms duration.

# Behavior Requirements

All camera movements must use the project's existing tween library with the established snap/overshoot feel.
The 3D preview updates live and smoothly on every action.
Prevent button spam during tweens (brief disable or ignore additional clicks while animating).
Keyboard shortcuts will be added later
Add tooltips because I'm going to use icons later

# Implementation

Make the entire group a reusable component (e.g. CameraControls.tsx or equivalent). This may be used in other modes.
