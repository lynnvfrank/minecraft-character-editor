/**
 * Unified app event bus. All app-level events flow through this module.
 * Convention: app:<domain>:<action>. Detail objects include characterId? for multi-character.
 * See docs/concepts/EVENT-SYSTEM.md
 */

export const APP_EVENTS = {
  /** Creator: current color changed (swatch, picker, skin load) */
  'app:creator:current-color-change': 'app:creator:current-color-change',
  /** Creator: texture position / hover info changed */
  'app:creator:texture-position-change': 'app:creator:texture-position-change',
  /** Creator: swatch history changed */
  'app:creator:swatch-history-change': 'app:creator:swatch-history-change',
  /** Creator: skin loaded into canvas */
  'app:creator:skin-load-change': 'app:creator:skin-load-change',
  /** Creator: active swatch palette changed */
  'app:creator:swatch-palette-change': 'app:creator:swatch-palette-change',
  /** Creator: edit mode changed (wardrobe / 2d / 3d) */
  'app:creator:edit-mode-change': 'app:creator:edit-mode-change',
  /** Creator: tools changed (brush, eraser, etc.) */
  'app:creator:tools-change': 'app:creator:tools-change',
  /** Creator: layer 3D visibility/lock changed */
  'app:creator:layer3d-change': 'app:creator:layer3d-change',
  /** Creator: canvas pixels changed */
  'app:creator:canvas-change': 'app:creator:canvas-change',
  /** Creator: lock feedback (painted on locked layer) */
  'app:creator:lock-feedback': 'app:creator:lock-feedback',
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

/** Detail for app:creator:current-color-change */
export type AppCreatorCurrentColorDetail = { color: string };

/** Detail for app:creator:edit-mode-change */
export type AppCreatorEditModeDetail = {
  mode: 'wardrobe' | '2d' | '3d';
  previousMode?: 'wardrobe' | '2d' | '3d';
};

/** Detail for app:creator:texture-position-change */
export type AppCreatorTexturePositionDetail = {
  part: string | null;
  layer: string | null;
  skinX: number;
  skinY: number;
  tool?: 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'navigate';
  currentColor?: string | null;
  hoverColor?: string | null;
};

/** Detail for app:creator:lock-feedback */
export type AppCreatorLockFeedbackDetail = { layer: string };

/** Detail for app:creator:camera-yaw-left, camera-yaw-right, camera-pitch-up, camera-pitch-down */
export type AppCreatorCameraAngleDetail = { degrees?: number };

/** Detail for app:creator:skin-load-change */
export type AppCreatorSkinLoadDetail = { path: string };

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

/** Backward-compatible aliases for creator domain (same event strings) */
export const CREATOR_EVENTS = {
  CURRENT_COLOR_CHANGE: APP_EVENTS['app:creator:current-color-change'],
  TEXTURE_POSITION_CHANGE: APP_EVENTS['app:creator:texture-position-change'],
  SWATCH_HISTORY_CHANGE: APP_EVENTS['app:creator:swatch-history-change'],
  SKIN_LOAD_CHANGE: APP_EVENTS['app:creator:skin-load-change'],
  SWATCH_PALETTE_CHANGE: APP_EVENTS['app:creator:swatch-palette-change'],
  EDIT_MODE_CHANGE: APP_EVENTS['app:creator:edit-mode-change'],
  TOOLS_CHANGE: APP_EVENTS['app:creator:tools-change'],
  LAYER3D_CHANGE: APP_EVENTS['app:creator:layer3d-change'],
  CANVAS_CHANGE: APP_EVENTS['app:creator:canvas-change'],
  LOCK_FEEDBACK: APP_EVENTS['app:creator:lock-feedback'],
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

/** Re-export types for creator events (backward compatibility) */
export type CreatorCurrentColorDetail = AppCreatorCurrentColorDetail;
export type CreatorEditModeDetail = AppCreatorEditModeDetail;
export type CreatorTexturePositionDetail = AppCreatorTexturePositionDetail;
export type CreatorLockFeedbackDetail = AppCreatorLockFeedbackDetail;

/** Publish an event. Subscribers will be notified. */
export function publish(event: string, detail?: unknown): void {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(event, { detail }));
  }
}

/** Binding for component event subscription. scope limits when handler runs. */
export type ComponentEventBinding = {
  event: string;
  handler: (e: CustomEvent) => void;
  scope?: 'creator' | 'viewer' | 'global';
};

/** Register component bindings. Uses document.body.dataset.route for scope check. */
export function registerComponentBindings(
  bindings: ComponentEventBinding[],
  subscribeFn: (event: string, handler: (e: CustomEvent) => void) => () => void = subscribe
): () => void {
  const unsubs = bindings.map(({ event, handler, scope }) => {
    const wrapped = (e: CustomEvent) => {
      if (scope && scope !== 'global') {
        const route = typeof document !== 'undefined' ? document.body.dataset.route : undefined;
        if (route !== scope) return;
      }
      handler(e);
    };
    return subscribeFn(event, wrapped);
  });
  return () => unsubs.forEach((u) => u());
}

/** Subscribe to an event. Returns an unsubscribe function. */
export function subscribe(event: string, handler: (e: CustomEvent) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const wrapped = (e: Event) => handler(e as CustomEvent);
  document.addEventListener(event, wrapped);
  return () => document.removeEventListener(event, wrapped);
}
