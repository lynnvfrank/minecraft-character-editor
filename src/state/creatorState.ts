/**
 * Creator state: single source of truth for all creator UI and editing state.
 * Consolidates module-level variables from creator.ts.
 * Panels receive context objects that read from this state.
 */

import type { DrawingTool } from '../creator/api';
import type { PaintBrushSize } from '../config/paintBrushTool';
import { PAINT_BRUSH_TOOL_CONFIG } from '../config/paintBrushTool';
import { LAYER_KEYS } from '../skin';

export type PixelChange = { x: number; y: number; r: number; g: number; b: number; a: number };

export type UndoCommand =
  | {
      type: 'stroke';
      pixels: PixelChange[];
      isEraser: boolean;
      newColor: string;
      /** Per-texel result after stroke (e.g. soft paint brush); redo uses this instead of `newColor`. */
      afterPixels?: PixelChange[];
    }
  | { type: 'fill'; pixels: PixelChange[]; fillColor: string }
  | { type: 'load'; beforeData: Uint8ClampedArray; afterData: Uint8ClampedArray };

export type CurrentStroke = {
  pixels: PixelChange[];
  isEraser: boolean;
  newColor: string;
  recorded: Set<string>;
};

export interface CreatorState {
  /** Currently selected color (hex). */
  currentColor: string;
  /** Recent colors in History palette (newest first). */
  swatchColors: string[];
  /** Colors extracted from current skin (read-only, updated on skin load). */
  skinSwatchColors: string[];
  /** Active swatch palette: 'history' | 'skin'. */
  activeSwatchPalette: 'history' | 'skin';
  /** Active drawing tool. */
  activeTool: DrawingTool;
  /** Edit mode: 'wardrobe' | '2d' | '3d'. */
  editMode: 'wardrobe' | '2d' | '3d';
  /** Per-layer visibility (hidden = not rendered, pencil ignored). */
  layer3DVisible: Record<string, boolean>;
  /** Per-layer, per-side visibility overrides (L/R). When undefined, part follows layer visibility. */
  layer3DPartVisible: Partial<Record<string, { L?: boolean; R?: boolean }>>;
  /** Per-layer lock (locked = pencil ignored, part stays visible). */
  layer3DLocked: Record<string, boolean>;

  /** Solo visibility mode: Alt+click eye. */
  layer3DSoloMode: boolean;
  layer3DSoloBeforeState: Record<string, boolean> | null;
  layer3DSoloCurrentLayer: string | null;
  /** Solo lock mode: Alt+click lock. */
  layer3DSoloLockMode: boolean;
  layer3DSoloLockBeforeState: Record<string, boolean> | null;
  layer3DSoloLockCurrentLayer: string | null;

  /** Ruler overlay visible. */
  showRulers: boolean;
  /** Template overlay (region outlines) visible. */
  showTemplate: boolean;
  /** Layers panel collapsed. */
  layersPanel3DCollapsed: boolean;

  /** Undo/redo stacks. */
  undoStack: UndoCommand[];
  redoStack: UndoCommand[];
  /** Stroke in progress (pencil/eraser drag). */
  currentStroke: CurrentStroke | null;

  /** Stroke tracking. */
  isDrawing: boolean;
  lastSkinX: number;
  lastSkinY: number;

  /** 2D mode: which layers are selected for painting. */
  selectedLayers: Set<string>;
  /** When false, allow drawing anywhere (ignore layer mask). */
  restrictToLayers: boolean;

  /** True after user explicitly picks a color (swatch, eyedropper, picker). When false, skin load sets currentColor to first skin color. */
  userHasSelectedColor: boolean;

  /** Soft paint brush: width/height in skin pixels (64 layout); see `paintBrushWorkingDimensions`. */
  paintBrushSize: PaintBrushSize;
  /** Soft paint brush: 1 = hardest edge, maxSoftness = softest (see paintBrushTool config). */
  paintBrushSoftness: number;

  /** Guided mode: wardrobe camera + focused solo / compact UI. Default on. */
  focusedCreationEnabled: boolean;
  /**
   * When false and focused solo applies, layers panel lists only currently visible rows until user expands.
   * Preserved when switching 3D↔2D; reset when leaving wardrobe for 3D/2D (see focusedCreationController).
   */
  layersPanelFocusedListExpanded: boolean;
}

const DEFAULT_COLOR = '#FFFFFF';

/** Create initial creator state. */
export function createCreatorState(): CreatorState {
  return {
    currentColor: DEFAULT_COLOR,
    swatchColors: [DEFAULT_COLOR],
    skinSwatchColors: [],
    activeSwatchPalette: 'skin',
    activeTool: 'navigate',
    editMode: 'wardrobe',
    layer3DVisible: Object.fromEntries(LAYER_KEYS.map((k) => [k, true])),
    layer3DPartVisible: {},
    layer3DLocked: Object.fromEntries(LAYER_KEYS.map((k) => [k, false])),
    layer3DSoloMode: false,
    layer3DSoloBeforeState: null,
    layer3DSoloCurrentLayer: null,
    layer3DSoloLockMode: false,
    layer3DSoloLockBeforeState: null,
    layer3DSoloLockCurrentLayer: null,
    showRulers: false,
    showTemplate: true,
    layersPanel3DCollapsed: false,
    undoStack: [],
    redoStack: [],
    currentStroke: null,
    isDrawing: false,
    lastSkinX: -1,
    lastSkinY: -1,
    selectedLayers: new Set(LAYER_KEYS),
    restrictToLayers: true,
    userHasSelectedColor: false,
    paintBrushSize: { ...PAINT_BRUSH_TOOL_CONFIG.defaultSize },
    paintBrushSoftness: PAINT_BRUSH_TOOL_CONFIG.defaultSoftness,
    focusedCreationEnabled: true,
    layersPanelFocusedListExpanded: true,
  };
}
