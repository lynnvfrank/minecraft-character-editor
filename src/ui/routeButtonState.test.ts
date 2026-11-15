import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRouteButtonState } from './routeButtonState';

test('route buttons disable and relabel during a transition', () => {
  assert.deepEqual(getRouteButtonState(false), { disabled: false, designLabel: 'Design', homeLabel: 'Home' });
  assert.deepEqual(getRouteButtonState(true), { disabled: true, designLabel: 'Designing...', homeLabel: 'Home' });
});
