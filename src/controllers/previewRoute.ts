/**
 * Preview route state: skin, baseSkin, part, cameraPreset from URL params or override.
 */

import { isPreviewPresetKey, type PreviewPresetKey } from '../viewer';

export type PreviewRoutePartKey = Exclude<PreviewPresetKey, 'fullOutfit'>;

export type PreviewRouteStateInput = {
  skin?: string | null;
  skinPath?: string | null;
  baseSkin?: string | null;
  baseSkinPath?: string | null;
  part?: string | null;
  cameraPreset?: string | null;
};

export type PreviewRouteInfo = {
  skinPath: string | null;
  baseSkinPath: string | null;
  part: PreviewRoutePartKey | null;
  cameraPreset: PreviewPresetKey;
  signature: string;
};

export type PreviewRouteController = {
  buildPreviewRouteInfo: (source: PreviewRouteStateInput) => PreviewRouteInfo;
  getPreviewRouteInfo: () => PreviewRouteInfo;
  setPreviewRouteOverride: (state: PreviewRouteStateInput | null) => void;
};

function normalizePreviewAssetPath(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('/') ? path : `/${path}`;
}

export function createPreviewRouteController(
  getParams: () => URLSearchParams
): PreviewRouteController {
  let previewRouteOverride: PreviewRouteInfo | null = null;

  function buildPreviewRouteInfo(source: PreviewRouteStateInput): PreviewRouteInfo {
    const part =
      isPreviewPresetKey(source.part) && source.part !== 'fullOutfit'
        ? source.part
        : null;
    const cameraPreset = isPreviewPresetKey(source.cameraPreset)
      ? source.cameraPreset
      : (part ?? 'fullOutfit');
    const skinPath = normalizePreviewAssetPath(source.skinPath ?? source.skin ?? null);
    const baseSkinPath = normalizePreviewAssetPath(
      source.baseSkinPath ?? source.baseSkin ?? null
    );
    return {
      skinPath,
      baseSkinPath,
      part,
      cameraPreset,
      signature: JSON.stringify({
        skinPath,
        baseSkinPath,
        part,
        cameraPreset,
      }),
    };
  }

  function setPreviewRouteOverride(state: PreviewRouteStateInput | null): void {
    if (!state) {
      previewRouteOverride = null;
      return;
    }
    previewRouteOverride = buildPreviewRouteInfo({
      skinPath: state.skinPath ?? state.skin ?? null,
      baseSkinPath: state.baseSkinPath ?? state.baseSkin ?? null,
      part: state.part ?? null,
      cameraPreset: state.cameraPreset ?? null,
    });
  }

  function getPreviewRouteInfo(): PreviewRouteInfo {
    if (previewRouteOverride) return previewRouteOverride;
    const params = getParams();
    return buildPreviewRouteInfo({
      skinPath: params.get('skin'),
      baseSkinPath: params.get('baseSkin'),
      part: params.get('part'),
      cameraPreset: params.get('cameraPreset'),
    });
  }

  return {
    buildPreviewRouteInfo,
    getPreviewRouteInfo,
    setPreviewRouteOverride,
  };
}
