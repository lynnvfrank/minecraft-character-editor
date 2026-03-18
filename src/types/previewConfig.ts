import type { LayerKey } from '../skinLayout';

export type PreviewPresetKey =
  | 'fullOutfit'
  | 'hat'
  | 'head'
  | 'jacket'
  | 'body'
  | 'arms'
  | 'sleeves'
  | 'pants'
  | 'legs';

export type PreviewVector = {
  x: number;
  y: number;
  z: number;
};

export type PreviewViewport = {
  width: number;
  height: number;
};

export type PreviewPreset = {
  visibleLayers: readonly LayerKey[];
  cameraPosition: PreviewVector;
  cameraTarget: PreviewVector;
  fov?: number;
  viewport: PreviewViewport;
};
