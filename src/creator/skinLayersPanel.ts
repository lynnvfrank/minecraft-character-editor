import type { CreatorTexturePositionDetail, CreatorLockFeedbackDetail } from '../events/appEvents';
import {
  creatorFocusedCreationSlice,
  creatorLayerSlice,
  creatorLockFeedbackSlice,
  creatorModeSlice,
  creatorTexturePositionSlice,
} from '../state/creatorSlices';
import type { SkinLayersContext, PartSide } from './api';
import { createIcon } from './icons';
import { isLayerWithParts } from '../skin';

export function buildSkinLayersPanel(ctx: SkinLayersContext): void {
  const upperLeftPanels = document.getElementById('creator-upper-left-panels');
  if (!upperLeftPanels) return;

  let panel = document.getElementById('creator-layers-panel');
  if (panel) panel.remove();

  const groups = ctx.layerGroups;
  panel = document.createElement('div');
  panel.id = 'creator-layers-panel';
  panel.className = 'creator-layers-panel';
  panel.setAttribute('aria-label', 'Layers');

  const header = document.createElement('div');
  header.className = 'creator-layers-panel-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'creator-layers-panel-title';
  titleSpan.textContent = 'Layers';
  const expandListBtn = document.createElement('button');
  expandListBtn.type = 'button';
  expandListBtn.className = 'creator-layers-panel-expand-list';
  expandListBtn.textContent = 'Show all layers';
  expandListBtn.setAttribute('aria-label', 'Show all layers');
  expandListBtn.hidden = true;
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'creator-layers-panel-toggle';
  toggleBtn.title = 'Minimize panel';
  toggleBtn.setAttribute('aria-label', 'Minimize panel');
  const minimizeIcon = document.createElement('span');
  minimizeIcon.className = 'creator-layers-panel-icon creator-layers-panel-icon-minimize';
  minimizeIcon.textContent = '▼';
  const expandIcon = document.createElement('span');
  expandIcon.className = 'creator-layers-panel-icon creator-layers-panel-icon-expand';
  expandIcon.textContent = '▲';
  toggleBtn.append(minimizeIcon, expandIcon);
  header.append(titleSpan, expandListBtn, toggleBtn);

  const list = document.createElement('div');
  list.className = 'creator-layers-panel-list';
  list.setAttribute('role', 'group');

  const updateLayerButtonUI = (panelEl: HTMLElement) => {
    panelEl.querySelectorAll<HTMLElement>('.creator-layers-panel-row').forEach((rowEl) => {
      const layer = rowEl.dataset.layer;
      const visibleInput = rowEl.querySelector<HTMLInputElement>('.creator-layer-3d-visible');
      const lockInput = rowEl.querySelector<HTMLInputElement>('.creator-layer-3d-lock');
      const eyeEl = rowEl.querySelector<SVGSVGElement>('.creator-layer-eye');
      const lockEl = rowEl.querySelector<SVGSVGElement>('.creator-layer-lock');
      const isVisible = !!visibleInput?.checked;
      const isLocked = !!lockInput?.checked;
      rowEl.classList.toggle('creator-layer-visible', isVisible);
      rowEl.classList.toggle('creator-layer-hidden', !isVisible);
      rowEl.classList.toggle('creator-layer-locked', isLocked);
      rowEl.classList.toggle('creator-layer-unlocked', !isLocked);
      if (eyeEl) eyeEl.replaceWith(createIcon(isVisible ? 'modeCreatorVisible' : 'modeCreatorHidden', { width: 16, height: 16, className: 'creator-layer-eye' }));
      if (lockEl) lockEl.replaceWith(createIcon(isLocked ? 'modeCreatorLock' : 'modeCreatorUnlock', { width: 16, height: 16, className: 'creator-layer-lock' }));
      if (layer && isLayerWithParts(layer)) {
        const parts = ctx.layerPartVisible[layer];
        ['L', 'R'].forEach((side) => {
          const btn = rowEl.querySelector<HTMLButtonElement>(`.creator-layer-part-btn[data-side="${side}"]`);
          if (btn) {
            const visible = side === 'R' ? (parts?.R !== false) : (parts?.L !== false);
            btn.classList.toggle('creator-layer-part-visible', visible);
            btn.classList.toggle('creator-layer-part-hidden', !visible);
          }
        });
      }
    });
  };

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    for (const layer of group) {
      const row = document.createElement('div');
      row.className = 'creator-layers-panel-row';
      row.dataset.layer = layer;

      const layerName = layer.charAt(0).toUpperCase() + layer.slice(1);

      const visibilityLabel = document.createElement('label');
      visibilityLabel.className = 'creator-layers-panel-visibility';
      visibilityLabel.title = `${layerName} visibility (eye): hide to paint underlying parts. Alt+click: solo this layer`;
      const visibilityInput = document.createElement('input');
      visibilityInput.type = 'checkbox';
      visibilityInput.className = 'creator-layer-3d-visible';
      visibilityInput.dataset.layer = layer;
      visibilityInput.checked = ctx.layerVisibility[layer];
      const eyeIcon = createIcon(visibilityInput.checked ? 'modeCreatorVisible' : 'modeCreatorHidden', { width: 16, height: 16, className: 'creator-layer-eye' });
      const layerNameSpan = document.createElement('span');
      layerNameSpan.className = 'creator-layers-panel-name';
      layerNameSpan.textContent = layerName;
      visibilityLabel.append(visibilityInput, eyeIcon, layerNameSpan);

      if (isLayerWithParts(layer)) {
        const parts = ctx.layerPartVisible[layer];
        const lVisible = parts?.L !== false;
        const rVisible = parts?.R !== false;
        const partsWrap = document.createElement('span');
        partsWrap.className = 'creator-layers-panel-parts';
        const lBtn = document.createElement('button');
        lBtn.type = 'button';
        lBtn.className = `creator-layer-part-btn creator-layer-part-btn-l ${lVisible ? 'creator-layer-part-visible' : 'creator-layer-part-hidden'}`;
        lBtn.dataset.layer = layer;
        lBtn.dataset.side = 'L';
        lBtn.textContent = 'L';
        lBtn.title = `${layerName} left: toggle visibility`;
        lBtn.setAttribute('aria-label', `${layerName} left`);
        const rBtn = document.createElement('button');
        rBtn.type = 'button';
        rBtn.className = `creator-layer-part-btn creator-layer-part-btn-r ${rVisible ? 'creator-layer-part-visible' : 'creator-layer-part-hidden'}`;
        rBtn.dataset.layer = layer;
        rBtn.dataset.side = 'R';
        rBtn.textContent = 'R';
        rBtn.title = `${layerName} right: toggle visibility`;
        rBtn.setAttribute('aria-label', `${layerName} right`);
        partsWrap.append(lBtn, rBtn);
        visibilityLabel.append(partsWrap);
      }

      const lockLabel = document.createElement('label');
      lockLabel.className = 'creator-layers-panel-lock';
      lockLabel.title = `${layerName} lock: ignore pencil/eraser/fill. Alt+click: solo this layer (unlock only this)`;
      const lockInput = document.createElement('input');
      lockInput.type = 'checkbox';
      lockInput.className = 'creator-layer-3d-lock';
      lockInput.dataset.layer = layer;
      lockInput.checked = ctx.layerLocked[layer];
      const lockIcon = createIcon(lockInput.checked ? 'modeCreatorLock' : 'modeCreatorUnlock', { width: 16, height: 16, className: 'creator-layer-lock' });
      lockLabel.append(lockInput, lockIcon);

      row.append(visibilityLabel, lockLabel);
      list.appendChild(row);
    }
    if (i < groups.length - 1) {
      const sep = document.createElement('div');
      sep.className = 'creator-layers-panel-separator';
      sep.setAttribute('aria-hidden', 'true');
      list.appendChild(sep);
    }
  }

  panel.append(header, list);

  panel.querySelectorAll('.creator-layers-panel-visibility').forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('.creator-layer-3d-visible');
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('click', (e) => {
      if (e instanceof MouseEvent && e.altKey) {
        e.preventDefault();
        ctx.onVisibilitySoloClick(layer);
        if (panel) {
          ctx.syncVisibilityCheckboxes(panel);
          updateLayerButtonUI(panel);
          ctx.clearSoloIndicator(panel);
        }
        return;
      }
    });
    input.addEventListener('change', () => {
      ctx.setLayerVisible(layer, input.checked);
      if (panel) updateLayerButtonUI(panel);
    });
  });
  panel.querySelectorAll('.creator-layers-panel-lock').forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('.creator-layer-3d-lock');
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('click', (e) => {
      if (e instanceof MouseEvent && e.altKey) {
        e.preventDefault();
        ctx.onLockSoloClick(layer);
        if (panel) {
          ctx.syncLockCheckboxes(panel);
          updateLayerButtonUI(panel);
          ctx.clearSoloIndicator(panel);
        }
        return;
      }
    });
  });
  panel.querySelectorAll<HTMLInputElement>('.creator-layer-3d-lock').forEach((input) => {
    input.addEventListener('change', () => {
      const layer = input.dataset.layer;
      if (layer) ctx.setLayerLocked(layer, input.checked);
      if (panel) updateLayerButtonUI(panel);
    });
  });

  panel.querySelectorAll<HTMLButtonElement>('.creator-layer-part-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const layer = btn.dataset.layer;
      const side = btn.dataset.side as PartSide | undefined;
      if (layer && (side === 'L' || side === 'R')) {
        const parts = ctx.layerPartVisible[layer];
        const current = side === 'R' ? (parts?.R !== false) : (parts?.L !== false);
        ctx.setLayerPartVisible(layer, side, !current);
        if (panel) updateLayerButtonUI(panel);
      }
    });
  });

  ctx.setupDragToToggle(
    panel,
    '.creator-layers-panel-visibility',
    '.creator-layer-3d-visible',
    (l) => ctx.layerVisibility[l],
    (l, v) => ctx.setLayerVisible(l, v),
    (p) => {
      ctx.syncVisibilityCheckboxes(p);
      updateLayerButtonUI(p);
      ctx.clearSoloIndicator(p);
    },
    (e) =>
      !(e instanceof MouseEvent && e.altKey) &&
      !(e.target instanceof HTMLElement && e.target.closest('.creator-layer-part-btn'))
  );
  ctx.setupDragToToggle(
    panel,
    '.creator-layers-panel-lock',
    '.creator-layer-3d-lock',
    (l) => ctx.layerLocked[l],
    (l, v) => ctx.setLayerLocked(l, v),
    (p) => {
      ctx.syncLockCheckboxes(p);
      updateLayerButtonUI(p);
      ctx.clearSoloIndicator(p);
    },
    (e) => !(e instanceof MouseEvent && e.altKey)
  );

  const applyFocusedListFilter = (panelEl: HTMLElement) => {
    const mode = ctx.getEditMode();
    const inEdit = mode === '3d' || mode === '2d';
    /** Wardrobe→3D/2D sets expanded false when solo applies; do not require focused toggle. */
    const compact = !ctx.getLayersPanelFocusedListExpanded() && inEdit;
    panelEl.classList.toggle('creator-layers-panel-focused-compact', compact);
    const showExpand = compact;
    expandListBtn.hidden = !showExpand;
    expandListBtn.setAttribute('aria-expanded', showExpand ? 'false' : 'true');
    panelEl.querySelectorAll<HTMLElement>('.creator-layers-panel-row').forEach((rowEl) => {
      const layer = rowEl.dataset.layer;
      if (!layer) return;
      if (!compact) {
        rowEl.removeAttribute('hidden');
        rowEl.removeAttribute('aria-hidden');
        rowEl.classList.remove('creator-layers-panel-row--focus-collapsed-hidden');
        return;
      }
      const vis = ctx.isLayer3DVisible(layer);
      const hideRow = !vis;
      rowEl.classList.toggle('creator-layers-panel-row--focus-collapsed-hidden', hideRow);
      if (hideRow) {
        rowEl.setAttribute('hidden', '');
        rowEl.setAttribute('aria-hidden', 'true');
      } else {
        rowEl.removeAttribute('hidden');
        rowEl.removeAttribute('aria-hidden');
      }
    });
  };

  expandListBtn.addEventListener('click', () => {
    ctx.setLayersPanelFocusedListExpanded(true);
    if (panel) {
      applyFocusedListFilter(panel);
      ctx.syncVisibilityCheckboxes(panel);
      ctx.syncLockCheckboxes(panel);
      updateLayerButtonUI(panel);
    }
  });

  const updateCollapsedUI = () => {
    if (!panel) return;
    const collapsed = ctx.isLayersPanelCollapsed();
    panel.classList.toggle('creator-layers-panel-collapsed', collapsed);
    const minimizeIcon = panel.querySelector('.creator-layers-panel-icon-minimize');
    const expandIcon = panel.querySelector('.creator-layers-panel-icon-expand');
    if (minimizeIcon && expandIcon) {
      minimizeIcon.setAttribute('aria-hidden', String(collapsed));
      expandIcon.setAttribute('aria-hidden', String(!collapsed));
    }
    if (toggleBtn) {
      toggleBtn.title = collapsed ? 'Expand panel' : 'Minimize panel';
      toggleBtn.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Minimize panel');
    }
  };
  toggleBtn?.addEventListener('click', () => {
    ctx.setLayersPanelCollapsed(!ctx.isLayersPanelCollapsed());
    updateCollapsedUI();
  });
  updateCollapsedUI();
  applyFocusedListFilter(panel);
  updateLayerButtonUI(panel);

  const LOCK_FEEDBACK_DURATION_MS = 400;
  creatorTexturePositionSlice.subscribe((detail: CreatorTexturePositionDetail) => {
    if (document.body.dataset.route !== 'creator') return;
    const layer = detail.layer ?? null;
    const layersPanel = document.getElementById('creator-layers-panel');
    if (!layersPanel) return;
    layersPanel.querySelectorAll<HTMLElement>('.creator-layers-panel-row').forEach((row) => {
      const rowLayer = row.dataset.layer;
      const shouldHighlight = layer != null && rowLayer === layer;
      row.classList.toggle('creator-layers-panel-row-highlight', !!shouldHighlight);
    });
  });
  const syncLayersPanelFromState = () => {
    if (document.body.dataset.route !== 'creator') return;
    if (!panel) return;
    ctx.syncVisibilityCheckboxes(panel);
    ctx.syncLockCheckboxes(panel);
    applyFocusedListFilter(panel);
    updateLayerButtonUI(panel);
  };

  creatorLayerSlice.subscribe(syncLayersPanelFromState);
  // Defer so focusedCreationController can apply wardrobe→3D/2D solo first (same notify tick).
  creatorModeSlice.subscribe(() => {
    queueMicrotask(() => {
      syncLayersPanelFromState();
    });
  });
  creatorFocusedCreationSlice.subscribe(syncLayersPanelFromState);
  creatorLockFeedbackSlice.subscribe((detail: CreatorLockFeedbackDetail) => {
    if (document.body.dataset.route !== 'creator') return;
    const layer = detail.layer;
    if (!layer) return;
    const panelEl = document.getElementById('creator-layers-panel');
    if (!panelEl) return;
    const row = panelEl.querySelector<HTMLElement>(`.creator-layers-panel-row[data-layer="${layer}"]`);
    if (!row) return;
    const lockEl = row.querySelector<SVGElement>('.creator-layer-lock');
    row.classList.add('creator-layer-row-wiggle');
    if (lockEl) lockEl.classList.add('creator-layer-lock-flash');
    const clear = () => {
      row.classList.remove('creator-layer-row-wiggle');
      if (lockEl) lockEl.classList.remove('creator-layer-lock-flash');
    };
    setTimeout(clear, LOCK_FEEDBACK_DURATION_MS);
  });

  upperLeftPanels.appendChild(panel);
}
