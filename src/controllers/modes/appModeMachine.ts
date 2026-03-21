/**
 * XState machine for application mode (route + creator submode).
 * Mirrors hash routing: home, creator (wardrobe|3d|2d), preview.
 */

import { createMachine, createActor, fromCallback } from 'xstate';
import type { EditMode } from '../../creator/api';

export type AppRoute = 'viewer' | 'creator' | 'preview';

export type RouteInfo = { route: AppRoute; creatorMode: EditMode | null };

type AppModeEvent =
  | { type: 'GO_HOME'; routeInfo: RouteInfo }
  | { type: 'GO_CREATOR'; editMode?: EditMode; routeInfo: RouteInfo }
  | { type: 'GO_PREVIEW'; routeInfo: RouteInfo }
  | { type: 'SET_EDIT_MODE'; editMode: EditMode; routeInfo: RouteInfo };

let applyRouteCallback: ((routeInfo: RouteInfo) => void) | null = null;
let creatorExitCallback: (() => void) | null = null;
let creatorShortcutsCleanup: (() => void) | null = null;

export function setApplyRouteCallback(fn: (routeInfo: RouteInfo) => void): void {
  applyRouteCallback = fn;
}

export function setCreatorExitCallback(fn: () => void): void {
  creatorExitCallback = fn;
}

export function setCreatorShortcutsCleanup(fn: () => void): void {
  creatorShortcutsCleanup = fn;
}

const creatorShortcutsInvoke = fromCallback(() => {
  return () => creatorShortcutsCleanup?.();
});

function applyRouteFromEvent(routeInfo: RouteInfo): void {
  applyRouteCallback?.(routeInfo);
}

export const appModeMachine = createMachine({
  id: 'appMode',
  types: {} as {
    context: Record<string, never>;
    events: AppModeEvent;
  },
  context: {},
  initial: 'home',
  states: {
    home: {
      entry: ({ event }) => {
        if (event && 'routeInfo' in event && event.routeInfo) applyRouteFromEvent(event.routeInfo);
      },
      on: {
        GO_CREATOR: [
          {
            target: 'creator.wardrobe',
            guard: ({ event }) => (event.editMode ?? 'wardrobe') === 'wardrobe'
          },
          { target: 'creator.3d', guard: ({ event }) => event.editMode === '3d' },
          { target: 'creator.2d', guard: ({ event }) => event.editMode === '2d' }
        ],
        GO_PREVIEW: 'preview'
      }
    },
    creator: {
      exit: () => creatorExitCallback?.(),
      invoke: { src: creatorShortcutsInvoke },
      initial: 'wardrobe',
      states: {
        wardrobe: {
          entry: ({ event }) => {
            if (event && 'routeInfo' in event && event.routeInfo) applyRouteFromEvent(event.routeInfo);
          },
          on: {
            SET_EDIT_MODE: [
              { target: '3d', guard: ({ event }) => event.editMode === '3d' },
              { target: '2d', guard: ({ event }) => event.editMode === '2d' }
            ]
          }
        },
        '3d': {
          entry: ({ event }) => {
            if (event && 'routeInfo' in event && event.routeInfo) applyRouteFromEvent(event.routeInfo);
          },
          on: {
            SET_EDIT_MODE: [
              { target: 'wardrobe', guard: ({ event }) => event.editMode === 'wardrobe' },
              { target: '2d', guard: ({ event }) => event.editMode === '2d' }
            ]
          }
        },
        '2d': {
          entry: ({ event }) => {
            if (event && 'routeInfo' in event && event.routeInfo) applyRouteFromEvent(event.routeInfo);
          },
          on: {
            SET_EDIT_MODE: [
              { target: 'wardrobe', guard: ({ event }) => event.editMode === 'wardrobe' },
              { target: '3d', guard: ({ event }) => event.editMode === '3d' }
            ]
          }
        }
      },
      on: {
        GO_HOME: 'home',
        GO_PREVIEW: 'preview'
      }
    },
    preview: {
      entry: ({ event }) => {
        if (event && 'routeInfo' in event && event.routeInfo) applyRouteFromEvent(event.routeInfo);
      },
      on: {
        GO_HOME: 'home',
        GO_CREATOR: [
          {
            target: 'creator.wardrobe',
            guard: ({ event }) => (event.editMode ?? 'wardrobe') === 'wardrobe'
          },
          { target: 'creator.3d', guard: ({ event }) => event.editMode === '3d' },
          { target: 'creator.2d', guard: ({ event }) => event.editMode === '2d' }
        ]
      }
    }
  }
});

let modeActor: ReturnType<typeof createActor<typeof appModeMachine>> | null = null;

export function getModeActor() {
  return modeActor;
}

export function startModeActor() {
  modeActor = createActor(appModeMachine).start();
  return modeActor;
}

function getEditModeFromSnapshot(
  snapshot: { value: string | Record<string, string> | Record<string, Record<string, string>> }
): EditMode {
  const val = snapshot.value;
  if (typeof val === 'object' && val !== null && 'creator' in val) {
    const child = (val as { creator: string }).creator;
    if (child === 'wardrobe' || child === '3d' || child === '2d') return child;
  }
  return 'wardrobe';
}

export function getModeFromMachine(): { route: AppRoute; editMode: EditMode } {
  if (!modeActor) {
    return { route: 'viewer', editMode: 'wardrobe' };
  }
  const snapshot = modeActor.getSnapshot();
  const value = snapshot.value;
  if (value === 'home') return { route: 'viewer', editMode: 'wardrobe' };
  if (value === 'preview') return { route: 'preview', editMode: 'wardrobe' };
  if (typeof value === 'object' && value && 'creator' in value) {
    return { route: 'creator', editMode: getEditModeFromSnapshot(snapshot) };
  }
  return { route: 'viewer', editMode: 'wardrobe' };
}

/** RouteInfo derived from machine state. Use after machine has synced. */
export function getRouteInfoFromMachine(): RouteInfo {
  const { route, editMode } = getModeFromMachine();
  return {
    route,
    creatorMode: route === 'creator' ? editMode : null
  };
}

/** Parse current location.hash into RouteInfo. Use for hashchange and initial load. */
export function parseHashToRouteInfo(): RouteInfo {
  if (typeof location === 'undefined') return { route: 'viewer', creatorMode: null };
  const hash = (location.hash || '#/').toLowerCase().replace(/\/$/, '') || '#/';
  if (hash === '#/preview') return { route: 'preview', creatorMode: null };
  if (hash === '#/creator' || hash.startsWith('#/creator/')) {
    const modeSegment = hash.slice('#/creator/'.length);
    const creatorMode: EditMode =
      modeSegment === '2d' || modeSegment === 'wardrobe' || modeSegment === '3d' ? modeSegment : 'wardrobe';
    return { route: 'creator', creatorMode };
  }
  return { route: 'viewer', creatorMode: null };
}

/** Current route from machine. Prefer getRouteInfoFromMachine when full RouteInfo needed. */
export function getRouteFromMachine(): AppRoute {
  return getModeFromMachine().route;
}

/** Returns true if an event was sent (machine transitioned and will run applyRoute via entry). */
export function syncModeMachineFromHash(routeInfo: RouteInfo): boolean {
  const actor = modeActor;
  if (!actor) return false;

  const current = getModeFromMachine();

  if (routeInfo.route === 'viewer') {
    if (current.route === 'viewer') return false;
    actor.send({ type: 'GO_HOME', routeInfo });
    return true;
  }

  if (routeInfo.route === 'preview') {
    if (current.route === 'preview') return false;
    actor.send({ type: 'GO_PREVIEW', routeInfo });
    return true;
  }

  if (routeInfo.route === 'creator') {
    const editMode = routeInfo.creatorMode ?? 'wardrobe';
    if (current.route === 'creator' && current.editMode === editMode) return false;
    if (current.route === 'creator') {
      actor.send({ type: 'SET_EDIT_MODE', editMode, routeInfo });
    } else {
      actor.send({ type: 'GO_CREATOR', editMode, routeInfo });
    }
    return true;
  }

  return false;
}
