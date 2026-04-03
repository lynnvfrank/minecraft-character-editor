/**
 * PaperCSS class hooks for DOM builders. Respects {@link PAPER_UI_OPT_OUT} in `config/paperUiSurfaces.ts`.
 * Builtin theme: these strings are inert (no matching CSS).
 * Scoped overrides: `src/styles/themes/_papercss.scss`.
 */

import { paperHooksEnabled, type PaperUiSurfaceId } from '../config/paperUiSurfaces';

export function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function paperCard(surface: PaperUiSurfaceId | string): string {
  return paperHooksEnabled(surface) ? 'card' : '';
}

export type PaperBtnVariant = 'sm' | 'primarySm' | 'secondaryOutlineSm';

const BTN_VARIANT_CLASSES: Record<PaperBtnVariant, string> = {
  sm: 'paper-btn btn-small',
  primarySm: 'paper-btn btn-small btn-primary',
  secondaryOutlineSm: 'paper-btn btn-small btn-secondary-outline',
};

export function paperBtn(surface: PaperUiSurfaceId | string, variant: PaperBtnVariant = 'sm'): string {
  return paperHooksEnabled(surface) ? BTN_VARIANT_CLASSES[variant] : '';
}
