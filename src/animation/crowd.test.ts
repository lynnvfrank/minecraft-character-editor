import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCrowdSim, DEFAULT_CROWD_CONFIG, type CrowdConfig, type CrowdEvent } from './crowd';

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

function makeSim(overrides: Partial<CrowdConfig> = {}) {
  return createCrowdSim({ ...DEFAULT_CROWD_CONFIG, random: seeded(42), ...overrides });
}

/** Run the sim, auto-spawning on request (models "load" instantly). */
function run(sim: ReturnType<typeof makeSim>, seconds: number, dt = 1 / 30, onTick?: (e: CrowdEvent[]) => void) {
  for (let t = 0; t < seconds; t += dt) {
    const events = sim.tick(dt);
    for (const e of events) {
      if (e.type === 'spawn-request') {
        const id = sim.reserve();
        if (id) sim.activate(id);
      }
    }
    onTick?.(events);
  }
}

describe('crowd sim', () => {
  test('spawns up to maxAgents and no more', () => {
    const sim = makeSim({ maxAgents: 3, spawnInterval: [0.2, 0.3] });
    let max = 0;
    run(sim, 20, 1 / 30, () => (max = Math.max(max, sim.size())));
    assert.equal(max, 3);
    assert.equal(sim.reserve() === null || sim.size() <= 3, true);
  });

  test('reserve() refuses when full; loading agents count toward the limit', () => {
    const sim = makeSim({ maxAgents: 2 });
    assert.ok(sim.reserve());
    assert.ok(sim.reserve());
    assert.equal(sim.reserve(), null);
    assert.ok(sim.list().every((a) => a.phase === 'loading'));
  });

  test('loading agents stay put until activated, then enter the zone', () => {
    const sim = makeSim({ maxAgents: 1 });
    const id = sim.reserve()!;
    const before = { ...sim.get(id)! };
    sim.tick(1);
    assert.equal(sim.get(id)!.x, before.x);
    assert.equal(Math.hypot(before.x, before.z).toFixed(6), DEFAULT_CROWD_CONFIG.edgeRadius.toFixed(6));
    sim.activate(id);
    assert.equal(sim.get(id)!.phase, 'entering');
    const target = sim.get(id)!.target!;
    assert.ok(Math.hypot(target.x, target.z) <= DEFAULT_CROWD_CONFIG.zoneRadius);
  });

  test('agents wander inside the zone, then leave and despawn at the edge', () => {
    const cfg = { maxAgents: 1, stay: [10, 10] as const, spawnInterval: [999, 999] as const };
    const sim = makeSim(cfg);
    const phases: string[] = [];
    let despawned = false;
    let maxRadiusWhileStaying = 0;
    run(sim, 120, 1 / 30, (events) => {
      for (const e of events) {
        if (e.type === 'phase') phases.push(e.phase);
        if (e.type === 'despawn') despawned = true;
      }
      const a = sim.list()[0];
      if (a && a.phase !== 'entering' && a.phase !== 'exiting' && a.phase !== 'loading') {
        maxRadiusWhileStaying = Math.max(maxRadiusWhileStaying, Math.hypot(a.x, a.z));
      }
    });
    assert.equal(phases[0], 'entering');
    assert.ok(phases.includes('exiting'), `phases: ${phases.join(',')}`);
    assert.ok(phases.some((p) => p === 'idling' || p === 'emoting'));
    assert.ok(despawned);
    assert.ok(maxRadiusWhileStaying <= DEFAULT_CROWD_CONFIG.zoneRadius + 1e-6);
  });

  test('emoting phases carry an emote from the config', () => {
    const sim = makeSim({ maxAgents: 2, emoteChance: 1, emotes: ['waving'] });
    const emotes = new Set<string | null>();
    run(sim, 60, 1 / 30, (events) => {
      for (const e of events) if (e.type === 'phase' && e.phase === 'emoting') emotes.add(e.emote);
    });
    assert.deepEqual([...emotes], ['waving']);
  });

  test('held agents do not move; release resumes', () => {
    const sim = makeSim({ maxAgents: 1 });
    const id = sim.reserve()!;
    sim.activate(id);
    sim.tick(0.5);
    sim.hold(id);
    const { x, z } = sim.get(id)!;
    sim.tick(5);
    assert.equal(sim.get(id)!.x, x);
    assert.equal(sim.get(id)!.z, z);
    sim.release(id);
    assert.equal(sim.get(id)!.phase, 'entering');
    sim.tick(1);
    assert.notEqual(sim.get(id)!.x, x);
  });

  test('addAgentAt hands a standing character to the crowd', () => {
    const sim = makeSim({ maxAgents: 3 });
    const a = sim.addAgentAt('runningboy-old', 1, 2, 0.5);
    assert.equal(a.phase, 'idling');
    assert.equal(sim.size(), 1);
    assert.ok(sim.remove('runningboy-old'));
    assert.equal(sim.size(), 0);
  });
});
