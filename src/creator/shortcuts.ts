/**
 * Creator keyboard shortcut bindings. Data-driven to avoid switch/case.
 * Add new shortcuts by extending KEY_BINDINGS or CTRL_KEY_BINDINGS.
 */
import type { EditMode } from './api';
import { EDIT_MODE_2D, EDIT_MODE_3D } from './api';

export type EditorToolShortcutDeps = {
  getEditMode: () => EditMode;
  setEditMode: (mode: EditMode) => void;
  setActiveTool: (tool: 'navigate' | 'brush' | 'eraser' | 'fill') => void;
  performUndo: () => void;
  performRedo: () => void;
  addToSwatch: (color: string) => void;
  getCurrentColor: () => string;
  updateAllUndoRedoButtons: () => void;
};

export function createEditorToolKeyBindings(
  deps: EditorToolShortcutDeps
): {
  keyBindings: Record<string, (e: KeyboardEvent) => void>;
  ctrlKeyBindings: Record<string, (e: KeyboardEvent) => void>;
} {
  const {
    getEditMode,
    setEditMode,
    setActiveTool,
    performUndo,
    performRedo,
    addToSwatch,
    getCurrentColor,
    updateAllUndoRedoButtons,
  } = deps;

  const keyBindings: Record<string, (e: KeyboardEvent) => void> = {
    Tab: (e) => {
      e.preventDefault();
      setEditMode(getEditMode() === EDIT_MODE_3D ? EDIT_MODE_2D : EDIT_MODE_3D);
    },
    h: (e) => {
      e.preventDefault();
      setActiveTool('navigate');
    },
    H: (e) => {
      e.preventDefault();
      setActiveTool('navigate');
    },
    b: (e) => {
      e.preventDefault();
      setActiveTool('brush');
    },
    B: (e) => {
      e.preventDefault();
      setActiveTool('brush');
    },
    e: (e) => {
      e.preventDefault();
      setActiveTool('eraser');
    },
    E: (e) => {
      e.preventDefault();
      setActiveTool('eraser');
    },
    g: (e) => {
      e.preventDefault();
      setActiveTool('fill');
    },
    G: (e) => {
      e.preventDefault();
      setActiveTool('fill');
    },
  };

  const ctrlKeyBindings: Record<string, (e: KeyboardEvent) => void> = {
    z: (e) => {
      e.preventDefault();
      if (e.shiftKey) performRedo();
      else performUndo();
      updateAllUndoRedoButtons();
    },
    '=': (e) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      addToSwatch(getCurrentColor());
    },
    '+': (e) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      addToSwatch(getCurrentColor());
    },
  };

  return { keyBindings, ctrlKeyBindings };
}
