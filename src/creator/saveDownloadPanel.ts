/**
 * Save/Download panel: appears in bottom-left panel group, above Home button, in all Creator modes.
 * Keep: appends current skin to outfits panel. Save: exports 64×64 PNG.
 * Animates in from the left when creator is shown.
 */

import { PaperUiSurface } from '../config/paperUiSurfaces';
import { cx, paperBtn, paperCard } from '../ui/paperUiClasses';
import { createEl } from './dom';
import { createIcon } from './icons';

export type SaveDownloadPanelContext = {
  onSave: () => void;
  onDownload: () => void;
};

export function buildSaveDownloadPanel(ctx: SaveDownloadPanelContext): void {
  const host = document.getElementById('creator-lower-left-panels');
  if (!host) return;

  const existing = document.getElementById('creator-save-download-panel');
  if (existing) existing.remove();

  const panel = createEl(
    'div',
    {
      id: 'creator-save-download-panel',
      className: cx('creator-save-download-panel', paperCard(PaperUiSurface.saveDownloadPanel)),
      role: 'group',
      'aria-label': 'Keep and save',
    },
    createEl(
      'button',
      {
        type: 'button',
        className: cx(
          'creator-btn',
          'creator-save-download-btn',
          paperBtn(PaperUiSurface.saveDownloadPanel, 'primarySm'),
        ),
        id: 'creator-save-btn',
        title: 'Keep current skin in Outfits',
        'aria-label': 'Keep to outfits',
      },
      createIcon('modeCreatorKeep', { width: 18, height: 18 }),
      ' Keep',
    ),
    createEl(
      'button',
      {
        type: 'button',
        className: cx(
          'creator-btn',
          'creator-save-download-btn',
          paperBtn(PaperUiSurface.saveDownloadPanel, 'secondaryOutlineSm'),
        ),
        id: 'creator-download-skin-btn',
        title: 'Save skin as PNG',
        'aria-label': 'Save skin',
      },
      createIcon('modeCreatorSave', { width: 18, height: 18 }),
      ' Save',
    ),
  );

  panel.querySelector('#creator-save-btn')?.addEventListener('click', ctx.onSave);
  panel.querySelector('#creator-download-skin-btn')?.addEventListener('click', ctx.onDownload);

  const homePanel = document.getElementById('creator-home-panel');
  host.insertBefore(panel, homePanel ?? host.firstChild);
}
