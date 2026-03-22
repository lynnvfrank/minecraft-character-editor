/**
 * Orbit controls, pointer handlers, tool switching for creator 3D paint.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { uvToWorkingCoords } from '../skin';
import {
  getEditMode3D,
  getActiveTool,
  getBrushSize,
  getBrushCursorStyleFor3D,
  getLayer3DVisible,
  getLayer3DLocked,
  getLayerAndPartAtCoords,
  getPartVisible,
  paintStartFrom3D,
  paintMoveFrom3D,
  paintEndFrom3D,
  sampleColorAtWithAlpha,
  EYEDROPPER_ALPHA_THRESHOLD,
  applySampledColor,
  updateHoverInfo,
  getPartDisplayNameAtCoords
} from '../creator';
import { subscribe, publish, CREATOR_EVENTS } from '../events/appEvents';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export type Creator3DPaintDeps = {
  getControls: () => OrbitControls;
  setControls: (c: OrbitControls) => void;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  getCharacterModel: () => THREE.Group | null;
  getRoute: () => 'creator' | 'viewer' | 'preview';
  onWindowResize: () => void;
  onUpdateViewPlacement: () => void;
};

function getCharacterMeshes(getCharacterModel: () => THREE.Group | null): THREE.Object3D[] {
  const model = getCharacterModel();
  if (!model) return [];
  const meshes: THREE.Object3D[] = [];
  model.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj);
  });
  return meshes;
}

function sampleColorFromRaycast(
  deps: Creator3DPaintDeps,
  clientX: number,
  clientY: number
): string | null {
  const { camera, renderer, getCharacterModel } = deps;
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = getCharacterMeshes(getCharacterModel);
  const intersects = raycaster.intersectObjects(meshes, false);
  const layerLocked = getLayer3DLocked();
  for (const hit of intersects) {
    const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
    if (!uv) continue;
    const { x, y } = uvToWorkingCoords(uv.x, uv.y);
    const info = getLayerAndPartAtCoords(x, y);
    if (!info) continue;
    const layerVisible = getLayer3DVisible();
    const visible =
      info.side !== undefined
        ? getPartVisible(info.layer, info.side)
        : layerVisible[info.layer] !== false;
    if (!visible) continue;
    if (layerLocked[info.layer] === true) continue;
    const sample = sampleColorAtWithAlpha(x, y);
    if (sample && sample.alpha >= EYEDROPPER_ALPHA_THRESHOLD) return sample.hex;
  }
  return null;
}

function raycastToPaintableUV(
  deps: Creator3DPaintDeps,
  clientX: number,
  clientY: number
): { u: number; v: number } | null {
  const { camera, renderer, getCharacterModel } = deps;
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = getCharacterMeshes(getCharacterModel);
  const intersects = raycaster.intersectObjects(meshes, false);
  const layerLocked = getLayer3DLocked();
  for (const hit of intersects) {
    const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
    if (!uv) continue;
    const { x, y } = uvToWorkingCoords(uv.x, uv.y);
    const info = getLayerAndPartAtCoords(x, y);
    if (!info) continue;
    const layerVisible = getLayer3DVisible();
    const visible =
      info.side !== undefined
        ? getPartVisible(info.layer, info.side)
        : layerVisible[info.layer] !== false;
    if (!visible) continue;
    if (layerLocked[info.layer] === true) continue;
    return { u: uv.x, v: uv.y };
  }
  return null;
}

/** Returns layer info for first visible hit (including locked). Used for lock feedback when paint is blocked. */
function raycastToVisibleLayer(
  deps: Creator3DPaintDeps,
  clientX: number,
  clientY: number
): { layer: string; isLocked: boolean } | null {
  const { camera, renderer, getCharacterModel } = deps;
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = getCharacterMeshes(getCharacterModel);
  const intersects = raycaster.intersectObjects(meshes, false);
  const layerLocked = getLayer3DLocked();
  const layerVisible = getLayer3DVisible();
  for (const hit of intersects) {
    const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
    if (!uv) continue;
    const { x, y } = uvToWorkingCoords(uv.x, uv.y);
    const info = getLayerAndPartAtCoords(x, y);
    if (!info) continue;
    const visible =
      info.side !== undefined
        ? getPartVisible(info.layer, info.side)
        : layerVisible[info.layer] !== false;
    if (!visible) continue;
    return { layer: info.layer, isLocked: layerLocked[info.layer] === true };
  }
  return null;
}

export function updateOrbitControlsForEditMode(
  controls: OrbitControls,
  getRoute: () => 'creator' | 'viewer' | 'preview'
): void {
  if (getRoute() !== 'creator') return;
  if (getEditMode3D()) {
    const isNavigate = getActiveTool() === 'navigate';
    controls.mouseButtons = {
      LEFT: isNavigate ? THREE.MOUSE.ROTATE : null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
  } else {
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }
}

export function updateCreator3DCanvasCursor(
  renderer: THREE.WebGLRenderer,
  getRoute: () => 'creator' | 'viewer' | 'preview'
): void {
  const canvas = renderer.domElement;
  if (getRoute() !== 'creator' || !getEditMode3D()) {
    canvas.style.cursor = '';
    return;
  }
  const tool = getActiveTool();
  if (tool === 'brush' || tool === 'eraser' || tool === 'fill') {
    canvas.style.cursor = getBrushCursorStyleFor3D(getBrushSize());
  } else if (tool === 'eyedropper') {
    canvas.style.cursor = 'crosshair';
  } else {
    canvas.style.cursor = '';
  }
}

export function recreateOrbitControls(
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer
): OrbitControls {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);
  return controls;
}

export function resetCameraFor2DPreview(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls
): void {
  camera.position.set(0, 1.5, 4);
  controls.target.set(0, 1, 0);
  controls.update();
}

export function setupCreator3DPaint(deps: Creator3DPaintDeps): void {
  const { getControls, renderer } = deps;
  const canvas = renderer.domElement;
  let is3DPainting = false;
  let controlsTemporarilyDisabled = false;

  const refreshControls = () => {
    if (controlsTemporarilyDisabled) return;
    updateOrbitControlsForEditMode(getControls(), deps.getRoute);
    deps.onUpdateViewPlacement();
    updateCreator3DCanvasCursor(renderer, deps.getRoute);
  };

  const releasePaintControl = () => {
    if (!controlsTemporarilyDisabled) return;
    controlsTemporarilyDisabled = false;
    getControls().enabled = true;
    updateOrbitControlsForEditMode(getControls(), deps.getRoute);
    updateCreator3DCanvasCursor(renderer, deps.getRoute);
  };

  function handlePointerDown(e: MouseEvent) {
    if (deps.getRoute() !== 'creator' || !getEditMode3D()) return;
    if (e.button !== 0) return;
    const activeTool = getActiveTool();
    if (activeTool === 'navigate') return;
    controlsTemporarilyDisabled = true;
    getControls().enabled = false;
    if (activeTool === 'eyedropper' || e.altKey) {
      const hex = sampleColorFromRaycast(deps, e.clientX, e.clientY);
      if (hex) applySampledColor(hex);
      releasePaintControl();
      return;
    }
    const uv = raycastToPaintableUV(deps, e.clientX, e.clientY);
    if (!uv) {
      const visibleHit = raycastToVisibleLayer(deps, e.clientX, e.clientY);
      if (visibleHit?.isLocked) {
        publish(CREATOR_EVENTS.LOCK_FEEDBACK, { layer: visibleHit.layer });
      }
      releasePaintControl();
      return;
    }
    const { x, y } = uvToWorkingCoords(uv.u, uv.v);
    paintStartFrom3D(x, y);
    is3DPainting = true;
    e.preventDefault();
  }

  function handlePointerMove(e: MouseEvent) {
    if (deps.getRoute() !== 'creator' || !getEditMode3D()) return;
    const activeTool = getActiveTool();
    const eyedropperHoverColor = activeTool === 'eyedropper'
      ? sampleColorFromRaycast(deps, e.clientX, e.clientY)
      : null;
    const uv = raycastToPaintableUV(deps, e.clientX, e.clientY);
    if (uv) {
      const { x, y } = uvToWorkingCoords(uv.u, uv.v);
      const part = getPartDisplayNameAtCoords(x, y);
      const skinX = Math.floor(x / 2);
      const skinY = Math.floor(y / 2);
      updateHoverInfo(part, skinX, skinY, eyedropperHoverColor);
    } else {
      updateHoverInfo(null, -1, -1, null);
    }
    if (!is3DPainting) return;
    const paintUv = raycastToPaintableUV(deps, e.clientX, e.clientY);
    if (!paintUv) return;
    const { x, y } = uvToWorkingCoords(paintUv.u, paintUv.v);
    paintMoveFrom3D(x, y);
    e.preventDefault();
  }

  function handle3DCanvasLeave() {
    if (deps.getRoute() === 'creator' && getEditMode3D()) {
      updateHoverInfo(null, -1, -1);
    }
  }

  function handlePointerUp(e: MouseEvent) {
    if (e.button !== 0) return;
    if (is3DPainting) {
      paintEndFrom3D();
      is3DPainting = false;
      e.preventDefault();
    }
    releasePaintControl();
  }

  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  canvas.addEventListener('mouseup', handlePointerUp);
  window.addEventListener('mouseup', handlePointerUp);
  canvas.addEventListener('mouseleave', (e) => {
    handle3DCanvasLeave();
    handlePointerUp(e);
  });
  canvas.addEventListener('mouseenter', () => {
    updateCreator3DCanvasCursor(renderer, deps.getRoute);
  });

  subscribe(CREATOR_EVENTS.EDIT_MODE_CHANGE, () => {
    refreshControls();
  });
  subscribe(CREATOR_EVENTS.TOOLS_CHANGE, () => {
    refreshControls();
  });
  document.addEventListener('keydown', () => {
    // Keyboard tool shortcuts (B/E/G/H) update creator state; sync controls/cursor immediately.
    refreshControls();
  });
  refreshControls();
}
