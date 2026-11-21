import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCrowdSim, DEFAULT_CROWD_CONFIG, type CrowdConfig, type CrowdEnv, type CrowdEvent, type CrowdNav } from './crowd';
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
const QUIET: Partial<CrowdConfig> = {
  greetChance: 0,
  gatherInterval: null,
  spawnInterval: [9999, 9999],
  stay: [9999, 9999],
};

function makeSim(overrides: Partial<CrowdConfig> = {}, seed = 11) {
  return createCrowdSim({ ...DEFAULT_CROWD_CONFIG, ...QUIET, random: seeded(seed), ...overrides });
}

function run(
  sim: ReturnType<typeof makeSim>,
  seconds: number,
  env: (t: number) => CrowdEnv | undefined,
  onTick?: (events: CrowdEvent[], t: number) => void
): void {
  for (let t = 0; t < seconds; t += DT) onTick?.(sim.tick(DT, [], env(t)), t);
}

function villageNav(): CrowdNav {
  const world = buildBlockWorld();
  return {
    spots: walkableCellsWithin(world, 15),
    gates: world.gates,
    findPath: (from, to) => findPath(world.nav, from, to, { radius: 0.3 }),
    isClear: (p) => isClearAt(world.nav, p, 0.24),
    plaza: world.plaza,
    restSpots: [...world.lampSides, ...world.doorsteps],
  };
}

describe('crowd in the rain', () => {
  test('walks mostly end at shelter spots (doorsteps, lamp posts); a drizzle changes nothing', () => {
    const nav = villageNav();
    const isRest = (p: { x: number; z: number }) => nav.restSpots!.some((s) => s.x === p.x && s.z === p.z);
    const count = (rain: number) => {
      const sim = makeSim({ nav, idle: [0.5, 1], emoteChance: 0 });
      sim.addAgentAt('a', 0.5, 0.5, 0);
      sim.addAgentAt('b', 3.5, 3.5, 0);
      let walks = 0;
      let toRest = 0;
      run(sim, 300, () => ({ rain }), (evs) => {
        for (const e of evs) {
          if (e.type !== 'phase' || e.phase !== 'walking') continue;
          const agent = sim.get(e.id)!;
          const goal = agent.path[agent.path.length - 1] ?? agent.target!;
          walks++;
          if (isRest(goal)) toRest++;
        }
      });
      return { walks, toRest };
    };
    const dry = count(0);
    const wet = count(1);
    assert.ok(wet.walks > 5);
    assert.ok(wet.toRest / wet.walks > 0.7, `rain ${wet.toRest}/${wet.walks}`);
    assert.ok(dry.toRest / dry.walks < 0.3, `dry ${dry.toRest}/${dry.walks}`);
    assert.deepEqual(count(0.3), dry, 'below the threshold is a dry day');
  });

  test('no gathering is called while it rains; they come back when it stops', () => {
    const sim = makeSim({ gatherInterval: [1, 1], performDuration: [5, 5] }, 7);
    sim.addAgentAt('a', -4, -4, 0);
    sim.addAgentAt('b', 4, -4, 0);
    sim.addAgentAt('c', 4, 4, 0);
    sim.addAgentAt('d', -4, 4, 0);
    let duringRain = 0;
    let after = 0;
    run(sim, 80, (t) => ({ rain: t < 40 ? 1 : 0 }), (evs, t) => {
      for (const e of evs) {
        if (e.type !== 'gathering' || e.stage !== 'invited') continue;
        if (t < 40) duringRain++;
        else after++;
      }
    });
    assert.equal(duringRain, 0);
    assert.ok(after >= 1);
  });

  test('no rain level given means dry', () => {
    const trace = (env: CrowdEnv | undefined) => {
      const sim = makeSim({ idle: [0.5, 1] });
      sim.addAgentAt('a', 0.5, 0.5, 0);
      run(sim, 30, () => env);
      const a = sim.get('a')!;
      return [a.x, a.z, a.phase];
    };
    assert.deepEqual(trace({ rain: 0 }), trace(undefined));
    assert.deepEqual(trace({ night: 0 }), trace(undefined));
  });
});
