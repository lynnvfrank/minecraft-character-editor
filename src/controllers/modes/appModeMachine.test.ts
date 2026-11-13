import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHashToRouteInfo,
  startModeActor,
  syncModeMachineFromHash,
  getRouteInfoFromMachine,
  setApplyRouteCallback,
} from './appModeMachine';

function withHash(hash: string, fn: () => void) {
  const g = globalThis as { location?: unknown };
  const prev = g.location;
  g.location = { hash };
  try {
    fn();
  } finally {
    g.location = prev;
  }
}

describe('route parsing', () => {
  const cases: [string, ReturnType<typeof parseHashToRouteInfo>][] = [
    ['', { route: 'viewer', creatorMode: null }],
    ['#/', { route: 'viewer', creatorMode: null }],
    ['#/preview', { route: 'preview', creatorMode: null }],
    ['#/creator', { route: 'creator', creatorMode: 'wardrobe' }],
    ['#/creator/3D/', { route: 'creator', creatorMode: '3d' }],
    ['#/creator/2d', { route: 'creator', creatorMode: '2d' }],
    ['#/creator/bogus', { route: 'creator', creatorMode: 'wardrobe' }],
  ];
  for (const [hash, expected] of cases) {
    test(`'${hash}'`, () => withHash(hash, () => assert.deepEqual(parseHashToRouteInfo(), expected)));
  }
});

describe('mode machine', () => {
  test('follows hash changes between home, creator submodes, and preview', () => {
    const applied: string[] = [];
    setApplyRouteCallback((info) => applied.push(`${info.route}:${info.creatorMode}`));
    startModeActor();

    assert.equal(syncModeMachineFromHash({ route: 'creator', creatorMode: '2d' }), true);
    assert.deepEqual(getRouteInfoFromMachine(), { route: 'creator', creatorMode: '2d' });

    // same state → no event
    assert.equal(syncModeMachineFromHash({ route: 'creator', creatorMode: '2d' }), false);

    syncModeMachineFromHash({ route: 'creator', creatorMode: '3d' });
    assert.deepEqual(getRouteInfoFromMachine(), { route: 'creator', creatorMode: '3d' });

    syncModeMachineFromHash({ route: 'viewer', creatorMode: null });
    assert.deepEqual(getRouteInfoFromMachine(), { route: 'viewer', creatorMode: null });

    assert.deepEqual(applied, ['creator:2d', 'creator:3d', 'viewer:null']);
  });
});
