/**
 * API handlers for skin/animation control.
 * Used by both the Vite plugin (dev) and Express server (prod).
 */

const { parse: parseUrl } = require('url');
const sseClients = new Set();

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

  next?.();
}

module.exports = { handleApi, broadcast };
