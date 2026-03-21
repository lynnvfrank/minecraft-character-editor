/**
 * Configurable logging for the Minecraft 3D viewer.
 * Supports URL params (?log=...), localStorage, and server relay.
 * See docs/LOGGING-ARCHITECTURE.md for full spec.
 */

export type LogSystem =
  | 'animation'
  | 'stateMachine'
  | 'messaging'
  | 'position'
  | 'renderer'
  | 'input'
  | 'general'
  | 'transition';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_NUMS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

const ALL_SYSTEMS: LogSystem[] = [
  'animation',
  'stateMachine',
  'messaging',
  'position',
  'renderer',
  'input',
  'general',
  'transition'
];

const THROTTLE_MS = 80;
const STORAGE_KEY = 'viewer-log-config';
const RELAY_STORAGE_KEY = 'viewer-log-relay';

type LogConfig = Record<LogSystem, LogLevel>;
type ThrottleKey = string;

let startTime: number;
let config: LogConfig;
let relayEnabled: boolean;
let throttleMap: Map<ThrottleKey, number> = new Map();

function parseLevel(s: string): LogLevel {
  const l = s.toLowerCase();
  if (['error', 'warn', 'info', 'debug', 'trace'].includes(l)) return l as LogLevel;
  return 'info';
}

function parseConfigFromParam(param: string): Partial<LogConfig> {
  const out: Partial<LogConfig> = {};
  const parts = param.split(',');
  for (const p of parts) {
    const [sys, level] = p.split(':').map((x) => x.trim());
    if (!sys) continue;
    const systems = sys === '*' ? [...ALL_SYSTEMS] : [sys as LogSystem];
    const lev = level ? parseLevel(level) : 'info';
    for (const s of systems) {
      if (ALL_SYSTEMS.includes(s as LogSystem)) (out as Record<string, LogLevel>)[s] = lev;
    }
  }
  return out;
}

function buildConfig(): { config: LogConfig; relay: boolean } {
  const base: LogConfig = {
    animation: 'error',
    stateMachine: 'error',
    messaging: 'error',
    position: 'error',
    renderer: 'error',
    input: 'error',
    general: 'error',
    transition: 'error'
  };

  let relay = false;

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(location.search);

    // URL params: ?log=animation:debug,stateMachine:info  or  ?log=1 / ?log=on
    const logParam = params.get('log');
    if (logParam) {
      if (logParam === '1' || logParam === 'on') {
        base.animation = base.stateMachine = base.messaging = 'info';
      } else {
        Object.assign(base, parseConfigFromParam(logParam));
      }
    }

    // localStorage override
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (ALL_SYSTEMS.includes(k as LogSystem) && typeof v === 'string')
            base[k as LogSystem] = parseLevel(v);
        }
      }
    } catch {
      /* ignore */
    }

    // logRelay: ?logRelay=1 or localStorage or VITE_LOG_RELAY
    const relayParam = params.get('logRelay');
    if (relayParam === '1' || relayParam === 'on') {
      relay = true;
    } else {
      const storedRelay = localStorage.getItem(RELAY_STORAGE_KEY);
      relay = storedRelay === 'true' || storedRelay === '1';
    }
    if (import.meta.env.VITE_LOG_RELAY === 'true') relay = true;
  }

  return { config: base, relay };
}

function init() {
  startTime = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  const { config: c, relay } = buildConfig();
  config = c;
  relayEnabled = relay;
}

init();

export function isEnabled(system: LogSystem, level: LogLevel): boolean {
  const minLevel = config[system];
  return LEVEL_NUMS[level] <= LEVEL_NUMS[minLevel];
}

function formatData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) return '';
  return (
    ' | ' +
    Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ')
  );
}

function shouldThrottle(system: LogSystem, level: LogLevel, event: string): boolean {
  if (level === 'error' || level === 'warn') return false;
  if (level !== 'trace' && level !== 'debug') return false;
  const key: ThrottleKey = `${system}:${event}`;
  const now = Date.now();
  const last = throttleMap.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return true;
  throttleMap.set(key, now);
  return false;
}

function emit(
  system: LogSystem,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
) {
  if (!isEnabled(system, level)) return;
  if (shouldThrottle(system, level, message)) return;

  const elapsed =
    typeof performance !== 'undefined' ? (performance.now() / 1000).toFixed(2) : '0';
  const line = `[${elapsed}s] [${system}] [${level}] ${message}${formatData(data)}`;

  // Browser console
  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }

  // Server relay
  if (relayEnabled && typeof fetch !== 'undefined') {
    const payload = {
      time: parseFloat(elapsed),
      system,
      level,
      message,
      data: data ?? {}
    };
    const body = JSON.stringify(payload);
    try {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export const logger = {
  error(system: LogSystem, message: string, data?: Record<string, unknown>) {
    emit(system, 'error', message, data);
  },
  warn(system: LogSystem, message: string, data?: Record<string, unknown>) {
    emit(system, 'warn', message, data);
  },
  info(system: LogSystem, message: string, data?: Record<string, unknown>) {
    emit(system, 'info', message, data);
  },
  debug(system: LogSystem, message: string, data?: Record<string, unknown>) {
    emit(system, 'debug', message, data);
  },
  trace(system: LogSystem, message: string, data?: Record<string, unknown>) {
    emit(system, 'trace', message, data);
  },
  isEnabled,
  /** Update config from localStorage (call after localStorage.setItem) */
  refreshConfig() {
    const { config: c, relay } = buildConfig();
    config = c;
    relayEnabled = relay;
  }
};
