const { handleApi, getLogRelayConfig, buildLogUrlParams } = require('./api.js');

module.exports = function apiPlugin() {
  return {
    name: 'api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handleApi(req, res, next);
      });

      server.httpServer?.once('listening', () => {
        const host = server.config.server.host || 'localhost';
        const port = server.config.server.port || 5173;
        const base = `http://${host === true ? 'localhost' : host}:${port}`;
        const qs = buildLogUrlParams();
        const url = qs ? `${base}/?${qs}` : `${base}/`;
        const urlChatOnly = qs ? `${base}/?${qs}&controls=0` : `${base}/?controls=0`;

        console.log('\n  ➜  App: ' + url);
        console.log('  ➜  Character creator: ' + base + '/#/creator');
        console.log('  ➜  Chat only (hide controls): ' + urlChatOnly);
        console.log('  ➜  Movement controls (debug): ' + base + '/?movementcontrols=1');
        console.log('  ➜  With controls + chat: ' + base + '/?controls=1&chat=1');
        const { relay } = getLogRelayConfig();
        if (relay) {
          console.log(
            '  ➜  Cursor Simple Browser: Cmd+Shift+P → "Simple Browser: Show" → paste the URL above\n'
          );
        } else {
          console.log('');
        }
      });
    },
  };
};
