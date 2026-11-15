import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickPreviewBaseSkin } from './previewRouteRuntime';

describe('pickPreviewBaseSkin', () => {
  test('first candidate present in the manifest wins', () => {
    assert.equal(pickPreviewBaseSkin(['/a.png', '/b.png'], ['/x.png', '/b.png', '/a.png'], null), '/a.png');
  });
  test('skips missing candidates', () => {
    assert.equal(pickPreviewBaseSkin(['/missing.png', '/b.png'], ['/b.png'], null), '/b.png');
  });
  test('falls back to the first available skin', () => {
    assert.equal(pickPreviewBaseSkin(['/missing.png'], ['/x.png'], '/fb.png'), '/x.png');
  });
  test('falls back to the fallback when the manifest is empty', () => {
    assert.equal(pickPreviewBaseSkin(['/a.png'], [], '/fb.png'), '/fb.png');
    assert.equal(pickPreviewBaseSkin([], [], null), null);
  });
});
