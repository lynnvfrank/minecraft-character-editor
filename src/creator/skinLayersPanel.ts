import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import type { CreatorTexturePositionDetail } from '../creatorEvents';
import type { SkinLayersContext } from './api';

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
  header.append(titleSpan, toggleBtn);

  const list = document.createElement('div');
  list.className = 'creator-layers-panel-list';
  list.setAttribute('role', 'group');

  const updateLayerButtonUI = (panelEl: HTMLElement) => {
    panelEl.querySelectorAll<HTMLElement>('.creator-layers-panel-row').forEach((rowEl) => {
      const visibleInput = rowEl.querySelector<HTMLInputElement>('.creator-layer-3d-visible');
      const lockInput = rowEl.querySelector<HTMLInputElement>('.creator-layer-3d-lock');
      const eyeEl = rowEl.querySelector<HTMLElement>('.creator-layer-eye');
      const lockEl = rowEl.querySelector<HTMLElement>('.creator-layer-lock');
      const isVisible = !!visibleInput?.checked;
      const isLocked = !!lockInput?.checked;
      rowEl.classList.toggle('creator-layer-visible', isVisible);
      rowEl.classList.toggle('creator-layer-hidden', !isVisible);
      rowEl.classList.toggle('creator-layer-locked', isLocked);
      rowEl.classList.toggle('creator-layer-unlocked', !isLocked);
      if (eyeEl) eyeEl.textContent = isVisible ? '👁' : '🙈';
      if (lockEl) lockEl.textContent = isLocked ? '🔒' : '🔓';
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
      const eyeSpan = document.createElement('span');
      eyeSpan.className = 'creator-layer-eye';
      eyeSpan.setAttribute('aria-hidden', 'true');
      eyeSpan.textContent = visibilityInput.checked ? '👁' : '🙈';
      const layerNameSpan = document.createElement('span');
      layerNameSpan.className = 'creator-layers-panel-name';
      layerNameSpan.textContent = layerName;
      visibilityLabel.append(visibilityInput, eyeSpan, layerNameSpan);

      const lockLabel = document.createElement('label');
      lockLabel.className = 'creator-layers-panel-lock';
      lockLabel.title = `${layerName} lock: ignore brush/eraser/fill. Alt+click: solo this layer (unlock only this)`;
      const lockInput = document.createElement('input');
      lockInput.type = 'checkbox';
      lockInput.className = 'creator-layer-3d-lock';
      lockInput.dataset.layer = layer;
      lockInput.checked = ctx.layerLocked[layer];
      const lockSpan = document.createElement('span');
      lockSpan.className = 'creator-layer-lock';
      lockSpan.setAttribute('aria-hidden', 'true');
      lockSpan.textContent = lockInput.checked ? '🔒' : '🔓';
      lockLabel.append(lockInput, lockSpan);

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
    (e) => !(e instanceof MouseEvent && e.altKey)
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
  updateLayerButtonUI(panel);

  subscribe(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, (e: CustomEvent<CreatorTexturePositionDetail>) => {
    const layer = e.detail?.layer ?? null;
    const layersPanel = document.getElementById('creator-layers-panel');
    if (!layersPanel) return;
    layersPanel.querySelectorAll<HTMLElement>('.creator-layers-panel-row').forEach((row) => {
      const rowLayer = row.dataset.layer;
      const shouldHighlight = layer != null && rowLayer === layer;
      row.classList.toggle('creator-layers-panel-row-highlight', !!shouldHighlight);
    });
  });

  upperLeftPanels.appendChild(panel);
}
