import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCrowdSim, DEFAULT_CROWD_CONFIG, type CrowdConfig, type CrowdEvent, type CrowdNav } from './crowd';
import { assignSpots, pairKey, pickSome, ringSpots } from './crowdSocial';
import { wrapAngle, yawToward } from './wander';
import { buildBlockWorld, walkableCellsWithin } from '../domain/blockWorld';
import { findPath, isClearAt } from '../lib/gridPath';

/** Deterministic PRNG (mulberry32) so runs are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 30;
/** Nobody comes or goes by themselves, nothing social unless a test turns it on. */
const QUIET: Partial<CrowdConfig> = {
  greetChance: 0,
  gatherInterval: null,
  spawnInterval: [9999, 9999],
  stay: [9999, 9999],
};

function makeSim(overrides: Partial<CrowdConfig> = {}, seed = 7) {
  return createCrowdSim({ ...DEFAULT_CROWD_CONFIG, ...QUIET, random: seeded(seed), ...overrides });
}

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, onTick?: (events: CrowdEvent[], t: number) => void, night = 0): CrowdEvent[] {
  const all: CrowdEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const events = sim.tick(DT, [], { night });
    all.push(...events);
    onTick?.(events, t);
  }
  return all;
}

const facingError = (from: { x: number; z: number; facing: number }, to: { x: number; z: number }) =>
  Math.abs(wrapAngle(yawToward(from, to) - from.facing));

function villageNav(): CrowdNav {
  const world = buildBlockWorld();
  const spots = walkableCellsWithin(world, 15);
  return {
    spots,
    gates: world.gates,
    findPath: (from, to) => findPath(world.nav, from, to, { radius: 0.3 }),
    isClear: (p) => isClearAt(world.nav, p, 0.24),
    plaza: world.plaza,
    restSpots: [...world.lampSides, ...world.doorsteps],
  };
}

describe('crowd social helpers', () => {
  test('pairKey ignores order', () => {
    assert.equal(pairKey('crowd-2', 'crowd-1'), pairKey('crowd-1', 'crowd-2'));
    assert.notEqual(pairKey('a', 'b'), pairKey('a', 'c'));
  });

  test('ringSpots are evenly spaced around the centre and grow to keep the gap', () => {
    const c = { x: 2, z: -1 };
    const spots = ringSpots(c, 4, 1.3, 0.4);
    assert.equal(spots.length, 4);
    for (const s of spots) assert.ok(Math.abs(Math.hypot(s.x - c.x, s.z - c.z) - 1.3) < 1e-9);
    const wide = ringSpots(c, 4, 0.2, 0, 1);
    assert.ok(Math.hypot(wide[0]!.x - wide[1]!.x, wide[0]!.z - wide[1]!.z) >= 1 - 1e-9);
    assert.deepEqual(ringSpots(c, 0, 1), []);
  });

  test('assignSpots hands out each spot once, nearest first', () => {
    const spots = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
    assert.deepEqual(assignSpots([{ x: 9, z: 0 }, { x: 8, z: 0 }], spots), [1, 0]);
    assert.deepEqual(assignSpots([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }], spots), [0, 1, -1]);
  });

  test('pickSome takes distinct items and never more than there are', () => {
    const picked = pickSome(['a', 'b', 'c', 'd'], 3, seeded(1));
    assert.equal(new Set(picked).size, 3);
    assert.equal(pickSome(['a'], 3, seeded(1)).length, 1);
    assert.deepEqual(pickSome(['a', 'b'], 1, () => 0.999999), ['b']);
  });
});

describe('crowd greetings', () => {
  const GREET: Partial<CrowdConfig> = { greetChance: 1, idle: [60, 60] };

  test('two agents that meet stop, face each other, say hello and answer, then carry on', () => {
    const sim = makeSim(GREET);
    const a = sim.addAgentAt('a', 0, 0, 0);
    const b = sim.addAgentAt('b', 1.2, 0, 0);
    const first = sim.tick(DT);
    const greet = first.find((e) => e.type === 'greet');
    assert.ok(greet && greet.type === 'greet');
    assert.deepEqual([greet.greeter, greet.answerer].sort(), ['a', 'b']);
    assert.equal(a.phase, 'greeting');
    assert.equal(b.phase, 'greeting');
    assert.equal(a.partner, 'b');
    assert.equal(b.partner, 'a');

    const phases = first.filter((e) => e.type === 'phase');
    const hello = phases.find((e) => e.type === 'phase' && e.id === greet.greeter);
    const waiting = phases.find((e) => e.type === 'phase' && e.id === greet.answerer);
    assert.ok(hello?.type === 'phase' && DEFAULT_CROWD_CONFIG.greetEmotes.includes(hello.emote!));
    assert.ok(waiting?.type === 'phase' && waiting.phase === 'greeting' && waiting.emote === null);

    // The answer starts after the reply delay, with a reply emote.
    let replyAt = -1;
    let replyEmote: string | null = null;
    const events = run(sim, 2, (evs, t) => {
      for (const e of evs) {
        if (e.type === 'phase' && e.id === greet.answerer && e.phase === 'greeting' && e.emote) {
          replyAt = t;
          replyEmote = e.emote;
        }
      }
    });
    assert.ok(Math.abs(replyAt - DEFAULT_CROWD_CONFIG.greetReplyDelay) < 0.1, `reply at ${replyAt}`);
    assert.ok(DEFAULT_CROWD_CONFIG.replyEmotes.includes(replyEmote!));
    assert.equal(events.filter((e) => e.type === 'greet').length, 0);
    // Standing still, turned to each other.
    assert.equal(a.x, 0);
    assert.equal(b.x, 1.2);
    assert.ok(facingError(a, b) < 0.05);
    assert.ok(facingError(b, a) < 0.05);

    // Over within hello + reply delay; both go for a walk.
    const [, maxHello] = DEFAULT_CROWD_CONFIG.greetDuration;
    const after = run(sim, maxHello + DEFAULT_CROWD_CONFIG.greetReplyDelay);
    for (const id of ['a', 'b']) {
      assert.ok(after.some((e) => e.type === 'phase' && e.id === id && e.phase === 'walking'), `${id} walked on`);
    }
    assert.notEqual(a.phase, 'greeting');
    assert.notEqual(b.phase, 'greeting');
    assert.equal(a.partner, null);
    assert.equal(b.partner, null);
  });

  test('the same two do not greet again until the pair cooldown has passed', () => {
    const sim = makeSim({ ...GREET, greetPairCooldown: 30, greetRest: 1, walkSpeed: 0 });
    sim.addAgentAt('a', 0, 0, 0);
    sim.addAgentAt('b', 1.2, 0, 0);
    const greetTimes: number[] = [];
    run(sim, 70, (evs, t) => {
      if (evs.some((e) => e.type === 'greet')) greetTimes.push(t);
    });
    assert.ok(greetTimes.length >= 2, `greeted ${greetTimes.length} times`);
    for (let i = 1; i < greetTimes.length; i++) assert.ok(greetTimes[i]! - greetTimes[i - 1]! >= 30 - DT);
  });

  test('agents far apart, entering or leaving are left alone; chance 0 turns greetings off', () => {
    const far = makeSim(GREET);
    far.addAgentAt('a', 0, 0, 0);
    far.addAgentAt('b', 6, 0, 0);
    assert.equal(run(far, 1).filter((e) => e.type === 'greet').length, 0);

    const off = makeSim({ idle: [60, 60] });
    off.addAgentAt('a', 0, 0, 0);
    off.addAgentAt('b', 1, 0, 0);
    assert.equal(run(off, 5).filter((e) => e.type === 'greet').length, 0);

    const entering = makeSim({ ...GREET, maxAgents: 2 });
    entering.addAgentAt('a', 0, 0, 0);
    const id = entering.reserve({ x: 1, z: 0 })!;
    entering.activate(id);
    assert.equal(entering.get(id)!.phase, 'entering');
    assert.equal(entering.tick(DT).filter((e) => e.type === 'greet').length, 0);
  });

  test('selecting (removing) one of the two frees the other at once', () => {
    const sim = makeSim(GREET);
    sim.addAgentAt('a', 0, 0, 0);
    const b = sim.addAgentAt('b', 1.2, 0, 0);
    sim.tick(DT);
    assert.equal(b.phase, 'greeting');
    assert.equal(sim.remove('a'), true);
    assert.equal(b.phase, 'walking');
    assert.equal(b.partner, null);
    // The controller hears about it on the next tick.
    assert.ok(sim.tick(DT).some((e) => e.type === 'phase' && e.id === 'b' && e.phase === 'walking'));
  });

  test('a greeting never outlasts its timer, whatever happens to the partner', () => {
    const sim = makeSim(GREET);
    const a = sim.addAgentAt('a', 0, 0, 0);
    const b = sim.addAgentAt('b', 1.2, 0, 0);
    sim.tick(DT);
    // Partner wanders off by other means (held by a tool).
    sim.hold('a');
    assert.equal(a.phase, 'held');
    assert.equal(b.phase, 'walking');
  });
});

describe('crowd plaza gatherings', () => {
  const GATHER: Partial<CrowdConfig> = { gatherInterval: [1, 1], performDuration: [5, 5] };

  function addFour(sim: Sim) {
    sim.addAgentAt('a', -4, -4, 0);
    sim.addAgentAt('b', 4, -4, 0);
    sim.addAgentAt('c', 4, 4, 0);
    sim.addAgentAt('d', -4, 4, 0);
  }

  test('2 to 4 agents walk to distinct spots around a centre, face it, perform together, then disperse', () => {
    const sim = makeSim(GATHER);
    addFour(sim);
    const stages: string[] = [];
    let invited: string[] = [];
    let performers: string[] = [];
    let checkedWhilePerforming = false;
    run(sim, 60, (evs) => {
      for (const e of evs) {
        if (e.type !== 'gathering' || e.id !== 1) continue;
        stages.push(e.stage);
        if (e.stage === 'invited') invited = e.ids;
        if (e.stage === 'performing') performers = e.ids;
      }
      const g = sim.gathering();
      if (g?.id === 1 && g.stage === 'performing' && g.timer < 3 && !checkedWhilePerforming) {
        checkedWhilePerforming = true;
        const members = g.members.map((id) => sim.get(id)!);
        for (const m of members) {
          assert.equal(m.phase, 'performing');
          assert.ok(DEFAULT_CROWD_CONFIG.danceEmotes.includes(m.emote!));
          assert.equal(m.emote, members[0]!.emote, 'the whole group dances the same clip');
          assert.ok(Math.abs(Math.hypot(m.x - g.center.x, m.z - g.center.z) - DEFAULT_CROWD_CONFIG.gatherRadius) < 0.1);
          assert.ok(facingError(m, g.center) < 0.05);
        }
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++) {
            const d = Math.hypot(members[i]!.x - members[j]!.x, members[i]!.z - members[j]!.z);
            assert.ok(d >= DEFAULT_CROWD_CONFIG.personalSpace, `spots ${d} apart`);
          }
        }
      }
    });
    assert.deepEqual(stages.slice(0, 3), ['invited', 'performing', 'ended']);
    assert.ok(invited.length >= 2 && invited.length <= 4);
    assert.equal(new Set(invited).size, invited.length);
    assert.deepEqual([...performers].sort(), [...invited].sort());
    assert.ok(checkedWhilePerforming);
  });

  test('performing lasts performDuration, then everyone walks off and nobody stays in the group', () => {
    const sim = makeSim(GATHER, 3);
    addFour(sim);
    let start = -1;
    let end = -1;
    run(sim, 60, (evs, t) => {
      for (const e of evs) {
        if (e.type !== 'gathering' || e.id !== 1) continue;
        if (e.stage === 'performing') start = t;
        if (e.stage !== 'ended') continue;
        end = t;
        assert.equal(sim.gathering(), null);
        for (const a of sim.list()) {
          assert.equal(a.group, null);
          assert.ok(!['gathering', 'waiting', 'performing'].includes(a.phase), a.phase);
        }
      }
    });
    assert.ok(start > 0 && end > start);
    assert.ok(Math.abs(end - start - 5) < 0.1, `performed for ${end - start}s`);
  });

  test('needs at least two free agents; one alone is never invited', () => {
    const sim = makeSim(GATHER);
    sim.addAgentAt('a', 0, 0, 0);
    assert.equal(run(sim, 30).filter((e) => e.type === 'gathering').length, 0);
  });

  test('on the village map the group meets on the stone plaza and nobody stands in a wall', () => {
    const nav = villageNav();
    assert.ok(nav.plaza!.length > 0);
    const sim = makeSim({ ...GATHER, nav });
    sim.addAgentAt('a', -8.5, 0.5, 0);
    sim.addAgentAt('b', 8.5, 0.5, 0);
    sim.addAgentAt('c', 0.5, 8.5, 0);
    let center: { x: number; z: number } | null = null;
    let performed = false;
    run(sim, 90, (evs) => {
      for (const e of evs) {
        if (e.type !== 'gathering') continue;
        if (e.stage === 'invited' && !center) center = e.center;
        if (e.stage === 'performing') performed = true;
      }
      for (const a of sim.list()) assert.ok(nav.isClear!(a), `agent in a wall at ${a.x},${a.z}`);
    });
    assert.ok(center);
    assert.ok(nav.plaza!.some((p) => p.x === center!.x && p.z === center!.z));
    assert.ok(performed);
  });

  test('a ring spot is never put on top of an outside character (the selected one)', () => {
    const sim = makeSim({ ...GATHER, gatherInterval: [1, 1] });
    addFour(sim);
    const body = { x: 0, z: 0 };
    const ps = DEFAULT_CROWD_CONFIG.personalSpace;
    for (let t = 0; t < 40; t += DT) {
      sim.tick(DT, [body]);
      const g = sim.gathering();
      if (!g) continue;
      for (const id of g.members) {
        const target = sim.get(id)?.target;
        if (target && sim.get(id)!.path.length === 0) {
          assert.ok(Math.hypot(target.x - body.x, target.z - body.z) >= ps - 1e-9);
        }
      }
    }
  });

  test('removing a member while the group assembles: the gathering breaks up and the other moves on', () => {
    const sim = makeSim({ ...GATHER, gatherSize: [2, 2] });
    sim.addAgentAt('a', -5, 0, 0);
    sim.addAgentAt('b', 5, 0, 0);
    run(sim, 1.2);
    const g = sim.gathering();
    assert.ok(g && g.stage === 'assembling');
    assert.equal(sim.get('a')!.phase, 'gathering');
    sim.remove('a');
    assert.equal(sim.gathering(), null);
    const b = sim.get('b')!;
    assert.equal(b.group, null);
    assert.ok(b.phase === 'walking' || b.phase === 'idling' || b.phase === 'emoting');
    assert.ok(sim.tick(DT).some((e) => e.type === 'gathering' && e.stage === 'ended'));
  });

  test('removing a member mid-performance: the rest finish their dance', () => {
    const sim = makeSim({ ...GATHER, gatherSize: [4, 4] });
    addFour(sim);
    let removed = false;
    let ended: string[] | null = null;
    run(sim, 60, (evs) => {
      const g = sim.gathering();
      if (!removed && g?.stage === 'performing') {
        removed = true;
        sim.remove(g.members[0]!);
        assert.equal(sim.gathering()?.members.length, 3);
        assert.equal(sim.gathering()?.stage, 'performing');
      }
      for (const e of evs) if (e.type === 'gathering' && e.id === 1 && e.stage === 'ended') ended = e.ids;
    });
    assert.ok(removed);
    assert.equal(ended!.length, 3);
    assert.equal(sim.size(), 3);
  });

  test('a straggler who never arrives does not hold the group up', () => {
    const sim = makeSim({ ...GATHER, gatherSize: [3, 3], gatherAssembleTimeout: 6 });
    sim.addAgentAt('a', -2, 0, 0);
    sim.addAgentAt('b', 2, 0, 0);
    sim.addAgentAt('far', 0, 5.5, 0);
    let performers: string[] = [];
    run(sim, 1.2);
    const g = sim.gathering();
    assert.ok(g && g.members.includes('far'));
    // Pin the far one in place (as if blocked): it can't make it in time.
    const far = sim.get('far')!;
    run(sim, 12, (evs) => {
      if (far.phase === 'gathering') {
        far.x = 0;
        far.z = 5.5;
      }
      for (const e of evs) {
        if (e.type !== 'gathering' || e.id !== 1 || e.stage !== 'performing') continue;
        performers = e.ids;
        assert.equal(far.group, null);
        assert.notEqual(far.phase, 'gathering');
      }
    });
    assert.deepEqual([...performers].sort(), ['a', 'b']);
  });
});

describe('crowd night routine', () => {
  test('after dark, walks mostly end at rest spots (lamp posts, doorsteps)', () => {
    const nav = villageNav();
    const isRest = (p: { x: number; z: number }) => nav.restSpots!.some((s) => s.x === p.x && s.z === p.z);
    const count = (night: number) => {
      const sim = makeSim({ nav, idle: [0.5, 1], emoteChance: 0 }, 11);
      sim.addAgentAt('a', 0.5, 0.5, 0);
      sim.addAgentAt('b', 3.5, 3.5, 0);
      let walks = 0;
      let toRest = 0;
      run(sim, 400, (evs) => {
        for (const e of evs) {
          if (e.type !== 'phase' || e.phase !== 'walking') continue;
          const agent = sim.get(e.id)!;
          const goal = agent.path[agent.path.length - 1] ?? agent.target!;
          walks++;
          if (isRest(goal)) toRest++;
        }
      }, night);
      return { walks, toRest };
    };
    const day = count(0);
    const night = count(1);
    assert.ok(night.walks > 5);
    assert.ok(night.toRest / night.walks > 0.6, `night ${night.toRest}/${night.walks}`);
    assert.ok(day.toRest / day.walks < 0.3, `day ${day.toRest}/${day.walks}`);
    assert.ok(night.walks < day.walks, 'residents wander less at night');
  });

  test('night emotes are the sleepy ones, pauses are longer and walking is slower', () => {
    const emotes = new Set<string>();
    const sim = makeSim({ emoteChance: 1 }, 5);
    sim.addAgentAt('a', 0, 0, 0);
    sim.addAgentAt('b', 3, 3, 0);
    run(sim, 200, (evs) => {
      for (const e of evs) if (e.type === 'phase' && e.phase === 'emoting') emotes.add(e.emote!);
    }, 1);
    assert.ok(emotes.size > 0);
    for (const e of emotes) assert.ok(DEFAULT_CROWD_CONFIG.nightEmotes.includes(e), e);

    const travelled = (night: number) => {
      const s = makeSim({ idle: [0, 0], emoteChance: 0, walkSpeed: 1, turnRate: 1000 }, 9);
      const a = s.addAgentAt('a', 0, 0, 0);
      a.timer = 0;
      s.tick(DT, [], { night }); // starts a walk (at night it may pause again; walk it by hand)
      a.phase = 'walking';
      a.target = { x: 0, z: 100 };
      a.path = [];
      const z0 = a.z;
      for (let i = 0; i < 30; i++) s.tick(DT, [], { night });
      return a.z - z0;
    };
    const day = travelled(0);
    const night = travelled(1);
    assert.ok(Math.abs(day - 1) < 0.05, `day ${day}`);
    assert.ok(Math.abs(night - 0.8) < 0.05, `night ${night}`);
  });

  test('no night level given means day', () => {
    const trace = (env: { night?: number } | undefined) => {
      const sim = makeSim({}, 21);
      sim.addAgentAt('a', 0, 0, 0);
      sim.addAgentAt('b', 3, 3, 0);
      for (let t = 0; t < 60; t += DT) sim.tick(DT, [], env);
      return sim.list().map((a) => `${a.phase}:${a.x.toFixed(4)}:${a.z.toFixed(4)}`);
    };
    assert.deepEqual(trace({ night: 0 }), trace(undefined));
    assert.deepEqual(trace({}), trace(undefined));
  });

  test('someone standing around gets a visit, which ends in a greeting', () => {
    const sim = makeSim({ greetChance: 1, visitChance: 1, idle: [0.5, 0.5], emoteChance: 0 }, 2);
    const host = sim.addAgentAt('host', 0, 0, 0);
    host.timer = 9999;
    const guest = sim.addAgentAt('guest', 5, 0, 0);
    let greetedAt: number | null = null;
    run(sim, 20, (evs) => {
      if (greetedAt == null && evs.some((e) => e.type === 'greet')) greetedAt = Math.hypot(guest.x - host.x, guest.z - host.z);
    });
    assert.ok(greetedAt != null, 'they greeted');
    assert.ok(greetedAt! <= DEFAULT_CROWD_CONFIG.greetDistance && greetedAt! >= DEFAULT_CROWD_CONFIG.personalSpace);
  });
});

describe('crowd with everything on (defaults)', () => {
  test('a busy village greets, gathers, keeps its distance and nobody gets stuck in an activity', () => {
    const nav = villageNav();
    const sim = createCrowdSim({
      ...DEFAULT_CROWD_CONFIG,
      nav,
      random: seeded(1234),
      spawnInterval: [1, 2],
      gatherInterval: [15, 30],
    });
    let greets = 0;
    let performed = 0;
    let minDist = Infinity;
    const social = new Map<string, { phase: string; since: number }>();
    const longest = DEFAULT_CROWD_CONFIG.gatherAssembleTimeout + DEFAULT_CROWD_CONFIG.performDuration[1] + 1;
    for (let t = 0; t < 900; t += DT) {
      // Night falls halfway through.
      for (const e of sim.tick(DT, [], { night: t > 450 ? 1 : 0 })) {
        if (e.type === 'spawn-request') {
          const id = sim.reserve();
          if (id) sim.activate(id);
        }
        if (e.type === 'greet') greets++;
        if (e.type === 'gathering' && e.stage === 'performing') performed++;
      }
      const list = sim.list();
      for (const a of list) {
        assert.ok(nav.isClear!(a), `agent in a wall at ${a.x},${a.z}`);
        const isSocial = ['greeting', 'gathering', 'waiting', 'performing'].includes(a.phase);
        const seen = social.get(a.id);
        if (!isSocial) social.delete(a.id);
        else if (!seen || seen.phase !== a.phase) social.set(a.id, { phase: a.phase, since: t });
        else assert.ok(t - seen.since <= longest, `${a.id} stuck in ${a.phase}`);
        if (a.phase === 'greeting') assert.ok(a.partner && sim.get(a.partner)?.partner === a.id);
      }
      // In the village (a newcomer may appear at a gate just as someone walks out through it).
      const inside = list.filter((a) => !['loading', 'entering', 'exiting'].includes(a.phase));
      for (let i = 0; i < inside.length; i++) {
        for (let j = i + 1; j < inside.length; j++) {
          minDist = Math.min(minDist, Math.hypot(inside[i]!.x - inside[j]!.x, inside[i]!.z - inside[j]!.z));
        }
      }
    }
    assert.ok(greets > 3, `greets ${greets}`);
    assert.ok(performed > 3, `gatherings ${performed}`);
    assert.ok(minDist > DEFAULT_CROWD_CONFIG.personalSpace * 0.9, `closest ${minDist}`);
  });
});
