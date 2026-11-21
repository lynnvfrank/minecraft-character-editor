import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BOOKMARKS_PER_PLACE,
  MAX_BOOKMARK_NAME_LENGTH,
  addBookmark,
  canAddBookmark,
  cleanBookmarkName,
  defaultBookmarkName,
  describeBookmarks,
  glidePose,
  lerpPose,
  parseCameraBookmarks,
  parseCameraBookmarksJson,
  parsePose,
  removeBookmark,
  renameBookmark,
  type CameraBookmark,
  type CameraPose,
} from './cameraBookmarks';

const pose = (px = 0, py = 3, pz = 8, fov = 45): CameraPose => ({
  position: { x: px, y: py, z: pz },
  target: { x: 0, y: 1, z: 0 },
  fov,
});
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('parsePose', () => {
  test('accepts a sane pose and clamps the lens', () => {
    assert.deepEqual(parsePose(pose()), pose());
    assert.equal(parsePose(pose(0, 3, 8, 500))!.fov, 120);
    assert.equal(parsePose(pose(0, 3, 8, 1))!.fov, 10);
    assert.equal(parsePose({ position: { x: 0, y: 3, z: 8 }, target: { x: 0, y: 1, z: 0 } })!.fov, 45);
    assert.equal(parsePose({ ...pose(), fov: Number.NaN })!.fov, 45);
  });

  test('drops extra fields', () => {
    assert.deepEqual(parsePose({ ...pose(), junk: 1, position: { x: 0, y: 3, z: 8, w: 2 } }), pose());
  });

  test('rejects junk, non-finite numbers and silly distances', () => {
    const bad: unknown[] = [
      null,
      undefined,
      5,
      'pose',
      [],
      {},
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 0, y: 3, z: 8 }, target: { x: 0, y: '1', z: 0 } },
      { position: { x: Number.NaN, y: 3, z: 8 }, target: { x: 0, y: 1, z: 0 } },
      { position: { x: Infinity, y: 3, z: 8 }, target: { x: 0, y: 1, z: 0 } },
      { position: { x: 0, y: 1, z: 0 }, target: { x: 0, y: 1, z: 0 } }, // camera inside its target
      { position: { x: 0, y: 1, z: 0.05 }, target: { x: 0, y: 1, z: 0 } },
      { position: { x: 0, y: 1, z: 400 }, target: { x: 0, y: 1, z: 0 } }, // too far away
      { position: { x: 9999, y: 1, z: 0 }, target: { x: 9998, y: 1, z: 0 } }, // off the map
    ];
    for (const raw of bad) assert.equal(parsePose(raw), null, JSON.stringify(raw));
  });
});

describe('names', () => {
  test('cleanBookmarkName trims, collapses spaces and cuts to length', () => {
    assert.equal(cleanBookmarkName('  By   the\tpond '), 'By the pond');
    assert.equal(cleanBookmarkName('x'.repeat(80)).length, MAX_BOOKMARK_NAME_LENGTH);
    assert.equal(cleanBookmarkName('   '), '');
    assert.equal(cleanBookmarkName(7), '');
  });

  test('defaultBookmarkName picks the first free "Spot N"', () => {
    assert.equal(defaultBookmarkName([]), 'Spot 1');
    assert.equal(defaultBookmarkName([{ name: 'Spot 1' }, { name: 'spot 2' }]), 'Spot 3');
    assert.equal(defaultBookmarkName([{ name: 'Spot 2' }, { name: 'Pond' }]), 'Spot 1');
  });
});

describe('add / rename / remove', () => {
  test('add names and ids the new bookmark and leaves the input alone', () => {
    const empty: CameraBookmark[] = [];
    const one = addBookmark(empty, pose());
    assert.equal(empty.length, 0);
    assert.deepEqual(one, [{ id: 'spot-1', name: 'Spot 1', ...pose() }]);
    const two = addBookmark(one, pose(2), '  Pond  ');
    assert.deepEqual(two.map((b) => [b.id, b.name]), [['spot-1', 'Spot 1'], ['spot-2', 'Pond']]);
  });

  test('ids and names fill gaps left by removed bookmarks', () => {
    let list = addBookmark(addBookmark(addBookmark([], pose()), pose(1)), pose(2));
    list = removeBookmark(list, 'spot-2');
    list = addBookmark(list, pose(3));
    assert.deepEqual(list.map((b) => [b.id, b.name]), [['spot-1', 'Spot 1'], ['spot-3', 'Spot 3'], ['spot-2', 'Spot 2']]);
  });

  test('add stops at the cap and refuses a bad pose (same list back)', () => {
    let list: readonly CameraBookmark[] = [];
    for (let i = 0; i < MAX_BOOKMARKS_PER_PLACE; i++) list = addBookmark(list, pose(i));
    assert.equal(list.length, MAX_BOOKMARKS_PER_PLACE);
    assert.equal(canAddBookmark(list), false);
    assert.equal(addBookmark(list, pose(99)), list);
    const short = list.slice(0, 2);
    assert.equal(addBookmark(short, { ...pose(), position: { x: Number.NaN, y: 0, z: 0 } }), short);
  });

  test('rename cleans the name; no-ops return the same list', () => {
    const list = addBookmark([], pose());
    assert.equal(renameBookmark(list, 'spot-1', '  Sunset   hill ')[0]!.name, 'Sunset hill');
    assert.equal(renameBookmark(list, 'spot-1', '   '), list);
    assert.equal(renameBookmark(list, 'spot-1', 'Spot 1'), list);
    assert.equal(renameBookmark(list, 'nope', 'Hill'), list);
  });

  test('remove takes one out; unknown ids return the same list', () => {
    const list = addBookmark(addBookmark([], pose()), pose(1));
    assert.deepEqual(removeBookmark(list, 'spot-1').map((b) => b.id), ['spot-2']);
    assert.equal(removeBookmark(list, 'nope'), list);
  });
});

describe('parseCameraBookmarks', () => {
  test('keeps good entries, drops bad ones, repairs names and ids', () => {
    const parsed = parseCameraBookmarks({
      home: [
        { id: 'a', name: 'Pond', ...pose() },
        { id: 'a', name: '', ...pose(1) }, // duplicate id, no name
        { id: 'b', name: 'Broken', position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 45 },
        'junk',
        { id: '<script>', name: 5, ...pose(2) },
      ],
      studio: 'nope',
      extra: [1],
    })!;
    assert.deepEqual(parsed.home.map((b) => [b.id, b.name]), [['a', 'Pond'], ['spot-1', 'Spot 1'], ['spot-2', 'Spot 2']]);
    assert.deepEqual(parsed.studio, []);
    assert.deepEqual(Object.keys(parsed).sort(), ['home', 'studio']);
  });

  test('caps each list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `N${i}`, ...pose(i) }));
    const parsed = parseCameraBookmarks({ home: many, studio: many })!;
    assert.equal(parsed.home.length, MAX_BOOKMARKS_PER_PLACE);
    assert.equal(parsed.studio.length, MAX_BOOKMARKS_PER_PLACE);
  });

  test('null for values that are not a bookmarks object; JSON variant falls back to empty', () => {
    for (const raw of [null, undefined, 3, 'x', []]) assert.equal(parseCameraBookmarks(raw), null);
    for (const json of [null, '', '{', 'null', '[]', '"x"']) {
      assert.deepEqual(parseCameraBookmarksJson(json), { home: [], studio: [] }, String(json));
    }
    const all = { home: [{ id: 'spot-1', name: 'Spot 1', ...pose() }], studio: [] };
    assert.deepEqual(parseCameraBookmarksJson(JSON.stringify(all)), all);
  });

  test('describeBookmarks counts both places', () => {
    const b = { id: 'spot-1', name: 'Spot 1', ...pose() };
    assert.equal(describeBookmarks({ home: [b], studio: [] }), '1 camera spot');
    assert.equal(describeBookmarks({ home: [b], studio: [b, b] }), '3 camera spots');
  });
});

describe('lerpPose / glidePose', () => {
  const a: CameraPose = { position: { x: 0, y: 3, z: 8 }, target: { x: 0, y: 1, z: 0 }, fov: 40 };
  const b: CameraPose = { position: { x: 14, y: 2, z: 4 }, target: { x: 4, y: 2, z: 4 }, fov: 60 };

  test('ends are the two poses', () => {
    for (const [t, want] of [[0, a], [1, b], [-3, a], [7, b]] as const) {
      const got = lerpPose(a, b, t);
      for (const key of ['position', 'target'] as const) {
        near(got[key].x, want[key].x);
        near(got[key].y, want[key].y);
        near(got[key].z, want[key].z);
      }
      near(got.fov, want.fov);
    }
  });

  test('halfway: target and lens are midway, the camera swings around (distance stays between)', () => {
    const mid = lerpPose(a, b, 0.5);
    assert.deepEqual(mid.target, { x: 2, y: 1.5, z: 2 });
    near(mid.fov, 50);
    const radius = Math.hypot(mid.position.x - mid.target.x, mid.position.z - mid.target.z);
    near(radius, 9); // horizontal distance: 8 → 10
    near(mid.position.y - mid.target.y, 1); // height above the target: 2 → 0
  });

  test('a half turn around a point keeps its distance instead of cutting through', () => {
    const front: CameraPose = { position: { x: 0, y: 1, z: 5 }, target: { x: 0, y: 1, z: 0 }, fov: 45 };
    const side: CameraPose = { position: { x: 5, y: 1, z: 0 }, target: { x: 0, y: 1, z: 0 }, fov: 45 };
    const mid = lerpPose(front, side, 0.5);
    near(Math.hypot(mid.position.x, mid.position.z), 5);
  });

  test('glidePose eases and reports arrival', () => {
    const start = glidePose(a, b, 0, 1);
    assert.equal(start.done, false);
    near(start.pose.fov, 40);
    const early = glidePose(a, b, 0.25, 1);
    assert.ok(early.pose.fov < 45, 'eased: slower than linear at the start');
    const end = glidePose(a, b, 1, 1);
    assert.equal(end.done, true);
    near(end.pose.fov, 60);
    assert.equal(glidePose(a, b, 0, 0).done, true);
    assert.equal(glidePose(a, b, 5).done, true);
  });
});
