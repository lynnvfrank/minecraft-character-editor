/**
 * Wardrobe scene post-processing (pmndrs/postprocessing): presets, composition, render hook.
 * Active only in Creator.Wardrobe when a non-default preset is selected.
 */

import * as THREE from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  VignetteEffect,
} from 'postprocessing';

import type { WardrobePostFxPresetId } from '../domain/postFx';

export type PostFxPresetDefinition = {
  id: WardrobePostFxPresetId;
  label: string;
  /** Built-in effects for this preset (empty = renderer default path). */
  effects: Array<BloomEffect | VignetteEffect | ChromaticAberrationEffect>;
};

export type PostFxPipelineState = {
  activePresetId: WardrobePostFxPresetId;
  presets: readonly PostFxPresetDefinition[];
};

export type PostFxPipeline = {
  getState: () => PostFxPipelineState;
  setPreset: (id: WardrobePostFxPresetId) => void;
  /** True when the composer path should run this frame (creator + wardrobe + non-natural). */
  shouldUseComposer: () => boolean;
  renderWithComposer: () => void;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
};

export type PostFxPipelineDeps = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  shouldUseComposer: () => boolean;
};

function createPresetDefinitions(): PostFxPresetDefinition[] {
  return [
    {
      id: 'natural',
      label: 'Natural',
      effects: [],
    },
    {
      id: 'bloom',
      label: 'Bloom',
      effects: [
        new BloomEffect({
          intensity: 1.15,
          luminanceThreshold: 0.85,
          luminanceSmoothing: 0.35,
          mipmapBlur: true,
        }),
      ],
    },
    {
      id: 'cinema',
      label: 'Cinema',
      effects: [
        new BloomEffect({
          intensity: 0.55,
          luminanceThreshold: 0.92,
          luminanceSmoothing: 0.25,
          mipmapBlur: true,
        }),
        new VignetteEffect({ darkness: 0.42, offset: 0.35 }),
        new ChromaticAberrationEffect({
          offset: new THREE.Vector2(0.0012, 0.0008),
          radialModulation: true,
          modulationOffset: 0.15,
        }),
      ],
    },
  ];
}

export function createPostFxPipeline(deps: PostFxPipelineDeps): PostFxPipeline {
  const { renderer, scene, camera } = deps;
  const presets = createPresetDefinitions();
  const presetById = new Map(presets.map((p) => [p.id, p]));

  let activePresetId: WardrobePostFxPresetId = 'natural';

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let effectPass: EffectPass | null = null;

  function clearEffectPass(): void {
    if (!effectPass) return;
    composer.removePass(effectPass);
    effectPass.dispose();
    effectPass = null;
  }

  function applyPresetEffects(effects: PostFxPresetDefinition['effects']): void {
    clearEffectPass();
    if (effects.length === 0) return;
    effectPass = new EffectPass(camera, ...effects);
    composer.addPass(effectPass);
  }

  function rebuildComposerForCurrentPreset(): void {
    const def = presetById.get(activePresetId);
    if (!def) return;
    applyPresetEffects(def.effects);
  }

  rebuildComposerForCurrentPreset();

  return {
    getState: () => ({ activePresetId, presets }),

    setPreset(id: WardrobePostFxPresetId) {
      if (!presetById.has(id)) return;
      activePresetId = id;
      const def = presetById.get(id)!;
      applyPresetEffects(def.effects);
    },

    shouldUseComposer: () => deps.shouldUseComposer() && activePresetId !== 'natural',

    renderWithComposer() {
      composer.render();
    },

    setSize(width: number, height: number) {
      composer.setSize(width, height, false);
    },

    dispose() {
      clearEffectPass();
      composer.removePass(renderPass);
      renderPass.dispose();
      composer.dispose();
    },
  };
}
