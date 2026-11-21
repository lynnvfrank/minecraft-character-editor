import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createOutfitsStore, OUTFITS_KEY } from './outfitsStore';
import { MAX_OUTFITS } from '../domain/outfits';
import { fakeSkinDataUrl } from '../domain/outfitsFixture';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  let failWrites = false;
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    m,
    fail: (on: boolean) => void (failWrites = on),
  };
}

function ids() {
  let n = 0;
  return () => `id${++n}`;
}

describe('outfitsStore', () => {
  test('starts empty, keeps an outfit, persists it and reads it back after a "reload"', () => {
    const storage = memoryStorage();
    const store = createOutfitsStore(storage, { now: () => 1234, newId: ids() });
    assert.deepEqual(store.list(), []);
    let calls = 0;
    store.subscribe(() => calls++);
    const result = store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'slim' });
    assert.equal(result.outcome, 'added');
    assert.equal(result.persisted, true);
    assert.deepEqual(result.outfit, {
      id: 'id1',
      label: 'My outfit 1',
      dataUrl: fakeSkinDataUrl(1),
      armModel: 'slim',
      createdAt: 1234,
    });
    assert.equal(calls, 1);
    assert.equal(store.get('id1')?.armModel, 'slim');
    assert.equal(store.findByDataUrl(fakeSkinDataUrl(1))?.id, 'id1');

    const reloaded = createOutfitsStore(storage);
    assert.deepEqual(reloaded.list(), store.list());
  });

  test('the same image twice is one outfit and changes nothing', () => {
    const store = createOutfitsStore(memoryStorage(), { newId: ids() });
    store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'classic' });
    let calls = 0;
    store.subscribe(() => calls++);
    const again = store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'slim' });
    assert.equal(again.outcome, 'exists');
    assert.equal(again.outfit?.id, 'id1');
    assert.equal(store.list().length, 1);
    assert.equal(calls, 0);
  });

  test('untrusted stored data is validated: junk is dropped, never thrown on', () => {
    const good = { id: 'ok1', label: 'Fine', dataUrl: fakeSkinDataUrl(1), armModel: 'slim', createdAt: 5 };
    const stored = JSON.stringify({
      version: 1,
      outfits: [
        good,
        { id: 'evil', label: 'x', dataUrl: 'javascript:alert(1)', armModel: 'slim', createdAt: 1 },
        { id: 'svg', label: 'x', dataUrl: 'data:image/svg+xml;base64,AAAA', armModel: 'slim', createdAt: 1 },
        { id: '../../x', label: 'x', dataUrl: fakeSkinDataUrl(2), armModel: 'slim', createdAt: 1 },
        { id: 'long', label: 'y'.repeat(500), dataUrl: fakeSkinDataUrl(3), armModel: 'nope', createdAt: -4 },
      ],
    });
    const store = createOutfitsStore(memoryStorage({ [OUTFITS_KEY]: stored }));
    assert.deepEqual(store.list().map((o) => o.id), ['ok1', 'long']);
    assert.deepEqual(store.list()[0], good);
    assert.equal(store.list()[1]!.label.length, 32);
    assert.equal(store.list()[1]!.armModel, 'classic');
    assert.equal(store.list()[1]!.createdAt, 0);
    assert.deepEqual(createOutfitsStore(memoryStorage({ [OUTFITS_KEY]: '{broken' })).list(), []);
    assert.deepEqual(createOutfitsStore(memoryStorage({ [OUTFITS_KEY]: '42' })).list(), []);
  });

  test('a refused write (quota) keeps the outfit for this visit and says so', () => {
    const storage = memoryStorage();
    const store = createOutfitsStore(storage, { newId: ids() });
    storage.fail(true);
    const result = store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'classic' });
    assert.equal(result.outcome, 'added');
    assert.equal(result.persisted, false);
    assert.equal(store.list().length, 1);
    assert.equal(storage.m.has(OUTFITS_KEY), false);
    // Storage works again: the next change writes everything.
    storage.fail(false);
    assert.equal(store.add({ dataUrl: fakeSkinDataUrl(2), armModel: 'classic' }).persisted, true);
    assert.equal(createOutfitsStore(storage).list().length, 2);
  });

  test('works without storage and with storage that throws on read', () => {
    const store = createOutfitsStore(null, { newId: ids() });
    const result = store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'classic' });
    assert.equal(result.outcome, 'added');
    assert.equal(result.persisted, false);
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    assert.deepEqual(createOutfitsStore(throwing).list(), []);
  });

  test('refuses junk and a full list without notifying', () => {
    const store = createOutfitsStore(memoryStorage(), { newId: ids() });
    let calls = 0;
    store.subscribe(() => calls++);
    assert.equal(store.add({ dataUrl: 'data:text/html;base64,AAAA', armModel: 'classic' }).outcome, 'invalid');
    assert.equal(calls, 0);
    for (let i = 0; i < MAX_OUTFITS; i++) store.add({ dataUrl: fakeSkinDataUrl(i + 1), armModel: 'classic' });
    assert.equal(store.list().length, MAX_OUTFITS);
    calls = 0;
    const refused = store.add({ dataUrl: fakeSkinDataUrl(900), armModel: 'classic' });
    assert.equal(refused.outcome, 'full');
    assert.equal(refused.outfit, null);
    assert.equal(calls, 0);
  });

  test('remove and rename persist and notify only on a real change', () => {
    const storage = memoryStorage();
    const store = createOutfitsStore(storage, { newId: ids() });
    store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'classic' });
    store.add({ dataUrl: fakeSkinDataUrl(2), armModel: 'classic' });
    let calls = 0;
    store.subscribe(() => calls++);
    assert.equal(store.rename('id2', '  Night out '), true);
    assert.equal(store.rename('id2', 'Night out'), false);
    assert.equal(store.rename('missing', 'x'), false);
    assert.equal(store.rename('id2', '  '), false);
    assert.equal(store.remove('missing'), false);
    assert.equal(store.remove('id1'), true);
    assert.equal(calls, 2);
    assert.deepEqual(
      createOutfitsStore(storage).list().map((o) => [o.id, o.label]),
      [['id2', 'Night out']]
    );
  });

  test('exportOutfits / importOutfits: a save file moves outfits to another store', () => {
    const a = createOutfitsStore(memoryStorage(), { newId: ids() });
    a.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'slim', label: 'One' });
    a.add({ dataUrl: fakeSkinDataUrl(2), armModel: 'classic', label: 'Two' });
    const file = JSON.parse(JSON.stringify(a.exportOutfits()));

    const storage = memoryStorage();
    const b = createOutfitsStore(storage, { newId: () => 'mine' });
    b.add({ dataUrl: fakeSkinDataUrl(2), armModel: 'classic', label: 'Already here' });
    let calls = 0;
    b.subscribe(() => calls++);
    assert.deepEqual(b.importOutfits(file), { added: 1, persisted: true });
    assert.equal(calls, 1);
    assert.deepEqual(b.list().map((o) => o.label), ['Already here', 'One']);
    assert.deepEqual(b.importOutfits(file), { added: 0, persisted: true });
    assert.deepEqual(b.importOutfits({ outfits: [{ id: 'x', dataUrl: 'file:///etc/passwd' }] }), {
      added: 0,
      persisted: true,
    });
    assert.equal(calls, 1);
    assert.equal(createOutfitsStore(storage).list().length, 2);
  });
});
