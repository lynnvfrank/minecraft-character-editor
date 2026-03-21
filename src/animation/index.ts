/**
 * Animation module: sequence/walk/turn manager and trapezoid movement bounds.
 */

export {
  createAnimationManager,
  type CharacterStateLike,
  type SequenceStep,
  type TurnStrategy,
} from './manager';

export {
  getTrapezoidBounds,
  clampToTrapezoid,
  WALK_CYCLE_DISTANCE,
  type TrapezoidBounds,
} from '../lib/trapezoidBounds';
