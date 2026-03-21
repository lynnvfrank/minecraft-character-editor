/**
 * Run an npm script when matched files change.
 * Debounces rapid changes.
 */

import { spawn } from 'child_process';
import path from 'path';
import type { RunNpmTaskOptions } from '../types';

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function runNpmTask(
  _paths: string[],
  options: RunNpmTaskOptions
): Promise<void> {
  const task = options.task;
  const debounceMs = options.debounceMs ?? 500;
  const key = `npm:${task}`;

  const run = () => {
    debounceTimers.delete(key);
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('npm', ['run', task], {
        stdio: 'inherit',
        shell: true,
        cwd: path.resolve(),
      });
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm run ${task} exited ${code}`))));
    });
  };

  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      run().catch((err) => console.error(`[file-watcher] npm run ${task} failed:`, err));
    }, debounceMs)
  );
}
