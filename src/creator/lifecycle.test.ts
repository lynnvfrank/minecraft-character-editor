import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDisposableScope } from './lifecycle';
import { createSubscribable } from '../lib/subscribable';

describe('creator lifecycle scope', () => {
  test('re-initialising does not stack listeners (regression: Ctrl+Z undid N steps after N visits)', () => {
    const scope = createDisposableScope();
    const target = new EventTarget();
    let calls = 0;
    const init = () => {
      scope.dispose();
      scope.listen(target, 'keydown', () => calls++);
    };
    init();
    init();
    init();
    target.dispatchEvent(new Event('keydown'));
    assert.equal(calls, 1);
  });

  test('tracks slice subscriptions', () => {
    const scope = createDisposableScope();
    const slice = createSubscribable();
    let calls = 0;
    scope.track(slice.subscribe(() => calls++));
    scope.track(slice.subscribe(() => calls++));
    slice.notify();
    assert.equal(calls, 2);
    scope.dispose();
    slice.notify();
    assert.equal(calls, 2);
    assert.equal(scope.size(), 0);
  });

  test('a throwing disposer does not block the others', () => {
    const scope = createDisposableScope();
    let ran = false;
    scope.track(() => { ran = true; });
    scope.track(() => { throw new Error('boom'); });
    scope.dispose();
    assert.equal(ran, true);
  });
});
