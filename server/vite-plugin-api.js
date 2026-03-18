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
        const displayHost = host === true || host === '0.0.0.0' || host === '::' ? 'localhost' : host;
        const base = `http://${displayHost}:${port}`;
        const qs = buildLogUrlParams();
        const baseParams = new URLSearchParams(qs);
        const buildUrl = (extraParams = {}) => {
          const params = new URLSearchParams(baseParams.toString());
          for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
          const query = params.toString();
          return query ? `${base}/?${query}` : `${base}/`;
        };
        const buildHashUrl = (hash, extraParams = {}) => {
          const params = new URLSearchParams(baseParams.toString());
          for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
          const query = params.toString();
          return query ? `${base}/?${query}${hash}` : `${base}/${hash}`;
        };
        const { relay, level } = getLogRelayConfig();
        const loggingLevel = level || 'trace';
        const systems = ['animation', 'stateMachine', 'messaging', 'position', 'renderer', 'input', 'general', 'transition'];

        console.log('\n  ➜  App: ' + buildUrl());
        console.log('  ➜  Character creator: ' + base + '/#/creator');
        console.log('  ➜  Preview camera controls: ' + buildHashUrl('#/preview', { previewcontrols: 1 }));
        console.log('  ➜  Movement controls (debug): ' + buildUrl({ movementcontrols: 1 }));
        console.log('\n  ➜  Logging specific components');
        console.log('      component      url');
        for (const system of systems) {
          const params = { log: `${system}:${loggingLevel}` };
          if (relay) params.logRelay = 1;
          const line = `      ${system.padEnd(14)} ${buildUrl(params)}`;
          console.log(line);
        }
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
