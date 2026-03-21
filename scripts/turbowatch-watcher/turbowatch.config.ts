/**
 * Turbowatch-based file watcher.
 * Alternative to the chokidar-based file-watcher. Uses Turbowatch expressions and onChange handlers.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig, type ChangeEvent, type Expression } from 'turbowatch';
import { indexToQdrant } from '../file-watcher/operations/indexToQdrant';
import type { IndexToQdrantOptions } from '../file-watcher/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Docs + source: src ts/tsx, docs md, excluding test/spec */
const docsSrcExpression: Expression = [
  'allof',
  ['not', ['dirname', 'node_modules']],
  ['not', ['dirname', 'dist']],
  [
    'anyof',
    ['allof', ['dirname', 'src'], ['anyof', ['match', '*.ts', 'basename'], ['match', '*.tsx', 'basename']]],
    ['allof', ['dirname', 'docs'], ['match', '*.md', 'basename']],
  ],
  [
    'not',
    [
      'anyof',
      ['match', '*.test.ts', 'basename'],
      ['match', '*.test.tsx', 'basename'],
      ['match', '*.spec.ts', 'basename'],
      ['match', '*.spec.tsx', 'basename'],
    ],
  ],
];

/** Wardrobe assets: skins, index.json, preview configs */
const wardrobeAssetsExpression: Expression = [
  'anyof',
  ['match', '**/wardrobe/skins/*.png', 'wholename'],
  ['match', '**/wardrobe/skins/index.json', 'wholename'],
  ['match', '**/config/preview/**/*.json', 'wholename'],
];

const indexOptions: IndexToQdrantOptions = {
  collection: 'codebase',
  url: process.env.QDRANT_URL || 'http://localhost:6333',
};

export default defineConfig({
  project: PROJECT_ROOT,
  debounce: { wait: 500 },
  triggers: [
    {
      name: 'index-docs-src',
      expression: docsSrcExpression,
      initialRun: false,
      interruptible: false,
      onChange: async ({ files }: ChangeEvent) => {
        const paths = files.map((f) => f.name);
        const results: { path: string; eventType: 'add' | 'change' | 'unlink' }[] = [];

        for (const p of paths) {
          const absolutePath = path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
          try {
            fs.accessSync(absolutePath, fs.constants.R_OK);
            results.push({ path: p, eventType: 'change' });
          } catch {
            results.push({ path: p, eventType: 'unlink' });
          }
        }

        for (const { path: p, eventType } of results) {
          await indexToQdrant([p], eventType, indexOptions, PROJECT_ROOT);
        }
      },
    },
    {
      name: 'regenerate-wardrobe-assets',
      expression: wardrobeAssetsExpression,
      initialRun: false,
      interruptible: false,
      onChange: async ({ spawn }: ChangeEvent) => {
        await spawn`npm run assets:generate`;
      },
    },
  ],
});
