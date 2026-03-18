import type { ColorToolbarContext } from './api';

export function buildColorToolbar(ctx: ColorToolbarContext): void {
  ctx.applyColor(ctx.getCurrentColor());
}
