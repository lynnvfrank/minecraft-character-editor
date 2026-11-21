/**
 * "Me": a character's own hair, eyes and skin, each a style (taken from any tagged skin) plus an
 * optional color, laid onto whatever outfit they wear.
 *
 * dressMe mixes the chosen styles onto the outfit by feature tags (composeFeaturesLabeled), then
 * recolors each feature on exactly the pixels that came from it: the skin keeps its shading, hair
 * keeps its highlights, and eyes only change their colored (iris) pixels, not whites, lashes or
 * the mouth. Pure: runs in Node (tests) and the browser.
 */
import { composeFeaturesLabeled, FEATURE_CODE, isFaceTexel, type TaggedSkin } from './featureMap';
import { detectEyeAnchor, recolorHair, recolorSkinTone, rgbToHsv, type RGB, type SkinPixels } from './skinStyler';

export type MeFeature = 'hair' | 'eyes' | 'skin';
export const ME_FEATURES: readonly MeFeature[] = ['hair', 'eyes', 'skin'];

/** One feature of Me: whose style (null = the outfit skin's own) and an optional color. */
export type MeChoice = { style: TaggedSkin | null; color: RGB | null };
export type MeLook = Record<MeFeature, MeChoice>;

/** Eye pixels that carry the eye color: saturated, on the eye rows. */
export function irisPixels(image: SkinPixels, eyes: Iterable<number>): Set<number> {
  const anchor = detectEyeAnchor(image);
  const out = new Set<number>();
  const d = image.data;
  for (const k of eyes) {
    const y = (k / 64) | 0;
    if (y < anchor - 2 || y > anchor + 1) continue;
    const [, s, v] = rgbToHsv(d[k * 4]! / 255, d[k * 4 + 1]! / 255, d[k * 4 + 2]! / 255);
    if (s >= 0.12 && v >= 0.08) out.add(k);
  }
  return out;
}

/** The outfit, worn by Me. */
export function dressMe(outfit: TaggedSkin, look: MeLook): SkinPixels {
  const { pixels, labels } = composeFeaturesLabeled({
    outfit,
    hair: look.hair.style,
    eyes: look.eyes.style,
    skin: look.skin.style,
  });
  let image: SkinPixels = pixels;
  const hair = new Set<number>();
  const skin = new Set<number>();
  const eyes = new Set<number>();
  for (let k = 0; k < labels.length; k++) {
    if ((image.data[k * 4 + 3] ?? 0) === 0) continue;
    if (labels[k] === FEATURE_CODE.hair) hair.add(k);
    else if (labels[k] === FEATURE_CODE.skin) skin.add(k);
    else if (labels[k] === FEATURE_CODE.eyes && isFaceTexel(k)) eyes.add(k);
  }
  if (look.skin.color && skin.size) image = recolorSkinTone(image, look.skin.color, hair, 24, skin).image;
  if (look.hair.color && hair.size) {
    // Take the hair's color from the head, so long hair on the body follows the same shift.
    const head = new Set([...hair].filter((k) => k < 16 * 64));
    image = recolorHair(image, look.hair.color, { hairMask: hair, colorReferenceMask: head.size ? head : hair }).image;
  }
  if (look.eyes.color && eyes.size) {
    const iris = irisPixels(image, eyes);
    if (iris.size) image = recolorHair(image, look.eyes.color, { hairMask: iris, colorReferenceMask: iris }).image;
  }
  return image;
}
