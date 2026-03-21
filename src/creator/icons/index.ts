/**
 * Creator icons — colocated with creator UI.
 * All icons use currentColor so they inherit the parent text color (theme-aware).
 * Use createIcon() as the single entry point.
 */

import modeHomeRaw from './mode.home.svg?raw';
import modeCreatorRaw from './mode.creator.svg?raw';
import modeCreatorKeepRaw from './mode.creator.keep.svg?raw';
import modeCreatorSaveRaw from './mode.creator.save.svg?raw';
import modeCreatorVisibleRaw from './mode.creator.visible.svg?raw';
import modeCreatorHiddenRaw from './mode.creator.hidden.svg?raw';
import modeCreatorLockRaw from './mode.creator.lock.svg?raw';
import modeCreatorUnlockRaw from './mode.creator.unlock.svg?raw';
import modeCreatorToolsNavigateRaw from './mode.creator.tools.navigate.svg?raw';
import modeCreatorToolsBrushRaw from './mode.creator.tools.brush.svg?raw';
import modeCreatorToolsErasorRaw from './mode.creator.tools.erasor.svg?raw';
import modeCreatorToolsFillRaw from './mode.creator.tools.fill.svg?raw';
import modeCreatorToolsDropperRaw from './mode.creator.tools.dropper.svg?raw';
import modeCreatorToolsUndoRaw from './mode.creator.tools.undo.svg?raw';
import modeCreatorToolsRedoRaw from './mode.creator.tools.redo.svg?raw';
import modeCreatorWardrobeRaw from './mode.creator.wardrobe.svg?raw';
import modeCreator2DRaw from './mode.creator.2D.svg?raw';
import modeCreator3DRaw from './mode.creator.3D.svg?raw';

const ICONS_RAW: Record<IconName, string> = {
  modeHome: modeHomeRaw,
  modeCreator: modeCreatorRaw,
  modeCreatorKeep: modeCreatorKeepRaw,
  modeCreatorSave: modeCreatorSaveRaw,
  modeCreatorVisible: modeCreatorVisibleRaw,
  modeCreatorHidden: modeCreatorHiddenRaw,
  modeCreatorLock: modeCreatorLockRaw,
  modeCreatorUnlock: modeCreatorUnlockRaw,
  modeCreatorToolsNavigate: modeCreatorToolsNavigateRaw,
  modeCreatorToolsBrush: modeCreatorToolsBrushRaw,
  modeCreatorToolsErasor: modeCreatorToolsErasorRaw,
  modeCreatorToolsFill: modeCreatorToolsFillRaw,
  modeCreatorToolsDropper: modeCreatorToolsDropperRaw,
  modeCreatorToolsUndo: modeCreatorToolsUndoRaw,
  modeCreatorToolsRedo: modeCreatorToolsRedoRaw,
  modeCreatorWardrobe: modeCreatorWardrobeRaw,
  modeCreator2D: modeCreator2DRaw,
  modeCreator3D: modeCreator3DRaw,
};

export type IconName = keyof typeof ICONS_RAW;

/** Convert SVG string to use currentColor for stroke/fill so it inherits text color. */
function svgToCurrentColor(svg: string): string {
  return svg
    .replace(/\bstroke="[^"]*"/g, 'stroke="currentColor"')
    .replace(/\bfill="(?!none)[^"]*"/g, 'fill="currentColor"')
    .replace(/fill:\s*#[0-9A-Fa-f]+/gi, 'fill:currentColor')
    .replace(/stroke:\s*#[0-9A-Fa-f]+/gi, 'stroke:currentColor');
}

export type CreateIconOptions = {
  width?: number;
  height?: number;
  className?: string;
};

/**
 * Create an inline SVG icon that inherits currentColor (matches parent text color).
 * Use this for all creator icons — they will follow light/dark mode and theming.
 */
export function createIcon(
  name: IconName,
  opts?: CreateIconOptions
): SVGSVGElement {
  const raw = ICONS_RAW[name];
  if (!raw) throw new Error(`Unknown icon: ${name}`);
  const str = svgToCurrentColor(raw);
  const div = document.createElement('div');
  div.innerHTML = str;
  const svg = div.querySelector('svg');
  if (!svg) throw new Error(`Invalid SVG: ${name}`);
  svg.setAttribute('aria-hidden', 'true');
  if (opts?.width) svg.setAttribute('width', String(opts.width));
  if (opts?.height) svg.setAttribute('height', String(opts.height));
  if (opts?.className) svg.setAttribute('class', opts.className);
  return svg;
}
