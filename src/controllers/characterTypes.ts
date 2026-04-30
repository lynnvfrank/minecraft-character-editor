/**
 * Character state and config types. Lives in controllers to avoid domain→viewer dependency.
 */

import * as THREE from 'three';
import type { TexturePreset, AlphaMode } from '../viewer';
import type { AnimationEntry } from '../domain';
import { DEFAULT_CHARACTER_ID } from '../domain';

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
  id: string = DEFAULT_CHARACTER_ID
): CharacterConfig {
  return {
    id,
    label: 'Runningboy',
    model: '/models/RunningboyRigSlim.fbx',
    skin: skinPath,
    texturePreset: 'clamped-flip',
    alphaMode: 'transparent',
    animations: animations.map((a) => ({ path: a.path, key: a.key })),
    position: new THREE.Vector3(0, 0, 0),
  };
}
