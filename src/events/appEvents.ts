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

/** Publish an event. Subscribers will be notified. */
export function publish(event: string, detail?: unknown): void {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(event, { detail }));
  }
}

/** Subscribe to an event. Returns an unsubscribe function. */
export function subscribe(event: string, handler: (e: CustomEvent) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const wrapped = (e: Event) => handler(e as CustomEvent);
  document.addEventListener(event, wrapped);
  return () => document.removeEventListener(event, wrapped);
}
