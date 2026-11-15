import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAppContext } from './appContext';

type Services = { scene: { id: number }; ai: { name: string } | null };

describe('AppContext', () => {
  test('get returns a provided service', () => {
    const app = createAppContext<Services>();
    const scene = app.provide('scene', { id: 1 });
    assert.equal(app.get('scene'), scene);
    assert.equal(app.has('scene'), true);
  });

  test('get throws before provide; tryGet returns undefined', () => {
    const app = createAppContext<Services>();
    assert.throws(() => app.get('scene'), /not ready/);
    assert.equal(app.tryGet('scene'), undefined);
    assert.equal(app.has('scene'), false);
  });

  test('a null service counts as provided', () => {
    const app = createAppContext<Services>();
    app.provide('ai', null);
    assert.equal(app.get('ai'), null);
    assert.equal(app.has('ai'), true);
  });

  test('providing twice throws', () => {
    const app = createAppContext<Services>();
    app.provide('scene', { id: 1 });
    assert.throws(() => app.provide('scene', { id: 2 }), /already provided/);
  });
});
