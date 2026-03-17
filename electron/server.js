/**
 * Electron app server: Express + Socket.IO, serves built app from dist/.
 * Same API as web server, plus Socket.IO so client receives skin/animation events.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { handleApi, setSocketIo } = require('../server/api.js');

const DEFAULT_PORT = 5173;

/**
 * @param {{ distDir: string; port?: number }} opts
 * @returns {{ server: import('http').Server; io: import('socket.io').Server; port: number }}
 */
function createAppServer(opts = {}) {
  const distDir = opts.distDir || path.join(__dirname, '..', 'dist');
  const port = opts.port || DEFAULT_PORT;

  const app = express();
  const server = createServer(app);

  app.use((req, res, next) => {
    handleApi(req, res, () => next());
  });

  app.use(express.static(distDir));

  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const io = new Server(server, {
    cors: { origin: false },
    transports: ['websocket', 'polling']
  });
  setSocketIo(io);

  return { server, io, port };
}

/**
 * Start the server, resolve with { server, io, port } when listening.
 * @param {Object} opts
 * @param {string} [opts.distDir]
 * @param {number} [opts.port]
 */
function startServer(opts = {}) {
  const { server, io, port } = createAppServer(opts);
  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      resolve({ server, io, port });
    });
    server.on('error', reject);
  });
}

module.exports = { createAppServer, startServer, DEFAULT_PORT };
