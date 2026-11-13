/**
 * Character state and config types. Lives in controllers to avoid domain→viewer dependency.
 */

import * as THREE from 'three';
import type { TexturePreset, AlphaMode } from '../viewer';
import type { AnimationEntry } from '../domain';
import { DEFAULT_CHARACTER_ID } from '../domain';
import { ARM_MODEL_PATHS } from '../skin/armModel';

export type CharacterState = {
  id: string;
  /** Root container we move during walkTo (model is child at 0,0,0) — isolates root motion */
  container: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | undefined;
  texturePreset: TexturePreset;
  alphaMode: AlphaMode;
  currentSkin: string;
  /** Path of the loaded rig (slim vs classic arms). */
  modelPath: string;
  /** Loaded clips by key, kept so a model swap can rebind them without refetching. */
  clips: Record<string, THREE.AnimationClip>;
};

export type CharacterConfig = {
  id: string;
  label: string;
  model: string;
  skin: string;
  texturePreset: TexturePreset;
  alphaMode: AlphaMode;
  animations: Array<{ path: string; key: string }>;
  position: THREE.Vector3;
};

export function buildCharacterConfig(
  skinPath: string,
  animations: AnimationEntry[],
  id: string = DEFAULT_CHARACTER_ID,
  modelPath: string = ARM_MODEL_PATHS.slim
): CharacterConfig {
  return {
    id,
    label: 'Runningboy',
    model: modelPath,
    skin: skinPath,
    texturePreset: 'clamped-flip',
    alphaMode: 'transparent',
    animations: animations.map((a) => ({ path: a.path, key: a.key })),
    position: new THREE.Vector3(0, 0, 0),
  };
}
