import { createEl } from './creator/dom';
import { PREVIEW_PRESET_KEYS, getPreviewPresetLabel, type PreviewPresetKey } from './viewer';

type VectorLike = {
  x: number;
  y: number;
  z: number;
};

type PreviewCameraInfo = {
  activePreset: PreviewPresetKey | null;
  position: VectorLike;
  target: VectorLike;
  fov: number;
};

type PreviewCameraPanelContext = {
  container: HTMLElement;
  activePreset: PreviewPresetKey;
  onSelectPreset: (preset: PreviewPresetKey) => void;
};

let buttonPanel: HTMLElement | null = null;
let infoPanel: HTMLElement | null = null;
let activePresetLabel: HTMLElement | null = null;
let positionValue: HTMLElement | null = null;
let targetValue: HTMLElement | null = null;
let fovValue: HTMLElement | null = null;

function formatVector(v: VectorLike): string {
  return `x=${v.x.toFixed(3)} y=${v.y.toFixed(3)} z=${v.z.toFixed(3)}`;
}

export function ensurePreviewCameraPanel(ctx: PreviewCameraPanelContext): void {
  removePreviewCameraPanel();

  buttonPanel = createEl(
    'div',
    {
      id: 'preview-camera-panel',
      className: 'preview-camera-panel',
      'aria-label': 'Preview camera presets',
    },
    createEl('div', { className: 'preview-camera-panel-title' }, 'Camera presets'),
    createEl(
      'div',
      { className: 'preview-camera-button-grid', role: 'group', 'aria-label': 'Preview camera preset buttons' },
      ...PREVIEW_PRESET_KEYS.map((preset) =>
        createEl(
          'button',
          {
            type: 'button',
            className: 'preview-camera-preset-btn',
            'data-preset': preset,
            title: `Move camera to ${getPreviewPresetLabel(preset)}`,
          },
          getPreviewPresetLabel(preset),
        ),
      ),
    ),
  );

  infoPanel = createEl(
    'div',
    {
      id: 'preview-camera-info-panel',
      className: 'preview-camera-info-panel',
      'aria-live': 'polite',
      'aria-label': 'Preview camera info',
    },
    createEl('div', { className: 'preview-camera-info-title' }, 'Camera info'),
    createEl(
      'div',
      { className: 'preview-camera-info-lines' },
      createEl('div', { className: 'preview-camera-info-line' }, createEl('span', { className: 'preview-camera-info-label' }, 'Preset'), (activePresetLabel = createEl('span', { className: 'preview-camera-info-value' }, '—'))),
      createEl('div', { className: 'preview-camera-info-line' }, createEl('span', { className: 'preview-camera-info-label' }, 'Position'), (positionValue = createEl('span', { className: 'preview-camera-info-value' }, '—'))),
      createEl('div', { className: 'preview-camera-info-line' }, createEl('span', { className: 'preview-camera-info-label' }, 'Target'), (targetValue = createEl('span', { className: 'preview-camera-info-value' }, '—'))),
      createEl('div', { className: 'preview-camera-info-line' }, createEl('span', { className: 'preview-camera-info-label' }, 'FOV'), (fovValue = createEl('span', { className: 'preview-camera-info-value' }, '—'))),
    ),
  );

  buttonPanel.querySelectorAll<HTMLButtonElement>('.preview-camera-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (!preset || !PREVIEW_PRESET_KEYS.includes(preset as PreviewPresetKey)) return;
      ctx.onSelectPreset(preset as PreviewPresetKey);
    });
  });

  ctx.container.append(buttonPanel, infoPanel);
  setPreviewCameraActivePreset(ctx.activePreset);
}

export function setPreviewCameraActivePreset(preset: PreviewPresetKey | null): void {
  if (!buttonPanel) return;
  buttonPanel.querySelectorAll<HTMLButtonElement>('.preview-camera-preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });
  if (activePresetLabel) {
    activePresetLabel.textContent = preset ? getPreviewPresetLabel(preset) : 'Custom';
  }
}

export function updatePreviewCameraInfo(info: PreviewCameraInfo): void {
  if (!infoPanel) return;
  setPreviewCameraActivePreset(info.activePreset);
  if (positionValue) positionValue.textContent = formatVector(info.position);
  if (targetValue) targetValue.textContent = formatVector(info.target);
  if (fovValue) fovValue.textContent = info.fov.toFixed(3);
}

export function removePreviewCameraPanel(): void {
  buttonPanel?.remove();
  infoPanel?.remove();
  buttonPanel = null;
  infoPanel = null;
  activePresetLabel = null;
  positionValue = null;
  targetValue = null;
  fovValue = null;
}
