import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteDirtyTracker } from './creatorPreview';

describe('createRouteDirtyTracker', () => {
  test('first frame on the watched route is due', () => {
    const t = createRouteDirtyTracker('creator');
    assert.equal(t.consume('creator'), true);
    assert.equal(t.consume('creator'), false);
  });
  test('markDirty makes the next watched frame due, once', () => {
    const t = createRouteDirtyTracker('creator');
    t.consume('creator');
    t.markDirty();
    assert.equal(t.consume('creator'), true);
    assert.equal(t.consume('creator'), false);
  });
  test('dirty is kept while on another route', () => {
    const t = createRouteDirtyTracker('creator');
    t.consume('viewer');
    t.markDirty();
    assert.equal(t.consume('viewer'), false);
    assert.equal(t.consume('creator'), true);
  });
  test('re-entering the watched route is due even when clean', () => {
    const t = createRouteDirtyTracker('creator');
    t.consume('creator');
    t.consume('viewer');
    assert.equal(t.consume('creator'), true);
  });
});
