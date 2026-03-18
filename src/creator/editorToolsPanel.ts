import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import { createEl } from './dom';
import type { EditorToolsContext } from './api';
import { EDIT_MODE_2D, EDIT_MODE_3D, EDIT_MODE_WARDROBE, isDrawingTool, isToggleType } from './api';
import { iconNavigate, iconBrush, iconEraser, iconFill, iconEyedropper } from './toolIcons';

let modeShortcutKeyHandler: ((e: KeyboardEvent) => void) | null = null;

export function unregisterEditorModeShortcuts(): void {
  if (!modeShortcutKeyHandler) return;
  document.removeEventListener('keydown', modeShortcutKeyHandler);
  modeShortcutKeyHandler = null;
}

export function buildEditorToolsPanel(ctx: EditorToolsContext): void {
  const topRow = document.getElementById('creator-left-top-row');
  const upperLeftPanels = document.getElementById('creator-upper-left-panels');
  if (!topRow || !upperLeftPanels) return;

  const oldModePanel = document.getElementById('creator-mode-panel');
  if (oldModePanel) oldModePanel.remove();

  const modePanel = createEl('div', { id: 'creator-mode-panel', className: 'creator-mode-panel', role: 'group', 'aria-label': 'Creator mode' },
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-mode-btn', 'data-mode': EDIT_MODE_WARDROBE, title: 'Wardrobe' }, 'Wardrobe'),
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-mode-btn', 'data-mode': EDIT_MODE_3D, title: 'Edit on 3D model' }, '3D'),
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-mode-btn', 'data-mode': EDIT_MODE_2D, title: 'Edit on 2D canvas' }, '2D')
  );
  upperLeftPanels.insertBefore(modePanel, upperLeftPanels.firstChild);

  const oldOverlaysPanel = document.getElementById('creator-canvas-overlays-panel');
  if (oldOverlaysPanel) oldOverlaysPanel.remove();

  const overlaysPanel = createEl('div', { id: 'creator-canvas-overlays-panel', className: 'creator-canvas-overlays-panel', role: 'group', 'aria-label': 'Canvas overlays' },
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-canvas-overlays-btn', 'data-toggle': 'rulers', title: 'Toggle rulers' }, 'Rulers'),
    createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-canvas-overlays-btn', 'data-toggle': 'template', title: 'Show template overlay' }, 'Template')
  );
  const loadSkinsPanel = document.getElementById('creator-load-skins-panel');
  if (loadSkinsPanel) {
    upperLeftPanels.insertBefore(overlaysPanel, loadSkinsPanel);
  } else {
    upperLeftPanels.appendChild(overlaysPanel);
  }

  const oldPanel = document.getElementById('creator-tools-panel');
  if (oldPanel) oldPanel.remove();

  const panel = createEl('div', { id: 'creator-tools-panel', className: 'creator-tools-panel', 'aria-label': 'Editor tools' },
    createEl('div', { className: 'creator-tools-panel-row creator-tools-panel-tools-row', role: 'group', 'aria-label': 'Drawing tools' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'navigate', title: 'Navigate: orbit/zoom, no paint (H)', 'aria-label': 'Navigate' }, iconNavigate()),
      createEl('div', { className: 'creator-tools-panel-divider', 'aria-hidden': 'true' }),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'brush', title: 'Brush (B)', 'aria-label': 'Brush' }, iconBrush()),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'eraser', title: 'Eraser (E)', 'aria-label': 'Eraser' }, iconEraser()),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'fill', title: 'Fill (G)', 'aria-label': 'Fill' }, iconFill()),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-btn-icon', 'data-tool': 'eyedropper', title: 'Eyedropper: sample color from 2D or 3D', 'aria-label': 'Eyedropper' }, iconEyedropper())
    ),
    createEl('div', { className: 'creator-tools-panel-divider', 'aria-hidden': 'true' }),
    createEl('div', { className: 'creator-tools-panel-row creator-tools-panel-undo-redo', role: 'group', 'aria-label': 'Undo Redo' },
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-undo-btn', id: 'creator-tools-undo-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, '↩'),
      createEl('button', { type: 'button', className: 'creator-tools-panel-btn creator-tools-panel-redo-btn', id: 'creator-tools-redo-btn', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, '↪')
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
      if (mode) ctx.setEditMode(mode);
      updateEditModeButtons();
    });
  });
  unregisterEditorModeShortcuts();
  modeShortcutKeyHandler = (e: KeyboardEvent) => {
    if (document.body.dataset.route !== 'creator') return;
    const target = e.target as HTMLElement | null;
    const inInput = !!target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );
    if (inInput || e.ctrlKey || e.metaKey || e.altKey) return;
    const keyNum = Number.parseInt(e.key, 10);
    if (!Number.isInteger(keyNum) || keyNum < 1) return;
    const currentModePanel = document.getElementById('creator-mode-panel');
    if (!currentModePanel) return;
    const modeButtons = Array.from(
      currentModePanel.querySelectorAll<HTMLButtonElement>('.creator-tools-panel-mode-btn')
    );
    const btn = modeButtons[keyNum - 1];
    if (!btn) return;
    e.preventDefault();
    btn.click();
  };
  document.addEventListener('keydown', modeShortcutKeyHandler);

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
    updateViewToggleButtons();
  });

  updateToolActive();
  updateEditModeButtons();
  updateViewToggleButtons();
  ctx.updateUndoRedoButtons();

  topRow.appendChild(panel);
}
