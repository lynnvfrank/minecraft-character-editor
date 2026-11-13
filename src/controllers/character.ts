/**
 * Character loading and actions: loadCharacter, getCharacter, fadeToAction,
 * getAction, switchSkin, resolveAnimationByName, resolveSkinByName.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { logger } from '../lib';
import { loadRig } from '../viewer/rigLoader';
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
  setModel: (charId: string, modelPath: string) => Promise<void>;
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

  /** When a one-shot clip finishes, return to idle (or the creator pose). */
  function attachFinishedHandler(mixer: THREE.AnimationMixer, charId: string): void {
    mixer.addEventListener('finished', () => {
      const char = getCharacter(charId);
      if (!char || char.mixer !== mixer) return;
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
  }

  /** Model load is async; remember the latest request so rapid toggles settle on the last one. */
  const pendingModelSwap: Record<string, string> = {};

  /**
   * Swap the character's rig (e.g. slim ↔ classic arms) in place.
   * Keeps the container (position/facing), current skin texture, and the playing clip + time.
   */
  function setModel(charId: string, modelPath: string): Promise<void> {
    const char = getCharacter(charId);
    if (!char || char.modelPath === modelPath) {
      delete pendingModelSwap[charId];
      return Promise.resolve();
    }
    pendingModelSwap[charId] = modelPath;
    return new Promise((resolve) => {
      loadRig(
        modelPath,
        (model) => {
          const current = getCharacter(charId);
          if (!current || pendingModelSwap[charId] !== modelPath) return resolve();
          delete pendingModelSwap[charId];

          model.scale.copy(current.model.scale);
          model.position.copy(current.model.position);
          model.rotation.copy(current.model.rotation);

          // Reuse whatever texture is on the old rig (viewer skin or creator canvas texture).
          let texture: THREE.Texture | null = null;
          current.model.traverse((obj) => {
            const mat = (obj as THREE.Mesh).material as THREE.MeshPhongMaterial | undefined;
            if (!texture && (obj as THREE.Mesh).isMesh && mat?.map) texture = mat.map;
          });
          if (texture) {
            applySkinToModel(model, texture, current.texturePreset, current.alphaMode, current.currentSkin, modelPath);
          }
          applyShadowToModel(model);

          const mixer = new THREE.AnimationMixer(model);
          const actions: Record<string, THREE.AnimationAction> = {};
          for (const [key, clip] of Object.entries(current.clips)) {
            const prev = current.actions[key];
            const action = mixer.clipAction(clip, model);
            action.setLoop(prev?.loop ?? THREE.LoopRepeat, prev?.repetitions ?? Infinity);
            action.clampWhenFinished = prev?.clampWhenFinished ?? false;
            actions[key] = action;
          }
          const keyOf = (a: THREE.AnimationAction | null | undefined) =>
            a ? Object.keys(current.actions).find((k) => current.actions[k] === a) : undefined;
          const currentKey = keyOf(current.currentAction);
          const idleKey = keyOf(current.idleAction);

          let nextCurrent: THREE.AnimationAction | null = null;
          if (currentKey && actions[currentKey] && current.currentAction) {
            nextCurrent = actions[currentKey];
            nextCurrent.time = current.currentAction.time;
            nextCurrent.setEffectiveWeight(1);
            nextCurrent.play();
          }

          current.container.remove(current.model);
          current.mixer.stopAllAction();
          current.container.add(model);

          current.model = model;
          current.mixer = mixer;
          current.actions = actions;
          current.currentAction = nextCurrent;
          current.idleAction = idleKey ? actions[idleKey] : undefined;
          current.modelPath = modelPath;
          attachFinishedHandler(mixer, charId);
          mixer.update(0);

          logger.info('general', 'Model swapped', { charId, modelPath });
          resolve();
        },
        (err) => {
          logger.error('general', 'Model swap failed', { modelPath, error: String(err) });
          resolve();
        }
      );
    });
  }

  function loadCharacter(config: CharacterConfig, skins: SkinEntry[]) {
    const fbxLoader = new FBXLoader();
    const textureLoader = new THREE.TextureLoader();
    const animationsList = getAnimationsList();

    const loadModel = (texture: THREE.Texture | null) => {
      loadRig(
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
          getSceneContext().scene.add(container);

          const mixer = new THREE.AnimationMixer(model);
          const actions: Record<string, THREE.AnimationAction> = {};
          const clips: Record<string, THREE.AnimationClip> = {};
          let loadedCount = 0;

          const onClipLoaded = (animFbx: THREE.Group, key: string) => {
            if (!animFbx.animations.length) return;
            animFbx.animations.forEach((clip) => {
              const action = mixer.clipAction(clip, model);
              action.setLoop(THREE.LoopRepeat, Infinity);
              actions[key] = action;
              clips[key] = clip;
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
                modelPath: config.model,
                clips,
              } as CharacterState;

              attachFinishedHandler(mixer, config.id);

              if (idleAction) fadeToAction(getSceneContext().characters[config.id] as CharacterState, idleAction, 0);

              if (getRoute() === 'creator') {
                getCreatorPoseController()?.applyCreatorCharacterPose();
              }

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
              (err) => logger.error('general', 'FBX load failed', { path, error: String(err) })
            );
          }
        },
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
    setModel,
    resolveAnimationByName,
    resolveSkinByName,
  };
}
