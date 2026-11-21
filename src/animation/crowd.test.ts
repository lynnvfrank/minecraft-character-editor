import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCrowdSim, DEFAULT_CROWD_CONFIG, type CrowdConfig, type CrowdEvent } from './crowd';
import { createNavGrid, findPath, isClearAt, setBlocked } from '../lib/gridPath';

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
  // Greetings and gatherings are off here (they have their own tests in crowdSocial.test.ts).
  return createCrowdSim({ ...DEFAULT_CROWD_CONFIG, greetChance: 0, gatherInterval: null, random: seeded(42), ...overrides });
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

  test('with navigation, agents come in through a gate and never walk through a wall', () => {
    // 12×12 open field (centered on the origin) with a wall across the middle and a gap at one end.
    const grid = createNavGrid(12, 12, -6, -6, 1);
    for (let c = 0; c < 10; c++) setBlocked(grid, c, 6);
    const spots = [{ x: -4.5, z: -4.5 }, { x: -4.5, z: 4.5 }, { x: 3.5, z: -3.5 }, { x: 2.5, z: 3.5 }];
    const gates = [{ x: -5.5, z: -5.5 }];
    const sim = makeSim({
      maxAgents: 2,
      stay: [10, 20],
      nav: { spots, gates, findPath: (a, b) => findPath(grid, a, b, { radius: 0.3 }) },
    });
    const ids = new Set<string>();
    let despawned = 0;
    for (let i = 0; i < 4000; i++) {
      for (const e of sim.tick(0.05)) {
        if (e.type === 'spawn-request') {
          const id = sim.reserve();
          if (id) {
            assert.deepEqual({ x: sim.get(id)!.x, z: sim.get(id)!.z }, gates[0]);
            sim.activate(id);
            ids.add(id);
          }
        }
        if (e.type === 'despawn') despawned++;
      }
      for (const a of sim.list()) {
        // Body center may brush a wall corner at most by the turn-in-place tolerance.
        assert.ok(isClearAt(grid, a, 0.25), `agent ${a.id} inside a wall at ${a.x.toFixed(2)},${a.z.toFixed(2)}`);
      }
    }
    assert.ok(ids.size >= 2, 'agents spawned');
    assert.ok(despawned >= 1, 'agents left through the gate');
  });

  /** Smallest center-to-center distance between any two active agents (and outside bodies). */
  function minSpacing(sim: ReturnType<typeof makeSim>, bodies: { x: number; z: number }[] = []): number {
    const pts = [...sim.list().filter((a) => a.phase !== 'loading'), ...bodies];
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z));
    }
    return min;
  }

  /** Spawn on request and activate right away, like the controller once models are loaded. */
  function runCrowd(sim: ReturnType<typeof makeSim>, seconds: number, onTick: () => void, bodies: { x: number; z: number }[] = []) {
    for (let t = 0; t < seconds; t += 0.05) {
      for (const e of sim.tick(0.05, bodies)) {
        if (e.type === 'spawn-request') {
          const id = sim.reserve();
          if (id) sim.activate(id);
        }
      }
      onTick();
    }
  }

  test('a busy crowd keeps its personal space', () => {
    // Small zone and many agents so paths cross constantly.
    const sim = makeSim({ maxAgents: 8, zoneRadius: 3, spawnInterval: [0.3, 0.8], stay: [20, 40] });
    const ps = DEFAULT_CROWD_CONFIG.personalSpace;
    let worst = Infinity;
    let busiest = 0;
    runCrowd(sim, 120, () => {
      worst = Math.min(worst, minSpacing(sim));
      busiest = Math.max(busiest, sim.list().filter((a) => a.phase !== 'loading').length);
    });
    assert.ok(busiest >= 6, `crowd got busy (${busiest})`);
    assert.ok(worst > ps * 0.9, `two agents got within ${worst.toFixed(2)} (personal space ${ps})`);
  });

  test('two agents walking head-on pass each other instead of stalling', () => {
    const sim = makeSim({ maxAgents: 0 });
    const a = sim.addAgentAt('a', -3, 0, Math.PI / 2);
    const b = sim.addAgentAt('b', 3, 0, -Math.PI / 2);
    // Send them straight at each other along the same line.
    for (const [agent, x] of [[a, 3], [b, -3]] as const) {
      agent.phase = 'walking';
      agent.target = { x, z: 0 };
      agent.prevDist = Infinity;
    }
    let minGap = Infinity;
    for (let t = 0; t < 15 && (a.phase === 'walking' || b.phase === 'walking'); t += 0.05) {
      sim.tick(0.05);
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.z - b.z));
    }
    assert.ok(a.x > 2.9 && b.x < -2.9, `they got past each other (a.x=${a.x.toFixed(2)}, b.x=${b.x.toFixed(2)})`);
    assert.ok(minGap > DEFAULT_CROWD_CONFIG.personalSpace * 0.9, `closest ${minGap.toFixed(2)}`);
  });

  test('the crowd keeps clear of an outside body and walks around it', () => {
    const sim = makeSim({ maxAgents: 6, zoneRadius: 3, spawnInterval: [0.3, 0.8], stay: [20, 40] });
    const body = { x: 0, z: 0 };
    let worst = Infinity;
    runCrowd(sim, 90, () => {
      for (const a of sim.list()) if (a.phase !== 'loading') worst = Math.min(worst, Math.hypot(a.x, a.z));
    }, [body]);
    assert.ok(worst > DEFAULT_CROWD_CONFIG.personalSpace * 0.9, `agent came within ${worst.toFixed(2)} of the body`);
  });

  test('an idle agent bumped by an outside body walks off', () => {
    const sim = makeSim({ maxAgents: 0 });
    const a = sim.addAgentAt('a', 0.3, 0, 0);
    a.timer = 100;
    sim.tick(0.05, [{ x: 0, z: 0 }]);
    assert.equal(a.phase, 'walking');
    assert.ok(Math.hypot(a.x, a.z) >= DEFAULT_CROWD_CONFIG.personalSpace * 0.99);
  });

  test('a walker blocked for good gives up and picks something else', () => {
    // Corridor one cell wide, with someone standing in it for ever.
    const grid = createNavGrid(9, 3, -4.5, -1.5, 1);
    for (let c = 0; c < 9; c++) { setBlocked(grid, c, 0); setBlocked(grid, c, 2); }
    const nav = {
      spots: [{ x: 3, z: 0 }, { x: -3, z: 0 }],
      gates: [],
      findPath: (p: { x: number; z: number }, q: { x: number; z: number }) => findPath(grid, p, q),
      isClear: (p: { x: number; z: number }) => isClearAt(grid, p, 0.2),
    };
    const sim = makeSim({ maxAgents: 0, nav });
    const blocker = sim.addAgentAt('blocker', 0, 0, 0);
    sim.hold(blocker.id);
    const w = sim.addAgentAt('walker', -3, 0, Math.PI / 2);
    w.phase = 'walking';
    w.target = { x: 3, z: 0 };
    w.prevDist = Infinity;
    for (let t = 0; t < 8; t += 0.05) sim.tick(0.05);
    assert.notEqual(w.phase, 'walking', 'still pushing against the blocker');
    assert.ok(w.x < -0.5, 'never walked through the blocker');
  });

  test('reserve(at) starts the agent at that spot and still respects maxAgents', () => {
    const sim = makeSim({ maxAgents: 1 });
    const id = sim.reserve({ x: 1.5, z: -2 });
    assert.ok(id);
    const a = sim.get(id)!;
    assert.deepEqual([a.x, a.z, a.phase], [1.5, -2, 'loading']);
    assert.equal(sim.reserve({ x: 0, z: 0 }), null);
    sim.activate(id);
    assert.equal(a.phase, 'entering');
  });

  test('navChanged moves agents off newly blocked ground and re-plans walks around it', () => {
    const grid = createNavGrid(12, 12, -6, -6, 1);
    const spots = [{ x: -4.5, z: 0.5 }, { x: 4.5, z: 0.5 }];
    const sim = makeSim({
      maxAgents: 2,
      stay: [100, 200],
      idle: [100, 200],
      nav: { spots, gates: [], findPath: (a, b) => findPath(grid, a, b, { radius: 0.3 }), isClear: (p) => isClearAt(grid, p, 0.24) },
    });
    // One walker heading east along z = 0.5, one idler standing at the origin cell.
    const walker = sim.addAgentAt('walker', -4.5, 0.5, 0);
    const idler = sim.addAgentAt('idler', 0.5, -3.5, 0);
    walker.phase = 'walking';
    walker.target = { x: 4.5, z: 0.5 };
    walker.path = [];
    // Build a wall across x = 0 (a gap at the north end) and on the idler's cell.
    for (let r = 1; r < 12; r++) setBlocked(grid, 6, r);
    const nudge = (p: { x: number; z: number }) => {
      const col = Math.floor(p.x + 6), row = Math.floor(p.z + 6);
      return grid.blocked[row * 12 + col] ? { x: 1.5, z: -3.5 } : null;
    };
    sim.navChanged(nudge);
    assert.deepEqual({ x: idler.x, z: idler.z }, { x: 1.5, z: -3.5 }, 'idler stepped off the wall');
    assert.equal(walker.phase, 'walking');
    const route = [walker.target!, ...walker.path];
    assert.ok(route.length >= 2, 'walk was re-planned around the wall');
    // Walk it out: nobody crosses the wall.
    for (let i = 0; i < 600; i++) {
      sim.tick(0.05);
      for (const a of sim.list()) assert.ok(isClearAt(grid, a, 0.25), `${a.id} inside the wall`);
    }
  });
});
