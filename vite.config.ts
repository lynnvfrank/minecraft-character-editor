import { defineConfig } from 'vite';
import apiPlugin from './server/vite-plugin-api.js';

export default defineConfig({
  plugins: [apiPlugin()],
  build: {
    sourcemap: true
  }
});
