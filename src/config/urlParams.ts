/**
 * URL query parameter parsing and derived configuration.
 */

import type { TurnStrategy } from '../animation';

export function getUrlSearchParams(): URLSearchParams {
  return typeof window !== 'undefined'
    ? new URLSearchParams(location.search)
    : new URLSearchParams();
}

export type UrlParamsConfig = {
  defaultSceneFov: number;
  isTestMode: boolean;
  showPreviewCameraControls: boolean;
  creatorIdleTransitionMinDurationSec: number;
};

export function parseUrlParamsConfig(params: URLSearchParams): UrlParamsConfig {
  const previewControls = (params.get('previewcontrols') ?? params.get('previewControls') ?? '').toLowerCase();
  return {
    defaultSceneFov: Number.parseFloat(params.get('fov') || '45'),
    isTestMode: params.get('movementcontrols') === '1',
    showPreviewCameraControls:
      previewControls === '1' || previewControls === 'true' || previewControls === 'on',
    creatorIdleTransitionMinDurationSec: Number.parseFloat(
      params.get('creatorIdleMinDuration') || '0.3'
    ),
  };
}

export const TURN_STRATEGIES: TurnStrategy[] = ['lerp', 'snap', 'reset'];

export function parseTurnStrategy(p: URLSearchParams): TurnStrategy {
  const v = p.get('turn');
  if (v === 'snap' || v === 'lerp' || v === 'reset') return v;
  return 'lerp';
}
