import type { LayerKey } from '../skin';

export type PreviewPresetKey =
  | 'fullOutfit'
  | 'hat'
  | 'head'
  | 'jacket'
  | 'body'
  | 'arms'
  | 'sleeves'
  | 'pants'
  | 'legs'
  | 'torso'
  | 'jacketGroup'
  | 'bottom'
  | 'center'
  | 'top'
  | 'all';

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
