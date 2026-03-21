/**
 * Operation registry and dispatcher.
 */

import path from 'path';
import { matchesPatterns } from '../matcher';
import { runNpmTask } from './runNpmTask';
import { indexToQdrant } from './indexToQdrant';
import type { FileOperation, FileEventType } from '../types';

type PendingItem = { path: string; eventType: FileEventType };
const pendingByOp = new Map<string, { items: Map<string, PendingItem>; timer: ReturnType<typeof setTimeout> }>();

function debounceDispatch(
  op: FileOperation,
  relativePath: string,
  eventType: FileEventType,
  projectRoot: string,
  debounceMs = 300
): void {
  const key = op.name;
  let pending = pendingByOp.get(key);

  if (!pending) {
    pending = {
      items: new Map(),
      timer: setTimeout(() => {
        pendingByOp.delete(key);
        const items = Array.from(pending!.items.values());
        dispatchOperation(op, items, projectRoot);
      }, debounceMs),
    };
    pendingByOp.set(key, pending);
  }

  pending.items.set(relativePath, { path: relativePath, eventType });
}

async function dispatchOperation(
  op: FileOperation,
  items: PendingItem[],
  projectRoot: string
): Promise<void> {
  try {
    const paths = items.map((i) => i.path);
    if (op.handler === 'indexToQdrant') {
      for (const item of items) {
        await indexToQdrant(
          [item.path],
          item.eventType,
          (op.options ?? {}) as Parameters<typeof indexToQdrant>[2],
          projectRoot
        );
      }
    } else if (op.handler === 'runNpmTask') {
      await runNpmTask(paths, (op.options ?? {}) as Parameters<typeof runNpmTask>[1]);
    } else {
      console.warn(`[file-watcher] Unknown handler: ${op.handler}`);
    }
  } catch (e) {
    console.error(`[file-watcher] Operation ${op.name} failed:`, e);
  }
}

export function dispatchForFile(
  absolutePath: string,
  eventType: FileEventType,
  operations: FileOperation[],
  watchInclude: string[],
  watchExclude: string[],
  projectRoot: string
): void {
  const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join('/');

  for (const op of operations) {
    if (!matchesPatterns(relativePath, op.match, op.exclude)) continue;

    const debounce = op.handler === 'runNpmTask' ? (op.options as { debounceMs?: number })?.debounceMs ?? 500 : 300;
    debounceDispatch(op, relativePath, eventType, projectRoot, debounce);
  }
}
