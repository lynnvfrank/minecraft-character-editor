import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLayerVisibilityModel, type LayerVisibilityModel } from './layerVisibility';
import { getMemberLayerKeysForWardrobeLayer } from './wardrobeLayers';
import { createCreatorState, type CreatorState } from '../state/creatorState';
import { creatorLayerSlice } from '../state/creatorSlices';
import { LAYER_KEYS } from '../skin';

let state: CreatorState;
let api: LayerVisibilityModel;
let notifications = 0;
let unsubscribe: () => void = () => {};

beforeEach(() => {
  unsubscribe();
  state = createCreatorState();
  api = createLayerVisibilityModel(state);
  notifications = 0;
  unsubscribe = creatorLayerSlice.subscribe(() => notifications++);
});

const visibleLayers = () => LAYER_KEYS.filter((k) => state.layer3DVisible[k]);

describe('layer visibility setters', () => {
  test('setLayer3DVisible notifies only on change', () => {
    api.setLayer3DVisible('head', false);
    assert.equal(state.layer3DVisible.head, false);
    assert.equal(notifications, 1);
    api.setLayer3DVisible('head', false);
    assert.equal(notifications, 1);
  });

  test('unknown layers are ignored', () => {
    api.setLayer3DVisible('tail', false);
    api.setLayer3DLocked('tail', true);
    assert.equal(notifications, 0);
    assert.equal('tail' in state.layer3DVisible, false);
  });

  test('part visibility only applies to layers with L/R parts', () => {
    api.setLayerPartVisible('head', 'L', false);
    assert.equal(state.layer3DPartVisible.head, undefined);
    api.setLayerPartVisible('arms', 'L', false);
    assert.deepEqual(state.layer3DPartVisible.arms, { L: false });
  });

  test('getPartVisible: hidden layer hides both sides; part flag hides one', () => {
    assert.equal(api.getPartVisible('arms', 'L'), true);
    api.setLayerPartVisible('arms', 'L', false);
    assert.equal(api.getPartVisible('arms', 'L'), false);
    assert.equal(api.getPartVisible('arms', 'R'), true);
    api.setLayer3DVisible('arms', false);
    assert.equal(api.getPartVisible('arms', 'R'), false);
  });
});

describe('Alt+click visibility solo', () => {
  test('solo shows only that layer and clears part overrides', () => {
    api.setLayerPartVisible('legs', 'R', false);
    api.onVisibilitySoloClick('head');
    assert.deepEqual(visibleLayers(), ['head']);
    assert.equal(state.layer3DSoloMode, true);
    assert.deepEqual(state.layer3DPartVisible, {});
  });

  test('solo on the same layer again restores the previous state, parts included', () => {
    api.setLayer3DVisible('hat', false);
    api.setLayerPartVisible('legs', 'R', false);
    const before = { ...state.layer3DVisible };
    api.onVisibilitySoloClick('head');
    api.onVisibilitySoloClick('head');
    assert.deepEqual(state.layer3DVisible, before);
    assert.deepEqual(state.layer3DPartVisible, { legs: { R: false } });
    assert.equal(state.layer3DSoloMode, false);
  });

  test('switching solo layer keeps the original snapshot', () => {
    const before = { ...state.layer3DVisible };
    api.onVisibilitySoloClick('head');
    api.onVisibilitySoloClick('body');
    assert.deepEqual(visibleLayers(), ['body']);
    api.onVisibilitySoloClick('body');
    assert.deepEqual(state.layer3DVisible, before);
  });

  test('clearVisibilitySoloFlags keeps the current mask', () => {
    api.onVisibilitySoloClick('head');
    api.clearVisibilitySoloFlags();
    assert.equal(state.layer3DSoloMode, false);
    assert.deepEqual(visibleLayers(), ['head']);
  });
});

describe('Alt+click lock solo', () => {
  test('locks every other layer, and toggling again restores locks', () => {
    api.setLayer3DLocked('pants', true);
    const before = { ...state.layer3DLocked };
    api.onLockSoloClick('head');
    assert.deepEqual(
      LAYER_KEYS.filter((k) => !state.layer3DLocked[k]),
      ['head']
    );
    api.onLockSoloClick('head');
    assert.deepEqual(state.layer3DLocked, before);
  });
});

describe('edit-mode save/restore', () => {
  test('leaving edit mode shows and unlocks everything; returning restores it', () => {
    api.setLayer3DVisible('hat', false);
    api.setLayer3DLocked('body', true);
    api.setLayerPartVisible('arms', 'L', false);
    api.saveLayerStateAndNormalizeForNonEditMode();
    assert.deepEqual(visibleLayers(), [...LAYER_KEYS]);
    assert.equal(Object.values(state.layer3DLocked).some(Boolean), false);
    assert.deepEqual(state.layer3DPartVisible, {});

    api.restoreLayerStateForEditMode();
    assert.equal(state.layer3DVisible.hat, false);
    assert.equal(state.layer3DLocked.body, true);
    assert.deepEqual(state.layer3DPartVisible, { arms: { L: false } });
  });

  test('saving twice keeps the first snapshot', () => {
    api.setLayer3DVisible('hat', false);
    api.saveLayerStateAndNormalizeForNonEditMode();
    api.saveLayerStateAndNormalizeForNonEditMode();
    api.restoreLayerStateForEditMode();
    assert.equal(state.layer3DVisible.hat, false);
  });

  test('restore without a save is a no-op', () => {
    api.setLayer3DVisible('hat', false);
    api.restoreLayerStateForEditMode();
    assert.equal(state.layer3DVisible.hat, false);
  });
});

describe('focused solo for wardrobe layers', () => {
  test('a leaf layer shows only itself', () => {
    api.applyFocusedSoloForWardrobeLayer('hat');
    assert.deepEqual(visibleLayers(), ['hat']);
  });

  test('a group shows its member layers', () => {
    const members = getMemberLayerKeysForWardrobeLayer('jacketGroup');
    assert.ok(members.length > 1, 'jacketGroup has several members');
    api.applyFocusedSoloForWardrobeLayer('jacketGroup');
    assert.deepEqual(new Set(visibleLayers()), new Set(members));
  });

  test('fullOutfit shows and unlocks everything', () => {
    api.setLayer3DLocked('head', true);
    api.applyFocusedSoloForWardrobeLayer('hat');
    api.applyFocusedSoloForWardrobeLayer('fullOutfit');
    assert.deepEqual(visibleLayers(), [...LAYER_KEYS]);
    assert.equal(state.layer3DLocked.head, false);
  });

  test('clears part overrides only for the focused layers', () => {
    api.setLayerPartVisible('arms', 'L', false);
    api.setLayerPartVisible('legs', 'R', false);
    api.applyFocusedSoloForWardrobeLayer('arms');
    assert.equal(state.layer3DPartVisible.arms, undefined);
    assert.deepEqual(state.layer3DPartVisible.legs, { R: false });
  });
});
