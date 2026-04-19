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

/** Matches `LAYER_GROUPS` pairs in `creator.ts` — sleeves/arms and pants/legs share a Left/Right limb grid (no per-layer name rows). */
function isLimbPairGroup(group: readonly string[]): boolean {
  const key = group.join(',');
  return key === 'sleeves,arms' || key === 'pants,legs';
}

function limbPartButtonLabel(layerKey: string): string {
  switch (layerKey) {
    case 'sleeves':
      return 'Sleeve';
    case 'arms':
      return 'Arm';
    case 'pants':
      return 'Pant';
    case 'legs':
      return 'Leg';
    default:
      return layerKey.charAt(0).toUpperCase() + layerKey.slice(1);
  }
}

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
    });
    panelEl.querySelectorAll<HTMLButtonElement>('.creator-layer-part-btn').forEach((btn) => {
      const layer = btn.dataset.layer;
      const side = btn.dataset.side;
      if (!layer || (side !== 'L' && side !== 'R')) return;
      const visible = ctx.getPartVisible(layer, side);
      btn.classList.toggle('creator-layer-part-visible', visible);
      btn.classList.toggle('creator-layer-part-hidden', !visible);
      const eyeEl = btn.querySelector<SVGSVGElement>('.creator-layer-part-btn-eye');
      if (eyeEl) {
        eyeEl.replaceWith(
          createIcon(visible ? 'modeCreatorVisible' : 'modeCreatorHidden', {
            width: 14,
            height: 14,
            className: 'creator-layer-eye creator-layer-part-btn-eye',
          })
        );
      }
    });
  };

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (isLimbPairGroup(group)) {
      const composite = document.createElement('div');
      composite.className = 'creator-layers-panel-composite';
      composite.dataset.layers = group.join(' ');

      const partsRoot = document.createElement('div');
      partsRoot.className = 'creator-layers-panel-limb-parts';
      partsRoot.setAttribute('role', 'group');
      const showSideColumnTitles = group[0] === 'sleeves';

      for (const sideSpec of [{ key: 'L' as const, title: 'Left' }, { key: 'R' as const, title: 'Right' }]) {
        const col = document.createElement('div');
        col.className = 'creator-layers-panel-limb-column';
        const btnWrap = document.createElement('div');
        btnWrap.className = 'creator-layers-panel-limb-side-btns';
        for (const layer of group) {
          const partVis = ctx.getPartVisible(layer, sideSpec.key);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `creator-layer-part-btn creator-layer-part-btn-${sideSpec.key.toLowerCase()} ${partVis ? 'creator-layer-part-visible' : 'creator-layer-part-hidden'}`;
          btn.dataset.layer = layer;
          btn.dataset.side = sideSpec.key;
          const short = limbPartButtonLabel(layer);
          const labelSpan = document.createElement('span');
          labelSpan.className = 'creator-layer-part-btn-label';
          labelSpan.textContent = short;
          const eyeIcon = createIcon(partVis ? 'modeCreatorVisible' : 'modeCreatorHidden', {
            width: 14,
            height: 14,
            className: 'creator-layer-eye creator-layer-part-btn-eye',
          });
          btn.append(labelSpan, eyeIcon);
          btn.title = `${layer} ${sideSpec.title.toLowerCase()}: toggle visibility`;
          btn.setAttribute('aria-label', `${short} ${sideSpec.title}`);
          btnWrap.appendChild(btn);
        }
        if (showSideColumnTitles) {
          const titleEl = document.createElement('span');
          titleEl.className = 'creator-layers-panel-limb-side-title';
          titleEl.textContent = sideSpec.title;
          col.append(titleEl, btnWrap);
        } else {
          col.appendChild(btnWrap);
        }
        partsRoot.appendChild(col);
      }
      composite.appendChild(partsRoot);

      list.appendChild(composite);

      if (i < groups.length - 1) {
        const sep = document.createElement('div');
        sep.className = 'creator-layers-panel-separator';
        sep.setAttribute('aria-hidden', 'true');
        list.appendChild(sep);
      }
      continue;
    }

    for (const layer of group) {
      const row = document.createElement('div');
      row.className = 'creator-layers-panel-row';
      row.dataset.layer = layer;

      const layerName = layer.charAt(0).toUpperCase() + layer.slice(1);

      /** Wrapper div (not a label) so L/R part buttons are not inside the eye checkbox label — that nesting broke part clicks. */
      const visibilityWrap = document.createElement('div');
      visibilityWrap.className = 'creator-layers-panel-visibility';
      const visibilityInput = document.createElement('input');
      visibilityInput.type = 'checkbox';
      visibilityInput.className = 'creator-layer-3d-visible';
      visibilityInput.dataset.layer = layer;
      visibilityInput.checked = ctx.layerVisibility[layer];
      const eyeIcon = createIcon(visibilityInput.checked ? 'modeCreatorVisible' : 'modeCreatorHidden', { width: 16, height: 16, className: 'creator-layer-eye' });

      const visibilityToggle = document.createElement('label');
      visibilityToggle.className = 'creator-layers-panel-visibility-toggle';
      visibilityToggle.title = `${layerName} visibility (eye): hide to paint underlying parts. Alt+click: solo this layer`;
      const layerNameSpan = document.createElement('span');
      layerNameSpan.className = 'creator-layers-panel-name';
      layerNameSpan.textContent = layerName;
      visibilityToggle.append(visibilityInput, eyeIcon, layerNameSpan);
      visibilityWrap.append(visibilityToggle);

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

      row.append(visibilityWrap, lockLabel);
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

  panel.querySelectorAll('.creator-layers-panel-visibility-toggle').forEach((toggleLabel) => {
    const input = toggleLabel.querySelector<HTMLInputElement>('.creator-layer-3d-visible');
    const layer = input?.dataset.layer;
    if (!layer) return;
    toggleLabel.addEventListener('click', (e) => {
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
      if (e instanceof MouseEvent && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const layer = btn.dataset.layer;
        if (layer) {
          ctx.onVisibilitySoloClick(layer);
          if (panel) {
            ctx.syncVisibilityCheckboxes(panel);
            updateLayerButtonUI(panel);
            ctx.clearSoloIndicator(panel);
          }
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const layer = btn.dataset.layer;
      const side = btn.dataset.side as PartSide | undefined;
      if (layer && (side === 'L' || side === 'R')) {
        if (!ctx.isLayer3DVisible(layer)) {
          ctx.clearVisibilitySoloFlags();
          ctx.setLayerVisible(layer, true);
          ctx.setLayerPartVisible(layer, side, true);
        } else {
          const current = ctx.getPartVisible(layer, side);
          ctx.setLayerPartVisible(layer, side, !current);
        }
        if (panel) {
          ctx.syncVisibilityCheckboxes(panel);
          updateLayerButtonUI(panel);
          ctx.clearSoloIndicator(panel);
        }
      }
    });
  });

  const syncVisibilityPanel = (p: HTMLElement) => {
    ctx.syncVisibilityCheckboxes(p);
    updateLayerButtonUI(p);
    ctx.clearSoloIndicator(p);
  };
  ctx.setupDragToToggle(
    panel,
    '.creator-layers-panel-visibility',
    '.creator-layer-3d-visible',
    (l) => ctx.layerVisibility[l],
    (l, v) => ctx.setLayerVisible(l, v),
    syncVisibilityPanel,
    (e) =>
      !(e instanceof MouseEvent && e.altKey) &&
      !(e.target instanceof HTMLElement && e.target.closest('.creator-layer-part-btn')) &&
      (e.target instanceof HTMLElement && !!e.target.closest('.creator-layers-panel-visibility-toggle')),
    true
  );
  ctx.setupPartDragToToggle(panel, syncVisibilityPanel);
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
    panelEl.querySelectorAll<HTMLElement>('.creator-layers-panel-composite').forEach((comp) => {
      const ids = comp.dataset.layers?.split(/\s+/).filter((s) => s.length > 0) ?? [];
      if (!compact) {
        comp.removeAttribute('hidden');
        comp.removeAttribute('aria-hidden');
        comp.classList.remove('creator-layers-panel-composite--focus-collapsed-hidden');
        return;
      }
      const hideComposite = ids.length > 0 && ids.every((id) => !ctx.isLayer3DVisible(id));
      comp.classList.toggle('creator-layers-panel-composite--focus-collapsed-hidden', hideComposite);
      if (hideComposite) {
        comp.setAttribute('hidden', '');
        comp.setAttribute('aria-hidden', 'true');
      } else {
        comp.removeAttribute('hidden');
        comp.removeAttribute('aria-hidden');
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
    layersPanel.querySelectorAll<HTMLElement>('.creator-layers-panel-composite').forEach((comp) => {
      const ids = comp.dataset.layers?.split(/\s+/).filter((s) => s.length > 0) ?? [];
      const shouldHighlight = layer != null && ids.includes(layer);
      comp.classList.toggle('creator-layers-panel-composite-highlight', !!shouldHighlight);
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
    if (row) {
      const lockEl = row.querySelector<SVGElement>('.creator-layer-lock');
      row.classList.add('creator-layer-row-wiggle');
      if (lockEl) lockEl.classList.add('creator-layer-lock-flash');
      const clear = () => {
        row.classList.remove('creator-layer-row-wiggle');
        if (lockEl) lockEl.classList.remove('creator-layer-lock-flash');
      };
      setTimeout(clear, LOCK_FEEDBACK_DURATION_MS);
      return;
    }
    const composite = panelEl.querySelector<HTMLElement>(`.creator-layers-panel-composite[data-layers~="${layer}"]`);
    if (!composite) return;
    composite.classList.add('creator-layer-row-wiggle');
    const clearComp = () => composite.classList.remove('creator-layer-row-wiggle');
    setTimeout(clearComp, LOCK_FEEDBACK_DURATION_MS);
  });

  upperLeftPanels.appendChild(panel);
}
