/**
 * Context objects passed from creator.ts to panel builders.
 * Avoids circular imports by inverting the dependency.
 */

export const EDIT_MODE_2D = '2d';
export const EDIT_MODE_3D = '3d';
export const EDIT_MODE_WARDROBE = 'wardrobe';
export type EditMode = typeof EDIT_MODE_2D | typeof EDIT_MODE_3D | typeof EDIT_MODE_WARDROBE;

export type DrawingTool = 'pencil' | 'eraser' | 'paintBrush' | 'fill' | 'eyedropper' | 'navigate';

export const TOOL_LABELS: Record<DrawingTool, string> = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  paintBrush: 'Brush',
  fill: 'Fill',
  eyedropper: 'Dropper',
  navigate: 'Navigate',
};

const DRAWING_TOOLS: readonly DrawingTool[] = ['pencil', 'eraser', 'paintBrush', 'fill', 'eyedropper', 'navigate'];

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
  /** Live read from creator state (for compact list filtering). */
  isLayer3DVisible: (layer: string) => boolean;
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
  /** No-op if not in Alt visibility solo. */
  exitVisibilitySoloRestore: () => void;
  clearVisibilitySoloFlags: () => void;
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
    canStartDrag?: (e: Event) => boolean,
    applyPartsWhileDragging?: boolean
  ) => void;
  setupPartDragToToggle: (panel: HTMLElement, sync: (panel: HTMLElement) => void) => void;
  layerGroups: readonly (readonly string[])[];
  getEditMode: () => EditMode;
  getFocusedCreationEnabled: () => boolean;
  getLayersPanelFocusedListExpanded: () => boolean;
  setLayersPanelFocusedListExpanded: (expanded: boolean) => void;
}

export interface EditorToolsContext {
  getActiveTool: () => DrawingTool;
  getEditMode: () => EditMode;
  isEditMode3D: () => boolean;
  isRulersShown: () => boolean;
  isTemplateShown: () => boolean;
  setActiveTool: (tool: DrawingTool) => void;
  setEditMode: (mode: EditMode, options?: { fromUserModeNavigation?: boolean }) => void;
  setEditMode3D: (is3D: boolean) => void;
  setRulersShown: (show: boolean) => void;
  setTemplateShown: (show: boolean) => void;
  performUndo: () => void;
  performRedo: () => void;
  updateUndoRedoButtons: () => void;
  renderCanvas: () => void;
  updateCanvasCursor: () => void;
}
