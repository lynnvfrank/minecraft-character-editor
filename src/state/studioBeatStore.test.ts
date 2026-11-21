import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBeatSaveSection, createStudioBeatStore, STUDIO_BEAT_KEY } from './studioBeatStore';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('studioBeatStore', () => {
  test('persists, notifies once per real change, and reads back', () => {
    const storage = memoryStorage();
    const store = createStudioBeatStore(storage);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ bpm: 128, bounce: 0.4 });
    store.set({ bpm: 128 });
    store.set({ bpm: Number.NaN }); // ignored
    assert.equal(calls, 1);
    assert.equal(createStudioBeatStore(storage).get().bpm, 128);
    assert.ok(storage.m.has(STUDIO_BEAT_KEY));
  });
  test('works without storage and with broken stored data', () => {
    assert.equal(createStudioBeatStore(null).get().bounce, 0);
    assert.equal(createStudioBeatStore(memoryStorage({ [STUDIO_BEAT_KEY]: '{bad' })).get().snap, false);
  });
  test('backup section round trip', () => {
    const a = createStudioBeatStore(null);
    a.set({ groove: 'stomp', snap: true });
    const section = createBeatSaveSection(a);
    assert.equal(section.key, 'studioBeat');
    const b = createStudioBeatStore(null);
    const parsed = section.parse(JSON.parse(JSON.stringify(section.read())))!;
    createBeatSaveSection(b).write(parsed);
    assert.deepEqual(b.get(), a.get());
    assert.equal(section.parse('junk'), null);
  });
});
