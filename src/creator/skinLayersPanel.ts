import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import type { CreatorTexturePositionDetail } from '../creatorEvents';
import { getCreatorPanelsContainer } from './container';
import type { SkinLayersContext } from './api';

export function buildSkinLayersPanel(ctx: SkinLayersContext): void {
  const container = getCreatorPanelsContainer();
  if (!container) return;

  let panel = document.getElementById('creator-layers-panel-3d');
  if (panel) panel.remove();

  const groups = ctx.layerGroups;
  panel = document.createElement('div');
  panel.id = 'creator-layers-panel-3d';
  panel.className = 'creator-layers-panel-3d';
  panel.setAttribute('aria-label', '3D layers');

  const header = document.createElement('div');
  header.className = 'creator-layers-panel-3d-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'creator-layers-panel-3d-title';
  titleSpan.textContent = 'Layers';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'creator-layers-panel-3d-toggle';
  toggleBtn.title = 'Minimize panel';
  toggleBtn.setAttribute('aria-label', 'Minimize panel');
  const minimizeIcon = document.createElement('span');
  minimizeIcon.className = 'creator-layers-panel-3d-icon creator-layers-panel-3d-icon-minimize';
  minimizeIcon.textContent = '▼';
  const expandIcon = document.createElement('span');
  expandIcon.className = 'creator-layers-panel-3d-icon creator-layers-panel-3d-icon-expand';
  expandIcon.textContent = '▲';
  toggleBtn.append(minimizeIcon, expandIcon);
  header.append(titleSpan, toggleBtn);

  const list = document.createElement('div');
  list.className = 'creator-layers-panel-3d-list';
  list.setAttribute('role', 'group');

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    for (const layer of group) {
      const row = document.createElement('div');
      row.className = 'creator-layers-panel-3d-row';
      row.dataset.layer = layer;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'creator-layers-panel-3d-name';
      nameSpan.textContent = layer.charAt(0).toUpperCase() + layer.slice(1);

      const visibilityLabel = document.createElement('label');
      visibilityLabel.className = 'creator-layers-panel-3d-visibility';
      visibilityLabel.title = 'Visibility (eye): hide to paint underlying parts. Alt+click: solo this layer';
      const visibilityInput = document.createElement('input');
      visibilityInput.type = 'checkbox';
      visibilityInput.className = 'creator-layer-3d-visible';
      visibilityInput.dataset.layer = layer;
      visibilityInput.checked = ctx.layerVisibility[layer];
      const eyeSpan = document.createElement('span');
      eyeSpan.className = 'creator-layer-eye';
      eyeSpan.setAttribute('aria-hidden', 'true');
      eyeSpan.textContent = '👁';
      visibilityLabel.append(visibilityInput, eyeSpan);

      const lockLabel = document.createElement('label');
      lockLabel.className = 'creator-layers-panel-3d-lock';
      lockLabel.title = 'Lock: ignore brush/eraser/fill. Alt+click: solo this layer (unlock only this)';
      const lockInput = document.createElement('input');
      lockInput.type = 'checkbox';
      lockInput.className = 'creator-layer-3d-lock';
      lockInput.dataset.layer = layer;
      lockInput.checked = ctx.layerLocked[layer];
      const lockSpan = document.createElement('span');
      lockSpan.className = 'creator-layer-lock';
      lockSpan.setAttribute('aria-hidden', 'true');
      lockSpan.textContent = '🔒';
      lockLabel.append(lockInput, lockSpan);

      row.append(nameSpan, visibilityLabel, lockLabel);
      list.appendChild(row);
    }
    if (i < groups.length - 1) {
      const sep = document.createElement('div');
      sep.className = 'creator-layers-panel-3d-separator';
      sep.setAttribute('aria-hidden', 'true');
      list.appendChild(sep);
    }
  }

  panel.append(header, list);

  panel.querySelectorAll('.creator-layers-panel-3d-visibility').forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('.creator-layer-3d-visible');
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('click', (e) => {
      if (e instanceof MouseEvent && e.altKey) {
        e.preventDefault();
        ctx.onVisibilitySoloClick(layer);
        if (panel) {
          ctx.syncVisibilityCheckboxes(panel);
          ctx.clearSoloIndicator(panel);
        }
        return;
      }
    });
    input.addEventListener('change', () => {
      ctx.setLayerVisible(layer, input.checked);
    });
  });
  panel.querySelectorAll('.creator-layers-panel-3d-lock').forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('.creator-layer-3d-lock');
    const layer = input?.dataset.layer;
    if (!layer) return;
    label.addEventListener('click', (e) => {
      if (e instanceof MouseEvent && e.altKey) {
        e.preventDefault();
        ctx.onLockSoloClick(layer);
        if (panel) {
          ctx.syncLockCheckboxes(panel);
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
    });
  });

  ctx.setupDragToToggle(
    panel,
    '.creator-layers-panel-3d-visibility',
    '.creator-layer-3d-visible',
    (l) => ctx.layerVisibility[l],
    (l, v) => ctx.setLayerVisible(l, v),
    (p) => {
      ctx.syncVisibilityCheckboxes(p);
      ctx.clearSoloIndicator(p);
    },
    (e) => !(e instanceof MouseEvent && e.altKey)
  );
  ctx.setupDragToToggle(
    panel,
    '.creator-layers-panel-3d-lock',
    '.creator-layer-3d-lock',
    (l) => ctx.layerLocked[l],
    (l, v) => ctx.setLayerLocked(l, v),
    (p) => {
      ctx.syncLockCheckboxes(p);
      ctx.clearSoloIndicator(p);
    },
    (e) => !(e instanceof MouseEvent && e.altKey)
  );

  const updateCollapsedUI = () => {
    const collapsed = ctx.isLayersPanelCollapsed();
    panel.classList.toggle('creator-layers-panel-3d-collapsed', collapsed);
    const minimizeIcon = panel.querySelector('.creator-layers-panel-3d-icon-minimize');
    const expandIcon = panel.querySelector('.creator-layers-panel-3d-icon-expand');
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

  subscribe(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, (e: CustomEvent<CreatorTexturePositionDetail>) => {
    const layer = e.detail?.layer ?? null;
    const layersPanel = document.getElementById('creator-layers-panel-3d');
    if (!layersPanel) return;
    layersPanel.querySelectorAll<HTMLElement>('.creator-layers-panel-3d-row').forEach((row) => {
      const rowLayer = row.dataset.layer;
      const shouldHighlight = layer != null && rowLayer === layer;
      row.classList.toggle('creator-layers-panel-3d-row-highlight', !!shouldHighlight);
    });
  });

  container.appendChild(panel);
}
