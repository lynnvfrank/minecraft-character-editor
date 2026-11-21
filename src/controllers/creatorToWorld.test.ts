import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorToWorld, STUDIO_HASH } from './creatorToWorld';
import { createOutfitsStore } from '../state/outfitsStore';
import { createResidentsStore } from '../state/residentsStore';
import { createOutfitResidents } from './outfitResidents';
import { fakeSkinDataUrl } from '../domain/outfitsFixture';
import { MAX_OUTFITS } from '../domain/outfits';

const BUNDLED = ['/a.png', '/b.png', '/c.png'];

function setup(opts: { cap?: number; route?: string; hasSkin?: boolean; skin?: string } = {}) {
  let n = 0;
  const outfits = createOutfitsStore(null, { newId: () => `id${++n}` });
  const outfitResidents = createOutfitResidents(outfits);
  const residents = createResidentsStore(null);
  const said: string[] = [];
  const exits: (string | undefined)[] = [];
  const worn: string[] = [];
  const state = {
    route: opts.route ?? 'creator',
    skin: opts.skin ?? fakeSkinDataUrl(1),
    present: ['/a.png', '/b.png'] as string[],
    arm: 'slim' as 'slim' | 'classic',
  };
  const api = createCreatorToWorld({
    getRoute: () => state.route,
    hasSkin: () => opts.hasSkin ?? true,
    exportSkin: () => state.skin,
    getArmModel: () => state.arm,
    outfits,
    residents,
    getPresentSkins: () => state.present,
    getAvailableSkins: () => [...BUNDLED, ...outfitResidents.keys()],
    cap: opts.cap ?? 4,
    wearOutfit: (url) => void worn.push(url),
    exitCreator: async (hash) => void exits.push(hash),
    say: (m) => void said.push(m),
  });
  return { api, outfits, residents, said, exits, worn, state };
}

describe('creatorToWorld', () => {
  test('send to village: keeps the skin with its arm model, adds it to the roster and goes Home', async () => {
    const t = setup();
    assert.equal(await t.api.sendToVillage(), true);
    assert.equal(t.outfits.list().length, 1);
    assert.equal(t.outfits.list()[0]!.armModel, 'slim');
    // Nothing was stored: the roster starts from who is in the world right now.
    assert.deepEqual(t.residents.get(), ['/a.png', '/b.png', 'outfit:id1']);
    assert.deepEqual(t.worn, [fakeSkinDataUrl(1)]);
    assert.deepEqual(t.exits, [undefined]); // the normal Home exit
    assert.equal(t.said.length, 1);
  });

  test('send to village twice: one outfit, one resident', async () => {
    const t = setup();
    await t.api.sendToVillage();
    await t.api.sendToVillage();
    assert.equal(t.outfits.list().length, 1);
    assert.deepEqual(t.residents.get(), ['/a.png', '/b.png', 'outfit:id1']);
    assert.equal(t.exits.length, 2);
  });

  test('a full village keeps the outfit, says so and stays in the creator', async () => {
    const t = setup({ cap: 2 });
    t.residents.set(['/a.png', '/b.png']);
    assert.equal(await t.api.sendToVillage(), false);
    assert.equal(t.outfits.list().length, 1);
    assert.deepEqual(t.residents.get(), ['/a.png', '/b.png']);
    assert.deepEqual(t.exits, []);
    assert.match(t.said[0]!, /village is full \(2\)/);
    // Room was made: the same button now moves it in.
    t.residents.set(['/a.png']);
    assert.equal(await t.api.sendToVillage(), true);
    assert.deepEqual(t.residents.get(), ['/a.png', 'outfit:id1']);
  });

  test('a full outfits list or a skin that cannot be kept changes nothing', async () => {
    const t = setup();
    for (let i = 0; i < MAX_OUTFITS; i++) t.outfits.add({ dataUrl: fakeSkinDataUrl(100 + i), armModel: 'classic' });
    assert.equal(await t.api.sendToVillage(), false);
    assert.equal(t.residents.get(), null);
    assert.deepEqual(t.exits, []);
    assert.match(t.said[0]!, /My outfits is full/);

    const bad = setup({ skin: 'data:image/png;base64,AAAA' });
    assert.equal(await bad.api.sendToVillage(), false);
    assert.equal(bad.outfits.list().length, 0);
    assert.deepEqual(bad.exits, []);
    assert.equal(bad.said.length, 1);
  });

  test('nothing in the creator yet, or not in the creator: nothing happens', async () => {
    const empty = setup({ hasSkin: false });
    assert.equal(await empty.api.sendToVillage(), false);
    assert.equal(await empty.api.danceInStudio(), false);
    assert.equal(empty.outfits.list().length, 0);
    assert.deepEqual(empty.exits, []);
    assert.equal(empty.said.length, 2);

    const home = setup({ route: 'viewer' });
    assert.equal(await home.api.sendToVillage(), false);
    assert.equal(await home.api.danceInStudio(), false);
    assert.deepEqual(home.said, []);
    assert.deepEqual(home.exits, []);
  });

  test('dance in studio: leaves through the exit transition to the studio, saving nothing', async () => {
    const t = setup();
    assert.equal(await t.api.danceInStudio(), true);
    assert.deepEqual(t.exits, [STUDIO_HASH]);
    assert.equal(t.outfits.list().length, 0);
    assert.equal(t.residents.get(), null);
  });

  test('copy never names the trademark', async () => {
    const t = setup({ cap: 2 });
    t.residents.set(['/a.png', '/b.png']);
    await t.api.sendToVillage();
    await t.api.danceInStudio();
    const empty = setup({ hasSkin: false });
    await empty.api.sendToVillage();
    await empty.api.danceInStudio();
    for (const m of [...t.said, ...empty.said]) assert.ok(!/minecraft/i.test(m), m);
  });
});
