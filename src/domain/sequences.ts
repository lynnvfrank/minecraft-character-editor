/**
 * JSON-safe sequence shapes shared by the animation manager, the saved-sequence store and the
 * dance studio. `SequenceStep` in `animation/manager.ts` is a superset (it also allows walkTo
 * with a THREE.Vector3), so every `SavedSequenceStep` can be passed to `playSequence`.
 */

/** One clip in a blend: mixer weight (0..1) and playback speed. */
export type BlendLayerSpec = { name: string; weight: number; timeScale?: number };

/** Several clips playing at once with fixed weights, held for `duration` seconds. */
export type BlendStep = { type: 'blend'; layers: BlendLayerSpec[]; duration?: number };

export type SavedSequenceStep =
  | BlendStep
  | { type: 'animation'; name: string; duration?: number }
  | { type: 'pause'; duration?: number; min?: number; max?: number };

/** A user-made sequence (from the dance studio), replayable from the Move panel. */
export type SavedSequence = { id: string; label: string; steps: SavedSequenceStep[] };

/** Shape check for one stored step (untrusted JSON). Limits and clamping are in sequenceImport.ts. */
export function isSavedSequenceStep(v: unknown): v is SavedSequenceStep {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (s.type === 'animation') return typeof s.name === 'string';
  if (s.type === 'pause') return true;
  if (s.type === 'blend') {
    return (
      Array.isArray(s.layers) &&
      s.layers.length > 0 &&
      s.layers.every(
        (l) =>
          l && typeof l === 'object' &&
          typeof (l as Record<string, unknown>).name === 'string' &&
          typeof (l as Record<string, unknown>).weight === 'number'
      )
    );
  }
  return false;
}
