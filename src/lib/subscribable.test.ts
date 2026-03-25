import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSubscribable, createPayloadSubscribable } from './subscribable';

describe('createSubscribable', () => {
  it('notifies subscribers', () => {
    const s = createSubscribable();
    let n = 0;
    s.subscribe(() => {
      n += 1;
    });
    s.notify();
    assert.equal(n, 1);
  });

  it('unsubscribe stops notifications', () => {
    const s = createSubscribable();
    let n = 0;
    const off = s.subscribe(() => {
      n += 1;
    });
    off();
    s.notify();
    assert.equal(n, 0);
  });
});

describe('createPayloadSubscribable', () => {
  it('passes payload to subscribers', () => {
    const s = createPayloadSubscribable<{ x: number }>();
    let last = 0;
    s.subscribe((p) => {
      last = p.x;
    });
    s.notify({ x: 42 });
    assert.equal(last, 42);
  });
});
