/**
 * Crowd simulation for the home "creative space": characters walk into a round zone, wander,
 * idle and emote for a while, then walk back out. Pure (no three.js, no timers) so it runs in
 * unit tests; controllers/crowdController.ts loads the models and plays the clips.
 *
 * Agent life cycle:
 *   loading → entering → (idling | emoting | walking)* → exiting → removed
 * `held` freezes an agent in place (unused by the home view today, kept for tests and tools).
 */
import { lerpAngleRad, wrapAngle, yawToward, type XZ } from './wander';

export type CrowdPhase = 'loading' | 'entering' | 'walking' | 'idling' | 'emoting' | 'exiting' | 'held';

export type CrowdAgent = {
  id: string;
  x: number;
  z: number;
  /** Yaw in radians; +Z is 0 (same convention as the animation manager). */
  facing: number;
  phase: CrowdPhase;
  target: XZ | null;
  /** Waypoints still to walk after `target` (only with navigation). */
  path: XZ[];
  /** Seconds left in the current idling/emoting phase. */
  timer: number;
  /** Seconds left before the agent heads for the exit. */
  stayLeft: number;
  emote: string | null;
  /** Phase to return to after `held` is released. */
  heldFrom: CrowdPhase | null;
};

export type CrowdConfig = {
  /** Agents wander inside this radius around the origin. */
  zoneRadius: number;
  /** Agents appear and disappear on this circle (outside the zone). */
  edgeRadius: number;
  maxAgents: number;
  /** [min, max] seconds an agent stays before leaving. */
  stay: readonly [number, number];
  /** [min, max] seconds between spawns while below maxAgents. */
  spawnInterval: readonly [number, number];
  idle: readonly [number, number];
  emoteDuration: readonly [number, number];
  /** Chance (0..1) that an arrival is followed by an emote instead of a plain idle. */
  emoteChance: number;
  emotes: readonly string[];
  /** World units per second. */
  walkSpeed: number;
  /** How fast facing steers toward the walk direction (higher = snappier). */
  turnRate: number;
  random?: () => number;
  nav?: CrowdNav;
};

/**
 * Walkable world for the crowd (optional). Without it agents walk straight lines inside a circle;
 * with it they pick spots on walkable ground, follow paths around obstacles, and come and go
 * through gates (e.g. road ends at the edge of the map).
 */
export type CrowdNav = {
  /** Candidate wander targets (walkable, reachable). */
  spots: readonly XZ[];
  /** Where agents appear and leave. */
  gates: readonly XZ[];
  /** Waypoints from `from` to `to` (excluding `from`), [] if already there, null if unreachable. */
  findPath: (from: XZ, to: XZ) => XZ[] | null;
};

export type CrowdEvent =
  | { type: 'spawn-request' }
  | { type: 'phase'; id: string; phase: CrowdPhase; emote: string | null }
  | { type: 'despawn'; id: string };

export const DEFAULT_CROWD_CONFIG: CrowdConfig = {
  zoneRadius: 6,
  edgeRadius: 14,
  maxAgents: 5,
  stay: [35, 80],
  spawnInterval: [4, 10],
  idle: [1.5, 4],
  emoteDuration: [2.5, 4.5],
  emoteChance: 0.55,
  emotes: [
    'waving',
    'clapping',
    'happy',
    'excited',
    'look-around',
    'thinking',
    'texting',
    'shrugging',
    'laughing',
    'hard-head-nod',
    'yawn',
    'acknowledging',
  ],
  walkSpeed: 0.9,
  turnRate: 6,
};

/** Within this distance of a target counts as arrived. */
const ARRIVE_EPSILON = 0.05;
/** Only walk forward once facing is within this angle of the target; turn in place before that. */
const WALK_ALIGN_RAD = Math.PI / 3;
/** Candidate targets per pick; the one farthest from other agents wins. */
const TARGET_SAMPLES = 5;

export type CrowdSim = ReturnType<typeof createCrowdSim>;

export function createCrowdSim(config: CrowdConfig = DEFAULT_CROWD_CONFIG) {
  const random = config.random ?? Math.random;
  const agents = new Map<string, CrowdAgent>();
  let nextId = 1;
  /** First spawn comes quickly so the space isn't empty on load. */
  let spawnTimer = 0.5;
  let events: CrowdEvent[] = [];

  const between = ([min, max]: readonly [number, number]) => min + random() * (max - min);

  function pointOnCircle(radius: number, angle: number): XZ {
    return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
  }

  /** A target inside the zone, spread away from other agents' positions and targets. */
  function pickZoneTarget(self: CrowdAgent): XZ {
    const nav = config.nav;
    const r = config.zoneRadius * 0.85;
    const others: XZ[] = [];
    for (const a of agents.values()) {
      if (a === self || a.phase === 'loading') continue;
      others.push({ x: a.x, z: a.z });
      if (a.target) others.push(a.target);
    }
    let best: XZ = { x: 0, z: 0 };
    let bestScore = -Infinity;
    for (let i = 0; i < TARGET_SAMPLES; i++) {
      const p =
        nav && nav.spots.length > 0
          ? nav.spots[Math.floor(random() * nav.spots.length)]!
          : pointOnCircle(r * Math.sqrt(random()), random() * Math.PI * 2);
      const nearest = others.reduce((m, o) => Math.min(m, Math.hypot(o.x - p.x, o.z - p.z)), Infinity);
      // Prefer spread out, but don't send agents across the whole zone every time.
      const travel = Math.hypot(p.x - self.x, p.z - self.z);
      const score = Math.min(nearest, 3) - travel * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  function setPhase(agent: CrowdAgent, phase: CrowdPhase, emote: string | null = null): void {
    agent.phase = phase;
    agent.emote = emote;
    events.push({ type: 'phase', id: agent.id, phase, emote });
  }

  function despawn(agent: CrowdAgent): void {
    agents.delete(agent.id);
    events.push({ type: 'despawn', id: agent.id });
  }

  function startWalking(agent: CrowdAgent, phase: 'entering' | 'walking' | 'exiting', target: XZ): void {
    let path: XZ[] | null = [target];
    if (config.nav) {
      path = config.nav.findPath(agent, target);
      if (path === null || path.length === 0) {
        // Unreachable (or already there): leaving agents just go; others take a breather instead.
        if (phase === 'exiting') {
          despawn(agent);
          return;
        }
        agent.target = null;
        agent.path = [];
        agent.timer = between(config.idle);
        setPhase(agent, 'idling');
        return;
      }
    }
    agent.target = path[0]!;
    agent.path = path.slice(1);
    setPhase(agent, phase);
  }

  function pickGate(near?: XZ): XZ | null {
    const gates = config.nav?.gates ?? [];
    if (gates.length === 0) return null;
    if (!near) return gates[Math.floor(random() * gates.length)]!;
    // Usually the nearest gate, sometimes another one, so exits aren't all the same road.
    const sorted = [...gates].sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
    return random() < 0.7 ? sorted[0]! : sorted[Math.floor(random() * sorted.length)]!;
  }

  function leave(agent: CrowdAgent): void {
    const gate = pickGate(agent);
    if (gate) {
      startWalking(agent, 'exiting', gate);
      return;
    }
    const here = Math.atan2(agent.x, agent.z);
    const angle = here + (random() - 0.5) * 1.2;
    startWalking(agent, 'exiting', pointOnCircle(config.edgeRadius, angle));
  }

  /** Arrived somewhere in the zone (or finished a pause): decide what to do next. */
  function nextActivity(agent: CrowdAgent, justArrived: boolean): void {
    agent.target = null;
    agent.path = [];
    if (agent.stayLeft <= 0) {
      leave(agent);
      return;
    }
    if (justArrived && config.emotes.length > 0 && random() < config.emoteChance) {
      agent.timer = between(config.emoteDuration);
      setPhase(agent, 'emoting', config.emotes[Math.floor(random() * config.emotes.length)]!);
      return;
    }
    if (justArrived) {
      agent.timer = between(config.idle);
      setPhase(agent, 'idling');
      return;
    }
    startWalking(agent, 'walking', pickZoneTarget(agent));
  }

  /** Turn toward the target, then walk; moves on to the next waypoint. Returns true on final arrival. */
  function stepWalk(agent: CrowdAgent, dt: number): boolean {
    const target = agent.target;
    if (!target) return true;
    const dx = target.x - agent.x;
    const dz = target.z - agent.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= ARRIVE_EPSILON) {
      agent.x = target.x;
      agent.z = target.z;
      const next = agent.path.shift();
      if (!next) return true;
      agent.target = next;
      return false;
    }
    const wantYaw = yawToward(agent, target);
    agent.facing = lerpAngleRad(agent.facing, wantYaw, 1 - Math.exp(-config.turnRate * dt));
    if (Math.abs(wrapAngle(wantYaw - agent.facing)) > WALK_ALIGN_RAD) return false;
    const step = Math.min(config.walkSpeed * dt, dist);
    agent.x += (dx / dist) * step;
    agent.z += (dz / dist) * step;
    if (step < dist) return false;
    // Reached this waypoint: carry on to the next one, if any.
    const next = agent.path.shift();
    if (!next) return true;
    agent.target = next;
    return false;
  }

  function tickAgent(agent: CrowdAgent, dt: number): void {
    if (agent.phase === 'loading' || agent.phase === 'held') return;
    // The stay clock starts once the agent has walked into the zone.
    if (agent.phase !== 'entering') agent.stayLeft -= dt;
    switch (agent.phase) {
      case 'entering':
      case 'walking':
        if (stepWalk(agent, dt)) nextActivity(agent, true);
        break;
      case 'idling':
      case 'emoting':
        agent.timer -= dt;
        if (agent.timer <= 0) nextActivity(agent, false);
        break;
      case 'exiting':
        if (stepWalk(agent, dt)) despawn(agent);
        break;
    }
  }

  /** Advance the simulation; returns everything that happened since the last tick. */
  function tick(dt: number): CrowdEvent[] {
    for (const agent of [...agents.values()]) tickAgent(agent, dt);
    if (agents.size < config.maxAgents) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = between(config.spawnInterval);
        events.push({ type: 'spawn-request' });
      }
    }
    return drainEvents();
  }

  /**
   * Claim a slot for a new agent at a random point on the edge. It stays put ('loading') until
   * `activate` is called, so slow model loads still count toward maxAgents.
   */
  function reserve(): string | null {
    if (agents.size >= config.maxAgents) return null;
    const id = `crowd-${nextId++}`;
    const p = pickGate() ?? pointOnCircle(config.edgeRadius, random() * Math.PI * 2);
    agents.set(id, {
      id,
      x: p.x,
      z: p.z,
      facing: yawToward(p, { x: 0, z: 0 }),
      phase: 'loading',
      target: null,
      path: [],
      timer: 0,
      stayLeft: between(config.stay),
      emote: null,
      heldFrom: null,
    });
    return id;
  }

  /** The agent's model is ready: walk into the zone. */
  function activate(id: string): void {
    const agent = agents.get(id);
    if (!agent || agent.phase !== 'loading') return;
    startWalking(agent, 'entering', pickZoneTarget(agent));
  }

  /** Add an agent that is already standing somewhere (e.g. a character handed back to the crowd). */
  function addAgentAt(id: string, x: number, z: number, facing: number): CrowdAgent {
    const agent: CrowdAgent = {
      id,
      x,
      z,
      facing: wrapAngle(facing),
      phase: 'idling',
      target: null,
      path: [],
      timer: between(config.idle),
      stayLeft: between(config.stay),
      emote: null,
      heldFrom: null,
    };
    agents.set(id, agent);
    return agent;
  }

  function remove(id: string): boolean {
    return agents.delete(id);
  }

  function hold(id: string): void {
    const agent = agents.get(id);
    if (!agent || agent.phase === 'held' || agent.phase === 'loading') return;
    agent.heldFrom = agent.phase;
    setPhase(agent, 'held');
  }

  function release(id: string): void {
    const agent = agents.get(id);
    if (!agent || agent.phase !== 'held') return;
    const from = agent.heldFrom ?? 'idling';
    agent.heldFrom = null;
    if (from === 'idling' || from === 'emoting') {
      agent.timer = between(config.idle);
      setPhase(agent, 'idling');
    } else {
      setPhase(agent, from);
    }
  }

  function drainEvents(): CrowdEvent[] {
    const out = events;
    events = [];
    return out;
  }

  return {
    tick,
    reserve,
    activate,
    addAgentAt,
    remove,
    hold,
    release,
    drainEvents,
    get: (id: string) => agents.get(id),
    list: () => [...agents.values()],
    size: () => agents.size,
    config,
  };
}
