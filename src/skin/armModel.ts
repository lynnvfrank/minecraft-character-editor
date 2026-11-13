/**
 * Arm model (classic 4px arms vs slim 3px "Alex" arms).
 *
 * Minecraft stores the same 64×64 layout for both; a slim skin leaves the
 * outermost column of each arm face unused. We detect slim when the unused
 * strip of the right arm's back face (x 54–55, y 20–31) is fully transparent.
 */

export type ArmModel = 'classic' | 'slim';
export type ArmModelSetting = ArmModel | 'auto';

/**
 * Slim is derived from the classic rig at load time (`#slim`, see viewer/rigLoader.ts).
 * The old Blender-built RunningboyRigSlim.fbx put the overlay layer below the floor.
 */
export const ARM_MODEL_PATHS: Record<ArmModel, string> = {
  classic: '/models/RunningboyRig.fbx',
  slim: '/models/RunningboyRig.fbx#slim',
};

export const ARM_MODEL_SETTINGS: readonly ArmModelSetting[] = ['auto', 'slim', 'classic'];

/** Region (in 64×64 skin pixels) that is blank on slim skins. */
const SLIM_EMPTY_REGION = { x: 54, y: 20, w: 2, h: 12 };

/**
 * Detect arm model from skin pixels.
 * @param alphaAt alpha (0–255) of the skin pixel at 64×64 coords
 * @param skinHeight 64 for modern skins, 32 for legacy (always classic)
 */
export function detectArmModel(alphaAt: (x: number, y: number) => number, skinHeight = 64): ArmModel | null {
  if (skinHeight < 64) return 'classic';
  // Undecidable when the arm has no pixels at all (e.g. a canvas that is still empty).
  let armHasPixels = false;
  for (let py = 20; py < 32 && !armHasPixels; py++) {
    for (let px = 44; px < 47; px++) {
      if (alphaAt(px, py) > 0) {
        armHasPixels = true;
        break;
      }
    }
  }
  if (!armHasPixels) return null;
  const { x, y, w, h } = SLIM_EMPTY_REGION;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (alphaAt(px, py) > 0) return 'classic';
    }
  }
  return 'slim';
}

/** Detect from RGBA pixel data of a square image of any resolution (e.g. 64 or 128 working canvas). */
export function detectArmModelFromRGBA(data: ArrayLike<number>, width: number, height = width): ArmModel | null {
  const scale = width / 64;
  const skinHeight = Math.round(height / scale);
  return detectArmModel((x, y) => {
    const px = Math.floor(x * scale);
    const py = Math.floor(y * scale);
    return data[(py * width + px) * 4 + 3] ?? 0;
  }, skinHeight);
}

export function resolveArmModel(setting: ArmModelSetting, detected: ArmModel): ArmModel {
  return setting === 'auto' ? detected : setting;
}

export function armModelFromPath(path: string): ArmModel {
  return /#slim$|slim\.fbx$/i.test(path) ? 'slim' : 'classic';
}

const STORAGE_KEY = 'character:armModel';

export function readArmModelSetting(): ArmModelSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'auto' || v === 'slim' || v === 'classic') return v;
  } catch {
    // ignore
  }
  return 'auto';
}

export function writeArmModelSetting(setting: ArmModelSetting): void {
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // ignore
  }
}
