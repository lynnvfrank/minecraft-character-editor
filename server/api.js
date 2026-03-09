/**
 * API handlers for skin/animation control and client log relay.
 * Used by both the Vite plugin (dev) and Express server (prod).
 */

const { parse: parseUrl } = require('url');
const sseClients = new Set();

// Log relay: read from env or process.argv
const LOG_LEVEL_NUMS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
function getLogRelayConfig() {
  let relay = process.env.LOG_RELAY === 'true' || process.env.LOG_RELAY === '1';
  let level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  let systems = (process.env.LOG_SYSTEMS || '*').split(',').map((s) => s.trim());
  for (const arg of process.argv) {
    if (arg === '--log-relay') relay = true;
    else if (arg.startsWith('--log-level=')) level = arg.slice(12).toLowerCase();
    else if (arg.startsWith('--log-systems=')) systems = arg.slice(14).split(',').map((s) => s.trim());
  }
  return { relay, level, systems };
}

/** Build URL query string for client log config matching server relay settings */
function buildLogUrlParams() {
  const { relay, level, systems } = getLogRelayConfig();
  if (!relay) return '';
  const params = new URLSearchParams();
  const logVal = systems.includes('*')
    ? `*:${level}`
    : systems.map((s) => `${s}:${level}`).join(',');
  params.set('log', logVal);
  params.set('logRelay', '1');
  return params.toString();
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(msg);
    } catch (e) {
      sseClients.delete(res);
    }
  });
}

function handleApi(req, res, next) {
  const parsedUrl = parseUrl(req.url || '', true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/skin' && req.method === 'POST') {
    const name = parsedUrl.query?.name || '';
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing name parameter' }));
      return;
    }
    broadcast({ type: 'skin', name: name.trim() });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, skin: name.trim() }));
    return;
  }

  if (pathname === '/api/animation' && req.method === 'POST') {
    const name = parsedUrl.query?.name || '';
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing name parameter' }));
      return;
    }
    broadcast({ type: 'animation', name: name.trim() });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, animation: name.trim() }));
    return;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (pathname === '/api/log' && req.method === 'POST') {
    const { relay, level, systems } = getLogRelayConfig();
    if (!relay) {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const minLevelNum = LOG_LEVEL_NUMS[level] ?? LOG_LEVEL_NUMS.info;
        const sysSet = systems.includes('*') ? null : new Set(systems);
        const parseOne = (entry) => {
          if (!entry || typeof entry !== 'object') return;
          const { system, level: lv, message, data } = entry;
          if (!system || !message) return;
          const lvNum = LOG_LEVEL_NUMS[lv] ?? LOG_LEVEL_NUMS.info;
          const alwaysPrint = lv === 'error' || lv === 'warn';
          if (!alwaysPrint && sysSet && !sysSet.has(system)) return;
          if (!alwaysPrint && lvNum > minLevelNum) return;
          const dataStr = data && Object.keys(data).length
            ? ' | ' + Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')
            : '';
          const time = entry.time != null ? `[${entry.time}s]` : '';
          const line = `${time} [${system}] [${lv}] ${message}${dataStr}`;
          if (lv === 'error') console.error(line);
          else if (lv === 'warn') console.warn(line);
          else console.log(line);
        };
        const parsed = JSON.parse(body);
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        entries.forEach(parseOne);
      } catch (e) {
        console.error('[log-relay] Parse error:', e.message);
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  next?.();
}

module.exports = { handleApi, broadcast, getLogRelayConfig, buildLogUrlParams };
