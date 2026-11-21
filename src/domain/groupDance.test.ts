import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GROUP_DANCE,
  SOLO_CAMERA_DISTANCE,
  formationOffsets,
  groupFraming,
  normalizeGroupDance,
  parseGroupDance,
  groupShot,
  pickDancerSkins,
  reframeDecision,
  stageToWorld,
} from './groupDance';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe('group dance settings', () => {
  test('nothing or junk stored gives the defaults (no dancers)', () => {
    assert.deepEqual(parseGroupDance(null), DEFAULT_GROUP_DANCE);
    assert.deepEqual(parseGroupDance('{oops'), DEFAULT_GROUP_DANCE);
    assert.deepEqual(parseGroupDance('[1,2]'), DEFAULT_GROUP_DANCE);
    assert.deepEqual(parseGroupDance('"line"'), DEFAULT_GROUP_DANCE);
  });

  test('valid settings round-trip', () => {
    const s = { count: 2, formation: 'triangle' as const, offsetSec: 0.25 };
    assert.deepEqual(parseGroupDance(JSON.stringify(s)), s);
  });

  test('bad fields are clamped, snapped or replaced one by one', () => {
    assert.deepEqual(parseGroupDance('{"count":9,"formation":"circle","offsetSec":0.4}'), {
      count: 2,
      formation: 'line',
      offsetSec: 0.5,
    });
    assert.deepEqual(parseGroupDance('{"count":-3,"formation":"stagger","offsetSec":"x"}'), {
      count: 0,
      formation: 'stagger',
      offsetSec: 0,
    });
    assert.equal(parseGroupDance('{"count":1.4}').count, 1);
    assert.equal(parseGroupDance('{"count":null}').count, 0);
  });

  test('a patch keeps the fields it does not mention', () => {
    const base = { count: 2, formation: 'stagger' as const, offsetSec: 0.5 };
    assert.deepEqual(normalizeGroupDance({ ...base, count: 1 }, base), { ...base, count: 1 });
    assert.deepEqual(normalizeGroupDance({ formation: 'nope' }, base), base);
  });
});

describe('formations', () => {
  test('one offset per dancer, none for zero, never more than two', () => {
    for (const f of ['line', 'triangle', 'stagger'] as const) {
      assert.equal(formationOffsets(f, 0).length, 0);
      assert.equal(formationOffsets(f, 1).length, 1);
      assert.equal(formationOffsets(f, 2).length, 2);
      assert.equal(formationOffsets(f, 7).length, 2);
      assert.equal(formationOffsets(f, NaN).length, 0);
    }
  });

  test('nobody stands on the lead or on each other', () => {
    for (const f of ['line', 'triangle', 'stagger'] as const) {
      const spots = [{ side: 0, forward: 0 }, ...formationOffsets(f, 2)];
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const d = Math.hypot(spots[i]!.side - spots[j]!.side, spots[i]!.forward - spots[j]!.forward);
          assert.ok(d >= 1, `${f}: spots ${i} and ${j} are ${d} apart`);
        }
      }
    }
  });

  test('line is level with the lead; triangle and stagger stand behind it', () => {
    assert.ok(formationOffsets('line', 2).every((o) => o.forward === 0));
    assert.ok(formationOffsets('triangle', 2).every((o) => o.forward < 0));
    assert.ok(formationOffsets('stagger', 2).every((o) => o.forward < 0));
    const [a, b] = formationOffsets('triangle', 2);
    assert.equal(a!.side, -b!.side);
  });

  test('stageToWorld follows the facing', () => {
    // Facing +Z: forward is +Z, side is +X.
    let p = stageToWorld({ side: 1, forward: 2 }, 0);
    near(p.x, 1);
    near(p.z, 2);
    // Facing +X: forward is +X.
    p = stageToWorld({ side: 0, forward: 2 }, Math.PI / 2);
    near(p.x, 2);
    near(p.z, 0);
    // Distances survive the turn.
    p = stageToWorld({ side: 1.5, forward: -1 }, 1.234);
    near(Math.hypot(p.x, p.z), Math.hypot(1.5, 1));
  });

  test('framing: solo shot without dancers, wider and centred with them', () => {
    assert.deepEqual(groupFraming([]), { center: { side: 0, forward: 0 }, distance: SOLO_CAMERA_DISTANCE });
    const line = groupFraming(formationOffsets('line', 2));
    assert.deepEqual(line.center, { side: 0, forward: 0 });
    assert.ok(line.distance > SOLO_CAMERA_DISTANCE);
    const one = groupFraming(formationOffsets('line', 1));
    assert.equal(one.center.side, -0.75);
    assert.ok(one.distance > SOLO_CAMERA_DISTANCE && one.distance < line.distance);
  });
});

describe('pickDancerSkins', () => {
  const available = ['a', 'b', 'c', 'd'];
  const first = () => 0;

  test('residents first, in roster order, skipping the lead and unknown skins', () => {
    assert.deepEqual(
      pickDancerSkins({ roster: ['a', 'gone', 'c', 'd'], available, exclude: ['a'], count: 2, random: first }),
      ['c', 'd']
    );
  });

  test('no roster: random skins that are not the lead and not each other', () => {
    const picks = pickDancerSkins({ roster: null, available, exclude: ['a'], count: 2, random: first });
    assert.deepEqual(picks, ['b', 'c']);
    const last = pickDancerSkins({ roster: null, available, exclude: ['a'], count: 2, random: () => 0.999 });
    assert.deepEqual(last, ['d', 'c']);
  });

  test('a short roster is topped up from the other skins', () => {
    assert.deepEqual(
      pickDancerSkins({ roster: ['a', 'b'], available, exclude: ['a'], count: 2, random: first }),
      ['b', 'c']
    );
  });

  test('twins only when there is no other skin left', () => {
    assert.deepEqual(
      pickDancerSkins({ roster: null, available: ['a', 'b'], exclude: ['a'], count: 2, random: first }),
      ['b', 'a']
    );
    assert.deepEqual(pickDancerSkins({ roster: null, available: ['a'], exclude: ['a'], count: 1, random: first }), ['a']);
  });

  test('nothing to pick from, or nobody asked for', () => {
    assert.deepEqual(pickDancerSkins({ roster: ['a'], available: [], exclude: [], count: 2, random: first }), []);
    assert.deepEqual(pickDancerSkins({ roster: null, available, exclude: [], count: 0, random: first }), []);
  });

  test('a random() of exactly 1 stays in range', () => {
    assert.deepEqual(pickDancerSkins({ roster: null, available, exclude: [], count: 1, random: () => 1 }), ['d']);
  });
});

describe('group shot', () => {
  test('nobody on stage: the lead itself, no extra distance', () => {
    const shot = groupShot([], 1.2);
    near(shot.dx, 0);
    near(shot.dz, 0);
    near(shot.extraDistance, 0);
  });

  test('a line of three is centred on the lead and stands further back', () => {
    const shot = groupShot(formationOffsets('line', 2), 0);
    near(shot.dx, 0);
    near(shot.dz, 0);
    assert.ok(shot.extraDistance > 1);
  });

  test('the centre follows the lead facing', () => {
    // Triangle: the group's middle is behind the lead.
    const offsets = formationOffsets('triangle', 2);
    const front = groupShot(offsets, 0); // facing +Z: behind is -Z
    near(front.dx, 0);
    assert.ok(front.dz < 0);
    const turned = groupShot(offsets, Math.PI / 2); // facing +X: behind is -X
    assert.ok(turned.dx < 0);
    near(turned.dz, 0);
    near(turned.extraDistance, front.extraDistance);
    near(front.extraDistance, groupFraming(offsets).distance - SOLO_CAMERA_DISTANCE);
  });
});

describe('re-framing once the dancers are in', () => {
  test('nothing pending, nothing to do', () => {
    assert.equal(reframeDecision(null, 0, 3), 'none');
    assert.equal(reframeDecision(null, 2, 3), 'none');
  });

  test('waits while dancers load, then frames', () => {
    const pending = { cameraSerial: 4 };
    assert.equal(reframeDecision(pending, 2, 4), 'wait');
    assert.equal(reframeDecision(pending, 1, 4), 'wait');
    assert.equal(reframeDecision(pending, 0, 4), 'frame');
  });

  test('never steals the camera once the user has moved it', () => {
    const pending = { cameraSerial: 4 };
    assert.equal(reframeDecision(pending, 2, 5), 'skip');
    assert.equal(reframeDecision(pending, 0, 5), 'skip');
  });
});
