import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_BOOKMARKS_KEY, cameraBookmarksSaveSection, createCameraBookmarksStore } from './cameraBookmarks';
import { MAX_BOOKMARKS_PER_PLACE, type CameraPose } from '../lib/cameraBookmarks';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const pose = (x = 0): CameraPose => ({ position: { x, y: 3, z: 8 }, target: { x: 0, y: 1, z: 0 }, fov: 45 });

describe('camera bookmarks store', () => {
  test('starts empty, with or without storage, and survives junk in storage', () => {
    assert.deepEqual(createCameraBookmarksStore(null).get(), { home: [], studio: [] });
    assert.deepEqual(createCameraBookmarksStore(memoryStorage()).get(), { home: [], studio: [] });
    assert.deepEqual(createCameraBookmarksStore(memoryStorage({ [CAMERA_BOOKMARKS_KEY]: '{oops' })).get(), {
      home: [],
      studio: [],
    });
  });

  test('add / rename / remove persist per place and notify once per real change', () => {
    const storage = memoryStorage();
    const store = createCameraBookmarksStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);

    const spot = store.add('home', pose())!;
    assert.equal(spot.name, 'Spot 1');
    store.add('studio', pose(2));
    assert.equal(calls, 2);
    assert.equal(store.list('home').length, 1);
    assert.equal(store.list('studio').length, 1);

    assert.equal(store.rename('home', spot.id, 'Pond'), true);
    assert.equal(store.rename('home', spot.id, 'Pond'), false);
    assert.equal(store.rename('studio', 'nope', 'X'), false);
    assert.equal(calls, 3);
    assert.equal(store.find('home', spot.id)!.name, 'Pond');

    // A fresh store reads the same thing back.
    assert.deepEqual(createCameraBookmarksStore(storage).get(), store.get());

    assert.equal(store.remove('home', spot.id), true);
    assert.equal(store.remove('home', spot.id), false);
    assert.equal(calls, 4);
    assert.deepEqual(JSON.parse(storage.m.get(CAMERA_BOOKMARKS_KEY)!).home, []);
  });

  test('add refuses past the cap and for a bad pose', () => {
    const store = createCameraBookmarksStore(null);
    for (let i = 0; i < MAX_BOOKMARKS_PER_PLACE; i++) assert.ok(store.add('home', pose(i)));
    assert.equal(store.add('home', pose(50)), null);
    assert.ok(store.add('studio', pose()), 'the other place has its own cap');
    assert.equal(store.add('studio', { ...pose(), target: { x: 0, y: Infinity, z: 0 } }), null);
  });

  test('a storage that throws does not break the store', () => {
    const store = createCameraBookmarksStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    assert.ok(store.add('home', pose()));
    assert.equal(store.list('home').length, 1);
  });
});

describe('backup section', () => {
  test('nothing to save when there are no spots', () => {
    const section = cameraBookmarksSaveSection(createCameraBookmarksStore(null));
    assert.equal(section.key, 'cameraBookmarks');
    assert.equal(section.read(), undefined);
  });

  test('round trip: read, JSON, parse, write into another store', () => {
    const a = createCameraBookmarksStore(null);
    a.add('home', pose());
    a.add('studio', pose(3));
    const file = JSON.parse(JSON.stringify(cameraBookmarksSaveSection(a).read()));

    const b = createCameraBookmarksStore(null);
    b.add('home', pose(9));
    let calls = 0;
    b.subscribe(() => calls++);
    const section = cameraBookmarksSaveSection(b);
    const parsed = section.parse(file)!;
    assert.equal(section.describe(parsed), '2 camera spots');
    section.write(parsed);
    assert.deepEqual(b.get(), a.get());
    assert.equal(calls, 1);
  });

  test('parse skips junk and files with no usable spots', () => {
    const section = cameraBookmarksSaveSection(createCameraBookmarksStore(null));
    for (const raw of [null, 5, 'x', [], {}, { home: [{ name: 'bad' }], studio: [] }]) {
      assert.equal(section.parse(raw), null, JSON.stringify(raw));
    }
  });
});
