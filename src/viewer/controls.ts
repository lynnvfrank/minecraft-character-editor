/**
 * Orbit controls, pointer handlers, tool switching for creator 3D paint.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { uvToWorkingCoords } from '../skinCoordinates';
import {
  getEditMode3D,
  getActiveTool,
  getBrushSize,
  getBrushCursorStyleFor3D,
  getLayer3DVisible,
  getLayer3DLocked,
  getLayerAtCoords,
  paintStartFrom3D,
  paintMoveFrom3D,
  paintEndFrom3D,
  sampleColorAtWithAlpha,
  EYEDROPPER_ALPHA_THRESHOLD,
  applySampledColor,
  updateHoverInfo,
  getPartDisplayNameAtCoords
} from '../creator';
import { subscribe, CREATOR_EVENTS } from '../creatorEvents';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export type Creator3DPaintDeps = {
  getControls: () => OrbitControls;
  setControls: (c: OrbitControls) => void;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  getCharacterModel: () => THREE.Group | null;
  getRoute: () => 'creator' | 'viewer';
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
  const layerVisible = getLayer3DVisible();
  const layerLocked = getLayer3DLocked();
  for (const hit of intersects) {
    const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
    if (!uv) continue;
    const { x, y } = uvToWorkingCoords(uv.x, uv.y);
    const layer = getLayerAtCoords(x, y);
    if (!layer) continue;
    if (layerVisible[layer] === false) continue;
    if (layerLocked[layer] === true) continue;
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
  const layerVisible = getLayer3DVisible();
  const layerLocked = getLayer3DLocked();
  for (const hit of intersects) {
    const uv = (hit as THREE.Intersection<THREE.Object3D> & { uv?: THREE.Vector2 }).uv;
    if (!uv) continue;
    const { x, y } = uvToWorkingCoords(uv.x, uv.y);
    const layer = getLayerAtCoords(x, y);
    if (!layer) continue;
    if (layerVisible[layer] === false) continue;
    if (layerLocked[layer] === true) continue;
    return { u: uv.x, v: uv.y };
  }
  return null;
}

export function updateOrbitControlsForEditMode(
  controls: OrbitControls,
  getRoute: () => 'creator' | 'viewer'
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
  getRoute: () => 'creator' | 'viewer'
): void {
  const canvas = renderer.domElement;
  if (getRoute() !== 'creator' || !getEditMode3D()) {
    canvas.style.cursor = '';
    return;
  }
  const tool = getActiveTool();
  if (tool === 'brush' || tool === 'eraser') {
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
  const { getControls, setControls, camera, renderer } = deps;
  const canvas = renderer.domElement;
  let is3DPainting = false;

  const refreshControls = () => {
    updateOrbitControlsForEditMode(getControls(), deps.getRoute);
    deps.onUpdateViewPlacement();
    updateCreator3DCanvasCursor(renderer, deps.getRoute);
  };

  function handlePointerDown(e: MouseEvent) {
    if (deps.getRoute() !== 'creator' || !getEditMode3D()) return;
    if (e.button !== 0) return;
    if (getActiveTool() === 'navigate') return;
    if (getActiveTool() === 'eyedropper' || e.altKey) {
      const hex = sampleColorFromRaycast(deps, e.clientX, e.clientY);
      if (hex) applySampledColor(hex);
      return;
    }
    const uv = raycastToPaintableUV(deps, e.clientX, e.clientY);
    if (!uv) return;
    const { x, y } = uvToWorkingCoords(uv.u, uv.v);
    paintStartFrom3D(x, y);
    is3DPainting = true;
    e.preventDefault();
  }

  function handlePointerMove(e: MouseEvent) {
    if (deps.getRoute() !== 'creator' || !getEditMode3D()) return;
    const uv = raycastToPaintableUV(deps, e.clientX, e.clientY);
    if (uv) {
      const { x, y } = uvToWorkingCoords(uv.u, uv.v);
      const part = getPartDisplayNameAtCoords(x, y);
      const skinX = Math.floor(x / 2);
      const skinY = Math.floor(y / 2);
      updateHoverInfo(part, skinX, skinY);
    } else {
      updateHoverInfo(null, -1, -1);
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
  }

  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  canvas.addEventListener('mouseup', handlePointerUp);
  canvas.addEventListener('mouseleave', (e) => {
    handle3DCanvasLeave();
    handlePointerUp(e);
  });

  subscribe(CREATOR_EVENTS.EDIT_MODE_CHANGE, () => {
    refreshControls();
  });
  subscribe(CREATOR_EVENTS.TOOLS_CHANGE, () => {
    refreshControls();
  });
  refreshControls();
}
