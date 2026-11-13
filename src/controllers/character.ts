/**
 * Character loading and actions: loadCharacter, getCharacter, fadeToAction,
 * getAction, switchSkin, resolveAnimationByName, resolveSkinByName.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { logger } from '../lib';
import { PREFERRED_IDLE_KEYS } from '../config/scene.config';
import type { TexturePreset, AlphaMode } from '../viewer';
import type { CharacterState, CharacterConfig } from './characterTypes';
import type { SkinEntry, AnimationEntry } from '../domain';
import type { CharacterStateLike } from '../animation';

export type CharacterControllerDeps = {
  getSceneContext: () => { scene: THREE.Scene; characters: Record<string, CharacterState> };
  preprocessSkinTexture: (tex: THREE.Texture) => THREE.Texture;
  applySkinToModel: (
    model: THREE.Group,
    texture: THREE.Texture,
    preset: TexturePreset,
    alphaMode: AlphaMode,
    skinPath: string,
    modelPath?: string
  ) => void;
  applyShadowToModel: (model: THREE.Group) => void;
  createDebugTexture: (w: number, h: number) => THREE.CanvasTexture;
  logMeshNames: (model: THREE.Group, label: string) => void;
  logModelUVInfo: (model: THREE.Group, label: string) => void;
  getSkinsList: () => SkinEntry[];
  getAnimationsList: () => AnimationEntry[];
  getRoute: () => 'creator' | 'viewer' | 'preview';
  onFirstCharacterReady: (skins: SkinEntry[], animations: AnimationEntry[], sequences: unknown[]) => void;
  getSequencesList: () => unknown[];
  onPreviewRouteAfterCharacterReady: () => void;
  getCreatorPoseController: () => {
    isCreatorIdleCompletingTransition: () => boolean;
    applyCreatorCharacterPose: (detail?: { mode?: string }) => void;
  } | null;
  getCreatorTransitionInFlight?: () => boolean;
  getAnimationManager: () => {
    isInWalkToPhase?: () => boolean;
    isBusy?: () => boolean;
  } | null;
  highlightActiveButton: (charId: string, action: THREE.AnimationAction) => void;
  highlightActiveSkin: (charId: string, skinPath: string) => void;
  useDebugTexture?: boolean;
  logModelInfo?: boolean;
};

export type CharacterController = {
  getCharacter: (id: string) => CharacterState | undefined;
  loadCharacter: (config: CharacterConfig, skins: SkinEntry[]) => void;
  fadeToAction: (char: CharacterStateLike, next: THREE.AnimationAction, duration?: number) => void;
  getAction: (charId: string, key: string) => THREE.AnimationAction | undefined;
  switchSkin: (charId: string, skinPath: string) => void;
  resolveAnimationByName: (name: string) => string | undefined;
  resolveSkinByName: (name: string) => string | undefined;
};

export function createCharacterController(deps: CharacterControllerDeps): CharacterController {
  const {
    getSceneContext,
    preprocessSkinTexture,
    applySkinToModel,
    applyShadowToModel,
    createDebugTexture,
    logMeshNames,
    logModelUVInfo,
    getSkinsList,
    getAnimationsList,
    getRoute,
    onFirstCharacterReady,
    getSequencesList,
    onPreviewRouteAfterCharacterReady,
    getCreatorPoseController,
    getCreatorTransitionInFlight = () => false,
    getAnimationManager,
    highlightActiveButton,
    highlightActiveSkin,
    useDebugTexture = false,
    logModelInfo = false,
  } = deps;

  function getCharacter(id: string): CharacterState | undefined {
    return getSceneContext().characters[id] as CharacterState | undefined;
  }

  function fadeToAction(
    char: CharacterStateLike,
    next: THREE.AnimationAction,
    duration = 0.5
  ): void {
    const fromAction = char.currentAction as THREE.AnimationAction | null;
    const fromClipName = (fromAction as unknown as { _clip?: { name?: string } })?._clip?.name ?? 'none';
    const toClipName = (next as unknown as { _clip?: { name?: string } })._clip?.name ?? 'unknown';

    if (fromAction === next) {
      logger.debug('animation', 'Fade to action (no-op, already active)', {
        action: toClipName,
        actionTime: Number(next.time.toFixed(3)),
      });
      return;
    }

    logger.debug('animation', 'Fade to action (crossfade)', {
      from: fromClipName,
      to: toClipName,
      duration,
      fromTime: fromAction ? Number(fromAction.time.toFixed(3)) : null,
      toTimeBeforeReset: Number(next.time.toFixed(3)),
    });

    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);

    if (fromAction) {
      fromAction.crossFadeTo(next, duration, false);
    } else {
      next.fadeIn(duration);
    }

    next.play();
    next.paused = false;
    (char as CharacterState).currentAction = next;

    highlightActiveButton(char.id, next);
  }

  function resolveSkinByName(name: string): string | undefined {
    if (!name) return undefined;
    const skins = getSkinsList();
    const n = name.toLowerCase().replace(/\s+/g, '-').trim();
    const exact = skins.find((s) => s.path === name || s.path === `/${name}`.replace(/\/+/g, '/'));
    if (exact) return exact.path;
    return skins.find((s) => {
      const pathNorm = s.path.toLowerCase();
      const labelNorm = s.label.toLowerCase().replace(/\s+/g, '-');
      const base = pathNorm.split('/').pop()?.replace(/\.(png|jpg|jpeg)$/, '') ?? '';
      return pathNorm.endsWith(`/${n}.png`) || base === n || labelNorm === n || pathNorm.includes(n);
    })?.path;
  }

  function resolveAnimationByName(name: string): string | undefined {
    if (!name) return undefined;
    const animations = getAnimationsList();
    const n = name.toLowerCase().replace(/\s+/g, '-').trim();
    const exact = animations.find((a) => a.key === name || a.key === n);
    if (exact) return exact.key;
    return animations.find((a) => {
      const keyNorm = a.key.toLowerCase();
      const labelNorm = a.label.toLowerCase().replace(/\s+/g, '-');
      return keyNorm === n || labelNorm === n || keyNorm.includes(n) || labelNorm.includes(n);
    })?.key;
  }

  function getAction(charId: string, key: string): THREE.AnimationAction | undefined {
    const char = getCharacter(charId);
    if (!char) return undefined;
    const resolved = resolveAnimationByName(key) ?? key.toLowerCase().replace(/\s+/g, '-');
    if (resolved === 'back-to-idle') return char.idleAction;
    return (
      char.actions[resolved] ??
      PREFERRED_IDLE_KEYS.map((k) => char.actions[k]).find(Boolean) ??
      Object.values(char.actions)[0]
    );
  }

  function switchSkin(charId: string, skinPath: string) {
    const char = getCharacter(charId);
    if (!char || char.currentSkin === skinPath) return;

    const loader = new THREE.TextureLoader();
    loader.load(
      skinPath,
      (texture) => {
        const processed = preprocessSkinTexture(texture);
        applySkinToModel(char.model, processed, char.texturePreset, char.alphaMode, skinPath);
        char.currentSkin = skinPath;
        highlightActiveSkin(charId, skinPath);
      },
      undefined,
      (err) => logger.error('general', 'Skin load error', { path: skinPath, error: String(err) })
    );
  }

  function loadCharacter(config: CharacterConfig, skins: SkinEntry[]) {
    const fbxLoader = new FBXLoader();
    const textureLoader = new THREE.TextureLoader();
    const animationsList = getAnimationsList();

    const loadModel = (texture: THREE.Texture | null) => {
      fbxLoader.load(
        config.model,
        (model) => {
          logger.info('general', 'Model loaded', { label: config.label });

          model.scale.setScalar(0.01);
          model.position.set(0, 0, 0);
          if (logModelInfo) {
            logMeshNames(model, config.label);
            logModelUVInfo(model, config.label);
          }
          if (texture) {
            const texToUse = useDebugTexture ? createDebugTexture(64, 64) : texture;
            applySkinToModel(model, texToUse, config.texturePreset, config.alphaMode, config.skin, config.model);
          }
          applyShadowToModel(model);

          const container = new THREE.Group();
          container.position.copy(config.position);
          container.add(model);
          // Hide until the idle pose is applied: otherwise the raw bind pose renders
          // while animation clips load, then snaps down — reads as a "jump" on startup.
          container.visible = false;
          getSceneContext().scene.add(container);

          const mixer = new THREE.AnimationMixer(model);
          const actions: Record<string, THREE.AnimationAction> = {};
          let loadedCount = 0;

          const onClipLoaded = (animFbx: THREE.Group, key: string) => {
            if (!animFbx.animations.length) return;
            animFbx.animations.forEach((clip) => {
              const action = mixer.clipAction(clip, model);
              action.setLoop(THREE.LoopRepeat, Infinity);
              actions[key] = action;
            });
            loadedCount++;
            if (loadedCount === config.animations.length) {
              logger.info('animation', 'Actions loaded', {
                count: Object.keys(actions).length,
                keys: Object.keys(actions).join(', '),
              });
              const idleKey = PREFERRED_IDLE_KEYS.find((k) => actions[k]) ?? Object.keys(actions)[0];
              const idleAction = idleKey ? actions[idleKey] : Object.values(actions)[0];
              getSceneContext().characters[config.id] = {
                id: config.id,
                container,
                model,
                mixer,
                actions,
                currentAction: null,
                idleAction,
                texturePreset: config.texturePreset,
                alphaMode: config.alphaMode,
                currentSkin: config.skin,
              } as CharacterState;

              mixer.addEventListener('finished', () => {
                const char = getSceneContext().characters[config.id] as CharacterState | undefined;
                if (!char) return;
                if (getRoute() === 'creator') {
                  const cpc = getCreatorPoseController();
                  if (cpc?.isCreatorIdleCompletingTransition()) return;
                  cpc?.applyCreatorCharacterPose();
                  return;
                }
                if (getCreatorTransitionInFlight()) return;
                if (!char.idleAction || char.currentAction === char.idleAction) return;
                if (getAnimationManager()?.isInWalkToPhase?.() || getAnimationManager()?.isBusy?.()) return;
                fadeToAction(char, char.idleAction!, 0.3);
              });

              if (idleAction) fadeToAction(getSceneContext().characters[config.id] as CharacterState, idleAction, 0);

              if (getRoute() === 'creator') {
                getCreatorPoseController()?.applyCreatorCharacterPose();
              }

              // Evaluate the pose now so the first visible frame is already posed.
              mixer.update(0);
              container.visible = true;

              if (Object.keys(getSceneContext().characters).length === 1) {
                onFirstCharacterReady(skins, animationsList, getSequencesList());
              }

              if (getRoute() === 'preview') {
                window.setTimeout(() => onPreviewRouteAfterCharacterReady(), 0);
              }
            }
          };

          const anims = config.animations;
          for (const { path, key } of anims) {
            fbxLoader.load(
              path,
              (animFbx) => onClipLoaded(animFbx, key),
              undefined,
              (err) => {
                logger.error('general', 'FBX load failed', { path, error: String(err) });
                container.visible = true; // don't leave the character invisible forever
              }
            );
          }
        },
        undefined,
        (err) => logger.error('general', 'Model load error', { model: config.model, error: String(err) })
      );
    };

    if (config.skin) {
      textureLoader.load(
        config.skin,
        (texture) => loadModel(preprocessSkinTexture(texture)),
        undefined,
        () => loadModel(null)
      );
    } else {
      loadModel(null);
    }
  }

  return {
    getCharacter,
    loadCharacter,
    fadeToAction,
    getAction,
    switchSkin,
    resolveAnimationByName,
    resolveSkinByName,
  };
}
