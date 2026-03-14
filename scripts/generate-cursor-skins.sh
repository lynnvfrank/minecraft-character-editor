#!/bin/bash
# Generate 10 Minecraft skins: life, death, spring, winter themes
# Per docs/MINECRAFT-SKIN-ARTIST-AND-AGENT-SPEC.md
# Output: public/skins/skin-cursor-01.png through skin-cursor-10.png

set -e
OUTDIR="public/skins"
mkdir -p "$OUTDIR"

# Skin tone (warm brown per spec)
SKIN="#D4A574"
SKIN_DARK="#8D5524"
SKIN_LIGHT="#E8C4A0"

# Primary region draw helper: draw_primary file color
# We draw ALL primary regions. Rectangle: x1,y1 x2,y2 (x2=x1+w-1, y2=y1+h-1)
draw_primary_regions() {
  local f="$1"
  local c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 8,0 15,7"    -draw "rectangle 16,0 23,7" \
    -draw "rectangle 0,8 7,15"    -draw "rectangle 8,8 15,15" \
    -draw "rectangle 16,8 23,15"  -draw "rectangle 24,8 31,15" \
    -draw "rectangle 20,16 27,19" -draw "rectangle 28,16 35,19" \
    -draw "rectangle 16,20 19,31" -draw "rectangle 20,20 27,31" \
    -draw "rectangle 28,20 31,31" -draw "rectangle 32,20 39,31" \
    -draw "rectangle 4,16 7,19"   -draw "rectangle 8,16 11,19" \
    -draw "rectangle 0,20 3,31"   -draw "rectangle 4,20 7,31" \
    -draw "rectangle 8,20 11,31"  -draw "rectangle 12,20 15,31" \
    -draw "rectangle 20,48 23,51" -draw "rectangle 24,48 27,51" \
    -draw "rectangle 16,52 19,63" -draw "rectangle 20,52 23,63" \
    -draw "rectangle 24,52 27,63" -draw "rectangle 28,52 31,63" \
    -draw "rectangle 44,16 47,19" -draw "rectangle 48,16 51,19" \
    -draw "rectangle 40,20 43,31" -draw "rectangle 44,20 47,31" \
    -draw "rectangle 48,20 51,31" -draw "rectangle 52,20 55,31" \
    -draw "rectangle 36,48 39,51" -draw "rectangle 40,48 43,51" \
    -draw "rectangle 32,52 35,63" -draw "rectangle 36,52 39,63" \
    -draw "rectangle 40,52 43,63" -draw "rectangle 44,52 47,63" \
    "$f"
}

# Draw head only
draw_head() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 8,0 15,7" -draw "rectangle 16,0 23,7" \
    -draw "rectangle 0,8 7,15" -draw "rectangle 8,8 15,15" \
    -draw "rectangle 16,8 23,15" -draw "rectangle 24,8 31,15" \
    "$f"
}

# Draw body only
draw_body() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 20,16 27,19" -draw "rectangle 28,16 35,19" \
    -draw "rectangle 16,20 19,31" -draw "rectangle 20,20 27,31" \
    -draw "rectangle 28,20 31,31" -draw "rectangle 32,20 39,31" \
    "$f"
}

# Draw arms only
draw_arms() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 44,16 47,19" -draw "rectangle 48,16 51,19" \
    -draw "rectangle 40,20 43,31" -draw "rectangle 44,20 47,31" \
    -draw "rectangle 48,20 51,31" -draw "rectangle 52,20 55,31" \
    -draw "rectangle 36,48 39,51" -draw "rectangle 40,48 43,51" \
    -draw "rectangle 32,52 35,63" -draw "rectangle 36,52 39,63" \
    -draw "rectangle 40,52 43,63" -draw "rectangle 44,52 47,63" \
    "$f"
}

# Draw legs only
draw_legs() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 4,16 7,19" -draw "rectangle 8,16 11,19" \
    -draw "rectangle 0,20 3,31" -draw "rectangle 4,20 7,31" \
    -draw "rectangle 8,20 11,31" -draw "rectangle 12,20 15,31" \
    -draw "rectangle 20,48 23,51" -draw "rectangle 24,48 27,51" \
    -draw "rectangle 16,52 19,63" -draw "rectangle 20,52 23,63" \
    -draw "rectangle 24,52 27,63" -draw "rectangle 28,52 31,63" \
    "$f"
}

# Draw hat overlay
draw_hat() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 40,0 47,7" -draw "rectangle 48,0 55,7" \
    -draw "rectangle 32,8 39,15" -draw "rectangle 40,8 47,15" \
    -draw "rectangle 48,8 55,15" -draw "rectangle 56,8 63,15" \
    "$f"
}

# Draw jacket overlay
draw_jacket() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 20,32 27,35" -draw "rectangle 28,32 35,35" \
    -draw "rectangle 16,36 19,47" -draw "rectangle 20,36 27,47" \
    -draw "rectangle 28,36 31,47" -draw "rectangle 32,36 39,47" \
    "$f"
}

# Draw pants overlay
draw_pants() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 4,32 7,35" -draw "rectangle 8,32 11,35" \
    -draw "rectangle 0,36 3,47" -draw "rectangle 4,36 7,47" \
    -draw "rectangle 8,36 11,47" -draw "rectangle 12,36 15,47" \
    -draw "rectangle 4,48 7,51" -draw "rectangle 8,48 11,51" \
    -draw "rectangle 0,52 3,63" -draw "rectangle 4,52 7,63" \
    -draw "rectangle 8,52 11,63" -draw "rectangle 12,52 15,63" \
    "$f"
}

# Draw sleeves overlay
draw_sleeves() {
  local f="$1" c="$2"
  convert "$f" -fill "$c" \
    -draw "rectangle 44,32 47,35" -draw "rectangle 48,32 51,35" \
    -draw "rectangle 40,36 43,47" -draw "rectangle 44,36 47,47" \
    -draw "rectangle 48,36 51,47" -draw "rectangle 52,36 55,47" \
    -draw "rectangle 52,48 55,51" -draw "rectangle 56,48 59,51" \
    -draw "rectangle 48,52 51,63" -draw "rectangle 52,52 55,63" \
    -draw "rectangle 56,52 59,63" -draw "rectangle 60,52 63,63" \
    "$f"
}

cd "$(dirname "$0")/.."

# --- 1. Spring Bloom: fresh greens, florals, rebirth ---
echo "1/10 Spring Bloom"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-01.png"
draw_head "$OUTDIR/skin-cursor-01.png" "$SKIN"
draw_body "$OUTDIR/skin-cursor-01.png" "#4CAF50"
draw_arms "$OUTDIR/skin-cursor-01.png" "$SKIN"
draw_legs "$OUTDIR/skin-cursor-01.png" "#2E7D32"
draw_hat "$OUTDIR/skin-cursor-01.png" "#66BB6A"
draw_jacket "$OUTDIR/skin-cursor-01.png" "#81C784"
draw_sleeves "$OUTDIR/skin-cursor-01.png" "#A5D6A7"
draw_pants "$OUTDIR/skin-cursor-01.png" "#1B5E20"

# --- 2. Winter Frost: icy blues, crystalline ---
echo "2/10 Winter Frost"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-02.png"
draw_head "$OUTDIR/skin-cursor-02.png" "$SKIN_LIGHT"
draw_body "$OUTDIR/skin-cursor-02.png" "#B3E5FC"
draw_arms "$OUTDIR/skin-cursor-02.png" "$SKIN_LIGHT"
draw_legs "$OUTDIR/skin-cursor-02.png" "#E1F5FE"
draw_hat "$OUTDIR/skin-cursor-02.png" "#FFFFFF"
draw_jacket "$OUTDIR/skin-cursor-02.png" "#81D4FA"
draw_sleeves "$OUTDIR/skin-cursor-02.png" "#4FC3F7"
draw_pants "$OUTDIR/skin-cursor-02.png" "#0288D1"

# --- 3. Life Force: vibrant greens, organic growth ---
echo "3/10 Life Force"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-03.png"
draw_head "$OUTDIR/skin-cursor-03.png" "$SKIN"
draw_body "$OUTDIR/skin-cursor-03.png" "#2E7D32"
draw_arms "$OUTDIR/skin-cursor-03.png" "$SKIN"
draw_legs "$OUTDIR/skin-cursor-03.png" "#1B5E20"
draw_hat "$OUTDIR/skin-cursor-03.png" "#388E3C"
draw_jacket "$OUTDIR/skin-cursor-03.png" "#43A047"
draw_sleeves "$OUTDIR/skin-cursor-03.png" "#4CAF50"
draw_pants "$OUTDIR/skin-cursor-03.png" "#2E7D32"

# --- 4. Death's Embrace: dark purples, skeletal ---
echo "4/10 Death's Embrace"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-04.png"
draw_head "$OUTDIR/skin-cursor-04.png" "#5D4037"
draw_body "$OUTDIR/skin-cursor-04.png" "#212121"
draw_arms "$OUTDIR/skin-cursor-04.png" "#5D4037"
draw_legs "$OUTDIR/skin-cursor-04.png" "#1A1A1A"
draw_hat "$OUTDIR/skin-cursor-04.png" "#4A148C"
draw_jacket "$OUTDIR/skin-cursor-04.png" "#311B92"
draw_sleeves "$OUTDIR/skin-cursor-04.png" "#6A1B9A"
draw_pants "$OUTDIR/skin-cursor-04.png" "#0D0D0D"

# --- 5. Spring Awakening: pastel greens & pinks, cherry blossom ---
echo "5/10 Spring Awakening"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-05.png"
draw_head "$OUTDIR/skin-cursor-05.png" "$SKIN_LIGHT"
draw_body "$OUTDIR/skin-cursor-05.png" "#F8BBD9"
draw_arms "$OUTDIR/skin-cursor-05.png" "$SKIN_LIGHT"
draw_legs "$OUTDIR/skin-cursor-05.png" "#C8E6C9"
draw_hat "$OUTDIR/skin-cursor-05.png" "#F48FB1"
draw_jacket "$OUTDIR/skin-cursor-05.png" "#FCE4EC"
draw_sleeves "$OUTDIR/skin-cursor-05.png" "#E1BEE7"
draw_pants "$OUTDIR/skin-cursor-05.png" "#A5D6A7"

# --- 6. Winter's End: ice transitioning to green, hope ---
echo "6/10 Winter's End"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-06.png"
draw_head "$OUTDIR/skin-cursor-06.png" "$SKIN"
draw_body "$OUTDIR/skin-cursor-06.png" "#90CAF9"
draw_arms "$OUTDIR/skin-cursor-06.png" "$SKIN"
draw_legs "$OUTDIR/skin-cursor-06.png" "#81C784"
draw_hat "$OUTDIR/skin-cursor-06.png" "#B3E5FC"
draw_jacket "$OUTDIR/skin-cursor-06.png" "#64B5F6"
draw_sleeves "$OUTDIR/skin-cursor-06.png" "#4DD0E1"
draw_pants "$OUTDIR/skin-cursor-06.png" "#66BB6A"

# --- 7. Cycle of Seasons: spring base, winter overlay (transition) ---
echo "7/10 Cycle of Seasons"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-07.png"
draw_head "$OUTDIR/skin-cursor-07.png" "$SKIN"
draw_body "$OUTDIR/skin-cursor-07.png" "#4CAF50"
draw_arms "$OUTDIR/skin-cursor-07.png" "$SKIN"
draw_legs "$OUTDIR/skin-cursor-07.png" "#2E7D32"
draw_hat "$OUTDIR/skin-cursor-07.png" "#81C784"
draw_jacket "$OUTDIR/skin-cursor-07.png" "#64B5F6"
draw_sleeves "$OUTDIR/skin-cursor-07.png" "#90CAF9"
draw_pants "$OUTDIR/skin-cursor-07.png" "#42A5F5"

# --- 8. Death and Rebirth: dark with budding green accents ---
echo "8/10 Death and Rebirth"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-08.png"
draw_head "$OUTDIR/skin-cursor-08.png" "#5D4037"
draw_body "$OUTDIR/skin-cursor-08.png" "#37474F"
draw_arms "$OUTDIR/skin-cursor-08.png" "#5D4037"
draw_legs "$OUTDIR/skin-cursor-08.png" "#263238"
draw_hat "$OUTDIR/skin-cursor-08.png" "#1B5E20"
draw_jacket "$OUTDIR/skin-cursor-08.png" "#455A64"
draw_sleeves "$OUTDIR/skin-cursor-08.png" "#2E7D32"
draw_pants "$OUTDIR/skin-cursor-08.png" "#1B5E20"

# --- 9. Eternal Winter: pure white/blue, frozen ---
echo "9/10 Eternal Winter"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-09.png"
draw_head "$OUTDIR/skin-cursor-09.png" "#E3F2FD"
draw_body "$OUTDIR/skin-cursor-09.png" "#E3F2FD"
draw_arms "$OUTDIR/skin-cursor-09.png" "#BBDEFB"
draw_legs "$OUTDIR/skin-cursor-09.png" "#90CAF9"
draw_hat "$OUTDIR/skin-cursor-09.png" "#FFFFFF"
draw_jacket "$OUTDIR/skin-cursor-09.png" "#B3E5FC"
draw_sleeves "$OUTDIR/skin-cursor-09.png" "#81D4FA"
draw_pants "$OUTDIR/skin-cursor-09.png" "#64B5F6"

# --- 10. Verdant Life: lush forest green, growth ---
echo "10/10 Verdant Life"
convert -size 64x64 xc:none "$OUTDIR/skin-cursor-10.png"
draw_head "$OUTDIR/skin-cursor-10.png" "$SKIN"
draw_body "$OUTDIR/skin-cursor-10.png" "#1B5E20"
draw_arms "$OUTDIR/skin-cursor-10.png" "$SKIN"
draw_legs "$OUTDIR/skin-cursor-10.png" "#0D3B0D"
draw_hat "$OUTDIR/skin-cursor-10.png" "#2E7D32"
draw_jacket "$OUTDIR/skin-cursor-10.png" "#388E3C"
draw_sleeves "$OUTDIR/skin-cursor-10.png" "#43A047"
draw_pants "$OUTDIR/skin-cursor-10.png" "#1B5E20"

echo "Done. Skins saved to $OUTDIR/skin-cursor-01.png through skin-cursor-10.png"
