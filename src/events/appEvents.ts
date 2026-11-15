/**
 * Document event bus for app-level and cross-boundary commands.
 * Creator editor state sync uses in-process slices (src/state/creatorSlices.ts).
 * See docs/concepts/EVENT-SYSTEM.md
 */

export const APP_EVENTS = {
  /** Creator: camera yaw left */
  'app:creator:camera-yaw-left': 'app:creator:camera-yaw-left',
  /** Creator: camera yaw right */
  'app:creator:camera-yaw-right': 'app:creator:camera-yaw-right',
  /** Creator: camera pitch up */
  'app:creator:camera-pitch-up': 'app:creator:camera-pitch-up',
  /** Creator: camera pitch down */
  'app:creator:camera-pitch-down': 'app:creator:camera-pitch-down',
  /** Creator: camera zoom in */
  'app:creator:camera-zoom-in': 'app:creator:camera-zoom-in',
  /** Creator: camera zoom out */
  'app:creator:camera-zoom-out': 'app:creator:camera-zoom-out',
  /** Creator: camera recenter */
  'app:creator:camera-recenter': 'app:creator:camera-recenter',
  /** Creator: camera move started (tween in progress) */
  'app:creator:camera-move-start': 'app:creator:camera-move-start',
  /** Creator: camera move ended */
  'app:creator:camera-move-end': 'app:creator:camera-move-end',
  /** Character: skin changed (UI or external) */
  'app:character:skin-change': 'app:character:skin-change',
  /** Character: animation play requested (UI or external) */
  'app:character:animation-play': 'app:character:animation-play',
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

/** Detail for app:creator:camera-yaw-left, camera-yaw-right, camera-pitch-up, camera-pitch-down */
export type AppCreatorCameraAngleDetail = { degrees?: number };

/** Detail for app:character:skin-change */
export type AppCharacterSkinChangeDetail = {
  characterId?: string;
  path: string;
};

/** Detail for app:character:animation-play */
export type AppCharacterAnimationPlayDetail = {
  characterId?: string;
  name: string;
};

/** Camera / character command aliases (document bus only). */
export const CREATOR_EVENTS = {
  CAMERA_YAW_LEFT: APP_EVENTS['app:creator:camera-yaw-left'],
  CAMERA_YAW_RIGHT: APP_EVENTS['app:creator:camera-yaw-right'],
  CAMERA_PITCH_UP: APP_EVENTS['app:creator:camera-pitch-up'],
  CAMERA_PITCH_DOWN: APP_EVENTS['app:creator:camera-pitch-down'],
  CAMERA_ZOOM_IN: APP_EVENTS['app:creator:camera-zoom-in'],
  CAMERA_ZOOM_OUT: APP_EVENTS['app:creator:camera-zoom-out'],
  CAMERA_RECENTER: APP_EVENTS['app:creator:camera-recenter'],
  CAMERA_MOVE_START: APP_EVENTS['app:creator:camera-move-start'],
  CAMERA_MOVE_END: APP_EVENTS['app:creator:camera-move-end'],
} as const;

export type {
  CreatorColorPayload as CreatorCurrentColorDetail,
  CreatorEditModePayload as CreatorEditModeDetail,
  CreatorTexturePositionPayload as CreatorTexturePositionDetail,
  CreatorLockFeedbackPayload as CreatorLockFeedbackDetail,
} from '../state/creatorSlicePayloads';

/** Detail for events that carry no payload. */
export type AppEmptyDetail = Record<string, never>;

/** Payload type for every bus event. Adding an event to APP_EVENTS without an entry here is a type error. */
export type AppEventMap = {
  'app:creator:camera-yaw-left': AppCreatorCameraAngleDetail;
  'app:creator:camera-yaw-right': AppCreatorCameraAngleDetail;
  'app:creator:camera-pitch-up': AppCreatorCameraAngleDetail;
  'app:creator:camera-pitch-down': AppCreatorCameraAngleDetail;
  'app:creator:camera-zoom-in': AppEmptyDetail;
  'app:creator:camera-zoom-out': AppEmptyDetail;
  'app:creator:camera-recenter': AppEmptyDetail;
  'app:creator:camera-move-start': AppEmptyDetail;
  'app:creator:camera-move-end': AppEmptyDetail;
  'app:character:skin-change': AppCharacterSkinChangeDetail;
  'app:character:animation-play': AppCharacterAnimationPlayDetail;
};

// Compile-time check that APP_EVENTS and AppEventMap list the same events.
type _SameKeys<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never] ? true : never;
const _eventMapCoversAllEvents: _SameKeys<typeof APP_EVENTS, AppEventMap> = true;
void _eventMapCoversAllEvents;

/** Detail is optional when every field of the payload is optional, required otherwise. */
type DetailArg<E extends AppEventName> = {} extends AppEventMap[E] ? [detail?: AppEventMap[E]] : [detail: AppEventMap[E]];

/** Publish an event; the detail must match the event's payload type. */
export function publish<E extends AppEventName>(event: E, ...[detail]: DetailArg<E>): void {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(event, { detail }));
  }
}

/** Subscribe to an event; the handler gets a CustomEvent typed for that event. Returns an unsubscribe function. */
export function subscribe<E extends AppEventName>(
  event: E,
  handler: (e: CustomEvent<AppEventMap[E]>) => void
): () => void {
  if (typeof document === 'undefined') return () => {};
  const wrapped = (e: Event) => handler(e as CustomEvent<AppEventMap[E]>);
  document.addEventListener(event, wrapped);
  return () => document.removeEventListener(event, wrapped);
}
