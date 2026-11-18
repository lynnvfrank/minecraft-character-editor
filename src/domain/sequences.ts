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
