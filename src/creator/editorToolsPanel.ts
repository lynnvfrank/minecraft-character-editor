import { creatorModeSlice, creatorToolsSlice } from '../state/creatorSlices';
import { createEl } from './dom';
import type { EditorToolsContext } from './api';
import { EDIT_MODE_2D, EDIT_MODE_3D, EDIT_MODE_WARDROBE, isDrawingTool, isToggleType } from './api';
import { createIcon } from './icons';

let toolShortcutKeyHandler: ((e: KeyboardEvent) => void) | null = null;

export function unregisterEditorToolShortcuts(): void {
  if (!toolShortcutKeyHandler) return;
  document.removeEventListener('keydown', toolShortcutKeyHandler);
  toolShortcutKeyHandler = null;
}

export function buildEditorToolsPanel(ctx: EditorToolsContext): void {
  const bottomCenterPanels = document.getElementById('creator-bottom-center-panels');
  const upperLeftPanels = document.getElementById('creator-upper-left-panels');
  if (!bottomCenterPanels || !upperLeftPanels) return;

  const oldModePanel = document.getElementById('creator-mode-panel');
  if (oldModePanel) oldModePanel.remove();

  const modeIconOpts = { width: 18, height: 18 };
  const modePanel = createEl('div', { id: 'creator-mode-panel', className: 'creator-mode-panel', role: 'group', 'aria-label': 'Creator mode' },
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-mode-btn', 'data-mode': EDIT_MODE_WARDROBE, title: 'Wardrobe', 'aria-label': 'Wardrobe' }, createIcon('modeCreatorWardrobe', modeIconOpts)),
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-mode-btn', 'data-mode': EDIT_MODE_3D, title: 'Edit on 3D model' }, createIcon('modeCreator3D', modeIconOpts), ' 3D'),
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-mode-btn', 'data-mode': EDIT_MODE_2D, title: 'Edit on 2D canvas' }, createIcon('modeCreator2D', modeIconOpts), ' 2D')
  );
  upperLeftPanels.insertBefore(modePanel, upperLeftPanels.firstChild);

  const oldOverlaysPanel = document.getElementById('creator-canvas-overlays-panel');
  if (oldOverlaysPanel) oldOverlaysPanel.remove();

  const overlaysPanel = createEl('div', { id: 'creator-canvas-overlays-panel', className: 'creator-canvas-overlays-panel', role: 'group', 'aria-label': 'Canvas overlays' },
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-canvas-overlays-btn', 'data-toggle': 'rulers', title: 'Toggle rulers' }, 'Rulers'),
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-canvas-overlays-btn', 'data-toggle': 'template', title: 'Show template overlay' }, 'Template')
  );
  upperLeftPanels.appendChild(overlaysPanel);

  const oldToolsPanel = document.getElementById('creator-tools-panel');
  if (oldToolsPanel) oldToolsPanel.remove();
  const oldUndoRedoPanel = document.getElementById('creator-undo-redo-panel');
  if (oldUndoRedoPanel) oldUndoRedoPanel.remove();

  const iconOpts = { width: 30, height: 30 };
  const panel = createEl('div', { id: 'creator-tools-panel', className: 'creator-tools-panel', 'aria-label': 'Editor tools' },
    createEl('div', { className: 'creator-tools-panel-row creator-tools-panel-tools-row', role: 'group', 'aria-label': 'Drawing tools' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'navigate', title: 'Navigate: orbit/zoom, no paint (H, 1)', 'aria-label': 'Navigate' }, createIcon('modeCreatorToolsNavigate', iconOpts)),
      createEl('div', { className: 'creator-tools-panel-divider', 'aria-hidden': 'true' }),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'pencil', title: 'Pencil (P, 2)', 'aria-label': 'Pencil' }, createIcon('modeCreatorToolsPencil', iconOpts)),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'eraser', title: 'Eraser (E, 3)', 'aria-label': 'Eraser' }, createIcon('modeCreatorToolsErasor', iconOpts)),
      // Soft paint brush hidden from release UI; tool code remains (see setActiveTool guard).
      // createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'paintBrush', title: 'Soft brush (B, 4)', 'aria-label': 'Soft brush' }, createIcon('modeCreatorToolsBrush', iconOpts)),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'fill', title: 'Fill (G, 4)', 'aria-label': 'Fill' }, createIcon('modeCreatorToolsFill', iconOpts)),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'eyedropper', title: 'Eyedropper: sample color from 2D or 3D (5)', 'aria-label': 'Eyedropper' }, createIcon('modeCreatorToolsDropper', iconOpts))
    )
  );

  const undoRedoPanel = createEl('div', { id: 'creator-undo-redo-panel', className: 'creator-undo-redo-panel creator-tools-panel', role: 'group', 'aria-label': 'Undo Redo' },
    createEl('div', { className: 'creator-tools-panel-row creator-tools-panel-undo-redo', role: 'group', 'aria-label': 'Undo Redo' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon creator-tools-panel-undo-btn', id: 'creator-tools-undo-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, createIcon('modeCreatorToolsUndo', iconOpts)),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon creator-tools-panel-redo-btn', id: 'creator-tools-redo-btn', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, createIcon('modeCreatorToolsRedo', iconOpts))
    )
  );

  const updateToolActive = () => {
    panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === ctx.getActiveTool());
    });
  };
  const updateViewToggleButtons = () => {
    overlaysPanel.querySelectorAll<HTMLButtonElement>('.creator-canvas-overlays-btn').forEach((btn) => {
      const t = btn.dataset.toggle;
      const isActive = (t === 'rulers' && ctx.isRulersShown()) || (t === 'template' && ctx.isTemplateShown());
      btn.classList.toggle('active', !!isActive);
    });
  };
  const updateEditModeButtons = () => {
    document.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === ctx.getEditMode());
    });
  };

  modePanel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as 'wardrobe' | '2d' | '3d';
      if (mode) ctx.setEditMode(mode, { fromUserModeNavigation: true });
      updateEditModeButtons();
    });
  });
  unregisterEditorToolShortcuts();
  toolShortcutKeyHandler = (e: KeyboardEvent) => {
    if (document.body.dataset.route !== 'creator') return;
    if (ctx.getEditMode() === 'wardrobe') return;
    const target = e.target as HTMLElement | null;
    const inInput = !!target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );
    if (inInput || e.ctrlKey || e.metaKey || e.altKey) return;
    const keyNum = Number.parseInt(e.key, 10);
    if (!Number.isInteger(keyNum) || keyNum < 1) return;
    const toolsPanel = document.getElementById('creator-tools-panel');
    if (!toolsPanel) return;
    const toolButtons = Array.from(
      toolsPanel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-btn[data-tool]')
    );
    const btn = toolButtons[keyNum - 1];
    if (!btn) return;
    e.preventDefault();
    btn.click();
  };
  document.addEventListener('keydown', toolShortcutKeyHandler);

  panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isDrawingTool(btn.dataset.tool)) ctx.setActiveTool(btn.dataset.tool);
      updateToolActive();
    });
  });
  overlaysPanel.querySelectorAll<HTMLButtonElement>('.creator-canvas-overlays-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isToggleType(btn.dataset.toggle)) {
        if (btn.dataset.toggle === 'rulers') ctx.setRulersShown(!ctx.isRulersShown());
        else ctx.setTemplateShown(!ctx.isTemplateShown());
      }
      updateViewToggleButtons();
      ctx.renderCanvas();
    });
  });
  const undoBtn = undoRedoPanel.querySelector<HTMLButtonElement>('#creator-tools-undo-btn');
  undoBtn?.addEventListener('click', () => {
    ctx.performUndo();
    ctx.updateUndoRedoButtons();
  });
  const redoBtn = undoRedoPanel.querySelector<HTMLButtonElement>('#creator-tools-redo-btn');
  redoBtn?.addEventListener('click', () => {
    ctx.performRedo();
    ctx.updateUndoRedoButtons();
  });

  creatorToolsSlice.subscribe(() => {
    if (document.body.dataset.route !== 'creator') return;
    updateToolActive();
    ctx.updateCanvasCursor();
  });
  creatorModeSlice.subscribe(() => {
    if (document.body.dataset.route !== 'creator') return;
    updateEditModeButtons();
    updateViewToggleButtons();
  });

  updateToolActive();
  updateEditModeButtons();
  updateViewToggleButtons();
  ctx.updateUndoRedoButtons();

  bottomCenterPanels.appendChild(panel);
  bottomCenterPanels.appendChild(undoRedoPanel);
}
