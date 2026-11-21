import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySaveFile, createSaveRegistry } from '../domain/saveFile';
import { createCoreSaveSections, parseCombosSection, parseResidentsSection } from './saveSections';
import { createSavedSequencesStore } from './savedSequences';
import { createResidentsStore } from './residentsStore';
import { createTimeOfDayStore } from './timeOfDay';
import { createGroupDanceStore } from './groupDanceStore';
import { createStudioBackdropStore } from './studioBackdrop';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const SKINS = ['/wardrobe/skins/a.png', '/wardrobe/skins/b.png', '/wardrobe/skins/c.png'];
const blend = (name: string) => ({ type: 'blend' as const, layers: [{ name, weight: 1, timeScale: 1 }], duration: 3 });

function makeApp() {
  const storage = memoryStorage();
  const stores = {
    savedSequences: createSavedSequencesStore(storage),
    residents: createResidentsStore(storage),
    timeOfDay: createTimeOfDayStore(storage),
    groupDance: createGroupDanceStore(storage),
    backdrop: createStudioBackdropStore(storage),
  };
  const registry = createSaveRegistry();
  for (const s of createCoreSaveSections({ ...stores, getAvailableSkins: () => SKINS, residentsCap: 2 })) registry.register(s);
  return { storage, stores, registry };
}

function restore(app: ReturnType<typeof makeApp>, json: string) {
  const parsed = app.registry.parse(json);
  if (!parsed.ok) throw new Error(parsed.reason);
  assert.deepEqual(applySaveFile(parsed), []);
  return parsed;
}

const fileWith = (data: unknown) => JSON.stringify({ app: 'blockygotchi', version: 1, data });

describe('core save sections', () => {
  test('a backup from one app restores into another, live, with notifications', () => {
    const from = makeApp();
    from.stores.savedSequences.add('Wave', [blend('waving')], 1);
    from.stores.savedSequences.add('Bored', [blend('bored')], 2);
    from.stores.residents.set([SKINS[1]!, SKINS[0]!]);
    from.stores.timeOfDay.setTime(21.5);
    from.stores.timeOfDay.setAuto(true);
    from.stores.groupDance.set({ count: 2, formation: 'triangle', offsetSec: 0.25 });
    from.stores.backdrop.setCustomColor('#112233');
    from.stores.backdrop.setFloor(false);
    const json = from.registry.build();
    assert.deepEqual(Object.keys(JSON.parse(json).data), ['combos', 'residents', 'timeOfDay', 'groupDance', 'backdrop']);

    const to = makeApp();
    const calls = { combos: 0, residents: 0, time: 0, dance: 0, backdrop: 0 };
    to.stores.savedSequences.subscribe(() => calls.combos++);
    to.stores.residents.subscribe(() => calls.residents++);
    to.stores.timeOfDay.subscribe(() => calls.time++);
    to.stores.groupDance.subscribe(() => calls.dance++);
    to.stores.backdrop.subscribe(() => calls.backdrop++);
    const parsed = restore(to, json);
    assert.deepEqual(parsed.entries.map((e) => e.summary), [
      '2 combos (added to yours)',
      'Village residents: 2 (replaces yours)',
      'Time of day',
      'Studio dancers',
      'Studio backdrop',
    ]);

    assert.deepEqual(to.stores.savedSequences.list().map((s) => s.label), ['Bored', 'Wave']);
    assert.deepEqual(to.stores.residents.get(), [SKINS[1], SKINS[0]]);
    assert.deepEqual(to.stores.timeOfDay.get(), { time: 21.5, auto: true });
    assert.deepEqual(to.stores.groupDance.get(), { count: 2, formation: 'triangle', offsetSec: 0.25 });
    assert.deepEqual(to.stores.backdrop.get(), from.stores.backdrop.get());
    assert.equal(calls.combos, 1);
    for (const [name, n] of Object.entries(calls)) assert.ok(n >= 1, `${name} notified`);

    // ...and it is persisted: fresh stores on the same storage read the same values.
    assert.deepEqual(createSavedSequencesStore(to.storage).list(), to.stores.savedSequences.list());
    assert.deepEqual(createTimeOfDayStore(to.storage).get(), { time: 21.5, auto: true });
    assert.deepEqual(createStudioBackdropStore(to.storage).get(), from.stores.backdrop.get());
  });

  test('a non-custom backdrop is restored even though the custom color is applied first', () => {
    const from = makeApp();
    from.stores.backdrop.setCustomColor('#112233');
    from.stores.backdrop.setBackdrop('default');
    const to = makeApp();
    restore(to, from.registry.build());
    assert.equal(to.stores.backdrop.get().id, 'default');
    assert.equal(to.stores.backdrop.get().customColor, '#112233');
  });

  test('combos merge: existing stay, duplicates are skipped, id clashes get a new id', () => {
    const from = makeApp();
    from.stores.savedSequences.add('Wave', [blend('waving')], 1);
    const bored = from.stores.savedSequences.add('Bored', [blend('bored')], 1);
    const json = from.registry.build();

    const to = makeApp();
    to.stores.savedSequences.add('Wave', [blend('waving')], 5); // same content as in the file, other id
    const mine = to.stores.savedSequences.add('Mine', [blend('clapping')], 1); // other content, same id as "Bored" in the file
    assert.equal(mine.id, bored.id);
    restore(to, json);
    const list = to.stores.savedSequences.list();
    assert.deepEqual(list.map((s) => s.label), ['Mine', 'Wave', 'Bored']);
    assert.equal(new Set(list.map((s) => s.id)).size, 3);
    assert.equal(to.stores.savedSequences.get(mine.id)?.label, 'Mine');

    // Restoring the same file again changes nothing and notifies nobody.
    let calls = 0;
    to.stores.savedSequences.subscribe(() => calls++);
    restore(to, json);
    assert.equal(to.stores.savedSequences.list().length, 3);
    assert.equal(calls, 0);
  });

  test('residents are fitted to the skins that exist and to the cap', () => {
    const to = makeApp();
    restore(to, fileWith({ residents: ['/wardrobe/skins/gone.png', SKINS[2], SKINS[0], SKINS[1]] }));
    assert.deepEqual(to.stores.residents.get(), [SKINS[2], SKINS[0]]);
  });

  test('settings missing from the file keep their current value; unset things are not in the file', () => {
    const from = makeApp();
    const data = JSON.parse(from.registry.build()).data;
    assert.equal('residents' in data, false);
    assert.equal('combos' in data, false);
    const to = makeApp();
    to.stores.residents.set([SKINS[0]!]);
    restore(to, from.registry.build());
    assert.deepEqual(to.stores.residents.get(), [SKINS[0]]);
  });

  test('junk in a section is skipped or falls back to safe values', () => {
    const to = makeApp();
    to.stores.timeOfDay.setTime(6);
    const parsed = restore(
      to,
      fileWith({
        combos: 'nope',
        residents: { a: 1 },
        timeOfDay: 'noon',
        groupDance: { count: 999, formation: '<script>', offsetSec: 'x' },
        backdrop: { id: 'javascript:alert(1)', customColor: 'red; background:url(x)', floor: 'no' },
      })
    );
    assert.deepEqual(parsed.skipped, ['Combos', 'Village residents', 'Time of day']);
    assert.equal(to.stores.timeOfDay.get().time, 6);
    assert.deepEqual(to.stores.groupDance.get(), { count: 2, formation: 'line', offsetSec: 0 });
    assert.equal(to.stores.backdrop.get().id, 'default');
    assert.match(to.stores.backdrop.get().customColor, /^#[0-9a-f]{6}$/i);
  });
});

describe('section parsers', () => {
  test('parseCombosSection keeps only valid sequences', () => {
    const out = parseCombosSection([
      { id: 'a', label: '<b>x</b>', steps: [blend('waving')] },
      { id: 'b', label: 'bad', steps: [{ type: 'animation', name: 'constructor' }] },
      'junk',
    ]);
    assert.deepEqual(out, [{ id: 'a', label: '<b>x</b>', steps: [blend('waving')] }]);
    assert.equal(parseCombosSection([]), null);
    assert.equal(parseCombosSection({}), null);
  });

  test('parseResidentsSection accepts site-relative paths only', () => {
    assert.deepEqual(
      parseResidentsSection([
        '/wardrobe/skins/a.png',
        '/wardrobe/skins/My Skin.png',
        'https://evil.test/x.png',
        '//evil.test/x.png',
        '/\\evil.test/x.png',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        '/' + 'x'.repeat(300),
        7,
        '/wardrobe/skins/a.png',
      ]),
      ['/wardrobe/skins/a.png', '/wardrobe/skins/My Skin.png']
    );
    assert.deepEqual(parseResidentsSection([]), []);
    assert.equal(parseResidentsSection('x'), null);
  });
});
