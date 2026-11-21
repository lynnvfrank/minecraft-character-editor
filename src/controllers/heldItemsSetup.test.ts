import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeldItemsSection } from './heldItemsSetup';

test('heldItems backup section parse is fully checked', () => {
  assert.equal(parseHeldItemsSection(null), null);
  assert.equal(parseHeldItemsSection('torch'), null);
  assert.equal(parseHeldItemsSection({}), null);
  assert.equal(parseHeldItemsSection({ '/a.png': 'nope' }), null);
  assert.deepEqual(parseHeldItemsSection({ '/a.png': 'torch', x: 'torch', 'outfit:o1': 'wand' }), {
    '/a.png': 'torch',
    'outfit:o1': 'wand',
  });
});
