import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MODE_PANEL_CONFIGS, MODE_TRANSITION_MS, planModePanelTransition, type ModePanelConfig } from './modePanels';

const ids = (cfgs: ModePanelConfig[]) => cfgs.map((c) => c.id).sort();
const panel = (id: string, modes: ModePanelConfig['modes']): ModePanelConfig => ({
  id,
  modes,
  enterFrom: 'left',
  exitTo: 'left',
});

const configs = [
  panel('everywhere', ['wardrobe', '2d', '3d']),
  panel('wardrobe-only', ['wardrobe']),
  panel('editing', ['2d', '3d']),
  panel('2d-only', ['2d']),
];

describe('planModePanelTransition', () => {
  test('wardrobe → 3d hides wardrobe panels, shows editing panels, keeps shared ones', () => {
    const plan = planModePanelTransition(configs, 'wardrobe', '3d');
    assert.deepEqual(ids(plan.hide), ['wardrobe-only']);
    assert.deepEqual(ids(plan.show), ['editing']);
    assert.deepEqual(ids(plan.keep), ['everywhere']);
    assert.deepEqual(ids(plan.stayHidden), ['2d-only']);
    assert.equal(plan.enterDelayMs, MODE_TRANSITION_MS);
  });

  test('3d → 2d only shows: no delay', () => {
    const plan = planModePanelTransition(configs, '3d', '2d');
    assert.deepEqual(ids(plan.hide), []);
    assert.deepEqual(ids(plan.show), ['2d-only']);
    assert.equal(plan.enterDelayMs, 0);
  });

  test('first render places everything without animation', () => {
    const plan = planModePanelTransition(configs, null, '2d');
    assert.deepEqual(ids(plan.keep), ['2d-only', 'editing', 'everywhere']);
    assert.deepEqual(ids(plan.stayHidden), ['wardrobe-only']);
    assert.equal(plan.hide.length + plan.show.length, 0);
  });

  test('same mode is treated like first render', () => {
    const plan = planModePanelTransition(configs, '3d', '3d');
    assert.equal(plan.hide.length + plan.show.length, 0);
  });

  test('every panel lands in exactly one bucket', () => {
    for (const from of [null, 'wardrobe', '2d', '3d'] as const) {
      for (const to of ['wardrobe', '2d', '3d'] as const) {
        const p = planModePanelTransition(MODE_PANEL_CONFIGS, from, to);
        const all = [...p.hide, ...p.show, ...p.keep, ...p.stayHidden];
        assert.equal(all.length, MODE_PANEL_CONFIGS.length, `${from}→${to}`);
      }
    }
  });

  test('showing the right-hand panel group asks for a resize', () => {
    assert.equal(planModePanelTransition(MODE_PANEL_CONFIGS, 'wardrobe', '3d').needsResize, true);
  });

  test('real config: the save panel is visible in every mode', () => {
    for (const to of ['wardrobe', '2d', '3d'] as const) {
      const p = planModePanelTransition(MODE_PANEL_CONFIGS, null, to);
      assert.ok(p.keep.some((c) => c.id === 'creator-save-download-panel'), to);
    }
  });
});
