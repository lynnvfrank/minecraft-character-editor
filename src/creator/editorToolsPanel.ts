import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import { createEl } from './dom';
import type { EditorToolsContext } from './api';
import { EDIT_MODE_2D, EDIT_MODE_3D, isDrawingTool, isToggleType } from './api';
import { iconNavigate, iconBrush, iconEraser, iconFill, iconEyedropper } from './toolIcons';

export function buildEditorToolsPanel(ctx: EditorToolsContext): void {
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!wrapper) return;

  const oldPanel = document.getElementById('creator-tools-panel-3d');
  if (oldPanel) oldPanel.remove();

  const panel = createEl('div', { id: 'creator-tools-panel-3d', className: 'creator-tools-panel-3d', 'aria-label': '3D tools' },
    createEl('div', { className: 'creator-tools-panel-3d-row creator-tools-panel-3d-edit-mode', role: 'group', 'aria-label': 'Edit mode' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-mode-btn', 'data-mode': EDIT_MODE_2D, title: 'Edit on 2D canvas' }, '2D'),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-mode-btn', 'data-mode': EDIT_MODE_3D, title: 'Edit on 3D model' }, '3D')
    ),
    createEl('div', { className: 'creator-tools-panel-3d-row creator-tools-panel-3d-tools-row', role: 'group', 'aria-label': 'Drawing tools' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-btn-icon', 'data-tool': 'navigate', title: 'Navigate: orbit/zoom, no paint (H)', 'aria-label': 'Navigate' }, iconNavigate()),
      createEl('div', { className: 'creator-tools-panel-3d-divider', 'aria-hidden': 'true' }),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-btn-icon', 'data-tool': 'brush', title: 'Brush (B)', 'aria-label': 'Brush' }, iconBrush()),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-btn-icon', 'data-tool': 'eraser', title: 'Eraser (E)', 'aria-label': 'Eraser' }, iconEraser()),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-btn-icon', 'data-tool': 'fill', title: 'Fill (G)', 'aria-label': 'Fill' }, iconFill()),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-btn-icon', 'data-tool': 'eyedropper', title: 'Eyedropper: sample color from 2D or 3D', 'aria-label': 'Eyedropper' }, iconEyedropper())
    ),
    createEl('div', { className: 'creator-tools-panel-3d-row creator-tools-panel-3d-view-toggles', 'data-only-when': EDIT_MODE_2D, role: 'group', 'aria-label': 'Canvas overlays' },
      createEl('div', { className: 'creator-tools-panel-3d-divider creator-tools-panel-3d-divider-2d-only', 'aria-hidden': 'true' }),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-toggle-btn', 'data-toggle': 'rulers', title: 'Toggle rulers' }, 'Rulers'),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-toggle-btn', 'data-toggle': 'template', title: 'Show template overlay' }, 'Template')
    ),
    createEl('div', { className: 'creator-tools-panel-3d-divider', 'aria-hidden': 'true' }),
    createEl('div', { className: 'creator-tools-panel-3d-row creator-tools-panel-3d-undo-redo', role: 'group', 'aria-label': 'Undo Redo' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-undo-btn', id: 'creator-tools-undo-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, '↩'),
      createEl('button', { type: 'button', className: 'creator-tools-panel-3d-btn creator-tools-panel-3d-redo-btn', id: 'creator-tools-redo-btn', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, '↪')
    )
  );

  const updateToolActive = () => {
    panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-3d-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === ctx.getActiveTool());
    });
  };
  const updateViewTogglesRowVisibility = () => {
    const row = panel.querySelector('.creator-tools-panel-3d-view-toggles');
    if (row) row.classList.toggle('creator-tools-panel-3d-visible', !ctx.isEditMode3D());
  };
  const updateViewToggleButtons = () => {
    panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-3d-toggle-btn').forEach((btn) => {
      const t = btn.dataset.toggle;
      const isActive = (t === 'rulers' && ctx.isRulersShown()) || (t === 'template' && ctx.isTemplateShown());
      btn.classList.toggle('active', !!isActive);
    });
  };
  const updateEditModeButtons = () => {
    panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-3d-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === (ctx.isEditMode3D() ? EDIT_MODE_3D : EDIT_MODE_2D));
    });
  };

  panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-3d-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      ctx.setEditMode3D(m === EDIT_MODE_3D);
      document.body.dataset.editMode = ctx.isEditMode3D() ? EDIT_MODE_3D : EDIT_MODE_2D;
      updateEditModeButtons();
    });
  });
  panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-3d-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isDrawingTool(btn.dataset.tool)) ctx.setActiveTool(btn.dataset.tool);
      updateToolActive();
    });
  });
  panel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-3d-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isToggleType(btn.dataset.toggle)) {
        if (btn.dataset.toggle === 'rulers') ctx.setRulersShown(!ctx.isRulersShown());
        else ctx.setTemplateShown(!ctx.isTemplateShown());
      }
      updateViewToggleButtons();
      ctx.renderCanvas();
    });
  });
  const undoBtn = panel.querySelector<HTMLButtonElement>('#creator-tools-undo-btn');
  undoBtn?.addEventListener('click', () => {
    ctx.performUndo();
    ctx.updateUndoRedoButtons();
  });
  const redoBtn = panel.querySelector<HTMLButtonElement>('#creator-tools-redo-btn');
  redoBtn?.addEventListener('click', () => {
    ctx.performRedo();
    ctx.updateUndoRedoButtons();
  });

  subscribe(CREATOR_EVENTS.TOOLS_CHANGE, () => {
    updateToolActive();
    ctx.updateCanvasCursor();
  });
  subscribe(CREATOR_EVENTS.EDIT_MODE_CHANGE, () => {
    updateEditModeButtons();
    updateViewTogglesRowVisibility();
  });

  updateToolActive();
  updateEditModeButtons();
  updateViewTogglesRowVisibility();
  updateViewToggleButtons();
  ctx.updateUndoRedoButtons();

  wrapper.appendChild(panel);
}
