/**
 * Home-view selection and free camera.
 *
 * - Click a character to select it. A crowd character is swapped into the primary slot first
 *   (see crowdController.swapIntoPrimary), so the Move panel, Design button and creator all act
 *   on whoever is selected. The selected character stops what it's doing and idles.
 * - Click empty ground or press Escape to deselect; the character goes back to doing its own thing.
 * - Right-click the ground (without dragging) to walk there. With nobody selected, the main
 *   character is selected first. A small marker shows where they're headed.
 * - `body[data-selection]` is "selected" or "none"; CSS shows the Move panels and Design button
 *   only while something is selected.
 * - Camera: orbit/zoom/pan anywhere (no longer pinned to the middle). While a character is
 *   selected the camera follows it; otherwise arrow keys / WASD glide the camera over the ground.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CharacterState } from './characterTypes';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';

export type SelectionControllerDeps = {
  getSceneContext: () => {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    characters: Record<string, CharacterState>;
  };
  getRoute: () => Route;
  getTransitionInFlight: () => boolean;
  getPrimaryCharacterId: () => string;
  crowd: {
    isCrowdCharacter: (id: string) => boolean;
    swapIntoPrimary: (id: string) => CharacterState | null;
  };
  animationManager: { stop: () => void; setFacing: (yaw: number) => void };
  characterAI: { setSuspended: (v: boolean) => void; resetHeadBone: () => void } | null;
  fadeToAction: (char: CharacterState, action: THREE.AnimationAction, duration?: number) => void;
  /** A different character became the primary (skin highlight, arm model, creator reload). */
  onPrimaryChanged: (char: CharacterState) => void;
  getSkinLabel: (skinPath: string) => string;
  /** Keep the camera target within this radius of the origin. */
  roamRadius: number;
  /** True while clicks on the ground mean something else (Build mode paints): no select/deselect. */
  isClickSuppressed?: () => boolean;
  /** Walk the main character to a point on the ground (taking control from the idle AI). */
  walkTo?: (target: THREE.Vector3) => void;
};

/** Pointer travel (px) above which a press is a camera drag, not a click. */
const CLICK_SLOP_PX = 6;
/** Approximate character height in world units (feet at y=0). */
const CHARACTER_HEIGHT = 1.9;
const FOLLOW_RATE = 4;
const PAN_SPEED = 5;
/** On select, ease the camera to within this distance if it's farther away. */
const SELECT_MAX_DISTANCE = 7;
const HOME_CAMERA_START = new THREE.Vector3(0, 4.5, 12);
/** Don't let the home camera dip under the ground. */
const HOME_MAX_POLAR = THREE.MathUtils.degToRad(84);
/** How long the right-click walk marker takes to fade out. */
const WALK_MARKER_SEC = 0.9;

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, 1], KeyW: [0, 1],
  ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

export type SelectionController = ReturnType<typeof createSelectionController>;

export function createSelectionController(deps: SelectionControllerDeps) {
  let selected = false;
  /** Camera distance to ease toward after selecting (null = leave the zoom alone). */
  let zoomTo: number | null = null;
  const heldKeys = new Set<string>();

  // Home starts pulled back so the whole zone is in view (creator/preview set their own camera).
  if (deps.getRoute() === 'viewer') {
    const { camera, controls } = deps.getSceneContext();
    camera.position.copy(HOME_CAMERA_START);
    controls.target.set(0, 1, 0);
    controls.update();
  }

  const ring = createSelectionRing();
  deps.getSceneContext().scene.add(ring);
  const marker = createWalkMarker();
  deps.getSceneContext().scene.add(marker);
  let markerAge = Infinity;
  const pill = createPill(() => deselect());

  function primary(): CharacterState | undefined {
    return deps.getSceneContext().characters[deps.getPrimaryCharacterId()];
  }

  function syncDom(): void {
    document.body.dataset.selection = selected ? 'selected' : 'none';
    const char = primary();
    pill.setSelected(selected, char ? deps.getSkinLabel(char.currentSkin) : '');
  }

  function settleToIdle(char: CharacterState): void {
    if (!char.idleAction) return;
    char.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    char.idleAction.clampWhenFinished = false;
    deps.fadeToAction(char, char.idleAction, 0.4);
  }

  function select(id: string): void {
    const primaryId = deps.getPrimaryCharacterId();
    let char = deps.getSceneContext().characters[id];
    if (!char) return;
    if (id !== primaryId) {
      if (!deps.crowd.isCrowdCharacter(id)) return;
      deps.animationManager.stop();
      const swapped = deps.crowd.swapIntoPrimary(id);
      if (!swapped) return;
      char = swapped;
      deps.animationManager.setFacing(char.model.rotation.y);
      deps.characterAI?.resetHeadBone();
      deps.onPrimaryChanged(char);
    }
    const wasSelected = selected;
    selected = true;
    deps.characterAI?.setSuspended(true);
    if (wasSelected) deps.animationManager.stop();
    settleToIdle(char);
    const cam = deps.getSceneContext();
    const dist = cam.camera.position.distanceTo(cam.controls.target);
    zoomTo = dist > SELECT_MAX_DISTANCE ? SELECT_MAX_DISTANCE : null;
    syncDom();
  }

  function deselect(): void {
    if (!selected) return;
    selected = false;
    zoomTo = null;
    deps.characterAI?.setSuspended(false);
    syncDom();
  }

  /** Character under a screen point: nearest to the click among feet-to-head screen segments. */
  function pick(clientX: number, clientY: number): string | null {
    const { camera, renderer, characters } = deps.getSceneContext();
    const rect = renderer.domElement.getBoundingClientRect();
    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, z: p.z };
    };
    let best: { id: string; score: number; depth: number } | null = null;
    for (const char of Object.values(characters)) {
      if (!char.container.visible) continue;
      const base = char.container.position;
      const feet = toScreen(new THREE.Vector3(base.x, 0.05, base.z));
      const head = toScreen(new THREE.Vector3(base.x, CHARACTER_HEIGHT, base.z));
      if (feet.z > 1 || head.z > 1) continue; // behind the camera
      const segX = head.x - feet.x;
      const segY = head.y - feet.y;
      const lenSq = segX * segX + segY * segY;
      const t = lenSq > 0 ? Math.min(1, Math.max(0, ((clientX - feet.x) * segX + (clientY - feet.y) * segY) / lenSq)) : 0;
      const dx = clientX - (feet.x + segX * t);
      const dy = clientY - (feet.y + segY * t);
      const halfWidth = Math.max(10, Math.sqrt(lenSq) * 0.2);
      const score = Math.hypot(dx, dy) / halfWidth;
      if (score > 1) continue;
      const depth = camera.position.distanceTo(base);
      if (!best || depth < best.depth - 0.5 || (Math.abs(depth - best.depth) <= 0.5 && score < best.score)) {
        best = { id: char.id, score, depth };
      }
    }
    return best?.id ?? null;
  }

  // --- Input ---
  const canvas = deps.getSceneContext().renderer.domElement;
  let down: { x: number; y: number; id: number; button: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = e.button === 0 || e.button === 2 ? { x: e.clientX, y: e.clientY, id: e.pointerId, button: e.button } : null;
  });
  canvas.addEventListener('pointerup', (e) => {
    const start = down;
    down = null;
    if (!start || start.id !== e.pointerId || start.button !== e.button) return;
    // Further than this is a camera drag (right-drag pans), not a click.
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return;
    if (deps.getRoute() !== 'viewer' || deps.getTransitionInFlight() || deps.isClickSuppressed?.()) return;
    if (start.button === 2) {
      walkToScreenPoint(e.clientX, e.clientY);
      return;
    }
    const id = pick(e.clientX, e.clientY);
    if (id) select(id);
    else deselect();
  });
  // No browser menu on the 3D view: right-click means "walk here".
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();

  /** Where a screen point lands on the ground (y = 0), or null for the sky. */
  function groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const { camera, renderer } = deps.getSceneContext();
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  }

  function walkToScreenPoint(clientX: number, clientY: number): void {
    if (!deps.walkTo) return;
    const target = groundAt(clientX, clientY);
    if (!target) return;
    if (!selected) {
      const char = primary();
      if (!char) return;
      select(char.id);
    }
    marker.position.set(target.x, 0.02, target.z);
    markerAge = 0;
    deps.walkTo(target);
  }

  const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  };
  document.addEventListener('keydown', (e) => {
    if (deps.getRoute() !== 'viewer' || isTyping(e.target)) return;
    if (e.code === 'Escape' && selected && !document.querySelector('.about-overlay:not([hidden])')) {
      deselect();
      return;
    }
    if (selected || e.altKey || e.ctrlKey || e.metaKey || !PAN_KEYS[e.code]) return;
    e.preventDefault();
    heldKeys.add(e.code);
  });
  document.addEventListener('keyup', (e) => heldKeys.delete(e.code));
  window.addEventListener('blur', () => heldKeys.clear());

  // --- Per frame ---
  const tmp = new THREE.Vector3();

  function moveCamera(controls: OrbitControls, camera: THREE.Camera, delta: THREE.Vector3): void {
    controls.target.add(delta);
    camera.position.add(delta);
  }

  function clampTarget(controls: OrbitControls, camera: THREE.Camera): void {
    const t = controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r <= deps.roamRadius) return;
    const k = deps.roamRadius / r;
    moveCamera(controls, camera, tmp.set(t.x * k - t.x, 0, t.z * k - t.z));
  }

  function update(dt: number, route: Route): void {
    const { camera, controls } = deps.getSceneContext();
    const char = primary();
    const home = route === 'viewer';
    const step = Math.min(dt, 0.1);

    ring.visible = home && selected && !!char;
    markerAge += step;
    const fade = home ? 1 - markerAge / WALK_MARKER_SEC : 0;
    marker.visible = fade > 0;
    if (marker.visible) {
      (marker.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      marker.scale.setScalar(0.6 + 0.4 * fade);
    }
    if (char) ring.position.set(char.container.position.x, 0.015, char.container.position.z);
    if (!home) {
      controls.maxPolarAngle = Math.PI;
      heldKeys.clear();
      return;
    }
    controls.maxPolarAngle = HOME_MAX_POLAR;
    controls.screenSpacePanning = false; // right-drag pans along the ground
    if (deps.getTransitionInFlight()) return;

    if (selected && char) {
      // Follow: slide target and camera together so the view keeps its angle.
      tmp.set(char.container.position.x, 1, char.container.position.z).sub(controls.target);
      moveCamera(controls, camera, tmp.multiplyScalar(1 - Math.exp(-FOLLOW_RATE * step)));
      if (zoomTo != null) {
        const offset = camera.position.clone().sub(controls.target);
        const len = offset.length();
        const next = THREE.MathUtils.lerp(len, zoomTo, 1 - Math.exp(-3 * step));
        camera.position.copy(controls.target).add(offset.setLength(next));
        if (Math.abs(next - zoomTo) < 0.05) zoomTo = null;
      }
    } else if (heldKeys.size > 0) {
      let fx = 0;
      let fz = 0;
      for (const code of heldKeys) {
        const k = PAN_KEYS[code];
        if (k) {
          fx += k[0];
          fz += k[1];
        }
      }
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6 && (fx !== 0 || fz !== 0)) {
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        tmp.copy(forward).multiplyScalar(fz).addScaledVector(right, fx).setLength(PAN_SPEED * step);
        moveCamera(controls, camera, tmp);
      }
    }
    clampTarget(controls, camera);
  }

  syncDom();

  return {
    update,
    select,
    deselect,
    isSelected: () => selected,
    /** Refresh the pill (e.g. the selected character's skin changed in the creator). */
    refresh: syncDom,
  };
}

function createSelectionRing(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.45, 0.55, 48);
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(geo, mat);
  ring.name = 'selection-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  ring.visible = false;
  return ring;
}

/** Where a right-click walk is headed: a small ring on the ground that shrinks and fades. */
function createWalkMarker(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.18, 0.3, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const marker = new THREE.Mesh(geo, mat);
  marker.name = 'walk-marker';
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 2;
  marker.visible = false;
  return marker;
}

/** Top-center hint: "Click a character" when nothing is selected, the selected name + ✕ otherwise. */
function createPill(onDeselect: () => void) {
  const root = document.createElement('div');
  root.className = 'selection-pill';
  root.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'selection-pill-text';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'selection-pill-close';
  close.textContent = '✕';
  close.title = 'Deselect (Esc)';
  close.setAttribute('aria-label', 'Deselect character');
  close.addEventListener('click', onDeselect);
  root.append(text, close);
  (document.getElementById('app-lower-left-panels')?.parentElement ?? document.body).appendChild(root);

  return {
    setSelected(isSelected: boolean, label: string) {
      root.classList.toggle('is-selected', isSelected);
      text.textContent = isSelected ? `Selected: ${label}` : 'Click a character to select it';
      close.hidden = !isSelected;
    },
  };
}
