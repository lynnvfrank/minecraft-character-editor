/**
 * Home view photo mode UI: the round camera button in the bottom-right stack, and the floating
 * bar shown while photo mode is on (Snap, Record, Lens, Tilt, Freeze, Polaroid, saved spots, Exit).
 * The mode itself is controllers/photoModeController.ts (described here by shape: ui can't
 * import controllers). Escape also exits.
 *
 * Snap uses the opaque stage capture (render and copy in one tick), so the shot is what is on
 * screen: residents, weather and the day/night light. The DOM (this bar) is never in the image.
 */
import { captureFileName, extensionForMimeType, formatElapsed, MAX_RECORDING_MS } from '../lib/captureFiles';
import { PHOTO_FOV_MAX, PHOTO_FOV_MIN, PHOTO_TILT_MAX, polaroidCaption, polaroidLayout } from '../lib/photoMode';
import { canRecordCanvas, createCanvasRecorder } from './canvasRecorder';
import { showToast } from './shareComboUi';

export type PhotoModeBarDeps = {
  mode: {
    enter: () => void;
    exit: () => void;
    isActive: () => boolean;
    getSnapshot: () => { active: boolean; frozen: boolean; fov: number; tilt: number };
    subscribe: (listener: () => void) => () => void;
    setFrozen: (on: boolean) => void;
    setFov: (fov: number) => void;
    setTilt: (deg: number) => void;
  };
  getCanvas: () => HTMLCanvasElement | null;
  /** The scene as framed now, in a 2D canvas (opaque). */
  takePhoto: () => HTMLCanvasElement | null;
  /** "Evening" etc. for the Polaroid caption. */
  getPartOfDay: () => string;
  /** The saved-spots chip row (ui/cameraBookmarkChips.ts), placed in the bar. */
  chips?: HTMLElement;
};

const FILE_PREFIX = 'village';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className: string, text: string, title: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.title = title;
  return b;
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
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The shot on a white instant-photo card with a caption (layout from lib/photoMode.ts). */
function polaroid(shot: HTMLCanvasElement, caption: string): HTMLCanvasElement | null {
  const l = polaroidLayout(shot.width, shot.height);
  const card = document.createElement('canvas');
  card.width = l.width;
  card.height = l.height;
  const ctx = card.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, l.width, l.height);
  ctx.drawImage(shot, l.imageX, l.imageY, l.imageWidth, l.imageHeight);
  ctx.fillStyle = '#3b3a36';
  ctx.font = `${l.fontPx}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(caption, l.captionX, l.captionY, l.imageWidth);
  return card;
}

function slider(label: string, min: number, max: number, step: number, title: string) {
  const wrap = el('label', 'photo-slider');
  wrap.title = title;
  const text = el('span', 'photo-slider-label', label);
  const input = el('input', 'photo-slider-input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  wrap.append(text, input);
  return { wrap, input };
}

export function createPhotoModeBar(deps: PhotoModeBarDeps) {
  const { mode } = deps;

  // --- Camera button (bottom-right stack, above Residents) ---
  const openBtn = button('photo-mode-btn', '📷', 'Photo mode: hide the buttons and take pictures');
  openBtn.id = 'photo-mode-btn';
  openBtn.setAttribute('aria-label', 'Photo mode');
  openBtn.addEventListener('click', () => mode.enter());

  // --- Bar ---
  const bar = el('div', 'photo-bar');
  bar.id = 'photo-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Photo mode');
  bar.hidden = true;

  const row = el('div', 'photo-bar-row');
  const snapBtn = button('photo-btn photo-btn--primary', '📷 Snap', 'Save a picture (PNG)');
  const recordBtn = button('photo-btn photo-record-btn', '● Record', '');
  recordBtn.setAttribute('aria-pressed', 'false');
  const lens = slider('Lens', PHOTO_FOV_MIN, PHOTO_FOV_MAX, 1, 'Zoom lens: left zooms in');
  const tiltCtl = slider('Tilt', -PHOTO_TILT_MAX, PHOTO_TILT_MAX, 1, 'Tilt the camera (double-click to level)');
  const freezeBtn = button('photo-btn', '❄ Freeze', 'Pause the village: everyone holds still');
  freezeBtn.setAttribute('aria-pressed', 'false');
  const polaroidLabel = el('label', 'photo-check');
  polaroidLabel.title = 'Put the photo on a white card with the date';
  const polaroidBox = el('input', '');
  polaroidBox.type = 'checkbox';
  polaroidLabel.append(polaroidBox, document.createTextNode('Polaroid'));
  const exitBtn = button('photo-btn photo-exit-btn', '✕', 'Leave photo mode (Esc)');
  exitBtn.setAttribute('aria-label', 'Leave photo mode');
  row.append(snapBtn, recordBtn, lens.wrap, tiltCtl.wrap, freezeBtn, polaroidLabel, exitBtn);
  bar.append(row);
  if (deps.chips) {
    const chipsRow = el('div', 'photo-bar-row photo-bar-spots');
    chipsRow.append(deps.chips);
    bar.append(chipsRow);
  }

  const flash = el('div', 'photo-flash');
  flash.setAttribute('aria-hidden', 'true');
  document.body.append(openBtn, bar, flash);

  // --- Snap ---
  function doFlash(): void {
    flash.classList.remove('is-on');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('is-on');
  }
  snapBtn.addEventListener('click', () => {
    let shot: HTMLCanvasElement | null = null;
    try {
      shot = deps.takePhoto();
      if (shot && polaroidBox.checked) shot = polaroid(shot, polaroidCaption(new Date(), deps.getPartOfDay()));
    } catch (error) {
      console.warn('[photo] snap failed', error);
      shot = null;
    }
    if (!shot) {
      showToast("Couldn't take the photo. Try again?");
      return;
    }
    doFlash();
    const name = captureFileName(new Date(), 'png', FILE_PREFIX);
    shot.toBlob((blob) => {
      if (!blob) {
        showToast("Couldn't save the photo. Try again?");
        return;
      }
      download(blob, name);
      showToast(`Saved ${name}`);
    }, 'image/png');
  });

  // --- Record ---
  const maxLabel = formatElapsed(MAX_RECORDING_MS);
  const recorder = createCanvasRecorder({
    getCanvas: deps.getCanvas,
    shouldContinue: mode.isActive,
    onTick: (elapsedMs, recording) => {
      bar.classList.toggle('recording', recording);
      recordBtn.setAttribute('aria-pressed', String(recording));
      recordBtn.textContent = recording ? `■ ${formatElapsed(elapsedMs)}` : '● Record';
    },
    onFinished: (blob, mimeType) => {
      const name = captureFileName(new Date(), extensionForMimeType(mimeType), FILE_PREFIX);
      download(blob, name);
      showToast(`Saved ${name}`);
    },
    onError: (error) => {
      console.warn('[photo] recording failed', error);
      showToast("Recording didn't work in this browser.");
    },
  });
  if (canRecordCanvas()) {
    recordBtn.title = `Record a video (up to ${maxLabel})`;
    recordBtn.addEventListener('click', () => {
      if (recorder.isRecording()) recorder.stop();
      else if (recorder.start()) showToast(`Recording… stops by itself at ${maxLabel}.`);
    });
  } else {
    recordBtn.disabled = true;
    recordBtn.title = "This browser can't record video";
  }

  // --- Lens, tilt, freeze, exit ---
  lens.input.addEventListener('input', () => mode.setFov(Number(lens.input.value)));
  tiltCtl.input.addEventListener('input', () => mode.setTilt(Number(tiltCtl.input.value)));
  tiltCtl.input.addEventListener('dblclick', () => mode.setTilt(0));
  freezeBtn.addEventListener('click', () => mode.setFrozen(!mode.getSnapshot().frozen));
  exitBtn.addEventListener('click', () => mode.exit());

  const isTyping = (t: EventTarget | null) => {
    const node = t as HTMLElement | null;
    return !!node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) && (node as HTMLInputElement).type === 'text');
  };
  // Capture phase on window: runs before the home view's own Escape (deselect).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !mode.isActive() || isTyping(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      mode.exit();
    },
    true
  );

  function sync(): void {
    const s = mode.getSnapshot();
    bar.hidden = !s.active;
    openBtn.classList.toggle('is-open', s.active);
    if (!s.active && recorder.isRecording()) recorder.stop();
    lens.input.value = String(Math.round(s.fov));
    tiltCtl.input.value = String(Math.round(s.tilt));
    freezeBtn.setAttribute('aria-pressed', String(s.frozen));
    freezeBtn.classList.toggle('active', s.frozen);
    freezeBtn.textContent = s.frozen ? '▶ Unfreeze' : '❄ Freeze';
  }
  mode.subscribe(sync);
  sync();

  return { stopRecording: () => recorder.stop() };
}
