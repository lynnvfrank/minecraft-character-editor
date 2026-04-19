/**
 * Creator.Wardrobe: post-processing preset bar (viewport bottom-center, fixed dock).
 * Presets map to pmndrs/postprocessing (see `viewer/postFxPipeline.ts`); not mesh ShaderMaterials.
 * The dock is outside `#creator-view-wrapper` and does not use Paper `.card` on the root (hover transform breaks `translateX(-50%)`).
 */

import { WARDROBE_POST_FX_PRESET_IDS, type WardrobePostFxPresetId } from '../domain/postFx';
import { CREATOR_EVENTS, publish } from '../events/appEvents';
import { creatorModeSlice, creatorWardrobePostFxSlice } from '../state/creatorSlices';
import { PaperUiSurface } from '../config/paperUiSurfaces';
import { cx, paperBtn } from '../ui/paperUiClasses';

const PANEL_ID = 'creator-wardrobe-postfx-panel';

const PRESET_LABELS: Record<WardrobePostFxPresetId, string> = {
  natural: 'Natural',
  bloom: 'Bloom',
  cinema: 'Cinema',
};

let postFxSliceSubscribed = false;
let modeSliceSubscribed = false;

function syncActiveButton(root: HTMLElement, activeId: WardrobePostFxPresetId): void {
  root.querySelectorAll<HTMLButtonElement>('[data-postfx-preset]').forEach((btn) => {
    const id = btn.dataset.postfxPreset as WardrobePostFxPresetId | undefined;
    btn.classList.toggle('creator-wardrobe-postfx-btn--active', id === activeId);
  });
}

function bindPostFxSliceOnce(): void {
  if (postFxSliceSubscribed) return;
  postFxSliceSubscribed = true;
  creatorWardrobePostFxSlice.subscribe((detail) => {
    const root = document.getElementById(PANEL_ID) as HTMLElement | null;
    if (!root) return;
    syncActiveButton(root, detail.activePresetId);
  });
}

function bindWardrobeModeOnce(): void {
  if (modeSliceSubscribed) return;
  modeSliceSubscribed = true;
  creatorModeSlice.subscribe((d) => {
    if ((d.mode ?? '') === 'wardrobe') mountWardrobePostFxPanelContent();
  });
}

/** Idempotent: fills the dock when preset buttons are missing. */
function mountWardrobePostFxPanelContent(): void {
  const root = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (!root) return;
  if (root.querySelector('[data-postfx-preset]')) return;

  root.textContent = '';
  root.className = 'creator-wardrobe-postfx-dock';

  const header = document.createElement('div');
  header.className = 'creator-wardrobe-effects-header';
  header.textContent = 'Scene effects';
  root.appendChild(header);

  const hint = document.createElement('div');
  hint.className = 'creator-wardrobe-effects-hint';
  hint.textContent = 'Post-processing presets (choose one)';
  root.appendChild(hint);

  const row = document.createElement('div');
  row.className = 'creator-wardrobe-effects-buttons';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Post-processing presets');

  for (const id of WARDROBE_POST_FX_PRESET_IDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.postfxPreset = id;
    btn.className = cx(
      'creator-wardrobe-postfx-btn',
      paperBtn(PaperUiSurface.wardrobePostFxPresetButton, 'secondaryOutlineSm')
    );
    btn.textContent = PRESET_LABELS[id];
    btn.title =
      id === 'natural'
        ? 'No extra post-processing'
        : id === 'bloom'
          ? 'Bloom (library BloomEffect)'
          : 'Bloom + vignette + chromatic aberration';
    btn.addEventListener('click', () => {
      publish(CREATOR_EVENTS.WARDROBE_POST_FX_SET, { presetId: id });
    });
    row.appendChild(btn);
  }

  root.appendChild(row);

  bindPostFxSliceOnce();
  syncActiveButton(root, 'natural');
}

/**
 * Ensures the wardrobe post-FX bar exists; re-runs when edit mode becomes wardrobe
 * (initCreator is not called on every wardrobe re-entry).
 */
export function buildWardrobePostFxPanel(): void {
  bindWardrobeModeOnce();
  mountWardrobePostFxPanelContent();
}
