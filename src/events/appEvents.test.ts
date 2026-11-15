import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { APP_EVENTS, CREATOR_EVENTS, publish, subscribe } from './appEvents';

// The bus dispatches on `document`; Node has EventTarget and CustomEvent but no document.
const g = globalThis as { document?: unknown };
let hadDocument = false;
before(() => {
  hadDocument = 'document' in g;
  if (!hadDocument) g.document = new EventTarget();
});
after(() => {
  if (!hadDocument) delete g.document;
});

describe('document event bus', () => {
  test('subscribe receives the published detail', () => {
    const got: string[] = [];
    const off = subscribe(APP_EVENTS['app:character:skin-change'], (e) => got.push(e.detail.path));
    publish(APP_EVENTS['app:character:skin-change'], { path: '/a.png' });
    off();
    publish(APP_EVENTS['app:character:skin-change'], { path: '/b.png' });
    assert.deepEqual(got, ['/a.png']);
  });

  test('events without a payload can be published with no detail', () => {
    let calls = 0;
    const off = subscribe(CREATOR_EVENTS.CAMERA_ZOOM_IN, () => calls++);
    publish(CREATOR_EVENTS.CAMERA_ZOOM_IN);
    off();
    assert.equal(calls, 1);
  });

  test('handlers only see their own event', () => {
    let yaw = 0;
    const off = subscribe(CREATOR_EVENTS.CAMERA_YAW_LEFT, (e) => (yaw += e.detail?.degrees ?? 0));
    publish(CREATOR_EVENTS.CAMERA_YAW_RIGHT, { degrees: 90 });
    publish(CREATOR_EVENTS.CAMERA_YAW_LEFT, { degrees: 45 });
    off();
    assert.equal(yaw, 45);
  });

  test('payload types are enforced at compile time (checked by npm run typecheck)', () => {
    // These lines never run; tsc fails if any @ts-expect-error stops being an error.
    if (Math.random() < 0) {
      // @ts-expect-error skin-change requires a detail with `path`
      publish(APP_EVENTS['app:character:skin-change']);
      // @ts-expect-error wrong field name
      publish(APP_EVENTS['app:character:animation-play'], { path: '/x.png' });
      // @ts-expect-error unknown event name
      publish('app:creator:camera-spin');
    }
    assert.ok(true);
  });
});
