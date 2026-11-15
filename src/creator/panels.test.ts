import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mountPanels, type CreatorPanel } from './panels';
import { createDisposableScope } from './lifecycle';
import { createSubscribable } from '../lib/subscribable';

describe('mountPanels', () => {
  test('mounts in order with the shared scope', () => {
    const scope = createDisposableScope();
    const order: string[] = [];
    const panels: CreatorPanel[] = ['a', 'b', 'c'].map((name) => ({
      name,
      mount: (s) => {
        assert.equal(s, scope);
        order.push(name);
      },
    }));
    assert.deepEqual(mountPanels(panels, scope), []);
    assert.deepEqual(order, ['a', 'b', 'c']);
  });

  test('a failing panel is reported and the rest still mount', () => {
    const scope = createDisposableScope();
    const mounted: string[] = [];
    const errors: string[] = [];
    const failed = mountPanels(
      [
        { name: 'ok1', mount: () => mounted.push('ok1') },
        { name: 'broken', mount: () => { throw new Error('boom'); } },
        { name: 'ok2', mount: () => mounted.push('ok2') },
      ],
      scope,
      (name) => errors.push(name)
    );
    assert.deepEqual(failed, ['broken']);
    assert.deepEqual(errors, ['broken']);
    assert.deepEqual(mounted, ['ok1', 'ok2']);
  });

  test('disposing the scope removes every panel subscription (re-entering the creator)', () => {
    const slice = createSubscribable();
    let calls = 0;
    const panel: CreatorPanel = { name: 'p', mount: (s) => { s.track(slice.subscribe(() => calls++)); } };

    const scope = createDisposableScope();
    mountPanels([panel], scope);
    scope.dispose();
    mountPanels([panel], scope); // second visit
    slice.notify();
    assert.equal(calls, 1, 'only the current visit’s subscription fires');
  });
});
