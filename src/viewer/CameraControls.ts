/**
 * Camera controls UI: compact toolbar for Creator.Wardrobe and Creator.3D.
 * Publishes events only; camera movement is handled by creatorCameraController.
 */

import { publish, subscribe, CREATOR_EVENTS } from '../events/appEvents';
import { createEl } from '../creator/dom';

const BUTTONS: Array<{
  id: string;
  label: string;
  title: string;
  event: string;
  detail?: { degrees?: number };
}> = [
  { id: 'camera-left-45', label: 'Left', title: 'Rotate camera yaw left by 45 degrees', event: CREATOR_EVENTS.CAMERA_YAW_RIGHT, detail: { degrees: 45 } },
  { id: 'camera-pitch-up', label: 'Up', title: 'Adjust camera pitch upward by 30 degrees', event: CREATOR_EVENTS.CAMERA_PITCH_UP, detail: { degrees: 30 } },
  { id: 'camera-zoom-in', label: 'In', title: 'Move closer to the character', event: CREATOR_EVENTS.CAMERA_ZOOM_IN },
  { id: 'camera-recenter', label: 'Recenter', title: 'Reset to default front-facing view', event: CREATOR_EVENTS.CAMERA_RECENTER },
  { id: 'camera-zoom-out', label: 'Out', title: 'Move farther from the character', event: CREATOR_EVENTS.CAMERA_ZOOM_OUT },
  { id: 'camera-pitch-down', label: 'Down', title: 'Adjust camera pitch downward by 30 degrees', event: CREATOR_EVENTS.CAMERA_PITCH_DOWN, detail: { degrees: 30 } },
  { id: 'camera-right-45', label: 'Right', title: 'Rotate camera yaw right by 45 degrees', event: CREATOR_EVENTS.CAMERA_YAW_LEFT, detail: { degrees: 45 } },
];

let moveStartEndBound = false;

function setButtonsDisabled(value: boolean): void {
  const toolbar = document.getElementById('creator-camera-controls-toolbar');
  if (!toolbar) return;
  toolbar.querySelectorAll<HTMLButtonElement>('.creator-camera-controls-btn').forEach((btn) => {
    btn.disabled = value;
  });
}

export function buildCameraControls(): void {
  let container = document.getElementById('creator-top-center-panels');
  if (!container) {
    const wrapper = document.getElementById('creator-view-wrapper');
    if (!wrapper) return;
    container = document.createElement('div');
    container.id = 'creator-top-center-panels';
    container.className = 'creator-top-center-panels';
    container.setAttribute('aria-label', 'Camera controls');
    wrapper.insertBefore(container, wrapper.firstChild);
  }

  const oldToolbar = document.getElementById('creator-camera-controls-toolbar');
  if (oldToolbar) oldToolbar.remove();

  const toolbar = createEl('div', {
    id: 'creator-camera-controls-toolbar',
    className: 'creator-camera-controls-toolbar',
    role: 'group',
    'aria-label': 'Camera controls',
  });
  let disabled = false;

  for (const cfg of BUTTONS) {
    const btn = createEl('button', {
      type: 'button',
      id: cfg.id,
      className: 'creator-camera-controls-btn',
      title: cfg.title,
      'aria-label': cfg.title,
      'data-action': cfg.event,
    });
    btn.textContent = cfg.label;
    btn.addEventListener('click', () => {
      if (disabled) return;
      publish(cfg.event, cfg.detail ?? {});
    });
    toolbar.appendChild(btn);
  }

  if (!moveStartEndBound) {
    moveStartEndBound = true;
    subscribe(CREATOR_EVENTS.CAMERA_MOVE_START, () => setButtonsDisabled(true));
    subscribe(CREATOR_EVENTS.CAMERA_MOVE_END, () => setButtonsDisabled(false));
  }

  container.appendChild(toolbar);
}
