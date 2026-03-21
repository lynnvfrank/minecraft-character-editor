#!/usr/bin/env node

import 'dotenv/config';

/**
 * File watcher CLI.
 * Watches files per config, runs operations on add/change/unlink.
 *
 * Config: file-watcher.config.json or .file-watcher.json in project root.
 *
 * Usage:
 *   npx tsx scripts/file-watcher/cli.ts
 *   npx tsx scripts/file-watcher/cli.ts --config ./my-config.json
 *
 * Env:
 *   QDRANT_URL      - Qdrant server URL (default: http://localhost:6333)
 *   EMBEDDER_MODULE - Path to embedder module for indexToQdrant
 */

import { startWatcher } from './watcher';

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : undefined;

const stop = startWatcher(configPath);

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
