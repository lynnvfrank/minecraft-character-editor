/**
 * Records a canvas to a video file with `canvas.captureStream()` + `MediaRecorder`. Pure rules
 * (mime preference, max length) live in lib/captureFiles.ts; this is the browser side.
 */
import { MAX_RECORDING_MS, pickVideoMimeType, reachedMaxLength } from '../lib/captureFiles';

export type CanvasRecorderDeps = {
  getCanvas: () => HTMLCanvasElement | null;
  /** Called once per recording with the finished file (not called if nothing was captured). */
  onFinished: (blob: Blob, mimeType: string) => void;
  /** Called about four times a second while recording, and once more when it stops. */
  onTick: (elapsedMs: number, recording: boolean) => void;
  /** Checked on every tick; the recording stops when it returns false. */
  shouldContinue?: () => boolean;
  onError?: (error: unknown) => void;
  fps?: number;
  maxMs?: number;
};

const TICK_MS = 250;

/** Can this browser record a canvas at all? */
export function canRecordCanvas(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export function createCanvasRecorder(deps: CanvasRecorderDeps) {
  const fps = deps.fps ?? 30;
  const maxMs = deps.maxMs ?? MAX_RECORDING_MS;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let timer: number | null = null;
  let startedAt = 0;

  const isRecording = () => recorder !== null;

  function cleanup(): void {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  }

  function stop(): void {
    const r = recorder;
    if (!r) return;
    if (r.state !== 'inactive') r.stop(); // `onstop` delivers the file and cleans up
    else cleanup();
  }

  function start(): boolean {
    if (recorder) return true;
    const canvas = deps.getCanvas();
    if (!canvas || !canRecordCanvas()) return false;
    try {
      const s = canvas.captureStream(fps);
      const mime = pickVideoMimeType((m) => MediaRecorder.isTypeSupported(m));
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      r.onerror = (e) => {
        deps.onError?.(e);
        stop();
      };
      r.onstop = () => {
        const type = r.mimeType || mime || 'video/webm';
        const elapsed = performance.now() - startedAt;
        cleanup();
        deps.onTick(elapsed, false);
        if (chunks.length > 0) deps.onFinished(new Blob(chunks, { type }), type);
      };
      stream = s;
      recorder = r;
      startedAt = performance.now();
      r.start(1000);
      timer = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        if (reachedMaxLength(elapsed, maxMs) || deps.shouldContinue?.() === false) stop();
        else deps.onTick(elapsed, true);
      }, TICK_MS);
      deps.onTick(0, true);
      return true;
    } catch (error) {
      cleanup();
      deps.onError?.(error);
      return false;
    }
  }

  return { start, stop, isRecording };
}
