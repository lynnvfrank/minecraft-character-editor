/**
 * Arm model picker (Auto / Slim / Classic): a small panel floating directly under the
 * wardrobe panel (Wardrobe, 3D and 2D modes; see modePanels.ts).
 * State lives in main.ts (it owns the character); main registers a context here.
 */

import { createEl } from './dom';
import { creatorScope } from './lifecycle';
import { MODE_PANEL_CONFIGS } from './modePanels';
import type { ArmModel, ArmModelSetting } from '../skin/armModel';

export type ArmModelPanelContext = {
  getSetting: () => ArmModelSetting;
  getResolved: () => ArmModel;
  setSetting: (setting: ArmModelSetting) => void;
  /** Subscribe to resolved-model changes (e.g. auto-detect after a skin load). */
  subscribe: (cb: () => void) => () => void;
};

let registered: ArmModelPanelContext | null = null;

export function registerArmModelPanelContext(ctx: ArmModelPanelContext): void {
  registered = ctx;
}

/** The arm setting's owner (main.ts), once registered. */
export function getArmModelPanelContext(): ArmModelPanelContext | null {
  return registered;
}

const LABELS: Record<ArmModelSetting, string> = { auto: 'Auto', slim: 'Slim', classic: 'Classic' };
const TITLES: Record<ArmModelSetting, string> = {
  auto: 'Pick arm width from the skin',
  slim: 'Slim arms (3px, "Alex")',
  classic: 'Classic arms (4px, "Steve")',
};

export function buildArmModelPanel(): void {
  const ctx = registered;
  const host = document.getElementById('creator-upper-left-panels');
  document.getElementById('creator-arm-model-panel')?.remove();
  if (!ctx || !host) return;

  const buttons = (['auto', 'slim', 'classic'] as const).map((setting) =>
    createEl(
      'button',
      {
        type: 'button',
        className: 'creator-arm-model-btn',
        'data-setting': setting,
        title: TITLES[setting],
        'aria-pressed': 'false',
      },
      LABELS[setting]
    )
  );
  const hint = createEl('span', { className: 'creator-arm-model-hint' });
  const panel = createEl(
    'div',
    { id: 'creator-arm-model-panel', className: 'creator-arm-model-panel', role: 'group', 'aria-label': 'Arm width' },
    createEl('div', { className: 'creator-arm-model-header' }, createEl('span', {}, 'Arms'), hint),
    createEl('div', { className: 'creator-arm-model-buttons' }, ...buttons)
  );

  const sync = () => {
    const setting = ctx.getSetting();
    for (const btn of buttons) {
      const on = btn.dataset.setting === setting;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    hint.textContent = setting === 'auto' ? `→ ${LABELS[ctx.getResolved()]}` : '';
  };

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      ctx.setSetting(btn.dataset.setting as ArmModelSetting);
      sync();
    });
  }
  creatorScope.track(ctx.subscribe(sync));
  sync();

  // Sit under whichever main panel is showing: Layers (3D/2D) or Wardrobe. They never
  // show together, so placing after the later of the two works for every mode.
  const anchor = ['creator-layers-panel', 'creator-wardrobe-parts-panel', 'creator-me-panel']
    .map((id) => document.getElementById(id))
    .find((el) => el?.parentElement === host);
  if (anchor) host.insertBefore(panel, anchor.nextSibling);
  else host.appendChild(panel);
  // Match current mode visibility (it's built after the mode panels were last synced).
  const mode = document.body.dataset.editMode;
  if (mode && !MODE_PANEL_CONFIGS.find((c) => c.id === panel.id)?.modes.includes(mode as never)) {
    panel.classList.add('creator-mode-panel-hidden');
  }
}
