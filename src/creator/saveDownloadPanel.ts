/**
 * Save/Download panel: appears below Creator mode buttons, before wardrobe-parts-panel, in all Creator modes.
 * Save: appends current skin to outfits panel. Download: exports 64×64 PNG.
 */

import { createEl } from './dom';

export type SaveDownloadPanelContext = {
  onSave: () => void;
  onDownload: () => void;
};

export function buildSaveDownloadPanel(ctx: SaveDownloadPanelContext): void {
  const host = document.getElementById('creator-upper-left-panels');
  if (!host) return;

  const existing = document.getElementById('creator-save-download-panel');
  if (existing) existing.remove();

  const panel = createEl(
    'div',
    {
      id: 'creator-save-download-panel',
      className: 'creator-save-download-panel',
      role: 'group',
      'aria-label': 'Save and download',
    },
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-btn creator-save-download-btn',
        id: 'creator-save-btn',
        title: 'Save current skin to Outfits',
        'aria-label': 'Save to outfits',
      },
      'Save'
    ),
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-btn creator-save-download-btn',
        id: 'creator-download-skin-btn',
        title: 'Download skin as PNG',
        'aria-label': 'Download skin',
      },
      'Download'
    )
  );

  panel.querySelector('#creator-save-btn')?.addEventListener('click', ctx.onSave);
  panel.querySelector('#creator-download-skin-btn')?.addEventListener('click', ctx.onDownload);

  const wardrobePanel = document.getElementById('creator-wardrobe-parts-panel');
  const modePanel = document.getElementById('creator-mode-panel');
  host.insertBefore(panel, wardrobePanel ?? modePanel?.nextSibling ?? host.firstChild);
}
