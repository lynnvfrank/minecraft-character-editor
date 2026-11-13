/**
 * Arm model picker (Auto / Slim / Classic) in the creator's lower-left panel group.
 * State lives in main.ts (it owns the character); main registers a context here.
 */

import { createEl } from './dom';
import { creatorScope } from './lifecycle';
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

const LABELS: Record<ArmModelSetting, string> = { auto: 'Auto', slim: 'Slim', classic: 'Classic' };
const TITLES: Record<ArmModelSetting, string> = {
  auto: 'Pick arm width from the skin',
  slim: 'Slim arms (3px, "Alex")',
  classic: 'Classic arms (4px, "Steve")',
};

export function buildArmModelPanel(): void {
  const ctx = registered;
  const host = document.getElementById('creator-lower-left-panels');
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

  const savePanel = document.getElementById('creator-save-download-panel');
  const homePanel = document.getElementById('creator-home-panel');
  host.insertBefore(panel, savePanel ?? homePanel ?? host.firstChild);
}
