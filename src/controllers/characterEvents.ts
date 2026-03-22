/**
 * Character event handlers: skin-change, animation-play.
 * setupCharacterEventSubscribers, setupSocketEvents, ANIMATION_COMMANDS.
 */

import * as THREE from 'three';
import { logger } from '../lib';
import { subscribe, publish, APP_EVENTS } from '../events/appEvents';
import type { CharacterState } from './characterTypes';

export type CharacterEventsDeps = {
  getCharacter: (id: string) => CharacterState | undefined;
  getPrimaryCharacterId: () => string;
  getRoute: () => 'creator' | 'viewer' | 'preview';
  getCreatorTransitionInFlight: () => boolean;
  resolveSkinByName: (name: string) => string | undefined;
  switchSkin: (charId: string, skinPath: string) => void;
  getAction: (charId: string, key: string) => THREE.AnimationAction | undefined;
  fadeToAction: (char: CharacterState, action: THREE.AnimationAction, duration: number) => void;
  getCharacterAI: () => { onUserActivity: (explicit: boolean) => boolean | undefined } | null;
  animationManager: { stop: () => void; setLastActivity: () => void } | null;
  highlightActiveButton: (charId: string, action: THREE.AnimationAction) => void;
};

import type { SocketManager } from '../services';

export function createCharacterEventsController(deps: CharacterEventsDeps): {
  setupCharacterEventSubscribers: () => void;
  setupSocketEvents: (socketManager: SocketManager | null) => void;
} {
  const {
    getCharacter,
    getPrimaryCharacterId,
    getRoute,
    getCreatorTransitionInFlight,
    resolveSkinByName,
    switchSkin,
    getAction,
    fadeToAction,
    getCharacterAI,
    animationManager,
  } = deps;

  const animationCommands: Record<string, (char: CharacterState, charId: string, name: string) => void> = {
    'back-to-idle': (char) => {
      if (char.idleAction) fadeToAction(char, char.idleAction, 0.5);
    },
  };

  function handleCharacterSkinChange(e: CustomEvent<{ characterId?: string; path: string }>) {
    const path = e.detail?.path;
    if (!path) return;
    logger.info('messaging', 'Skin change', { path, source: 'event' });
    const charId = e.detail?.characterId ?? getPrimaryCharacterId();
    const char = getCharacter(charId);
    if (char) switchSkin(charId, resolveSkinByName(path) ?? path);
  }

  function handleCharacterAnimationPlay(e: CustomEvent<{ characterId?: string; name: string }>) {
    if (getRoute() === 'creator' || getCreatorTransitionInFlight()) return;
    const charId = e.detail?.characterId ?? getPrimaryCharacterId();
    const char = getCharacter(charId);
    if (!char) return;
    const name = e.detail?.name;
    if (!name) return;
    getCharacterAI()?.onUserActivity(true);
    animationManager?.stop();
    animationManager?.setLastActivity();
    logger.info('messaging', 'Animation command', { name });

    const cmd = animationCommands[name];
    if (cmd) {
      cmd(char, charId, name);
      return;
    }
    const action = getAction(charId, name);
    if (action) fadeToAction(char, action, 0.5);
  }

  function setupCharacterEventSubscribers() {
    subscribe(APP_EVENTS['app:character:skin-change'], (e) =>
      handleCharacterSkinChange(e as CustomEvent<{ characterId?: string; path: string }>)
    );
    subscribe(APP_EVENTS['app:character:animation-play'], (e) =>
      handleCharacterAnimationPlay(e as CustomEvent<{ characterId?: string; name: string }>)
    );
  }

  function setupSocketEvents(socketManager: SocketManager | null): void {
    if (!socketManager) return;

    socketManager.on('skin', (data) => {
      const name = data.name ?? '';
      const skinPath = resolveSkinByName(name) ?? name;
      if (skinPath) publish(APP_EVENTS['app:character:skin-change'], { path: skinPath });
    });

    socketManager.on('animation', (data) => {
      const name = data.name;
      if (name) publish(APP_EVENTS['app:character:animation-play'], { name });
    });
  }

  return {
    setupCharacterEventSubscribers,
    setupSocketEvents,
  };
}
