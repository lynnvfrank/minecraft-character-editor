/**
 * Save/Download panel: appears in bottom-left panel group, above Home button, in all Creator modes.
 * Keep: appends current skin to outfits panel. Save: exports 64×64 PNG.
 * Animates in from the left when creator is shown.
 *
 * Second row, shortcuts into the world: "Send to village" and "Dance in studio". They only publish
 * a bus event; controllers/creatorToWorld.ts does the work and answers with
 * `app:creator:world-status`, shown in the line under the buttons.
 */

import { createEl } from './dom';
import { createIcon } from './icons';
import type { DisposableScope } from './lifecycle';
import { APP_EVENTS, publish, subscribe } from '../events/appEvents';

export type SaveDownloadPanelContext = {
  onSave: () => void;
  onDownload: () => void;
};

export function buildSaveDownloadPanel(ctx: SaveDownloadPanelContext, scope: DisposableScope): void {
  const host = document.getElementById('creator-lower-left-panels');
  if (!host) return;

  const existing = document.getElementById('creator-save-download-panel');
  if (existing) existing.remove();

  const panel = createEl(
    'div',
    {
      id: 'creator-save-download-panel',
      className: 'creator-save-download-panel',
      role: 'group',
      'aria-label': 'Keep and save',
    },
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-btn creator-save-download-btn',
        id: 'creator-save-btn',
        title: 'Keep current skin in Outfits',
        'aria-label': 'Keep to outfits',
      },
      createIcon('modeCreatorKeep', { width: 18, height: 18 }),
      ' Keep'
    ),
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-btn creator-save-download-btn',
        id: 'creator-download-skin-btn',
        title: 'Save skin as PNG',
        'aria-label': 'Save skin',
      },
      createIcon('modeCreatorSave', { width: 18, height: 18 }),
      ' Save'
    ),
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-btn creator-save-download-btn creator-world-btn',
        id: 'creator-send-to-village-btn',
        title: 'Keep this skin and move it into the village',
        'aria-label': 'Send to village',
      },
      createIcon('modeHome', { width: 16, height: 16 }),
      ' Send to village'
    ),
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-btn creator-save-download-btn creator-world-btn',
        id: 'creator-dance-in-studio-btn',
        title: 'Take this skin to the dance studio',
        'aria-label': 'Dance in studio',
      },
      createIcon('modeStudio', { width: 16, height: 16 }),
      ' Dance in studio'
    ),
    createEl('div', { id: 'creator-world-status', className: 'creator-world-status', role: 'status' })
  );

  const status = panel.querySelector<HTMLElement>('#creator-world-status');
  const sendBtn = panel.querySelector<HTMLElement>('#creator-send-to-village-btn');
  const danceBtn = panel.querySelector<HTMLElement>('#creator-dance-in-studio-btn');
  if (sendBtn) scope.listen(sendBtn, 'click', () => publish(APP_EVENTS['app:creator:send-to-village']));
  if (danceBtn) scope.listen(danceBtn, 'click', () => publish(APP_EVENTS['app:creator:dance-in-studio']));
  scope.track(
    subscribe(APP_EVENTS['app:creator:world-status'], (e) => {
      // textContent only: the message may carry an outfit's (stored) name one day.
      if (status) status.textContent = e.detail?.message ?? '';
    })
  );

  panel.querySelector('#creator-save-btn')?.addEventListener('click', ctx.onSave);
  panel.querySelector('#creator-download-skin-btn')?.addEventListener('click', ctx.onDownload);

  const homePanel = document.getElementById('creator-home-panel');
  host.insertBefore(panel, homePanel ?? host.firstChild);
}
