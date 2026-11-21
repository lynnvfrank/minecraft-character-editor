/**
 * Home-view Build mode: paint the village's tiles (domain/villageEdit.ts has the rules,
 * state/villageStore.ts keeps the result, ui/villagePalette.ts is the chrome).
 *
 * Input while building (the palette's hint says the same):
 * - Left-drag (one finger on touch) paints the cell under the pointer; a translucent square shows
 *   the hovered cell (reddish where nothing can be painted) and the stroke so far.
 * - Right-drag turns the view, the wheel / middle button zooms, WASD and arrows move the camera
 *   (selection controller). Two fingers turn and zoom; a second finger cancels the stroke.
 * - Character clicks are ignored (selectionController's isClickSuppressed).
 * - Esc or Done leaves; Ctrl+Z undoes a stroke.
 *
 * A stroke is checked cell by cell on a working copy of the map (refusals show in the hint) and
 * committed once, on pointer up: the store notifies, and the village rebuilds a single time.
 * Every rebuild (also undo, reset, and a restored backup) then fans out from blockWorld.onChange:
 * crowd characters step off newly blocked ground and re-plan, other characters (the selected
 * one) are moved off it too, a walk in progress is stopped, and the lamp lights are redone.
 */
import * as THREE from 'three';
import { applyVillageEdit, cellsBetween, PAINT_TILES, protectedReason } from '../domain/villageEdit';
import type { BlockWorldController } from './blockWorldController';
import type { VillageStore } from '../state/villageStore';
import type { CharacterState } from './characterTypes';
import { createVillagePalette } from '../ui/villagePalette';

type Route = 'creator' | 'viewer' | 'preview' | 'studio';
type XZ = { x: number; z: number };
type Cell = { col: number; row: number };

export type VillageEditorDeps = {
  getSceneContext: () => {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: {
      mouseButtons: { LEFT?: THREE.MOUSE | null; MIDDLE?: THREE.MOUSE | null; RIGHT?: THREE.MOUSE | null };
      touches: { ONE?: THREE.TOUCH | null; TWO?: THREE.TOUCH | null };
    };
    renderer: THREE.WebGLRenderer;
    characters: Record<string, CharacterState>;
  };
  getRoute: () => Route;
  blockWorld: BlockWorldController;
  store: VillageStore;
  dayNight: { refreshLamps: () => void };
  crowd: { onNavChanged: (nudge: (p: XZ) => XZ | null) => void };
  animationManager: { isWalking: () => boolean; stop: () => void };
  deselect: () => void;
};

/** Undo keeps this many strokes. */
const MAX_UNDO = 50;
const PREVIEW_Y = 0.03;

export type VillageEditorController = ReturnType<typeof createVillageEditorController>;

export function createVillageEditorController(deps: VillageEditorDeps) {
  const { blockWorld, store } = deps;

  // --- Live rebuild: one path for strokes, undo, reset and restored backups ---
  store.subscribe(() => blockWorld.setMap(store.get()));
  blockWorld.onChange(() => {
    deps.dayNight.refreshLamps();
    deps.crowd.onNavChanged(blockWorld.nudgeToWalkable);
    // Characters outside the crowd sim (the selected one): off any new tree or pond.
    for (const char of Object.values(deps.getSceneContext().characters)) {
      const p = char.container.position;
      const to = blockWorld.nudgeToWalkable(p);
      if (to) p.set(to.x, p.y, to.z);
    }
    // A walk planned on the old map could cross new blocks; stop it (the idle AI plans afresh).
    if (deps.animationManager.isWalking()) deps.animationManager.stop();
  });

  // --- State ---
  let building = false;
  let tileId = PAINT_TILES[0]!.id;
  const undo: (readonly string[])[] = [];
  let stroke: { pointerId: number; before: readonly string[]; map: readonly string[]; last: Cell; painted: Map<string, string> } | null = null;
  const activePointers = new Set<number>();
  let savedButtons: Pick<ReturnType<VillageEditorDeps['getSceneContext']>['controls'], 'mouseButtons' | 'touches'> = { mouseButtons: {}, touches: {} };
  let haveSaved = false;

  const tileFor = (id: string) => PAINT_TILES.find((t) => t.id === id) ?? PAINT_TILES[0]!;

  // --- Scene overlays: hover square and the stroke preview ---
  const { scene } = deps.getSceneContext();
  const plate = new THREE.BoxGeometry(1, 0.04, 1);
  const hoverMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  const hover = new THREE.Mesh(plate, hoverMat);
  hover.name = 'village-build-hover';
  hover.renderOrder = 3;
  hover.visible = false;
  const capacity = blockWorld.world.cols * blockWorld.world.rows;
  const previewMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, depthWrite: false });
  const preview = new THREE.InstancedMesh(plate, previewMat, capacity);
  preview.name = 'village-build-preview';
  preview.renderOrder = 3;
  preview.count = 0;
  preview.frustumCulled = false;
  preview.visible = false;
  scene.add(hover, preview);

  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  function drawPreview(): void {
    let i = 0;
    for (const [key, id] of stroke?.painted ?? []) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      const c = blockWorld.cellCenter(col, row);
      m.makeTranslation(c.x, PREVIEW_Y, c.z);
      preview.setMatrixAt(i, m);
      preview.setColorAt(i, color.set(tileFor(id).swatch));
      i++;
    }
    preview.count = i;
    preview.instanceMatrix.needsUpdate = true;
    if (preview.instanceColor) preview.instanceColor.needsUpdate = true;
  }

  // --- Picking: pointer → ground plane (y = 0) → map cell ---
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function cellUnder(e: PointerEvent): Cell | null {
    const { camera, renderer } = deps.getSceneContext();
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
    const cell = blockWorld.cellAt(hit);
    const { cols, rows } = blockWorld.world;
    return cell.col >= 0 && cell.row >= 0 && cell.col < cols && cell.row < rows ? cell : null;
  }

  function showHover(cell: Cell | null): void {
    hover.visible = building && !!cell;
    if (!cell) return;
    const c = blockWorld.cellCenter(cell.col, cell.row);
    hover.position.set(c.x, PREVIEW_Y + 0.005, c.z);
    hoverMat.color.set(protectedReason(cell.col, cell.row) ? 0xff6a5a : tileFor(tileId).swatch);
  }

  // --- Painting ---
  function paintTo(cell: Cell): void {
    if (!stroke) return;
    const tile = tileFor(tileId).tile;
    let refused: string | null = null;
    for (const c of cellsBetween(stroke.last, cell)) {
      const result = applyVillageEdit(stroke.map, c.col, c.row, tile);
      if (!result.ok) {
        refused = result.reason;
        continue;
      }
      if (result.changed) {
        stroke.map = result.map;
        stroke.painted.set(`${c.col},${c.row}`, tileId);
      }
    }
    stroke.last = cell;
    if (refused) palette.setMessage(refused);
    drawPreview();
  }

  function endStroke(commit: boolean): void {
    const s = stroke;
    stroke = null;
    preview.count = 0;
    if (!s || !commit || s.map === s.before) return;
    if (store.set(s.map)) {
      undo.push(s.before);
      if (undo.length > MAX_UNDO) undo.shift();
      palette.setCanUndo(true);
    }
  }

  const canvas = deps.getSceneContext().renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (!building) return;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1) {
      // Second finger: this is a two-finger turn/zoom, not paint.
      endStroke(false);
      return;
    }
    if (e.button !== 0) return;
    const cell = cellUnder(e);
    if (!cell) return;
    stroke = { pointerId: e.pointerId, before: store.get(), map: store.get(), last: cell, painted: new Map() };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic event): painting still works while over the canvas */
    }
    paintTo(cell);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!building) return;
    const cell = cellUnder(e);
    showHover(cell);
    if (stroke && e.pointerId === stroke.pointerId && cell) paintTo(cell);
  });
  const up = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (stroke && e.pointerId === stroke.pointerId) endStroke(e.type === 'pointerup');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => {
    if (!stroke) hover.visible = false;
  });

  // --- Mode ---
  function enter(): void {
    if (building || deps.getRoute() !== 'viewer') return;
    building = true;
    deps.deselect();
    const { controls } = deps.getSceneContext();
    savedButtons = { mouseButtons: { ...controls.mouseButtons }, touches: { ...controls.touches } };
    haveSaved = true;
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    document.body.dataset.building = 'on';
    preview.visible = true;
    palette.setOpen(true);
    palette.setCanUndo(undo.length > 0);
  }

  function exit(): void {
    if (!building) return;
    endStroke(true);
    building = false;
    activePointers.clear();
    if (haveSaved) {
      const { controls } = deps.getSceneContext();
      controls.mouseButtons = savedButtons.mouseButtons;
      controls.touches = savedButtons.touches;
      haveSaved = false;
    }
    delete document.body.dataset.building;
    hover.visible = false;
    preview.visible = false;
    palette.setOpen(false);
  }

  function undoStroke(): void {
    const prev = undo.pop();
    if (prev) store.set(prev);
    palette.setCanUndo(undo.length > 0);
  }

  function resetVillage(): void {
    if (!store.isCustom()) {
      palette.setMessage('This is already the original village.');
      return;
    }
    if (!window.confirm('Put the village back the way it was? You can undo this.')) return;
    undo.push(store.get());
    if (undo.length > MAX_UNDO) undo.shift();
    store.reset();
    palette.setCanUndo(true);
  }

  const palette = createVillagePalette({
    tiles: PAINT_TILES,
    initialTile: tileId,
    onToggle: () => (building ? exit() : enter()),
    onSelect: (id) => {
      tileId = id;
      palette.setSelected(id);
    },
    onUndo: undoStroke,
    onReset: resetVillage,
    onDone: exit,
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (!building) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.code === 'Escape' && !document.querySelector('.about-overlay:not([hidden])')) {
        e.stopImmediatePropagation();
        exit();
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undoStroke();
      }
    },
    true
  );
  // Build mode belongs to the home view: leaving it (editor, studio) ends the session.
  window.addEventListener('hashchange', () => {
    if (deps.getRoute() !== 'viewer') exit();
  });

  return {
    enter,
    exit,
    isBuilding: () => building,
  };
}
