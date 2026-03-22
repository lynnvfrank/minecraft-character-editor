/**
 * Context objects passed from creator.ts to panel builders.
 * Avoids circular imports by inverting the dependency.
 */

export const EDIT_MODE_2D = '2d';
export const EDIT_MODE_3D = '3d';
export const EDIT_MODE_WARDROBE = 'wardrobe';
export type EditMode = typeof EDIT_MODE_2D | typeof EDIT_MODE_3D | typeof EDIT_MODE_WARDROBE;

export type DrawingTool = 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'navigate';

export const TOOL_LABELS: Record<DrawingTool, string> = {
  brush: 'Brush',
  eraser: 'Eraser',
  fill: 'Fill',
  eyedropper: 'Dropper',
  navigate: 'Navigate',
};

const DRAWING_TOOLS: readonly DrawingTool[] = ['brush', 'eraser', 'fill', 'eyedropper', 'navigate'];

export function isDrawingTool(s: string | undefined): s is DrawingTool {
  return s != null && (DRAWING_TOOLS as readonly string[]).includes(s);
}

export type ToggleType = 'rulers' | 'template';

const TOGGLE_TYPES: readonly ToggleType[] = ['rulers', 'template'];

export function isToggleType(s: string | undefined): s is ToggleType {
  return s != null && (TOGGLE_TYPES as readonly string[]).includes(s);
}

export interface ColorToolbarContext {
  getCurrentColor: () => string;
  applyColor: (hex: string, addToSwatch?: boolean, markAsUserSelected?: boolean) => void;
}

export interface ColorPickerContext {
  getCurrentColor: () => string;
  applyColor: (hex: string, addToSwatch?: boolean, markAsUserSelected?: boolean) => void;
}

export type SwatchPaletteId = 'history' | 'skin';

export interface SwatchesContext {
  getSwatchColors: () => string[];
  getSwatchColorsForPalette: (paletteId: SwatchPaletteId) => string[];
  getCurrentColor: () => string;
  getMaxSwatchCount: () => number;
  getActivePalette: () => SwatchPaletteId;
  setActivePalette: (paletteId: SwatchPaletteId) => void;
  applyColor: (hex: string, addToSwatch?: boolean, markAsUserSelected?: boolean) => void;
  setSwatchColor: (index: number, hex: string) => void;
}

export type PartSide = 'L' | 'R';

export interface SkinLayersContext {
  layerVisibility: Record<string, boolean>;
  layerPartVisible: Partial<Record<string, { L?: boolean; R?: boolean }>>;
  layerLocked: Record<string, boolean>;
  isLayersPanelCollapsed: () => boolean;
  setLayersPanelCollapsed: (collapsed: boolean) => void;
  setLayerVisible: (layer: string, visible: boolean) => void;
  setLayerPartVisible: (layer: string, side: PartSide, visible: boolean) => void;
  getPartVisible: (layer: string, side: PartSide) => boolean;
  setLayerLocked: (layer: string, locked: boolean) => void;
  onVisibilitySoloClick: (layer: string) => void;
  onLockSoloClick: (layer: string) => void;
  syncVisibilityCheckboxes: (panel: HTMLElement) => void;
  syncLockCheckboxes: (panel: HTMLElement) => void;
  clearSoloIndicator: (panel: HTMLElement) => void;
  setupDragToToggle: (
    panel: HTMLElement,
    labelSelector: string,
    inputSelector: string,
    getValue: (layer: string) => boolean,
    setValue: (layer: string, value: boolean) => void,
    sync: (panel: HTMLElement) => void,
    canStartDrag?: (e: Event) => boolean
  ) => void;
  layerGroups: readonly (readonly string[])[];
}

export interface EditorToolsContext {
  getActiveTool: () => DrawingTool;
  getEditMode: () => EditMode;
  isEditMode3D: () => boolean;
  isRulersShown: () => boolean;
  isTemplateShown: () => boolean;
  setActiveTool: (tool: DrawingTool) => void;
  setEditMode: (mode: EditMode) => void;
  setEditMode3D: (is3D: boolean) => void;
  setRulersShown: (show: boolean) => void;
  setTemplateShown: (show: boolean) => void;
  performUndo: () => void;
  performRedo: () => void;
  updateUndoRedoButtons: () => void;
  renderCanvas: () => void;
  updateCanvasCursor: () => void;
}
