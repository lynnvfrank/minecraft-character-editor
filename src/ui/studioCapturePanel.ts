/**
 * "Camera" section of the dance studio panel (`#/studio`): save a photo of the stage (optionally
 * with a transparent background) or record a short video of it.
 *
 * A separate module from studioPanel.ts: it builds its own collapsible section and mounts it at
 * its place in the panel (last: shooting comes after mixing and dressing the stage). Created once
 * at startup, like the studio panel itself.
 *
 * While recording, a small "REC m:ss" badge sits over the stage (DOM, so it is not in the video)
 * and the section header shows the same when the section is collapsed.
 */
import { captureFileName, extensionForMimeType, formatElapsed, MAX_RECORDING_MS } from '../lib/captureFiles';
import { canRecordCanvas, createCanvasRecorder } from './canvasRecorder';
import { createCollapsibleSection, mountStudioSection } from './collapsibleSection';

export type StudioCapturePanelDeps = {
  /** The studio panel root (`#studio-panel`); the REC badge goes next to it, over the stage. */
  mount: HTMLElement | null;
  /** The stage's WebGL canvas (recorded as-is). */
  getCanvas: () => HTMLCanvasElement | null;
  /** Render the stage as currently framed into a 2D canvas (ui can't reach the scene itself). */
  takePhoto: (options: { transparent: boolean }) => HTMLCanvasElement | null;
  /** False once the user has left the studio; a running recording then stops. */
  isOnStage: () => boolean;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function createStudioCapturePanel(deps: StudioCapturePanelDeps) {
  const canRecord = canRecordCanvas();
  /** Elapsed time of the running recording, or null when not recording. */
  let recordingMs: number | null = null;
  const section = createCollapsibleSection({
    id: 'capture',
    title: 'Camera',
    className: 'studio-capture',
    domId: 'studio-capture',
    summary: () =>
      recordingMs != null ? `● REC ${formatElapsed(recordingMs)}` : canRecord ? 'Photo · Video' : 'Photo',
  });
  const root = section.root;

  const row = el('div', 'studio-row');
  const photoBtn = el('button', 'studio-btn studio-capture-btn', '📷 Photo');
  photoBtn.type = 'button';
  photoBtn.id = 'studio-photo-btn';
  photoBtn.title = 'Save a picture of the stage';
  const recordBtn = el('button', 'studio-btn studio-capture-btn studio-record-btn', '● Record');
  recordBtn.type = 'button';
  recordBtn.id = 'studio-record-btn';
  recordBtn.setAttribute('aria-pressed', 'false');
  row.append(photoBtn, recordBtn);

  const optRow = el('div', 'studio-row');
  const transparentLabel = el('label', 'studio-check');
  const transparentBox = el('input', '');
  transparentBox.type = 'checkbox';
  transparentBox.id = 'studio-photo-transparent';
  transparentLabel.append(transparentBox, document.createTextNode('Transparent background'));
  transparentLabel.title = 'Photo only: leave out the sky and the floor';
  optRow.append(transparentLabel);

  const hint = el('p', 'studio-hint');
  hint.setAttribute('aria-live', 'polite');
  section.body.append(row, optRow, hint);
  mountStudioSection(deps.mount, root);

  // Over the stage's top-left corner while recording. Plain DOM: the video only records the canvas.
  const badge = el('div', 'studio-rec-badge');
  badge.id = 'studio-rec-badge';
  badge.hidden = true;
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-label', 'Recording');
  deps.mount?.parentElement?.append(badge);

  // --- Photo ---
  photoBtn.addEventListener('click', () => {
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = deps.takePhoto({ transparent: transparentBox.checked });
    } catch (error) {
      console.warn('[studio] photo failed', error);
    }
    if (!canvas) {
      hint.textContent = "Couldn't take the photo. Try again?";
      return;
    }
    const name = captureFileName(new Date(), 'png');
    canvas.toBlob((blob) => {
      if (!blob) {
        hint.textContent = "Couldn't save the photo. Try again?";
        return;
      }
      download(blob, name);
      hint.textContent = `Saved ${name}`;
    }, 'image/png');
  });

  // --- Video ---
  const maxLabel = formatElapsed(MAX_RECORDING_MS);
  const recorder = createCanvasRecorder({
    getCanvas: deps.getCanvas,
    shouldContinue: deps.isOnStage,
    onTick: (elapsedMs, recording) => {
      recordingMs = recording ? elapsedMs : null;
      root.classList.toggle('recording', recording);
      badge.hidden = !recording;
      if (recording) badge.textContent = `REC ${formatElapsed(elapsedMs)}`;
      section.refresh();
      recordBtn.setAttribute('aria-pressed', String(recording));
      recordBtn.textContent = recording ? `■ Stop ${formatElapsed(elapsedMs)}` : '● Record';
      if (recording) hint.textContent = `Recording… stops by itself at ${maxLabel}.`;
    },
    onFinished: (blob, mimeType) => {
      const name = captureFileName(new Date(), extensionForMimeType(mimeType));
      download(blob, name);
      hint.textContent = `Saved ${name}`;
    },
    onError: (error) => {
      console.warn('[studio] recording failed', error);
      hint.textContent = "Recording didn't work in this browser.";
    },
  });

  if (canRecord) {
    recordBtn.title = `Record a video of the stage (up to ${maxLabel})`;
    recordBtn.addEventListener('click', () => {
      if (recorder.isRecording()) recorder.stop();
      else recorder.start();
    });
  } else {
    recordBtn.disabled = true;
    recordBtn.title = "This browser can't record video";
    hint.textContent = "Video recording isn't available in this browser.";
  }

  return {
    /** Stop a running recording (the file still downloads). */
    stopRecording: () => recorder.stop(),
    isRecording: () => recorder.isRecording(),
  };
}
