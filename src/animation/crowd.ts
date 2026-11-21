/**
 * Crowd simulation for the home "creative space": characters walk into a round zone, wander,
 * idle and emote for a while, then walk back out. Pure (no three.js, no timers) so it runs in
 * unit tests; controllers/crowdController.ts loads the models and plays the clips.
 *
 * Agent life cycle:
 *   loading → entering → (idling | emoting | walking | social)* → exiting → removed
 * `held` freezes an agent in place (unused by the home view today, kept for tests and tools).
 *
 * Social life (all optional, see the greet and gather settings in CrowdConfig):
 * - Greeting: two agents out and about (idling, emoting, walking) that come close stop and turn
 *   to each other ('greeting'); one plays a hello emote, the other answers a moment later, then
 *   both carry on. Now and then a walk goes over to someone on purpose (`visitChance`).
 * - Plaza gathering: now and then 2-4 agents are invited to a ring of spots around a point on
 *   the plaza ('gathering' = walking there, 'waiting' = arrived and facing the centre), perform
 *   together for a while ('performing'), then disperse.
 * - Night (tick's `env.night`, 0..1): agents walk a bit slower, stay put longer, prefer the
 *   nav's rest spots (lamp posts, doorsteps) and pick sleepy emotes.
 * - Rain (tick's `env.rain`, 0..1): walks head for the same rest spots (shelter) and no new plaza
 *   gathering is called until it stops.
 * An agent taken out with remove() (selected by the user, sent home) leaves its greeting or
 * gathering cleanly: the partner carries on, the gathering goes on without it or breaks up.
 */
import { assignSpots, pairKey, pickSome, ringSpots } from './crowdSocial';
import { lerpAngleRad, wrapAngle, yawToward, type XZ } from './wander';

export type CrowdPhase =
  | 'loading'
  | 'entering'
  | 'walking'
  | 'idling'
  | 'emoting'
  | 'exiting'
  | 'held'
  /** Standing face to face with `partner`, saying hello. */
  | 'greeting'
  /** Walking to a spot of a plaza gathering. */
  | 'gathering'
  /** At the gathering spot, facing the centre, until the others arrive. */
  | 'waiting'
  /** Dancing with the group. */
  | 'performing';

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
  /** Seconds spent walking without getting closer to the target (blocked by others). */
  stuck: number;
  /** Distance to `target` at the previous walk step (progress check for `stuck`). */
  prevDist: number;
  /** Who this agent is greeting (while 'greeting'). */
  partner: string | null;
  /** The answering side of a greeting: seconds until its reply emote starts (0 = none pending). */
  replyIn: number;
  replyEmote: string | null;
  /** Seconds before this agent may be greeted again. */
  greetRest: number;
  /** Id of the gathering this agent belongs to. */
  group: number | null;
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
  /**
   * Closest two characters' centers may get (world units). Walkers steer around anyone closer;
   * someone standing still is walked around, not shoved.
   */
  personalSpace: number;
  /** Two idling/walking agents closer than this may greet each other. */
  greetDistance: number;
  /** Chance (0..1) that such a meeting becomes a greeting. 0 turns greetings off. */
  greetChance: number;
  /** [min, max] seconds the hello emote plays. */
  greetDuration: readonly [number, number];
  /** The answer starts this long after the hello. */
  greetReplyDelay: number;
  /** The same two agents don't greet again for this long. */
  greetPairCooldown: number;
  /** After a greeting an agent is left alone for this long. */
  greetRest: number;
  greetEmotes: readonly string[];
  replyEmotes: readonly string[];
  /**
   * Chance (0..1) that a walk goes over to someone standing around (which usually ends in a
   * greeting) instead of to a spot away from everyone. Only with greetings on.
   */
  visitChance: number;
  /** [min, max] seconds between plaza gatherings; null turns them off. */
  gatherInterval: readonly [number, number] | null;
  /** [min, max] agents invited. */
  gatherSize: readonly [number, number];
  /** Distance from the gathering's centre to each spot. */
  gatherRadius: number;
  /** Start with whoever has arrived after this long. */
  gatherAssembleTimeout: number;
  /** [min, max] seconds the group performs. */
  performDuration: readonly [number, number];
  /** One of these is picked for the whole group (the controller may play a saved combo instead). */
  danceEmotes: readonly string[];
  /** Emotes used instead of `emotes` at night. */
  nightEmotes: readonly string[];
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
  /** Can a character's body stand here? Steps and sidesteps that fail this are not taken. */
  isClear?: (p: XZ) => boolean;
  /** Centres for gatherings (the stone plaza). Without it any wander spot will do. */
  plaza?: readonly XZ[];
  /** Where people like to stand after dark (by lamp posts, on doorsteps). */
  restSpots?: readonly XZ[];
};

/** What the world is like right now (plain numbers so the sim stays pure). */
export type CrowdEnv = {
  /** 0 = day, 1 = full night. */
  night?: number;
  /** 0 = dry, 1 = raining hard. */
  rain?: number;
};

export type CrowdEvent =
  | { type: 'spawn-request' }
  /**
   * An agent changed phase. `emote` is a clip key for 'emoting', 'greeting' (null while the
   * answering side waits its turn) and 'performing' (the group's dance).
   */
  | { type: 'phase'; id: string; phase: CrowdPhase; emote: string | null }
  | { type: 'despawn'; id: string }
  /** Two agents started greeting (their 'greeting' phase events follow). */
  | { type: 'greet'; greeter: string; answerer: string }
  /**
   * A plaza gathering was called ('invited'), started dancing ('performing', `ids` = who made
   * it; their phase events follow) or is over ('ended', `ids` = who was still there).
   */
  | { type: 'gathering'; id: number; stage: 'invited' | 'performing' | 'ended'; ids: string[]; center: XZ };

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
  personalSpace: 0.75,
  greetDistance: 1.8,
  greetChance: 0.8,
  greetDuration: [2.4, 3.4],
  greetReplyDelay: 0.8,
  greetPairCooldown: 45,
  greetRest: 8,
  greetEmotes: ['waving', 'acknowledging', 'quick-informal-bow'],
  replyEmotes: ['acknowledging', 'hard-head-nod', 'standing-thumbs-up', 'waving', 'happy', 'laughing'],
  visitChance: 0.3,
  gatherInterval: [40, 100],
  gatherSize: [2, 4],
  gatherRadius: 1.3,
  gatherAssembleTimeout: 30,
  performDuration: [9, 15],
  danceEmotes: ['groove', 'dancing-twerk', 'happy', 'excited', 'clapping'],
  nightEmotes: ['yawn', 'relaxed-idle', 'arm-stretching', 'bored', 'look-around', 'thinking'],
};

/** Within this distance of a target counts as arrived. */
const ARRIVE_EPSILON = 0.05;
/** Only walk forward once facing is within this angle of the target; turn in place before that. */
const WALK_ALIGN_RAD = Math.PI / 3;
/** Candidate targets per pick; the one farthest from other agents wins. */
const TARGET_SAMPLES = 5;
/** Give up on a walk after this long without progress (someone is standing in the way). */
const STUCK_SEC = 2.5;
/** How strongly a walker sidesteps (to its right) when someone is ahead, relative to backing off. */
const SIDESTEP = 0.9;
/** A meeting that didn't become a greeting is looked at again after this long. */
const GREET_RETRY_SEC = 10;
/** Too few people (or no room) for a gathering: try again this soon. */
const GATHER_RETRY_SEC = 8;
/** Agents about to leave aren't invited to gatherings. */
const GATHER_MIN_STAY_SEC = 10;
/** Different centres tried per gathering. */
const GATHER_CENTER_TRIES = 6;
/** Neighbours in a gathering ring stand at least this many personal spaces apart. */
const GATHER_GAP = 1.4;
/** Above this `night` level the night routine applies. */
const NIGHT_THRESHOLD = 0.5;
/** At full night walks are this much slower (fraction of walkSpeed). */
const NIGHT_SLOW = 0.2;
/** At full night pauses last (1 + this) times as long. */
const NIGHT_LINGER = 2;
/** After a pause at night: chance to stay put for another one instead of walking on. */
const NIGHT_STAY_CHANCE = 0.6;
/** At night: chance that a walk heads for a rest spot (lamp post, doorstep). */
const NIGHT_REST_SPOT_CHANCE = 0.8;
/** Gatherings come around this much slower at night. */
const NIGHT_GATHER_RATE = 0.5;
/** Above this `rain` level residents look for shelter and gatherings wait. */
const RAIN_THRESHOLD = 0.5;
/** In the rain: chance that a walk heads for a rest spot (doorstep, lamp post). */
const RAIN_SHELTER_CHANCE = 0.9;

export type CrowdGathering = {
  id: number;
  center: XZ;
  members: string[];
  stage: 'assembling' | 'performing';
  /** Seconds left to assemble, then to perform. */
  timer: number;
  emote: string | null;
};

export type CrowdSim = ReturnType<typeof createCrowdSim>;

export function createCrowdSim(config: CrowdConfig = DEFAULT_CROWD_CONFIG) {
  const random = config.random ?? Math.random;
  const agents = new Map<string, CrowdAgent>();
  let nextId = 1;
  /** First spawn comes quickly so the space isn't empty on load. */
  let spawnTimer = 0.5;
  let events: CrowdEvent[] = [];
  /** Characters outside the sim (e.g. the selected one) from the latest tick. */
  let bodies: readonly XZ[] = [];
  /** 0 = day, 1 = full night (from the latest tick). */
  let night = 0;
  /** 0 = dry, 1 = raining hard (from the latest tick). */
  let rain = 0;
  /** Pair key → seconds until those two may greet again. */
  const greetCooldowns = new Map<string, number>();
  /** The plaza gathering in progress (one at a time). */
  let gathering: CrowdGathering | null = null;
  let nextGatheringId = 1;

  const between = ([min, max]: readonly [number, number]) => min + random() * (max - min);
  const pickOne = <T>(list: readonly T[]): T | null =>
    list.length > 0 ? list[Math.min(list.length - 1, Math.floor(random() * list.length))]! : null;
  const isNight = () => night > NIGHT_THRESHOLD;
  const isRaining = () => rain > RAIN_THRESHOLD;
  const walkSpeed = () => config.walkSpeed * (1 - NIGHT_SLOW * night);
  let gatherTimer = config.gatherInterval ? between(config.gatherInterval) : Infinity;

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
    others.push(...bodies);
    // After dark most walks end by a lamp post or on a doorstep.
    const rest = nav?.restSpots ?? [];
    // In the rain nearly all of them do (shelter).
    const restChance = isRaining() ? RAIN_SHELTER_CHANCE : isNight() ? NIGHT_REST_SPOT_CHANCE : 0;
    const spots = restChance > 0 && rest.length > 0 && random() < restChance ? rest : (nav?.spots ?? []);
    let best: XZ = { x: 0, z: 0 };
    let bestScore = -Infinity;
    for (let i = 0; i < TARGET_SAMPLES; i++) {
      const p =
        spots.length > 0
          ? spots[Math.floor(random() * spots.length)]!
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
    followPath(agent, phase, path);
  }

  function followPath(agent: CrowdAgent, phase: CrowdPhase, path: readonly XZ[]): void {
    agent.target = path[0]!;
    agent.path = path.slice(1);
    agent.stuck = 0;
    agent.prevDist = Infinity;
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
    // After dark people mostly stay where they are.
    const pause = justArrived || (isNight() && random() < NIGHT_STAY_CHANCE);
    if (!pause) {
      startWalking(agent, 'walking', pickVisitTarget(agent) ?? pickZoneTarget(agent));
      return;
    }
    const emotes = isNight() && config.nightEmotes.length > 0 ? config.nightEmotes : config.emotes;
    if (emotes.length > 0 && random() < config.emoteChance) {
      agent.timer = between(config.emoteDuration) * (1 + night * 0.5);
      setPhase(agent, 'emoting', emotes[Math.floor(random() * emotes.length)]!);
      return;
    }
    agent.timer = between(config.idle) * (1 + night * NIGHT_LINGER);
    setPhase(agent, 'idling');
  }

  function turnToward(agent: CrowdAgent, p: XZ, dt: number): void {
    if (Math.hypot(p.x - agent.x, p.z - agent.z) < 1e-4) return;
    agent.facing = lerpAngleRad(agent.facing, yawToward(agent, p), 1 - Math.exp(-config.turnRate * dt));
  }

  // --- Greetings ---

  /** Now and then: a spot next to someone who is standing around and hasn't been greeted lately. */
  function pickVisitTarget(self: CrowdAgent): XZ | null {
    if (config.greetChance <= 0 || config.visitChance <= 0 || random() >= config.visitChance) return null;
    const hosts = [...agents.values()].filter(
      (a) =>
        a !== self &&
        (a.phase === 'idling' || a.phase === 'emoting') &&
        a.greetRest <= 0 &&
        !greetCooldowns.has(pairKey(a.id, self.id))
    );
    const host = pickOne(hosts);
    if (!host) return null;
    const d = Math.hypot(self.x - host.x, self.z - host.z);
    const gap = Math.max(config.personalSpace * 1.3, config.greetDistance * 0.6);
    if (d <= gap) return null;
    // Stop short of them, on our side.
    const p = { x: host.x + ((self.x - host.x) / d) * gap, z: host.z + ((self.z - host.z) / d) * gap };
    return !config.nav?.isClear || config.nav.isClear(p) ? p : null;
  }

  function startGreeting(a: CrowdAgent, b: CrowdAgent): void {
    const flip = random() < 0.5;
    const greeter = flip ? a : b;
    const answerer = flip ? b : a;
    const duration = between(config.greetDuration) + config.greetReplyDelay;
    for (const agent of [greeter, answerer]) {
      agent.target = null;
      agent.path = [];
      agent.timer = duration;
      agent.partner = agent === greeter ? answerer.id : greeter.id;
    }
    greeter.replyIn = 0;
    answerer.replyIn = config.greetReplyDelay;
    answerer.replyEmote = pickOne(config.replyEmotes);
    events.push({ type: 'greet', greeter: greeter.id, answerer: answerer.id });
    setPhase(greeter, 'greeting', pickOne(config.greetEmotes));
    setPhase(answerer, 'greeting', answerer.replyIn > 0 ? null : answerer.replyEmote);
  }

  function endGreeting(agent: CrowdAgent): void {
    agent.partner = null;
    agent.replyIn = 0;
    agent.replyEmote = null;
    agent.greetRest = config.greetRest;
    nextActivity(agent, false);
  }

  function tickGreeting(agent: CrowdAgent, dt: number): void {
    const other = agent.partner ? agents.get(agent.partner) : undefined;
    // The other one is gone or has moved on: so do we.
    if (!other || other.phase !== 'greeting' || other.partner !== agent.id) {
      endGreeting(agent);
      return;
    }
    turnToward(agent, other, dt);
    if (agent.replyIn > 0) {
      agent.replyIn -= dt;
      if (agent.replyIn <= 0) {
        agent.replyIn = 0;
        setPhase(agent, 'greeting', agent.replyEmote);
      }
    }
    agent.timer -= dt;
    if (agent.timer <= 0) endGreeting(agent);
  }

  /** Any two agents out and about (idling, emoting, walking) that have come close (and haven't greeted lately) say hello. */
  function checkGreetings(dt: number): void {
    for (const [key, left] of greetCooldowns) {
      if (left - dt <= 0) greetCooldowns.delete(key);
      else greetCooldowns.set(key, left - dt);
    }
    if (config.greetChance <= 0) return;
    const free = (a: CrowdAgent) =>
      (a.phase === 'idling' || a.phase === 'walking' || a.phase === 'emoting') && a.greetRest <= 0;
    const list = [...agents.values()].filter(free);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (!free(a)) break;
        if (!free(b) || Math.hypot(a.x - b.x, a.z - b.z) > config.greetDistance) continue;
        const key = pairKey(a.id, b.id);
        if (greetCooldowns.has(key)) continue;
        if (random() >= config.greetChance) {
          greetCooldowns.set(key, GREET_RETRY_SEC);
          continue;
        }
        greetCooldowns.set(key, config.greetPairCooldown);
        startGreeting(a, b);
      }
    }
  }

  // --- Plaza gatherings ---

  function gatherCenter(): XZ {
    const nav = config.nav;
    const pool = nav?.plaza && nav.plaza.length > 0 ? nav.plaza : (nav?.spots ?? []);
    return pickOne(pool) ?? pointOnCircle(config.zoneRadius * 0.4 * Math.sqrt(random()), random() * Math.PI * 2);
  }

  /** Invite 2-4 agents to a ring of spots on the plaza. False if there aren't enough or no room. */
  function tryStartGathering(): boolean {
    const eligible = [...agents.values()].filter(
      (a) => (a.phase === 'idling' || a.phase === 'emoting' || a.phase === 'walking') && a.stayLeft > GATHER_MIN_STAY_SEC
    );
    if (eligible.length < 2) return false;
    const [minSize, maxSize] = config.gatherSize;
    const size = Math.min(eligible.length, Math.max(2, minSize + Math.floor(random() * (maxSize - minSize + 1))));
    const invited = pickSome(eligible, size, random);
    const ps = config.personalSpace;
    const nav = config.nav;
    for (let attempt = 0; attempt < GATHER_CENTER_TRIES; attempt++) {
      const center = gatherCenter();
      const spots = ringSpots(center, invited.length, config.gatherRadius, random() * Math.PI * 2, ps * GATHER_GAP);
      // Every spot must fit a body and be clear of outside characters (the selected one).
      const usable = spots.every(
        (s) => (!nav?.isClear || nav.isClear(s)) && bodies.every((b) => Math.hypot(b.x - s.x, b.z - s.z) >= ps)
      );
      if (!usable) continue;
      const assigned = assignSpots(invited, spots);
      const plans: { agent: CrowdAgent; path: XZ[] }[] = [];
      invited.forEach((agent, i) => {
        const spot = spots[assigned[i]!];
        if (!spot) return;
        const path = nav ? nav.findPath(agent, spot) : [spot];
        if (path) plans.push({ agent, path });
      });
      if (plans.length < 2) continue;
      const g: CrowdGathering = {
        id: nextGatheringId++,
        center,
        members: plans.map((p) => p.agent.id),
        stage: 'assembling',
        timer: config.gatherAssembleTimeout,
        emote: null,
      };
      gathering = g;
      events.push({ type: 'gathering', id: g.id, stage: 'invited', ids: [...g.members], center });
      for (const { agent, path } of plans) {
        agent.group = g.id;
        if (path.length === 0) arriveAtGathering(agent);
        else followPath(agent, 'gathering', path);
      }
      return true;
    }
    return false;
  }

  function arriveAtGathering(agent: CrowdAgent): void {
    agent.target = null;
    agent.path = [];
    const g = gathering;
    if (!g || agent.group !== g.id) {
      agent.group = null;
      nextActivity(agent, true);
    } else if (g.stage === 'performing') {
      setPhase(agent, 'performing', g.emote);
    } else {
      setPhase(agent, 'waiting');
    }
  }

  const inGatheringPhase = (a: CrowdAgent) => a.phase === 'gathering' || a.phase === 'waiting' || a.phase === 'performing';

  /** Break up the gathering: everyone still in it walks off. */
  function endGathering(): void {
    const g = gathering;
    if (!g) return;
    gathering = null;
    events.push({ type: 'gathering', id: g.id, stage: 'ended', ids: [...g.members], center: g.center });
    for (const id of g.members) {
      const agent = agents.get(id);
      if (!agent) continue;
      agent.group = null;
      if (inGatheringPhase(agent)) nextActivity(agent, false);
    }
  }

  function tickGathering(dt: number): void {
    const g = gathering;
    if (!g) {
      // Nobody calls a get-together in the rain (one already under way carries on).
      if (!config.gatherInterval || isRaining()) return;
      gatherTimer -= dt * (isNight() ? NIGHT_GATHER_RATE : 1);
      if (gatherTimer > 0) return;
      gatherTimer = tryStartGathering() ? between(config.gatherInterval) : GATHER_RETRY_SEC;
      return;
    }
    g.timer -= dt;
    if (g.stage === 'performing') {
      if (g.timer <= 0) endGathering();
      return;
    }
    const members = g.members.map((id) => agents.get(id)).filter((a): a is CrowdAgent => !!a);
    const ready = members.filter((a) => a.phase === 'waiting');
    if (ready.length < members.length && g.timer > 0) return;
    // Everyone is here (or we've waited long enough): start with whoever made it.
    for (const late of members) {
      if (late.phase === 'waiting') continue;
      late.group = null;
      if (late.phase === 'gathering') nextActivity(late, true);
    }
    g.members = ready.map((a) => a.id);
    if (ready.length < 2) {
      endGathering();
      return;
    }
    g.stage = 'performing';
    g.timer = between(config.performDuration);
    g.emote = pickOne(config.danceEmotes);
    events.push({ type: 'gathering', id: g.id, stage: 'performing', ids: [...g.members], center: g.center });
    for (const agent of ready) setPhase(agent, 'performing', g.emote);
  }

  /**
   * Take an agent out of its greeting / gathering without leaving anyone waiting for it: the
   * greeting partner carries on, the gathering goes on without it or breaks up.
   */
  function leaveActivities(agent: CrowdAgent): void {
    if (agent.partner) {
      const other = agents.get(agent.partner);
      agent.partner = null;
      agent.replyIn = 0;
      if (other && other.phase === 'greeting' && other.partner === agent.id) endGreeting(other);
    }
    const g = gathering;
    if (agent.group != null && g && g.id === agent.group) {
      g.members = g.members.filter((id) => id !== agent.id);
      if (g.members.length === 0 || (g.stage === 'assembling' && g.members.length < 2)) endGathering();
    }
    agent.group = null;
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
      agent.prevDist = Infinity;
      return false;
    }
    // Progress since last step, including any push-back from separation: no progress = stuck.
    const expected = walkSpeed() * dt;
    if (agent.prevDist - dist < expected * 0.25) agent.stuck += dt;
    else agent.stuck = Math.max(0, agent.stuck - dt);
    agent.prevDist = dist;
    const wantYaw = yawToward(agent, target);
    agent.facing = lerpAngleRad(agent.facing, wantYaw, 1 - Math.exp(-config.turnRate * dt));
    if (Math.abs(wrapAngle(wantYaw - agent.facing)) > WALK_ALIGN_RAD) return false;
    const step = Math.min(expected, dist);
    moveBy(agent, (dx / dist) * step, (dz / dist) * step);
    if (Math.hypot(target.x - agent.x, target.z - agent.z) > ARRIVE_EPSILON) return false;
    agent.x = target.x;
    agent.z = target.z;
    // Reached this waypoint: carry on to the next one, if any.
    const next = agent.path.shift();
    if (!next) return true;
    agent.target = next;
    agent.prevDist = Infinity;
    return false;
  }

  /** Move by (dx, dz) if the body fits there; otherwise slide along whichever axis fits. */
  function moveBy(agent: CrowdAgent, dx: number, dz: number): void {
    const clear = config.nav?.isClear;
    // Already somewhere a body doesn't fit (e.g. handed over mid-wall): let it walk out.
    const fits = (x: number, z: number) => !clear || clear({ x, z }) || !clear({ x: agent.x, z: agent.z });
    if (fits(agent.x + dx, agent.z + dz)) {
      agent.x += dx;
      agent.z += dz;
    } else if (Math.abs(dx) >= Math.abs(dz) && fits(agent.x + dx, agent.z)) {
      agent.x += dx;
    } else if (fits(agent.x, agent.z + dz)) {
      agent.z += dz;
    } else if (fits(agent.x + dx, agent.z)) {
      agent.x += dx;
    }
  }

  const isWalkingPhase = (p: CrowdPhase) => p === 'entering' || p === 'walking' || p === 'exiting' || p === 'gathering';

  /** Final leg, close to the goal, but someone else is standing on it: good enough. */
  function goalTaken(agent: CrowdAgent): boolean {
    const t = agent.target;
    if (!t || agent.path.length > 0) return false;
    if (Math.hypot(t.x - agent.x, t.z - agent.z) > config.personalSpace * 1.5) return false;
    const near = (o: XZ) => Math.hypot(o.x - t.x, o.z - t.z) < config.personalSpace;
    for (const o of agents.values()) if (o !== agent && o.phase !== 'loading' && near(o)) return true;
    return bodies.some(near);
  }

  /**
   * Push apart anyone closer than personalSpace. Walkers give way (back off and sidestep to their
   * right, so two people meeting head-on pass each other); people standing still only move if
   * nobody walking is involved, or when an outside body (the selected character) bumps them, in
   * which case they walk off somewhere else.
   */
  function separate(): void {
    const ps = config.personalSpace;
    const list = [...agents.values()].filter((a) => a.phase !== 'loading');
    let lastPass = false;
    const share = (a: CrowdAgent, other: CrowdAgent | null): number => {
      if (a.phase === 'held') return 0;
      if (!other) return 1;
      if (other.phase === 'held') return 1;
      // Last pass: whatever overlap is left (a walker squeezed against someone standing), split it.
      if (lastPass) return 0.5;
      const aw = isWalkingPhase(a.phase);
      const ow = isWalkingPhase(other.phase);
      return aw === ow ? 0.5 : aw ? 1 : 0;
    };
    const push = (a: CrowdAgent, nx: number, nz: number, amount: number) => {
      if (amount <= 0) return;
      let px = nx;
      let pz = nz;
      if (isWalkingPhase(a.phase)) {
        const fx = Math.sin(a.facing);
        const fz = Math.cos(a.facing);
        // The other one is ahead (we're pushed backward): step to our right as well.
        if (fx * nx + fz * nz < 0) {
          px += -fz * SIDESTEP;
          pz += fx * SIDESTEP;
          const len = Math.hypot(px, pz);
          px /= len;
          pz /= len;
        }
      }
      moveBy(a, px * amount, pz * amount);
    };
    const direction = (a: XZ, b: XZ, d: number, salt: number): [number, number] => {
      if (d > 1e-6) return [(a.x - b.x) / d, (a.z - b.z) / d];
      const ang = salt * 2.399963; // exactly on top of each other: any fixed direction will do
      return [Math.sin(ang), Math.cos(ang)];
    };
    const PASSES = 4;
    for (let iter = 0; iter < PASSES; iter++) {
      lastPass = iter === PASSES - 1;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d >= ps) continue;
          const [nx, nz] = direction(a, b, d, i + j);
          const overlap = ps - d;
          push(a, nx, nz, overlap * share(a, b));
          push(b, -nx, -nz, overlap * share(b, a));
        }
        const a = list[i]!;
        if (a.phase === 'held') continue;
        bodies.forEach((body, k) => {
          const d = Math.hypot(a.x - body.x, a.z - body.z);
          if (d >= ps) return;
          const [nx, nz] = direction(a, body, d, i + k + 7);
          push(a, nx, nz, ps - d);
          // Bumped while standing around: wander off rather than be shoved along.
          if (a.phase === 'idling' || a.phase === 'emoting') startWalking(a, 'walking', pickZoneTarget(a));
        });
      }
    }
  }

  function tickAgent(agent: CrowdAgent, dt: number): void {
    if (agent.phase === 'loading' || agent.phase === 'held') return;
    // The stay clock starts once the agent has walked into the zone.
    if (agent.phase !== 'entering') agent.stayLeft -= dt;
    agent.greetRest = Math.max(0, agent.greetRest - dt);
    if (isWalkingPhase(agent.phase) && (agent.stuck > STUCK_SEC || goalTaken(agent))) {
      agent.stuck = 0;
      if (agent.phase === 'exiting') {
        // Find another way out (re-plan from here, maybe to another gate).
        leave(agent);
      } else if (agent.phase === 'gathering') {
        const goal = agent.path[agent.path.length - 1] ?? agent.target;
        const path = goal && config.nav ? config.nav.findPath(agent, goal) : goal ? [goal] : null;
        if (!goal || Math.hypot(goal.x - agent.x, goal.z - agent.z) <= config.personalSpace * 1.5 || !path || path.length === 0) {
          // Close enough (or no way through): join the group from here.
          arriveAtGathering(agent);
        } else {
          // Held up on the way: plan again from here. The assemble timeout covers the rest.
          followPath(agent, 'gathering', path);
        }
      } else {
        // Stop here and do something else; the next walk picks a fresh spot.
        nextActivity(agent, true);
      }
      return;
    }
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
      case 'greeting':
        tickGreeting(agent, dt);
        break;
      case 'gathering':
        if (stepWalk(agent, dt)) arriveAtGathering(agent);
        break;
      case 'waiting':
      case 'performing':
        if (gathering && agent.group === gathering.id) turnToward(agent, gathering.center, dt);
        else {
          agent.group = null;
          nextActivity(agent, false);
        }
        break;
    }
  }

  /**
   * Advance the simulation; returns everything that happened since the last tick.
   * `others` are characters outside the sim (e.g. the selected one) that the crowd keeps clear of.
   * `env` describes the world (night and rain levels).
   */
  function tick(dt: number, others: readonly XZ[] = [], env: CrowdEnv = {}): CrowdEvent[] {
    bodies = others;
    night = Math.min(1, Math.max(0, env.night ?? 0));
    rain = Math.min(1, Math.max(0, env.rain ?? 0));
    for (const agent of [...agents.values()]) tickAgent(agent, dt);
    separate();
    checkGreetings(dt);
    tickGathering(dt);
    if (agents.size < config.maxAgents) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = between(config.spawnInterval);
        events.push({ type: 'spawn-request' });
      }
    }
    return drainEvents();
  }

  function newAgent(id: string, x: number, z: number, facing: number, phase: CrowdPhase, timer: number): CrowdAgent {
    return {
      id,
      x,
      z,
      facing,
      phase,
      target: null,
      path: [],
      timer,
      stayLeft: between(config.stay),
      emote: null,
      heldFrom: null,
      stuck: 0,
      prevDist: Infinity,
      partner: null,
      replyIn: 0,
      replyEmote: null,
      greetRest: 0,
      group: null,
    };
  }

  /**
   * Claim a slot for a new agent at a random point on the edge. It stays put ('loading') until
   * `activate` is called, so slow model loads still count toward maxAgents.
   * Pass `at` to start somewhere specific instead (a resident added from the Residents panel
   * appears in the village rather than walking in from the edge).
   */
  function reserve(at?: XZ): string | null {
    if (agents.size >= config.maxAgents) return null;
    const id = `crowd-${nextId++}`;
    const p = at ?? pickGate() ?? pointOnCircle(config.edgeRadius, random() * Math.PI * 2);
    agents.set(id, newAgent(id, p.x, p.z, yawToward(p, { x: 0, z: 0 }), 'loading', 0));
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
    const agent = newAgent(id, x, z, wrapAngle(facing), 'idling', between(config.idle));
    agents.set(id, agent);
    return agent;
  }

  /** Take an agent out (selected by the user, sent home). Whoever it was busy with carries on. */
  function remove(id: string): boolean {
    const agent = agents.get(id);
    if (!agent) return false;
    agents.delete(id);
    leaveActivities(agent);
    return true;
  }

  function hold(id: string): void {
    const agent = agents.get(id);
    if (!agent || agent.phase === 'held' || agent.phase === 'loading') return;
    const social = agent.phase === 'greeting' || inGatheringPhase(agent);
    leaveActivities(agent);
    agent.heldFrom = social ? 'idling' : agent.phase;
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
    /** The plaza gathering in progress, if any (for tests and debugging). */
    gathering: (): Readonly<CrowdGathering> | null => gathering,
    config,
  };
}
