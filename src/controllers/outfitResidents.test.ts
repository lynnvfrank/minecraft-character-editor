import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createOutfitResidents } from './outfitResidents';
import { createOutfitsStore } from '../state/outfitsStore';
import { fakeSkinDataUrl } from '../domain/outfitsFixture';
import { createResidentsStore } from '../state/residentsStore';
import { crowdSkinsFor, diffResidents, isCustomSkin } from '../domain/residents';
import { ARM_MODEL_PATHS } from '../skin/armModel';

function setup() {
  let n = 0;
  const store = createOutfitsStore(null, { newId: () => `id${++n}` });
  store.add({ dataUrl: fakeSkinDataUrl(1), armModel: 'slim', label: 'Slim one' });
  store.add({ dataUrl: fakeSkinDataUrl(2), armModel: 'classic', label: 'Classic one' });
  return { store, residents: createOutfitResidents(store) };
}

describe('outfitResidents', () => {
  test('keys, panel entries (newest first) and labels', () => {
    const { residents } = setup();
    assert.deepEqual(residents.keys(), ['outfit:id1', 'outfit:id2']);
    assert.deepEqual(residents.entries(), [
      { path: 'outfit:id2', label: 'Classic one', face: fakeSkinDataUrl(2), group: 'outfits' },
      { path: 'outfit:id1', label: 'Slim one', face: fakeSkinDataUrl(1), group: 'outfits' },
    ]);
    assert.equal(residents.labelOf('outfit:id1'), 'Slim one');
    assert.equal(residents.labelOf(fakeSkinDataUrl(2)), 'Classic one');
    assert.equal(residents.labelOf('/wardrobe/skins/a.png'), undefined);
  });

  test('resolve gives the image and the rig for the stored arm model', () => {
    const { residents } = setup();
    assert.deepEqual(residents.resolve('outfit:id1'), { skin: fakeSkinDataUrl(1), modelPath: ARM_MODEL_PATHS.slim });
    assert.deepEqual(residents.resolve('outfit:id2'), {
      skin: fakeSkinDataUrl(2),
      modelPath: ARM_MODEL_PATHS.classic,
    });
    assert.equal(residents.resolve('outfit:gone'), null);
    assert.equal(residents.resolve('/wardrobe/skins/a.png'), null);
  });

  test('keyOf names a worn outfit by its key and leaves other skins alone', () => {
    const { store, residents } = setup();
    assert.equal(residents.keyOf(fakeSkinDataUrl(1)), 'outfit:id1');
    assert.equal(residents.keyOf('/wardrobe/skins/a.png'), '/wardrobe/skins/a.png');
    assert.equal(residents.keyOf(fakeSkinDataUrl(77)), fakeSkinDataUrl(77)); // an unsaved design
    // Kept later: known at once.
    const added = store.add({ dataUrl: fakeSkinDataUrl(3), armModel: 'classic' });
    assert.equal(residents.keyOf(fakeSkinDataUrl(3)), `outfit:${added.outfit!.id}`);
  });

  test('deleting an outfit removes its resident: roster pruned, and its character is sent home', () => {
    const { store, residents } = setup();
    const bundled = ['/a.png', '/b.png'];
    const available = () => [...bundled, ...residents.keys()];
    const roster = createResidentsStore(null);
    roster.set(['/a.png', 'outfit:id1', 'outfit:id2']);
    store.subscribe(() => roster.prune(available(), 8)); // as main.ts wires it

    // The crowd as the controller sees it: skins by roster key.
    const crowd = () => [
      { id: 'crowd-1', skin: residents.keyOf(fakeSkinDataUrl(1)) },
      { id: 'crowd-2', skin: residents.keyOf(fakeSkinDataUrl(2)) },
      { id: 'crowd-3', skin: residents.keyOf(fakeSkinDataUrl(77)) }, // unsaved design: a guest
    ];
    const wanted = () => crowdSkinsFor((roster.get() ?? []).filter((s) => available().includes(s)), '/a.png');
    assert.deepEqual(diffResidents(crowd(), wanted(), available()), { toAdd: [], toRemove: [] });

    store.remove('id1');
    assert.deepEqual(roster.get(), ['/a.png', 'outfit:id2']);
    assert.equal(residents.resolve('outfit:id1'), null);
    // Still recognised as the (deleted) outfit, so it is not mistaken for a guest that may stay.
    assert.equal(residents.keyOf(fakeSkinDataUrl(1)), 'outfit:id1');
    assert.equal(isCustomSkin('outfit:id1', available()), false);
    assert.deepEqual(diffResidents(crowd(), wanted(), available()), { toAdd: [], toRemove: ['crowd-1'] });
  });
});
