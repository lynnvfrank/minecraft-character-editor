# Minecraft Skin — Artist & Agent Specification

**Purpose:**  
1. Give artists exact pixel boundaries for every body part when drawing skins.  
2. Enable AI agents to generate new Minecraft skins using tools like ImageMagick, applying color theory, fashion design patterns, and prints.

**Canvas:** 64×64 pixels. Origin (0,0) is top-left.  
**Output:** Standard Minecraft skin PNG (64×64).

---

## Part 1 — Artist Reference: Complete Pixel Boundaries

Every drawable region is defined by **X, Y, Width, Height** (0-indexed). Use these bounds when painting or placing pixels.

### Coordinate System
- **X:** 0 = left edge, 63 = right edge  
- **Y:** 0 = top edge, 63 = bottom edge  
- **Width/Height:** Pixel count in that dimension  
- **Region extent:** X ranges from `X` to `X + Width - 1`; Y from `Y` to `Y + Height - 1`

---

### 1. Head (Primary Layer)

**Overall bounds:** X 0–31, Y 0–15 (32×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 8 | 0 | 8 | 8 | X:8–15, Y:0–7 |
| Bottom | 16 | 0 | 8 | 8 | X:16–23, Y:0–7 |
| Right | 0 | 8 | 8 | 8 | X:0–7, Y:8–15 |
| Front | 8 | 8 | 8 | 8 | X:8–15, Y:8–15 |
| Left | 16 | 8 | 8 | 8 | X:16–23, Y:8–15 |
| Back | 24 | 8 | 8 | 8 | X:24–31, Y:8–15 |

**Artist note:** Head faces are 8×8. Front is the main face. Top/bottom are the crown and chin. Right/left/back wrap around the head.

---

### 2. Hat (Outer Layer — Overlay)

**Overall bounds:** X 32–63, Y 0–15 (32×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 40 | 0 | 8 | 8 | X:40–47, Y:0–7 |
| Bottom | 48 | 0 | 8 | 8 | X:48–55, Y:0–7 |
| Right | 32 | 8 | 8 | 8 | X:32–39, Y:8–15 |
| Front | 40 | 8 | 8 | 8 | X:40–47, Y:8–15 |
| Left | 48 | 8 | 8 | 8 | X:48–55, Y:8–15 |
| Back | 56 | 8 | 8 | 8 | X:56–63, Y:8–15 |

**Artist note:** Hat overlays the head. Transparency is allowed (holes, visors, etc.). Same 8×8 face layout as head.

---

### 3. Body (Primary Layer)

**Overall bounds:** X 16–39, Y 16–31 (24×16 px total span)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 20 | 16 | 8 | 4 | X:20–27, Y:16–19 |
| Bottom | 28 | 16 | 8 | 4 | X:28–35, Y:16–19 |
| Right | 16 | 20 | 4 | 12 | X:16–19, Y:20–31 |
| Front | 20 | 20 | 8 | 12 | X:20–27, Y:20–31 |
| Left | 28 | 20 | 4 | 12 | X:28–31, Y:20–31 |
| Back | 32 | 20 | 8 | 12 | X:32–39, Y:20–31 |

**Artist note:** Body is the torso/shirt base. Front and back are 8×12; sides are 4×12; top/bottom are 8×4. No transparency in primary layer.

---

### 4. Jacket (Outer Layer — Overlay)

**Overall bounds:** X 16–39, Y 32–47 (24×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 20 | 32 | 8 | 4 | X:20–27, Y:32–35 |
| Bottom | 28 | 32 | 8 | 4 | X:28–35, Y:32–35 |
| Right | 16 | 36 | 4 | 12 | X:16–19, Y:36–47 |
| Front | 20 | 36 | 8 | 12 | X:20–27, Y:36–47 |
| Left | 28 | 36 | 4 | 12 | X:28–31, Y:36–47 |
| Back | 32 | 36 | 8 | 12 | X:32–39, Y:36–47 |

**Artist note:** Jacket overlays the body. Transparency allowed (hoods, open jackets, etc.).

---

### 5. Right Leg (Primary Layer)

**Overall bounds:** X 0–15, Y 16–31 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 4 | 16 | 4 | 4 | X:4–7, Y:16–19 |
| Bottom | 8 | 16 | 4 | 4 | X:8–11, Y:16–19 |
| Right | 0 | 20 | 4 | 12 | X:0–3, Y:20–31 |
| Front | 4 | 20 | 4 | 12 | X:4–7, Y:20–31 |
| Left | 8 | 20 | 4 | 12 | X:8–11, Y:20–31 |
| Back | 12 | 20 | 4 | 12 | X:12–15, Y:20–31 |

**Artist note:** Legs are 4×4 top/bottom, 4×12 sides. Right leg is on the left side of the texture (player's right).

---

### 6. Right Pants (Outer Layer — Overlay)

**Overall bounds:** X 0–15, Y 32–47 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 4 | 32 | 4 | 4 | X:4–7, Y:32–35 |
| Bottom | 8 | 32 | 4 | 4 | X:8–11, Y:32–35 |
| Right | 0 | 36 | 4 | 12 | X:0–3, Y:36–47 |
| Front | 4 | 36 | 4 | 12 | X:4–7, Y:36–47 |
| Left | 8 | 36 | 4 | 12 | X:8–11, Y:36–47 |
| Back | 12 | 36 | 4 | 12 | X:12–15, Y:36–47 |

---

### 7. Left Leg (Primary Layer)

**Overall bounds:** X 16–31, Y 48–63 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 20 | 48 | 4 | 4 | X:20–23, Y:48–51 |
| Bottom | 24 | 48 | 4 | 4 | X:24–27, Y:48–51 |
| Right | 16 | 52 | 4 | 12 | X:16–19, Y:52–63 |
| Front | 20 | 52 | 4 | 12 | X:20–23, Y:52–63 |
| Left | 24 | 52 | 4 | 12 | X:24–27, Y:52–63 |
| Back | 28 | 52 | 4 | 12 | X:28–31, Y:52–63 |

---

### 8. Left Pants (Outer Layer — Overlay)

**Overall bounds:** X 0–15, Y 48–63 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 4 | 48 | 4 | 4 | X:4–7, Y:48–51 |
| Bottom | 8 | 48 | 4 | 4 | X:8–11, Y:48–51 |
| Right | 0 | 52 | 4 | 12 | X:0–3, Y:52–63 |
| Front | 4 | 52 | 4 | 12 | X:4–7, Y:52–63 |
| Left | 8 | 52 | 4 | 12 | X:8–11, Y:52–63 |
| Back | 12 | 52 | 4 | 12 | X:12–15, Y:52–63 |

---

### 9. Right Arm (Primary Layer)

**Overall bounds:** X 40–55, Y 16–31 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 44 | 16 | 4 | 4 | X:44–47, Y:16–19 |
| Bottom | 48 | 16 | 4 | 4 | X:48–51, Y:16–19 |
| Right | 40 | 20 | 4 | 12 | X:40–43, Y:20–31 |
| Front | 44 | 20 | 4 | 12 | X:44–47, Y:20–31 |
| Left | 48 | 20 | 4 | 12 | X:48–51, Y:20–31 |
| Back | 52 | 20 | 4 | 12 | X:52–55, Y:20–31 |

---

### 10. Right Sleeves (Outer Layer — Overlay)

**Overall bounds:** X 40–55, Y 32–47 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 44 | 32 | 4 | 4 | X:44–47, Y:32–35 |
| Bottom | 48 | 32 | 4 | 4 | X:48–51, Y:32–35 |
| Right | 40 | 36 | 4 | 12 | X:40–43, Y:36–47 |
| Front | 44 | 36 | 4 | 12 | X:44–47, Y:36–47 |
| Left | 48 | 36 | 4 | 12 | X:48–51, Y:36–47 |
| Back | 52 | 36 | 4 | 12 | X:52–55, Y:36–47 |

---

### 11. Left Arm (Primary Layer)

**Overall bounds:** X 32–47, Y 48–63 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 36 | 48 | 4 | 4 | X:36–39, Y:48–51 |
| Bottom | 40 | 48 | 4 | 4 | X:40–43, Y:48–51 |
| Right | 32 | 52 | 4 | 12 | X:32–35, Y:52–63 |
| Front | 36 | 52 | 4 | 12 | X:36–39, Y:52–63 |
| Left | 40 | 52 | 4 | 12 | X:40–43, Y:52–63 |
| Back | 44 | 52 | 4 | 12 | X:44–47, Y:52–63 |

---

### 12. Left Sleeves (Outer Layer — Overlay)

**Overall bounds:** X 48–63, Y 48–63 (16×16 px)

| Face | X | Y | W | H | Pixel range (inclusive) |
|------|---|---|---|---|------------------------|
| Top | 52 | 48 | 4 | 4 | X:52–55, Y:48–51 |
| Bottom | 56 | 48 | 4 | 4 | X:56–59, Y:48–51 |
| Right | 48 | 52 | 4 | 12 | X:48–51, Y:52–63 |
| Front | 52 | 52 | 4 | 12 | X:52–55, Y:52–63 |
| Left | 56 | 52 | 4 | 12 | X:56–59, Y:52–63 |
| Back | 60 | 52 | 4 | 12 | X:60–63, Y:52–63 |

---

### Transparency Rules

| Layer type | Parts | Transparency |
|------------|-------|--------------|
| **Primary** | Head, Body, Right Leg, Left Leg, Right Arm, Left Arm | No transparency. Replace transparent pixels with solid color (e.g. skin tone or black) or avoid leaving them empty. |
| **Overlay** | Hat, Jacket, Right Pants, Left Pants, Right Sleeves, Left Sleeves | Transparency allowed. Use for holes, visors, open jackets, shorts, cuffs, etc. |

---

## Part 2 — Agent Instructions: Programmatic Skin Generation

This section is for AI agents that generate Minecraft skins using ImageMagick or similar tools.

### Workflow

1. **Read this spec** — Use the pixel boundaries above.
2. **Define a color palette** — Apply color theory (see below).
3. **Choose patterns** — Solids, stripes, checks, prints (see below).
4. **Build ImageMagick commands** — Fill regions, apply patterns, composite.
5. **Output** — 64×64 PNG, optionally starting from a transparent or solid base.

### Color Theory for Skins

| Scheme | Use case | Example |
|--------|----------|---------|
| **Complementary** | High contrast, striking | Red + green, blue + orange |
| **Analogous** | Cohesive, smooth | Blue, teal, green |
| **Triadic** | Balanced, vibrant | Red, yellow, blue |
| **Split-complementary** | Less harsh than complementary | Blue + orange + yellow |
| **Monochromatic** | Single hue, tints/shades | Light blue → dark blue |
| **Tetradic** | Bold, four colors | Red, green, blue, yellow |
| **Neutral + accent** | Easy to read | Gray/white/black + one bright color |

**Skin tones:** Use warm browns/tans (#D4A574, #C68642, #8D5524) or cooler tones. Avoid pure gray for skin.

**Garment conventions:**
- Shirt (body/jacket): Often 1–2 colors, sometimes pattern.
- Pants: Often darker than shirt or contrasting.
- Hat: Can match outfit or be accent.
- Sleeves: Usually match shirt/jacket; cuffs can differ.

### Fashion Design Patterns

| Pattern | Description | How to apply in ImageMagick |
|---------|-------------|-----------------------------|
| **Solid** | Single flat color | `-fill #RRGGBB -draw "rectangle X,Y W,H"` |
| **Horizontal stripes** | Bands across | Create small stripe tile, then `-tile stripe.png -draw "rectangle X,Y W,H"` |
| **Vertical stripes** | Bands down | Same, rotate tile 90° |
| **Checkerboard** | Alternating squares | `-size 2x2 xc:#A xc:#B +append` pattern, then tile |
| **Diagonal stripes** | Angled bands | Small diagonal tile, repeat |
| **Plaid / tartan** | Overlaid stripes | Multiple stripe layers at different angles |
| **Polka dots** | Scattered circles | `-draw "circle X,Y X2,Y2"` in loop or tile |
| **Camo** | Irregular blobs | Multiple overlapping irregular shapes |
| **Gradient** | Smooth color transition | `-size WxH gradient:#A-#B` then composite into region |
| **Two-tone** | Top/bottom or left/right split | Two `rectangle` draws |
| **Trim/cuffs** | Different color on edges | Draw main fill, then overlay edge rectangles |

### Prints (Repeating Patterns)

Create a small pattern tile (e.g. 4×4, 8×8) and use ImageMagick `-tile` to repeat it across a region.

**Example patterns:**
- **Floral:** Small flower shapes, repeat.
- **Geometric:** Triangles, diamonds, hexagons.
- **Camouflage:** Organic blobs in 2–3 colors.
- **Paisley:** Teardrop shapes.
- **Tribal:** Lines and zigzags.
- **Star/confetti:** Scattered small shapes.

**ImageMagick tile workflow:**
```bash
# Create 4×4 pattern
convert -size 4x4 xc:none \
  -fill "#FF0000" -draw "rectangle 0,0 2,2" \
  -fill "#0000FF" -draw "rectangle 2,2 4,4" \
  pattern.png

# Apply to region (e.g. body front 20,20 8x12)
convert -size 64x64 xc:none result.png
convert result.png -tile pattern.png -draw "rectangle 20,20 28,32" result.png
```

### ImageMagick Command Reference

**Create blank skin (transparent):**
```bash
convert -size 64x64 xc:none skin.png
```

**Create blank skin (solid base, e.g. skin tone):**
```bash
convert -size 64x64 xc:'#D4A574' skin.png
```

**Fill a rectangular region with solid color:**
```bash
convert skin.png -fill '#RRGGBB' -draw "rectangle X,Y X+W-1,Y+H-1" skin.png
```
Note: ImageMagick `rectangle` uses top-left (X,Y) and bottom-right (X2,Y2). Use `X+W-1`, `Y+H-1` for inclusive bounds.

**Fill multiple regions (same color):**
```bash
convert skin.png -fill '#RRGGBB' \
  -draw "rectangle 20,20 28,32" \
  -draw "rectangle 16,20 20,32" \
  ... skin.png
```

**Create gradient and paste into region:**
```bash
convert -size 8x12 gradient:#FF0000-#0000FF gradient_body.png
convert skin.png gradient_body.png -geometry +20+20 -composite skin.png
```

**Create tiled pattern and apply:**
```bash
convert -size 4x4 pattern.png -write mpr:pat +delete
convert skin.png -tile mpr:pat -draw "rectangle 20,20 28,32" skin.png
```

### Region → ImageMagick Bounds (X,Y to X2,Y2)

For `rectangle X,Y X2,Y2`, use:
- **X2 = X + Width - 1**
- **Y2 = Y + Height - 1**

| Part | Region | draw "rectangle X,Y X2,Y2" |
|------|--------|----------------------------|
| Head front | 8,8 8×8 | 8,8 15,15 |
| Body front | 20,20 8×12 | 20,20 27,31 |
| Right leg front | 4,20 4×12 | 4,20 7,31 |
| Left leg front | 20,52 4×12 | 20,52 23,63 |
| Right arm front | 44,20 4×12 | 44,20 47,31 |
| Left arm front | 36,52 4×12 | 36,52 39,63 |
| Hat front | 40,8 8×8 | 40,8 47,15 |
| Jacket front | 20,36 8×12 | 20,36 27,47 |
| Right pants front | 4,36 4×12 | 4,36 7,47 |
| Left pants front | 4,52 4×12 | 4,52 7,63 |
| Right sleeve front | 44,36 4×12 | 44,36 47,47 |
| Left sleeve front | 52,52 4×12 | 52,52 55,63 |

### Complete Region List (X,Y,W,H) for Scripting

```text
# Primary layers (no transparency)
head_top:      8,0,8,8    head_bottom:   16,0,8,8   head_right:    0,8,8,8
head_front:    8,8,8,8    head_left:     16,8,8,8   head_back:     24,8,8,8
body_top:      20,16,8,4  body_bottom:   28,16,8,4  body_right:    16,20,4,12
body_front:    20,20,8,12 body_left:     28,20,4,12 body_back:     32,20,8,12
right_leg_*:   (see table section 5)
left_leg_*:    (see table section 7)
right_arm_*:   (see table section 9)
left_arm_*:    (see table section 11)

# Overlay layers (transparency allowed)
hat_*:         (see table section 2)
jacket_*:      (see table section 4)
right_pants_*: (see table section 6)
left_pants_*:  (see table section 8)
right_sleeve_*:(see table section 10)
left_sleeve_*: (see table section 12)
```

### Agent Checklist

1. [ ] Read all 12 body part boundaries from Part 1.
2. [ ] Pick a color scheme (complementary, analogous, etc.) and palette.
3. [ ] Decide which layers to use (primary only, or primary + overlays).
4. [ ] Choose pattern per layer (solid, stripes, plaid, etc.).
5. [ ] Build ImageMagick commands for each region.
6. [ ] Ensure primary regions have no transparency (fill with solid color).
7. [ ] Output 64×64 PNG.
8. [ ] Validate: load skin in a viewer; check seams and color consistency.

---

## Appendix: Quick Bounds Table (X, Y, W, H)

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

*Derived from `docs/minecraft-skin-layout-specification.md`. Use with ImageMagick, Python PIL/Pillow, or any pixel/region-based image tool.*
