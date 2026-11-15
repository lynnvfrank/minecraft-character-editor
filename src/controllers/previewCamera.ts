/**
 * Preview route camera: applies camera presets and drives the optional
 * preview-camera debug panel. Extracted from main.ts.
 */
import { getPreviewPreset, type PreviewPreset, type PreviewPresetKey } from '../viewer/previewPresets';
import type { SceneContext } from '../viewer/scene';
import { ensurePreviewCameraPanel, removePreviewCameraPanel, updatePreviewCameraInfo } from '../ui/previewCameraPanel';
import type { PreviewRouteInfo } from './previewRoute';

type Vec3 = { x: number; y: number; z: number };
export type CameraSnapshot = { position: Vec3; target: Vec3; fov: number };

const EPSILON = 0.0005;
const near = (a: number, b: number) => Math.abs(a - b) < EPSILON;

/** True when the camera still sits on `preset` (within float noise). */
export function cameraMatchesPreset(cam: CameraSnapshot, preset: PreviewPreset, defaultFov: number): boolean {
  const p = preset.cameraPosition;
  const t = preset.cameraTarget;
  return (
    near(cam.position.x, p.x) &&
    near(cam.position.y, p.y) &&
    near(cam.position.z, p.z) &&
    near(cam.target.x, t.x) &&
    near(cam.target.y, t.y) &&
    near(cam.target.z, t.z) &&
    near(cam.fov, preset.fov ?? defaultFov)
  );
}

/** Stable string for change detection (3 decimals). */
export function cameraSignature(presetKey: PreviewPresetKey | null, cam: CameraSnapshot): string {
  return [
    presetKey ?? 'custom',
    cam.position.x.toFixed(3),
    cam.position.y.toFixed(3),
    cam.position.z.toFixed(3),
    cam.target.x.toFixed(3),
    cam.target.y.toFixed(3),
    cam.target.z.toFixed(3),
    cam.fov.toFixed(3),
  ].join('|');
}

export type PreviewCameraDeps = {
  getSceneContext: () => SceneContext | null;
  defaultFov: number;
  showDebugPanel: boolean;
  isPreviewRoute: () => boolean;
};

function ensurePanelsContainer(): HTMLElement | null {
  const wrapper = document.getElementById('creator-view-wrapper');
  if (!wrapper) return null;
  let container = document.getElementById('preview-lower-right-panels');
  if (!container) {
    container = document.createElement('div');
    container.id = 'preview-lower-right-panels';
    container.className = 'preview-lower-right-panels';
    wrapper.appendChild(container);
  }
  let group = document.getElementById('preview-right-panels-group');
  if (!group) {
    group = document.createElement('div');
    group.id = 'preview-right-panels-group';
    group.className = 'preview-right-panels-group';
    container.appendChild(group);
  }
  return group;
}

export function createPreviewCameraController(deps: PreviewCameraDeps) {
  let activePreset: PreviewPresetKey | null = null;
  let lastPanelSignature = '';

  function snapshot(): CameraSnapshot | null {
    const ctx = deps.getSceneContext();
    if (!ctx?.camera || !ctx?.controls) return null;
    return { position: ctx.camera.position, target: ctx.controls.target, fov: ctx.camera.fov };
  }

  function applyPreset(key: PreviewPresetKey): void {
    const ctx = deps.getSceneContext();
    if (!ctx?.camera || !ctx?.controls) return;
    const preset = getPreviewPreset(key);
    ctx.camera.position.set(preset.cameraPosition.x, preset.cameraPosition.y, preset.cameraPosition.z);
    ctx.controls.target.set(preset.cameraTarget.x, preset.cameraTarget.y, preset.cameraTarget.z);
    ctx.camera.fov = preset.fov ?? deps.defaultFov;
    ctx.camera.updateProjectionMatrix();
    ctx.controls.update();
  }

  /** Per frame: refresh the debug panel; drop the active preset once the user orbits away. */
  function update(): void {
    if (!deps.showDebugPanel || !deps.isPreviewRoute()) return;
    const ctx = deps.getSceneContext();
    const cam = snapshot();
    if (!ctx?.camera || !ctx?.controls || !cam) return;
    if (activePreset && !cameraMatchesPreset(cam, getPreviewPreset(activePreset), deps.defaultFov)) {
      activePreset = null;
    }
    const signature = cameraSignature(activePreset, cam);
    if (signature === lastPanelSignature) return;
    lastPanelSignature = signature;
    updatePreviewCameraInfo({
      activePreset,
      position: ctx.camera.position,
      target: ctx.controls.target,
      fov: ctx.camera.fov,
    });
  }

  function removePanels(): void {
    removePreviewCameraPanel();
    document.getElementById('preview-lower-right-panels')?.remove();
    lastPanelSignature = '';
  }

  function ensureDebugPanel(info: PreviewRouteInfo): void {
    if (!deps.showDebugPanel || !deps.isPreviewRoute()) {
      removePanels();
      return;
    }
    const container = ensurePanelsContainer();
    if (!container) return;
    ensurePreviewCameraPanel({
      container,
      activePreset: activePreset ?? info.cameraPreset,
      onSelectPreset: (preset) => {
        activePreset = preset;
        applyPreset(preset);
        update();
      },
    });
    update();
  }

  /** Enter (or re-sync) the preview route with `info`'s camera preset. */
  function activate(info: PreviewRouteInfo): void {
    activePreset = info.cameraPreset;
    applyPreset(info.cameraPreset);
    ensureDebugPanel(info);
  }

  /** Leave the preview route: remove panels and restore the default FOV. */
  function reset(): void {
    removePanels();
    activePreset = null;
    const ctx = deps.getSceneContext();
    if (!ctx?.camera || ctx.camera.fov === deps.defaultFov) return;
    ctx.camera.fov = deps.defaultFov;
    ctx.camera.updateProjectionMatrix();
  }

  return { activate, update, reset };
}

export type PreviewCameraController = ReturnType<typeof createPreviewCameraController>;
