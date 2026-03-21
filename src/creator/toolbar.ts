import type { ColorToolbarContext } from './api';

export function buildColorToolbar(ctx: ColorToolbarContext): void {
  ctx.applyColor(ctx.getCurrentColor(), true, false); // sync to swatch, do not mark as user-selected
}
