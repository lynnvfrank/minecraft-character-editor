/**
 * Group dance in the studio (`#/studio`): up to two backup dancers copy the lead.
 *
 * Pure rules only (no Three.js, no DOM): the settings and their validation, where the dancers
 * stand, how wide the camera has to frame the group, and which skins they wear.
 * state/groupDanceStore.ts persists the settings; controllers/studioDancersController.ts loads
 * the dancers and drives them.
 */

export const MAX_BACKUP_DANCERS = 2;

export const FORMATIONS = ['line', 'triangle', 'stagger'] as const;
export type Formation = (typeof FORMATIONS)[number];

/** How far the backup dancers trail the lead, in seconds (0 = together). */
export const DANCE_OFFSETS_SEC = [0, 0.25, 0.5] as const;
export const MAX_DANCE_OFFSET_SEC = 0.5;

export type GroupDanceSettings = {
  /** Backup dancers on stage (0 = the lead dances alone). */
  count: number;
  formation: Formation;
  offsetSec: number;
};

export const DEFAULT_GROUP_DANCE: GroupDanceSettings = { count: 0, formation: 'line', offsetSec: 0 };

/** Coerce anything into valid settings; junk fields fall back to `base`. */
export function normalizeGroupDance(
  value: unknown,
  base: GroupDanceSettings = DEFAULT_GROUP_DANCE
): GroupDanceSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const count =
    typeof v.count === 'number' && Number.isFinite(v.count)
      ? Math.min(MAX_BACKUP_DANCERS, Math.max(0, Math.round(v.count)))
      : base.count;
  const formation = FORMATIONS.includes(v.formation as Formation) ? (v.formation as Formation) : base.formation;
  let offsetSec = base.offsetSec;
  const rawOffset = v.offsetSec;
  if (typeof rawOffset === 'number' && Number.isFinite(rawOffset)) {
    // Snap to the nearest offered delay.
    offsetSec = DANCE_OFFSETS_SEC.reduce<number>(
      (best, o) => (Math.abs(o - rawOffset) < Math.abs(best - rawOffset) ? o : best),
      DANCE_OFFSETS_SEC[0]
    );
  }
  return { count, formation, offsetSec };
}

/** Settings from untrusted JSON (localStorage); the defaults when nothing usable is stored. */
export function parseGroupDance(json: string | null): GroupDanceSettings {
  if (!json) return { ...DEFAULT_GROUP_DANCE };
  try {
    return normalizeGroupDance(JSON.parse(json));
  } catch {
    return { ...DEFAULT_GROUP_DANCE };
  }
}

/**
 * A spot on stage relative to the lead: `side` is along the lead's left/right axis, `forward`
 * along its facing (negative = behind the lead). World units.
 */
export type StageOffset = { side: number; forward: number };

const FORMATION_SLOTS: Record<Formation, readonly StageOffset[]> = {
  // Shoulder to shoulder with the lead.
  line: [
    { side: -1.5, forward: 0 },
    { side: 1.5, forward: 0 },
  ],
  // Lead at the front point, the other two behind.
  triangle: [
    { side: -1.2, forward: -1.4 },
    { side: 1.2, forward: -1.4 },
  ],
  // A diagonal going back.
  stagger: [
    { side: 1.3, forward: -1.0 },
    { side: -1.3, forward: -2.0 },
  ],
};

/** Where `count` backup dancers stand (the lead is at 0,0). */
export function formationOffsets(formation: Formation, count: number): StageOffset[] {
  const n = Math.min(MAX_BACKUP_DANCERS, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  return FORMATION_SLOTS[formation].slice(0, n).map((o) => ({ ...o }));
}

/**
 * Stage offset → world XZ delta for a lead facing `yaw` (radians; yaw 0 faces +Z, forward is
 * (sin yaw, cos yaw), the same convention the studio camera uses).
 */
export function stageToWorld(offset: StageOffset, yaw: number): { x: number; z: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return {
    x: offset.side * c + offset.forward * s,
    z: -offset.side * s + offset.forward * c,
  };
}

/** Camera distance the studio uses for one character. */
export const SOLO_CAMERA_DISTANCE = 5.2;

/**
 * What the camera should look at to fit the lead plus dancers at `offsets`: the middle of the
 * group (as a stage offset from the lead) and how far back to stand. No dancers = the solo shot.
 */
export function groupFraming(offsets: readonly StageOffset[]): { center: StageOffset; distance: number } {
  const spots: StageOffset[] = [{ side: 0, forward: 0 }, ...offsets];
  const sides = spots.map((o) => o.side);
  const forwards = spots.map((o) => o.forward);
  const center = {
    side: (Math.min(...sides) + Math.max(...sides)) / 2,
    forward: (Math.min(...forwards) + Math.max(...forwards)) / 2,
  };
  const radius = Math.max(...spots.map((o) => Math.hypot(o.side - center.side, o.forward - center.forward)));
  return { center, distance: SOLO_CAMERA_DISTANCE + radius * 1.2 };
}

/**
 * The group as a camera sees it: the world XZ shift from the lead to the middle of the group (for
 * a lead facing `yaw`) and how much further back to stand than for one character. The framing
 * buttons and the turntable use it so they work on the whole group.
 */
export type GroupShot = { dx: number; dz: number; extraDistance: number };

export function groupShot(offsets: readonly StageOffset[], yaw: number): GroupShot {
  const framing = groupFraming(offsets);
  const c = stageToWorld(framing.center, yaw);
  return { dx: c.x, dz: c.z, extraDistance: framing.distance - SOLO_CAMERA_DISTANCE };
}

/**
 * Dancers load a moment after they are asked for, so the group is framed a second time once they
 * are all in (or a load gave up). `cameraSerial` counts the times the user took the camera (a
 * drag, a framing button, the turntable); it is remembered when the group changes.
 */
export type PendingReframe = { cameraSerial: number };

/**
 * What to do about a pending re-frame this frame:
 * - `none`: nothing is pending.
 * - `skip`: the user has moved the camera since the change; leave it alone and forget about it.
 * - `wait`: dancers are still loading.
 * - `frame`: everyone who is coming is on stage; frame the group now (once).
 */
export function reframeDecision(
  pending: PendingReframe | null,
  stillLoading: number,
  cameraSerial: number
): 'none' | 'skip' | 'wait' | 'frame' {
  if (!pending) return 'none';
  if (cameraSerial !== pending.cameraSerial) return 'skip';
  return stillLoading > 0 ? 'wait' : 'frame';
}

/**
 * Skins for `count` backup dancers. Residents (the roster) come first, in roster order; places
 * left over are filled with random skins. Skins in `exclude` (the lead's, dancers already on
 * stage) are only used when nothing else is left, so twins appear only when there is no way
 * around them. `random` returns [0, 1) like Math.random.
 */
export function pickDancerSkins(opts: {
  roster: readonly string[] | null;
  available: readonly string[];
  exclude: readonly string[];
  count: number;
  random: () => number;
}): string[] {
  const { available, random } = opts;
  const count = Math.max(0, Math.floor(opts.count));
  if (count === 0 || available.length === 0) return [];
  const known = new Set(available);
  const taken = new Set(opts.exclude);
  const out: string[] = [];
  const take = (skin: string) => {
    out.push(skin);
    taken.add(skin);
  };
  const drawRandom = (pool: readonly string[]) =>
    pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;

  for (const skin of opts.roster ?? []) {
    if (out.length >= count) break;
    if (known.has(skin) && !taken.has(skin)) take(skin);
  }
  while (out.length < count) {
    const free = available.filter((s) => !taken.has(s));
    if (free.length === 0) break;
    take(drawRandom(free));
  }
  // Fewer skins than dancers: twins it is.
  while (out.length < count) out.push(drawRandom(available));
  return out;
}
