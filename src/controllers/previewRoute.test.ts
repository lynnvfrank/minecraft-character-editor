import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRouteController } from './previewRoute';

const controller = (query = '') => createPreviewRouteController(() => new URLSearchParams(query));

describe('preview route info', () => {
  test('defaults: no skin, fullOutfit camera', () => {
    const info = controller().getPreviewRouteInfo();
    assert.equal(info.skinPath, null);
    assert.equal(info.part, null);
    assert.equal(info.cameraPreset, 'fullOutfit');
  });

  test('reads URL params and adds a leading slash to paths', () => {
    const info = controller('skin=wardrobe/a.png&baseSkin=/b.png&part=head').getPreviewRouteInfo();
    assert.equal(info.skinPath, '/wardrobe/a.png');
    assert.equal(info.baseSkinPath, '/b.png');
    assert.equal(info.part, 'head');
    assert.equal(info.cameraPreset, 'head', 'camera follows part when not given');
  });

  test('explicit cameraPreset wins over part', () => {
    const info = controller('part=head&cameraPreset=fullOutfit').getPreviewRouteInfo();
    assert.equal(info.cameraPreset, 'fullOutfit');
  });

  test('unknown and fullOutfit parts become null', () => {
    assert.equal(controller('part=tail').getPreviewRouteInfo().part, null);
    assert.equal(controller('part=fullOutfit').getPreviewRouteInfo().part, null);
  });

  test('override replaces URL params until cleared', () => {
    const c = controller('skin=/url.png');
    c.setPreviewRouteOverride({ skin: 'over.png', part: 'legs' });
    assert.equal(c.getPreviewRouteInfo().skinPath, '/over.png');
    assert.equal(c.getPreviewRouteInfo().cameraPreset, 'legs');
    c.setPreviewRouteOverride(null);
    assert.equal(c.getPreviewRouteInfo().skinPath, '/url.png');
  });

  test('signature changes only when inputs change', () => {
    const a = controller('skin=/a.png').getPreviewRouteInfo().signature;
    assert.equal(controller('skin=a.png').getPreviewRouteInfo().signature, a);
    assert.notEqual(controller('skin=/b.png').getPreviewRouteInfo().signature, a);
  });
});
