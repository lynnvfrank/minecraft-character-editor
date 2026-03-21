/**
 * Match file paths against include/exclude glob patterns.
 */

import path from 'path';
import { minimatch } from 'minimatch';
import type { GlobPattern } from './types';

/** Normalize path separators for consistent matching */
function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
}

export function matchesPatterns(
  filePath: string,
  include: GlobPattern[],
  exclude: GlobPattern[] = []
): boolean {
  const normalized = normalizePath(filePath);

  const included = include.length === 0 || include.some((pat) => minimatch(normalized, pat));
  if (!included) return false;

  const excluded = exclude.some((pat) => minimatch(normalized, pat));
  return !excluded;
}
