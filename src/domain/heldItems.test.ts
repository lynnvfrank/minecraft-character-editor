import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  HELD_ITEMS,
  MAX_HELD_ITEM_ASSIGNMENTS,
  classifyHandBone,
  getHeldItem,
  isHolderKey,
  parseHeldItemAssignments,
  parseStoredHeldItems,
  withHeldItem,
} from './heldItems';

describe('held items catalogue', () => {
  test('about ten items with unique ids, labels and emoji', () => {
    assert.ok(HELD_ITEMS.length >= 10);
    const ids = HELD_ITEMS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const item of HELD_ITEMS) {
      assert.match(item.id, /^[a-z][a-z-]*$/);
      assert.ok(item.label.length > 0 && item.emoji.length > 0);
      assert.ok(!/minecraft/i.test(item.label));
      assert.equal(getHeldItem(item.id), item);
    }
  });

  test('every item is a handful of well-formed boxes', () => {
    for (const item of HELD_ITEMS) {
      assert.ok(item.boxes.length >= 1 && item.boxes.length <= 8, item.id);
      for (const box of item.boxes) {
        assert.ok(box.size.every((n) => Number.isFinite(n) && n > 0), `${item.id} size`);
        assert.ok(box.at.every(Number.isFinite), `${item.id} position`);
        assert.match(box.color, /^#[0-9a-f]{6}$/i, `${item.id} colour`);
        // Small enough to hold: nothing further than ~20 pixels from the grip.
        assert.ok(box.at.every((n) => Math.abs(n) <= 20), `${item.id} too big`);
      }
      assert.ok([...item.grip.offset, ...item.grip.rotation].every(Number.isFinite), item.id);
    }
  });

  test('torch and lantern glow', () => {
    assert.ok(getHeldItem('torch')!.boxes.some((b) => b.emissive));
    assert.ok(getHeldItem('lantern')!.boxes.some((b) => b.emissive));
  });

  test('unknown ids are null', () => {
    assert.equal(getHeldItem('nope'), null);
    assert.equal(getHeldItem(null), null);
  });
});

describe('held item assignments', () => {
  test('holder keys: skin paths and outfits only', () => {
    assert.ok(isHolderKey('/wardrobe/skins/alex.png'));
    assert.ok(isHolderKey('outfit:abc-1'));
    assert.ok(!isHolderKey('data:image/png;base64,AAAA'));
    assert.ok(!isHolderKey('//evil.example/x.png'));
    assert.ok(!isHolderKey('https://evil.example/x.png'));
    assert.ok(!isHolderKey(42));
    assert.ok(!isHolderKey('/' + 'a'.repeat(300)));
  });

  test('parse keeps valid pairs and drops the rest', () => {
    assert.equal(parseHeldItemAssignments(null), null);
    assert.equal(parseHeldItemAssignments([]), null);
    assert.equal(parseHeldItemAssignments('x'), null);
    assert.deepEqual(
      parseHeldItemAssignments({
        '/skins/a.png': 'torch',
        'outfit:x': 'flower',
        '/skins/b.png': 'laser',
        'data:x': 'torch',
        '/skins/c.png': 3,
      }),
      { '/skins/a.png': 'torch', 'outfit:x': 'flower' }
    );
  });

  test('parse caps the size, keeping the newest', () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < MAX_HELD_ITEM_ASSIGNMENTS + 5; i++) raw[`/s/${i}.png`] = 'torch';
    const parsed = parseHeldItemAssignments(raw)!;
    assert.equal(Object.keys(parsed).length, MAX_HELD_ITEM_ASSIGNMENTS);
    assert.ok(`/s/${MAX_HELD_ITEM_ASSIGNMENTS + 4}.png` in parsed);
    assert.ok(!('/s/0.png' in parsed));
  });

  test('stored JSON: junk reads as empty', () => {
    assert.deepEqual(parseStoredHeldItems(null), {});
    assert.deepEqual(parseStoredHeldItems('{oops'), {});
    assert.deepEqual(parseStoredHeldItems('[1]'), {});
    assert.deepEqual(parseStoredHeldItems('{"/a.png":"wand"}'), { '/a.png': 'wand' });
  });

  test('withHeldItem sets, clears, moves to newest and caps', () => {
    let a = withHeldItem({}, '/a.png', 'torch');
    assert.deepEqual(a, { '/a.png': 'torch' });
    assert.equal(withHeldItem(a, '/a.png', 'torch'), a);
    assert.equal(withHeldItem(a, '/a.png', 'laser'), a);
    assert.equal(withHeldItem(a, 'data:x', 'torch'), a);
    a = withHeldItem(a, '/b.png', 'flag');
    a = withHeldItem(a, '/a.png', 'flag');
    assert.deepEqual(Object.keys(a), ['/b.png', '/a.png']);
    a = withHeldItem(a, '/c.png', 'pick', 2);
    assert.deepEqual(Object.keys(a), ['/a.png', '/c.png']);
    assert.deepEqual(withHeldItem(a, '/a.png', null), { '/c.png': 'pick' });
    assert.equal(withHeldItem(a, '/zzz.png', null), a);
  });
});

describe('classifyHandBone', () => {
  test('bundled rig: forearm end beats forearm beats upper arm', () => {
    assert.deepEqual(classifyHandBone('ArmRightLower_end'), { kind: 'forearm-end', score: 3 });
    assert.deepEqual(classifyHandBone('ArmRightLower'), { kind: 'forearm', score: 2 });
    assert.deepEqual(classifyHandBone('ArmRightUpper'), { kind: 'arm', score: 1 });
    assert.equal(classifyHandBone('ArmLeftLower_end'), null);
  });

  test('other naming styles', () => {
    assert.equal(classifyHandBone('mixamorig:RightHand')?.kind, 'hand');
    assert.equal(classifyHandBone('mixamorigRightHand')?.kind, 'hand');
    assert.equal(classifyHandBone('hand_r')?.kind, 'hand');
    assert.equal(classifyHandBone('RightForeArm')?.kind, 'forearm');
    assert.equal(classifyHandBone('mixamorig:RightHandIndex1'), null);
    assert.equal(classifyHandBone('mixamorig:LeftHand'), null);
    assert.equal(classifyHandBone('RightShoulder'), null);
    assert.equal(classifyHandBone('Head'), null);
  });
});
