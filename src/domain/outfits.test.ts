import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OUTFITS,
  MAX_OUTFITS_TOTAL_LENGTH,
  MAX_OUTFIT_LABEL_LENGTH,
  MAX_OUTFIT_URL_LENGTH,
  addOutfit,
  cleanOutfitLabel,
  exportOutfits,
  importOutfits,
  isOutfitDataUrl,
  normalizeOutfits,
  outfitSaveMessage,
  parseOutfits,
  removeOutfit,
  renameOutfit,
  validateOutfit,
  type Outfit,
} from './outfits';
import { fakeSkinDataUrl } from './outfitsFixture';

const outfit = (n: number, extra: Partial<Outfit> = {}): Outfit => ({
  id: `o${n}`,
  label: `Outfit ${n}`,
  dataUrl: fakeSkinDataUrl(n),
  armModel: 'classic',
  createdAt: n,
  ...extra,
});

describe('outfits', () => {
  test('only a 64x64 base64 PNG data URL under the size cap is accepted', () => {
    assert.equal(isOutfitDataUrl(fakeSkinDataUrl(1)), true);
    assert.equal(isOutfitDataUrl(fakeSkinDataUrl(1, 64, 32)), false);
    assert.equal(isOutfitDataUrl(fakeSkinDataUrl(1, 128, 128)), false);
    assert.equal(isOutfitDataUrl(fakeSkinDataUrl(1).replace('image/png', 'image/svg+xml')), false);
    assert.equal(isOutfitDataUrl(fakeSkinDataUrl(1).replace('data:', 'javascript:')), false);
    assert.equal(isOutfitDataUrl(`${fakeSkinDataUrl(1)}"),url("https://example.com/x.png`), false);
    assert.equal(isOutfitDataUrl('data:image/png;base64,'), false);
    const text = Buffer.from('not a png at all, just some text....').toString('base64');
    assert.equal(isOutfitDataUrl(`data:image/png;base64,${text}`), false);
    assert.equal(isOutfitDataUrl('/wardrobe/skins/a.png'), false);
    assert.equal(isOutfitDataUrl(null), false);
    assert.equal(isOutfitDataUrl(42), false);
    const huge = fakeSkinDataUrl(1, 64, 64, MAX_OUTFIT_URL_LENGTH);
    assert.ok(huge.length > MAX_OUTFIT_URL_LENGTH);
    assert.equal(isOutfitDataUrl(huge), false);
  });

  test('labels are trimmed, single-line, capped, and fall back when empty', () => {
    assert.equal(cleanOutfitLabel('  Party   look \n'), 'Party look');
    const sneaky = `a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c${String.fromCharCode(0x200b)}`;
    assert.equal(cleanOutfitLabel(sneaky), 'a b c');
    assert.equal(cleanOutfitLabel('x'.repeat(200)).length, MAX_OUTFIT_LABEL_LENGTH);
    assert.equal(cleanOutfitLabel('   ', 'Fallback'), 'Fallback');
    assert.equal(cleanOutfitLabel(12, 'Fallback'), 'Fallback');
    // Markup stays plain text; the UI shows labels with textContent, never innerHTML.
    assert.equal(cleanOutfitLabel('<img src=x onerror=1>'), '<img src=x onerror=1>');
  });

  test('validateOutfit rejects bad ids and images and repairs the rest', () => {
    assert.equal(validateOutfit(null), null);
    assert.equal(validateOutfit('x'), null);
    assert.equal(validateOutfit({ ...outfit(1), id: 'Bad Id!' }), null);
    assert.equal(validateOutfit({ ...outfit(1), id: '' }), null);
    assert.equal(validateOutfit({ ...outfit(1), dataUrl: 'https://example.com/a.png' }), null);
    assert.deepEqual(
      validateOutfit({ id: 'o1', dataUrl: fakeSkinDataUrl(1), label: 7, armModel: 'wide', createdAt: 'x', extra: 1 }),
      { id: 'o1', label: 'My outfit', dataUrl: fakeSkinDataUrl(1), armModel: 'classic', createdAt: 0 }
    );
    assert.equal(validateOutfit({ ...outfit(2), armModel: 'slim' })?.armModel, 'slim');
  });

  test('parse: empty for missing or malformed data; reads a file or a bare array; drops junk and repeats', () => {
    assert.deepEqual(parseOutfits(null), []);
    assert.deepEqual(parseOutfits('{oops'), []);
    assert.deepEqual(parseOutfits('"text"'), []);
    assert.deepEqual(parseOutfits('{"outfits":"no"}'), []);
    const good = [outfit(1), outfit(2)];
    assert.deepEqual(parseOutfits(JSON.stringify(exportOutfits(good))), good);
    assert.deepEqual(parseOutfits(JSON.stringify(good)), good);
    const messy = [
      outfit(1),
      { id: 'zz' },
      outfit(1, { label: 'same id' }),
      outfit(3, { dataUrl: fakeSkinDataUrl(1) }),
      5,
      outfit(2),
    ];
    assert.deepEqual(parseOutfits(JSON.stringify(messy)), good);
  });

  test('normalize keeps at most the count cap and the total size cap', () => {
    const many = Array.from({ length: MAX_OUTFITS + 5 }, (_, i) => outfit(i + 1));
    assert.equal(normalizeOutfits(many).length, MAX_OUTFITS);
    const big = Array.from({ length: MAX_OUTFITS }, (_, i) =>
      outfit(i + 1, { dataUrl: fakeSkinDataUrl(i + 1, 64, 64, 29_000) })
    );
    const kept = normalizeOutfits(big);
    assert.ok(kept.length < MAX_OUTFITS && kept.length > 0);
    assert.ok(kept.reduce((n, o) => n + o.dataUrl.length, 0) <= MAX_OUTFITS_TOTAL_LENGTH);
  });

  test('add: appends with a default name, and the same image is one outfit', () => {
    const first = addOutfit([], { dataUrl: fakeSkinDataUrl(1), armModel: 'slim' }, { id: 'a1', now: 100 });
    assert.equal(first.outcome, 'added');
    assert.deepEqual(first.outfit, {
      id: 'a1',
      label: 'My outfit 1',
      dataUrl: fakeSkinDataUrl(1),
      armModel: 'slim',
      createdAt: 100,
    });
    const second = addOutfit(
      first.list,
      { dataUrl: fakeSkinDataUrl(2), armModel: 'classic', label: '  Beach day ' },
      { id: 'a2', now: 200 }
    );
    assert.equal(second.outfit?.label, 'Beach day');
    assert.equal(second.list.length, 2);
    const again = addOutfit(second.list, { dataUrl: fakeSkinDataUrl(1), armModel: 'classic' }, { id: 'a3', now: 300 });
    assert.equal(again.outcome, 'exists');
    assert.equal(again.outfit?.id, 'a1');
    assert.equal(again.list.length, 2);
    // A default name already in use is skipped.
    const taken = renameOutfit(removeOutfit(second.list, 'a1'), 'a2', 'My outfit 2');
    const third = addOutfit(taken, { dataUrl: fakeSkinDataUrl(3), armModel: 'classic' }, { id: 'a4', now: 400 });
    assert.equal(third.outfit?.label, 'My outfit 3');
  });

  test('add: refuses junk, a reused id, and a full list, leaving the list as it was', () => {
    const base = [outfit(1)];
    assert.equal(addOutfit(base, { dataUrl: 'nope', armModel: 'classic' }, { id: 'a1', now: 1 }).outcome, 'invalid');
    assert.equal(
      addOutfit(base, { dataUrl: fakeSkinDataUrl(9), armModel: 'classic' }, { id: 'Bad id', now: 1 }).outcome,
      'invalid'
    );
    const reused = addOutfit(base, { dataUrl: fakeSkinDataUrl(9), armModel: 'classic' }, { id: 'o1', now: 1 });
    assert.equal(reused.outcome, 'invalid');
    assert.deepEqual(reused.list, base);
    const full = Array.from({ length: MAX_OUTFITS }, (_, i) => outfit(i + 1));
    const refused = addOutfit(full, { dataUrl: fakeSkinDataUrl(999), armModel: 'classic' }, { id: 'new', now: 1 });
    assert.equal(refused.outcome, 'full');
    assert.equal(refused.outfit, null);
    assert.deepEqual(refused.list, full);
  });

  test('remove and rename', () => {
    const list = [outfit(1), outfit(2)];
    assert.deepEqual(removeOutfit(list, 'o1'), [outfit(2)]);
    assert.deepEqual(removeOutfit(list, 'nobody'), list);
    assert.equal(renameOutfit(list, 'o2', ' Winter ')[1]!.label, 'Winter');
    assert.equal(renameOutfit(list, 'o2', '   ')[1]!.label, 'Outfit 2');
    assert.deepEqual(renameOutfit(list, 'nobody', 'x'), list);
    assert.equal(list[1]!.label, 'Outfit 2'); // input untouched
  });

  test('export then import round-trips; import merges, skips what is there, and ignores junk', () => {
    const list = [outfit(1), outfit(2)];
    const file = JSON.parse(JSON.stringify(exportOutfits(list)));
    assert.equal(file.version, 1);
    assert.deepEqual(importOutfits([], file), { list, added: 2 });
    assert.deepEqual(importOutfits(list, file), { list, added: 0 });
    const merged = importOutfits([outfit(1)], {
      outfits: [outfit(2), outfit(5, { id: 'o1' }), outfit(1, { id: 'other' }), { bad: true }, outfit(3)],
    });
    assert.deepEqual(merged.list.map((o) => o.id), ['o1', 'o2', 'o3']);
    assert.equal(merged.added, 2);
    for (const junk of [null, 5, 'x', {}, { outfits: {} }]) {
      assert.deepEqual(importOutfits(list, junk), { list, added: 0 });
    }
    const full = Array.from({ length: MAX_OUTFITS }, (_, i) => outfit(i + 1));
    assert.equal(importOutfits(full, [outfit(500)]).added, 0);
  });

  test('messages are short, distinct, and never name the trademark', () => {
    const all = [
      outfitSaveMessage('added'),
      outfitSaveMessage('added', false),
      outfitSaveMessage('exists'),
      outfitSaveMessage('full'),
      outfitSaveMessage('invalid'),
    ];
    assert.equal(new Set(all).size, all.length);
    for (const m of all) {
      assert.ok(m.length > 0 && m.length < 100, m);
      assert.ok(!/minecraft/i.test(m));
    }
  });
});
