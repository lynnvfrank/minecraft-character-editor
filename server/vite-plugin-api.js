const { handleApi } = require('./api.js');

module.exports = function apiPlugin() {
  return {
    name: 'api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handleApi(req, res, next);
      });
    },
  };
};
