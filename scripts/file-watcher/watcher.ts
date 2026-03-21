/**
 * Chokidar-based file watcher.
 * Watches configured paths, filters by include/exclude, dispatches to operations.
 */

import path from 'path';
import chokidar from 'chokidar';
import { matchesPatterns } from './matcher';
import { dispatchForFile } from './operations';
import { loadConfig, getProjectRoot } from './config';
import type { FileEventType } from './types';

export function startWatcher(configPath?: string): () => void {
  const config = loadConfig(configPath);
  const projectRoot = path.resolve(getProjectRoot());
  const watch = config.watch;

  const basePaths = Array.isArray(watch.base) ? watch.base : [watch.base ?? '.'];
  const include = watch.include ?? ['**/*'];
  const exclude = watch.exclude ?? [];
  const ignoreInitial = watch.ignoreInitial ?? false;

  const watchPaths = basePaths.map((b) => path.join(projectRoot, b));

  const watcher = chokidar.watch(watchPaths, {
    ignored: (p) => {
      const rel = path.relative(projectRoot, p).split(path.sep).join('/');
      if (!matchesPatterns(rel, include, exclude)) return true;
      return false;
    },
    ignoreInitial,
    persistent: true,
  });

  const handler = (eventType: FileEventType) => (filePath: string) => {
    const rel = path.relative(projectRoot, filePath).split(path.sep).join('/');
    if (!matchesPatterns(rel, include, exclude)) return;
    dispatchForFile(filePath, eventType, config.operations, include, exclude, projectRoot);
  };

  watcher.on('add', handler('add'));
  watcher.on('change', handler('change'));
  watcher.on('unlink', handler('unlink'));

  watcher.on('ready', () => {
    console.log(`[file-watcher] Watching ${watchPaths.join(', ')}`);
    console.log(`[file-watcher] Operations: ${config.operations.map((o) => o.name).join(', ')}`);
  });

  watcher.on('error', (err) => console.error('[file-watcher] Error:', err));

  return () => watcher.close();
}
