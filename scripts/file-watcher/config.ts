/**
 * Load and merge file watcher configuration.
 * Looks for: ./file-watcher.config.json, ./.file-watcher.json, ./scripts/file-watcher/file-watcher.config.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FileWatcherConfig } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

const CONFIG_PATHS = [
  path.join(PROJECT_ROOT, 'file-watcher.config.json'),
  path.join(PROJECT_ROOT, '.file-watcher.json'),
  path.join(__dirname, 'file-watcher.config.json'),
];

const DEFAULT_CONFIG: FileWatcherConfig = {
  watch: {
    base: '.',
    include: ['**/*'],
    exclude: [
      'node_modules',
      'node_modules/**',
      'dist/**',
      '.git/**',
      'release/**',
      '*.tgz',
      'public/wardrobe/parts/**',
      'public/wardrobe/skins/previews/**',
    ],
    ignoreInitial: false,
  },
  operations: [
    {
      name: 'index-docs-src',
      match: ['src/**/*.ts', 'src/**/*.tsx', 'docs/**/*.md'],
      exclude: ['**/*.test.*', '**/*.spec.*'],
      handler: 'indexToQdrant',
      options: {
        collection: 'codebase',
        url: process.env.QDRANT_URL || 'http://localhost:6333',
      },
    },
    {
      name: 'regenerate-wardrobe-assets',
      match: [
        'public/wardrobe/skins/*.png',
        'public/wardrobe/skins/index.json',
        'src/config/preview/**/*.json',
      ],
      handler: 'runNpmTask',
      options: { task: 'assets:generate', debounceMs: 500 },
    },
  ],
};

export function loadConfig(overridePath?: string): FileWatcherConfig {
  const paths = overridePath ? [overridePath] : CONFIG_PATHS;

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const loaded = JSON.parse(raw) as Partial<FileWatcherConfig>;
        return mergeConfig(DEFAULT_CONFIG, loaded);
      }
    } catch (e) {
      console.warn(`[file-watcher] Failed to load config from ${p}:`, e);
    }
  }

  return DEFAULT_CONFIG;
}

function mergeConfig(
  base: FileWatcherConfig,
  overrides: Partial<FileWatcherConfig>
): FileWatcherConfig {
  return {
    watch: {
      ...base.watch,
      ...overrides.watch,
      include: overrides.watch?.include ?? base.watch.include,
      exclude: overrides.watch?.exclude ?? base.watch.exclude,
    },
    operations: overrides.operations ?? base.operations,
  };
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
