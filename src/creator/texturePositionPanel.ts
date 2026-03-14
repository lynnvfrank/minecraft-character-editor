import { subscribe, CREATOR_EVENTS } from '../creatorEvents';
import type { CreatorTexturePositionDetail } from '../creatorEvents';
import { getCreatorPanelsContainer } from './container';

export function buildTexturePositionPanel(): void {
  const container = getCreatorPanelsContainer();
  if (!container) return;

  let panel = document.getElementById('creator-hover-info-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'creator-hover-info-panel';
  panel.className = 'creator-hover-info-panel';
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Current skin part and coordinates');
  const textSpan = document.createElement('span');
  textSpan.className = 'creator-hover-info-text';
  textSpan.textContent = '—';
  panel.appendChild(textSpan);

  subscribe(CREATOR_EVENTS.TEXTURE_POSITION_CHANGE, (e: CustomEvent<CreatorTexturePositionDetail>) => {
    const { part, skinX, skinY } = e.detail ?? { part: null, layer: null, skinX: -1, skinY: -1 };
    const textEl = document.querySelector('.creator-hover-info-text');
    if (!textEl) return;
    if (part == null || skinX < 0 || skinY < 0) {
      textEl.textContent = '—';
    } else {
      textEl.textContent = `${part} (${skinX},${skinY})`;
    }
  });

  container.appendChild(panel);
}
