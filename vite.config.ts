import { defineConfig } from 'vite';
import apiPlugin from './server/vite-plugin-api.js';

export default defineConfig({
  plugins: [apiPlugin()],
  server: {
    host: '0.0.0.0'
  },
  build: {
    sourcemap: true
  }
});
