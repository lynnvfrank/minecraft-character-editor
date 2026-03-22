/**
 * Re-exports from app events. Use src/events/appEvents.ts for new code.
 * @deprecated Import from '../events/appEvents' instead.
 */
export {
  publish,
  subscribe,
  APP_EVENTS,
  CREATOR_EVENTS,
  type CreatorCurrentColorDetail,
  type CreatorEditModeDetail,
  type CreatorTexturePositionDetail,
  type CreatorLockFeedbackDetail,
} from '../events/appEvents';
